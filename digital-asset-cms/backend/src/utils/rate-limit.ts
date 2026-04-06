import type { FastifyRequest } from 'fastify';
import { verifyAccessToken } from '../services/auth.service.js';
import { config } from '../config/index.js';

export interface RateLimitContext {
  after: string;
  max: number;
  ttl: number;
  ban?: boolean;
  statusCode?: number;
}

export function rateLimitErrorBuilder(_request: FastifyRequest, context: RateLimitContext): object {
  return {
    statusCode: context.statusCode ?? 429,
    code: 'RATE_LIMIT_EXCEEDED',
    message: `Rate limit exceeded. Retry after ${context.after}`,
    retryAfter: context.after,
    limit: context.max,
  };
}

export function crudRateLimitKey(request: FastifyRequest): string {
  const header = request.headers['authorization'];
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    try {
      const payload = verifyAccessToken(header.slice(7), config.JWT_SECRET);
      return `crud:user:${payload.user_id}`;
    } catch {
      // fall through to IP-based key
    }
  }
  return `crud:ip:${request.ip}`;
}

export function bulkRateLimitKey(request: FastifyRequest): string {
  const header = request.headers['authorization'];
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    try {
      const payload = verifyAccessToken(header.slice(7), config.JWT_SECRET);
      return `bulk:user:${payload.user_id}`;
    } catch {
      // fall through to IP-based key
    }
  }
  return `bulk:ip:${request.ip}`;
}

export const RATE_LIMIT_HEADERS = {
  'x-ratelimit-limit': true as const,
  'x-ratelimit-remaining': true as const,
  'x-ratelimit-reset': true as const,
  'retry-after': true as const,
};
