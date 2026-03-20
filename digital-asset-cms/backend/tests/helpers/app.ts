import { buildApp } from '../../src/app.js';
import type { FastifyInstance } from 'fastify';

let _app: FastifyInstance | null = null;

export async function getTestApp(): Promise<FastifyInstance> {
  if (!_app) {
    _app = buildApp();
    await _app.ready();
  }
  return _app;
}

export async function closeTestApp(): Promise<void> {
  if (_app) {
    await _app.close();
    _app = null;
  }
}
