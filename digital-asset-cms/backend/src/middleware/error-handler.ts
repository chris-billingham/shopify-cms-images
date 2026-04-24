import type { FastifyRequest, FastifyReply } from 'fastify';
import { AssetNotFoundError, AssetValidationError, OptimisticLockError } from '../services/asset.service.js';
import { ProductNotFoundError } from '../services/product.service.js';
import { DuplicateLinkError, LinkNotFoundError } from '../services/link.service.js';
import { DriveStorageFullError } from '../services/drive.service.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyError = any;

export function globalErrorHandler(error: AnyError, _request: FastifyRequest, reply: FastifyReply): void {
  // Rate limit errors (thrown by @fastify/rate-limit via errorResponseBuilder)
  if (error?.code === 'RATE_LIMIT_EXCEEDED') {
    reply.status(error.statusCode ?? 429).send({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: error.message,
        details: { retryAfter: error.retryAfter, limit: error.limit },
      },
    });
    return;
  }

  if (error instanceof AssetNotFoundError) {
    reply.status(404).send({ error: { code: 'ASSET_NOT_FOUND', message: error.message, details: {} } });
    return;
  }
  if (error instanceof AssetValidationError) {
    reply.status(400).send({ error: { code: error.code, message: error.message, details: {} } });
    return;
  }
  if (error instanceof OptimisticLockError) {
    reply.status(409).send({ error: { code: 'CONCURRENT_MODIFICATION', message: error.message, details: {} } });
    return;
  }
  if (error instanceof ProductNotFoundError) {
    reply.status(404).send({ error: { code: 'PRODUCT_NOT_FOUND', message: error.message, details: {} } });
    return;
  }
  if (error instanceof DuplicateLinkError) {
    reply.status(409).send({ error: { code: 'DUPLICATE_LINK', message: error.message, details: {} } });
    return;
  }
  if (error instanceof LinkNotFoundError) {
    reply.status(404).send({ error: { code: 'LINK_NOT_FOUND', message: error.message, details: {} } });
    return;
  }
  if (error instanceof DriveStorageFullError) {
    reply.status(507).send({ error: { code: 'DRIVE_STORAGE_FULL', message: error.message, details: {} } });
    return;
  }

  // Fastify schema validation errors
  if (error?.validation) {
    reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        details: { validation: error.validation },
      },
    });
    return;
  }

  const statusCode = (error?.statusCode ?? 500) as number;
  if (statusCode >= 500) reply.log.error(error);
  reply.status(statusCode).send({
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env['NODE_ENV'] === 'production' ? 'Internal server error' : String(error?.message ?? error),
      details: {},
    },
  });
}
