import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken } from '../services/auth.service.js';
import { config } from '../config/index.js';
import { db } from '../db/connection.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { user_id: string; role: string };
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return reply.status(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authorization header' },
    });
  }

  const token = header.slice(7);
  let payload: { user_id: string; role: string };

  try {
    payload = verifyAccessToken(token, config.JWT_SECRET);
  } catch {
    return reply.status(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' },
    });
  }

  // Deactivated users must be rejected even with a valid token (§8.3)
  const user = await db('users').where('id', payload.user_id).first();
  if (!user || user.status !== 'active') {
    return reply.status(401).send({
      error: { code: 'UNAUTHORIZED', message: 'User account is deactivated' },
    });
  }

  request.user = { user_id: payload.user_id, role: payload.role };
}

export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
      });
    }
    if (!roles.includes(request.user.role)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Insufficient permissions' },
      });
    }
  };
}
