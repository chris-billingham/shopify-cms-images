import { Redis } from 'ioredis';
import { config } from '../config/index.js';

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60; // 24 hours

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(config.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 3 });
  }
  return _redis;
}

export interface CachedResponse {
  statusCode: number;
  body: unknown;
}

export async function checkIdempotencyKey(key: string): Promise<CachedResponse | null> {
  const cached = await getRedis().get(`idem:${key}`);
  if (!cached) return null;
  return JSON.parse(cached) as CachedResponse;
}

export async function storeIdempotencyResult(
  key: string,
  statusCode: number,
  body: unknown
): Promise<void> {
  await getRedis().setex(
    `idem:${key}`,
    IDEMPOTENCY_TTL_SECONDS,
    JSON.stringify({ statusCode, body })
  );
}
