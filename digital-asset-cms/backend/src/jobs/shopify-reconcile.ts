import path from 'path';
import { Readable } from 'stream';
import { db } from '../db/connection.js';
import { shopifyService as defaultShopifyService, type ShopifyService } from '../services/shopify.service.js';
import { driveService as defaultDriveService, type DriveService } from '../services/drive.service.js';
import { upsertProduct, upsertVariant } from '../services/product.service.js';
import { refreshSearchView } from '../services/asset.service.js';
import { getSetting, DRIVE_FOLDER_KEY } from '../services/settings.service.js';
import { config } from '../config/index.js';
import { createJob, setJobRunning, updateJobProgress, completeJob, failJob } from '../services/job.service.js';

// ── Helper: fetch all Shopify products across pages ───────────────────────────

async function fetchAllShopifyProducts(shopify: ShopifyService) {
  const all: import('../services/shopify.service.js').ShopifyProduct[] = [];
  let cursor: string | undefined;
  do {
    const { products, nextCursor } = await shopify.fetchProducts(cursor);
    all.push(...products);
    cursor = nextCursor;
  } while (cursor);
  return all;
}

// ── Sync products ─────────────────────────────────────────────────────────────

export async function runSyncProducts(
  jobId: string,
  shopify: ShopifyService = defaultShopifyService
): Promise<void> {
  await setJobRunning(jobId);
  try {
    let cursor: string | undefined;
    let totalProducts = 0;

    do {
      const { products, nextCursor } = await shopify.fetchProducts(cursor);
      for (const product of products) {
        const cmsProduct = await upsertProduct(product.id, {
          title: product.title,
          vendor: product.vendor ?? null,
          category: product.product_type ?? null,
          status: product.status ?? 'active',
          shopifyTags: product.tags ? product.tags.split(', ').filter(Boolean) : [],
          shopifyCreatedAt: product.created_at ?? null,
        });
        for (const variant of product.variants) {
          await upsertVariant(cmsProduct['id'] as string, variant.id, {
            sku: variant.sku ?? null,
            title: variant.title ?? null,
            price: variant.price ?? null,
            inventory_quantity: variant.inventory_quantity ?? null,
          });
        }
        totalProducts++;
      }
      cursor = nextCursor;
    } while (cursor);

    await refreshSearchView().catch(() => {});
    await completeJob(jobId, { products_synced: totalProducts });
  } catch (err) {
    await failJob(jobId, err instanceof Error ? err.message : String(err));
  }
}

// ── Import images ─────────────────────────────────────────────────────────────

export async function runImportImages(
  jobId: string,
  shopify: ShopifyService = defaultShopifyService,
  drive: DriveService = defaultDriveService,
  statuses: string[] = ['active']
): Promise<void> {
  await setJobRunning(jobId);
  try {
    const activeFolderId = (await getSetting(DRIVE_FOLDER_KEY)) ?? config.GOOGLE_DRIVE_FOLDER_ID ?? undefined;

    const cmsProducts = await db('products')
      .whereNotNull('shopify_id')
      .whereIn('status', statuses)
      .select('id', 'shopify_id');

    let imported = 0;
    let skipped = 0;
    let processed = 0;
    const total = cmsProducts.length;

    for (const product of cmsProducts) {
      const images = await shopify.fetchProductImages(String(product.shopify_id));

      for (const image of images) {
        const rawName = path.basename(new URL(image.src).pathname);
        // Strip query strings if any leaked into the name
        const fileName = rawName.split('?')[0] ?? rawName;

        const existing = await db('assets')
          .whereNot('status', 'deleted')
          .where((q) =>
            q.where('shopify_image_id', String(image.id)).orWhere('file_name', fileName)
          )
          .first();
        if (existing) {
          const backfill: Record<string, unknown> = {};
          if (!existing.shopify_image_id) backfill['shopify_image_id'] = String(image.id);
          if (existing.alt_text == null && image.alt) backfill['alt_text'] = image.alt;
          if (Object.keys(backfill).length > 0) {
            await db('assets').where('id', existing.id).update(backfill);
          }
          skipped++;
          continue;
        }

        const imageStream = await shopify.fetchImageStream(image.src);
        const chunks: Buffer[] = [];
        for await (const chunk of imageStream) {
          chunks.push(chunk as Buffer);
        }
        const buffer = Buffer.concat(chunks);

        const { id: driveId, webViewLink } = await drive.uploadFile(
          Readable.from(buffer),
          { name: fileName, mimeType: 'image/jpeg', size: buffer.length },
          activeFolderId
        );

        const [asset] = await db('assets')
          .insert({
            file_name: fileName,
            asset_type: 'image',
            mime_type: 'image/jpeg',
            file_size_bytes: buffer.length,
            google_drive_id: driveId,
            google_drive_url: webViewLink || null,
            status: 'active',
            tags: JSON.stringify({}),
            alt_text: image.alt ?? null,
            shopify_image_id: String(image.id),
            version: 1,
          })
          .returning('*');

        const role = image.position === 1 ? 'hero' : 'gallery';

        let variantId: string | null = null;
        if (image.variant_ids && image.variant_ids.length > 0) {
          const variantRow = await db('product_variants')
            .where('product_id', product.id)
            .where('shopify_variant_id', image.variant_ids[0])
            .first();
          if (variantRow) variantId = variantRow.id as string;
        }

        await db('asset_products').insert({
          asset_id: (asset as Record<string, unknown>)['id'],
          product_id: product.id,
          variant_id: variantId,
          role,
          sort_order: image.position,
        });

        imported++;
      }

      processed++;
      if (total > 0) {
        await updateJobProgress(jobId, Math.round((processed / total) * 90));
      }
    }

    await refreshSearchView().catch(() => {});
    await completeJob(jobId, { imported, skipped });
  } catch (err) {
    await failJob(jobId, err instanceof Error ? err.message : String(err));
  }
}

// ── Reconciliation ────────────────────────────────────────────────────────────

export async function runReconciliation(
  jobId: string,
  shopify: ShopifyService = defaultShopifyService
): Promise<void> {
  await setJobRunning(jobId);
  try {
    const shopifyProducts = await fetchAllShopifyProducts(shopify);
    const shopifyById = new Map(shopifyProducts.map((p) => [p.id, p]));

    // All CMS products that have a shopify_id (non-deleted)
    const cmsProducts = await db('products')
      .whereNotNull('shopify_id')
      .whereNot('status', 'deleted')
      .select('id', 'shopify_id', 'title', 'vendor', 'status');

    const cmsShopifyIds = new Set(cmsProducts.map((p) => Number(p.shopify_id)));

    let created = 0;
    let updated = 0;
    let orphaned = 0;

    // Create missing products (in Shopify but not in CMS)
    for (const [shopifyId, shopifyProduct] of shopifyById) {
      if (!cmsShopifyIds.has(shopifyId)) {
        await upsertProduct(shopifyId, {
          title: shopifyProduct.title,
          vendor: shopifyProduct.vendor ?? null,
          category: shopifyProduct.product_type ?? null,
          status: 'active',
          shopifyTags: shopifyProduct.tags ? shopifyProduct.tags.split(', ').filter(Boolean) : [],
          shopifyCreatedAt: shopifyProduct.created_at ?? null,
        });
        for (const variant of shopifyProduct.variants) {
          // We need the new CMS product's id — fetch it
          const newProd = await db('products').where('shopify_id', shopifyId).first();
          if (newProd) {
            await upsertVariant(newProd.id as string, variant.id, {
              sku: variant.sku ?? null,
              title: variant.title ?? null,
              price: variant.price ?? null,
              inventory_quantity: variant.inventory_quantity ?? null,
            });
          }
        }
        created++;
      }
    }

    // Update stale / flag orphaned (in CMS but not in Shopify)
    for (const cmsProduct of cmsProducts) {
      const shopifyId = Number(cmsProduct.shopify_id);
      const shopifyProduct = shopifyById.get(shopifyId);
      if (!shopifyProduct) {
        // Orphaned — Shopify product no longer exists
        await db('products').where('id', cmsProduct.id).update({ status: 'orphaned' });
        orphaned++;
      } else {
        // Update if stale
        if (shopifyProduct.title !== cmsProduct.title || shopifyProduct.vendor !== cmsProduct.vendor) {
          await upsertProduct(shopifyId, {
            title: shopifyProduct.title,
            vendor: shopifyProduct.vendor ?? null,
            category: shopifyProduct.product_type ?? null,
            status: 'active',
            shopifyTags: shopifyProduct.tags ? shopifyProduct.tags.split(', ').filter(Boolean) : [],
          });
          updated++;
        }
      }
    }

    // ── Check Shopify image status for assets with a shopify_image_id ──────────
    const assetsWithImage = await db('assets')
      .whereNotNull('shopify_image_id')
      .whereNot('status', 'deleted')
      .select('id', 'shopify_image_id');

    let imagesMarkedDeleted = 0;
    let imagesRestored = 0;

    if (assetsWithImage.length > 0) {
      const assetIds = assetsWithImage.map((a) => a.id as string);

      // Find all linked Shopify product IDs for these assets
      const links = await db('asset_products as ap')
        .join('products as p', 'ap.product_id', 'p.id')
        .whereIn('ap.asset_id', assetIds)
        .whereNotNull('p.shopify_id')
        .select('ap.asset_id', 'p.shopify_id');

      // Fetch images once per unique Shopify product
      const uniqueProductIds = [...new Set(links.map((l) => String(l.shopify_id)))];
      const liveImagesByProduct = new Map<string, Set<string>>();
      for (const shopifyProductId of uniqueProductIds) {
        const images = await shopify.fetchProductImages(shopifyProductId);
        liveImagesByProduct.set(shopifyProductId, new Set(images.map((i) => String(i.id))));
      }

      // Map assetId → shopify product IDs it's linked to
      const assetToProducts = new Map<string, string[]>();
      for (const link of links) {
        const existing = assetToProducts.get(link.asset_id as string) ?? [];
        existing.push(String(link.shopify_id));
        assetToProducts.set(link.asset_id as string, existing);
      }

      for (const asset of assetsWithImage) {
        const linkedProductIds = assetToProducts.get(asset.id as string);
        if (!linkedProductIds?.length) continue;

        const imageId = String(asset.shopify_image_id);
        const exists = linkedProductIds.some((pid) => liveImagesByProduct.get(pid)?.has(imageId));

        await db('assets').where('id', asset.id).update({ shopify_image_deleted: !exists });
        if (!exists) imagesMarkedDeleted++;
        else imagesRestored++;
      }
    }

    await refreshSearchView().catch(() => {});
    await completeJob(jobId, { created, updated, orphaned, images_marked_deleted: imagesMarkedDeleted, images_restored: imagesRestored });
  } catch (err) {
    await failJob(jobId, err instanceof Error ? err.message : String(err));
  }
}

// ── Submit helpers ────────────────────────────────────────────────────────────

export async function submitSyncProducts(userId: string): Promise<string> {
  const job = await createJob('shopify_sync_products', userId);
  return job.id;
}

export async function submitImportImages(userId: string): Promise<string> {
  const job = await createJob('shopify_import_images', userId);
  return job.id;
}

export async function submitReconciliation(userId: string): Promise<string> {
  const job = await createJob('shopify_reconcile', userId);
  return job.id;
}
