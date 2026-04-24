import crypto from 'crypto';
import { Readable } from 'stream';
import { config } from '../config/index.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ShopifyVariant {
  id: number;
  sku?: string | null;
  title?: string | null;
  price?: string | null;
  inventory_quantity?: number | null;
}

export interface ShopifyProduct {
  id: number;
  title: string;
  vendor?: string | null;
  product_type?: string | null;
  tags?: string | null;
  status?: string | null;
  created_at?: string | null;
  variants: ShopifyVariant[];
}

export interface ShopifyImage {
  id: number;
  product_id: number;
  position: number;
  alt?: string | null;
  src: string;
  width?: number | null;
  height?: number | null;
  variant_ids?: number[];
}

// ── Rate limit error ──────────────────────────────────────────────────────────

export class ShopifyApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ShopifyApiError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseLinkHeader(header: string): string | undefined {
  // Link: <https://store.myshopify.com/admin/api/.../products.json?page_info=abc>; rel="next"
  const match = header.match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/);
  return match?.[1];
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createShopifyService(options?: {
  requester?: (url: string, init: RequestInit) => Promise<Response>;
  throttleDelayMs?: number;
  retryDelayMs?: number;
  webhookSecret?: string;
  storeDomain?: string;
  apiToken?: string;
  apiVersion?: string;
}) {
  const requester = options?.requester ?? ((url: string, init: RequestInit) => fetch(url, init));
  const throttleDelayMs = options?.throttleDelayMs ?? 500;
  const retryDelayMs = options?.retryDelayMs ?? 2000;
  const webhookSecret = options?.webhookSecret ?? config.SHOPIFY_WEBHOOK_SECRET;
  const storeDomain = options?.storeDomain ?? config.SHOPIFY_STORE_DOMAIN;
  const apiToken = options?.apiToken ?? config.SHOPIFY_ADMIN_API_TOKEN;
  const apiVersion = options?.apiVersion ?? '2024-01';
  const baseUrl = `https://${storeDomain}/admin/api/${apiVersion}`;

  let bucketFill = 0;
  let bucketMax = 40;

  function sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  function updateBucket(response: Response): void {
    const header = response.headers.get('X-Shopify-Shop-Api-Call-Limit');
    if (header) {
      const parts = header.split('/');
      const fill = parseInt(parts[0] ?? '0', 10);
      const max = parseInt(parts[1] ?? '40', 10);
      if (!isNaN(fill)) bucketFill = fill;
      if (!isNaN(max) && max > 0) bucketMax = max;
    }
  }

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    // Throttle if bucket is ≥ 80% full
    if (bucketFill / bucketMax >= 0.8) {
      await sleep(throttleDelayMs);
    }

    const url = path.startsWith('http') ? path : `${baseUrl}${path}`;
    const headers: Record<string, string> = {
      'X-Shopify-Access-Token': apiToken,
      'Content-Type': 'application/json',
      ...((init.headers as Record<string, string>) ?? {}),
    };

    let response = await requester(url, { ...init, headers });
    updateBucket(response);

    // Retry on 429
    if (response.status === 429) {
      await sleep(retryDelayMs);
      response = await requester(url, { ...init, headers });
      updateBucket(response);
    }

    return response;
  }

  // ── Public methods ──────────────────────────────────────────────────────────

  async function fetchProducts(cursor?: string): Promise<{
    products: ShopifyProduct[];
    nextCursor?: string;
  }> {
    const path = cursor
      ? `/products.json?limit=250&page_info=${cursor}`
      : '/products.json?limit=250';
    const response = await request(path);
    if (!response.ok) throw new ShopifyApiError(response.status, `fetchProducts failed: ${response.status}`);
    const data = (await response.json()) as { products: ShopifyProduct[] };
    const nextCursor = parseLinkHeader(response.headers.get('Link') ?? '');
    return { products: data.products, nextCursor };
  }

  async function fetchProductImages(shopifyProductId: string | number): Promise<ShopifyImage[]> {
    const response = await request(`/products/${shopifyProductId}/images.json`);
    if (!response.ok) throw new ShopifyApiError(response.status, `fetchProductImages failed: ${response.status}`);
    const data = (await response.json()) as { images: ShopifyImage[] };
    return data.images;
  }

  async function fetchImageStream(url: string): Promise<Readable> {
    const response = await fetch(url);
    if (!response.ok) throw new ShopifyApiError(response.status, `fetchImageStream failed: ${response.status}`);
    // Convert the web ReadableStream to a Node.js Readable
    return Readable.fromWeb(response.body as import('stream/web').ReadableStream);
  }

  async function pushImage(
    shopifyProductId: string | number,
    buffer: Buffer,
    metadata: { filename: string; position?: number; alt?: string | null }
  ): Promise<ShopifyImage> {
    const attachment = buffer.toString('base64');
    const body = JSON.stringify({
      image: {
        attachment,
        filename: metadata.filename,
        position: metadata.position ?? 1,
        alt: metadata.alt ?? null,
      },
    });
    const response = await request(`/products/${shopifyProductId}/images.json`, {
      method: 'POST',
      body,
    });
    if (!response.ok) throw new ShopifyApiError(response.status, `pushImage failed: ${response.status}`);
    const data = (await response.json()) as { image: ShopifyImage };
    return data.image;
  }

  async function updateImagePosition(
    shopifyProductId: string | number,
    shopifyImageId: string | number,
    position: number
  ): Promise<void> {
    const response = await request(`/products/${shopifyProductId}/images/${shopifyImageId}.json`, {
      method: 'PUT',
      body: JSON.stringify({ image: { id: Number(shopifyImageId), position } }),
    });
    if (!response.ok) throw new ShopifyApiError(response.status, `updateImagePosition failed: ${response.status}`);
  }

  function verifyWebhook(rawBody: Buffer, hmacHeader: string): boolean {
    if (!hmacHeader) return false;
    const digest = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('base64');
    try {
      return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
    } catch {
      return false;
    }
  }

  return { fetchProducts, fetchProductImages, fetchImageStream, pushImage, updateImagePosition, verifyWebhook };
}

export type ShopifyService = ReturnType<typeof createShopifyService>;

export const shopifyService = createShopifyService();
