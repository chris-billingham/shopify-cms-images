import { describe, it, expect, vi, afterEach } from 'vitest';
import crypto from 'crypto';
import { createShopifyService } from '../../../src/services/shopify.service.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

// ── 9.T1 — Rate limiting and retry ───────────────────────────────────────────

describe('9.T1 — Shopify rate limiting', () => {
  it('throttles the next request when the bucket fill is >= 80%', async () => {
    vi.useFakeTimers();

    const mockRequester = vi.fn().mockImplementation(async () =>
      makeResponse({ products: [] }, 200, {
        'X-Shopify-Shop-Api-Call-Limit': '38/40', // 95% full
        'Link': '',
      })
    );

    const shopify = createShopifyService({
      requester: mockRequester,
      throttleDelayMs: 500,
      retryDelayMs: 1000,
    });

    // First call — bucket starts at 0, no throttle
    await shopify.fetchProducts();
    expect(mockRequester).toHaveBeenCalledTimes(1);

    // After first call bucket = 38/40 (>= 80%), next call will sleep(500)
    let secondResolved = false;
    const secondCallPromise = shopify.fetchProducts().then(() => {
      secondResolved = true;
    });

    // Flush microtasks — second call is blocked on sleep, not yet made
    await Promise.resolve();
    await Promise.resolve();
    expect(secondResolved).toBe(false);
    expect(mockRequester).toHaveBeenCalledTimes(1); // still only 1

    // Advance past throttle delay
    await vi.advanceTimersByTimeAsync(500);
    await secondCallPromise;

    expect(secondResolved).toBe(true);
    expect(mockRequester).toHaveBeenCalledTimes(2);
  });

  it('does not throttle when bucket fill is < 80%', async () => {
    vi.useFakeTimers();

    const mockRequester = vi.fn().mockImplementation(async () =>
      makeResponse({ products: [] }, 200, {
        'X-Shopify-Shop-Api-Call-Limit': '20/40', // 50% — below threshold
      })
    );

    const shopify = createShopifyService({ requester: mockRequester, throttleDelayMs: 500 });

    await shopify.fetchProducts();
    // Second call should go through immediately (no throttle timer)
    const p = shopify.fetchProducts();
    // Should already be done or nearly done — no timer blocking it
    await vi.advanceTimersByTimeAsync(0);
    await p;

    expect(mockRequester).toHaveBeenCalledTimes(2);
  });

  it('retries once on a 429 response and succeeds', async () => {
    vi.useFakeTimers();

    const mockRequester = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockImplementation(async () =>
        makeResponse({ products: [{ id: 1, title: 'P', variants: [] }] }, 200, {
          'X-Shopify-Shop-Api-Call-Limit': '1/40',
        })
      );

    const shopify = createShopifyService({
      requester: mockRequester,
      throttleDelayMs: 100,
      retryDelayMs: 1000,
    });

    let done = false;
    const callPromise = shopify.fetchProducts().then(() => { done = true; });

    // After the 429 the service sleeps retryDelayMs before retrying
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    await callPromise;

    expect(done).toBe(true);
    expect(mockRequester).toHaveBeenCalledTimes(2);
  });
});

// ── Webhook verification ──────────────────────────────────────────────────────

describe('verifyWebhook', () => {
  it('accepts a valid HMAC signature', () => {
    const secret = 'test-webhook-secret';
    const body = Buffer.from('{"id":1}');
    const shopify = createShopifyService({ webhookSecret: secret });

    const expected = crypto.createHmac('sha256', secret).update(body).digest('base64');

    expect(shopify.verifyWebhook(body, expected)).toBe(true);
  });

  it('rejects an invalid HMAC signature', () => {
    const shopify = createShopifyService({ webhookSecret: 'secret' });
    expect(shopify.verifyWebhook(Buffer.from('body'), 'wrong-hmac')).toBe(false);
  });

  it('rejects an empty HMAC header', () => {
    const shopify = createShopifyService({ webhookSecret: 'secret' });
    expect(shopify.verifyWebhook(Buffer.from('body'), '')).toBe(false);
  });
});
