import type { FastifyPluginAsync } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import { rateLimitErrorBuilder, RATE_LIMIT_HEADERS } from '../utils/rate-limit.js';
import { db } from '../db/connection.js';
import { config } from '../config/index.js';
import {
  loginWithPassword,
  rotateRefreshToken,
  invalidateUserRefreshTokens,
  hashRefreshToken,
} from '../services/auth.service.js';

const REFRESH_COOKIE = 'refresh_token';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env['NODE_ENV'] === 'production',
  sameSite: 'strict' as const,
  path: '/',
  maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
};

const authRoutes: FastifyPluginAsync = async (fastify) => {
  // Rate limiting scoped to auth routes: 10 req/min per IP (§5.2)
  await fastify.register(fastifyRateLimit, {
    max: 10,
    timeWindow: '1 minute',
    keyGenerator: (request) => `auth:ip:${request.ip}`,
    errorResponseBuilder: rateLimitErrorBuilder,
    addHeaders: RATE_LIMIT_HEADERS,
  });

  // POST /api/auth/login — email + password
  fastify.post('/login', async (request, reply) => {
    const { email, password } = request.body as { email?: string; password?: string };

    if (!email || !password) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'email and password are required' },
      });
    }

    const result = await loginWithPassword(db, email, password, config.JWT_SECRET);

    if (!result.success) {
      if (result.reason === 'deactivated') {
        return reply.status(401).send({
          error: { code: 'ACCOUNT_DEACTIVATED', message: 'This account has been deactivated' },
        });
      }
      return reply.status(401).send({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      });
    }

    reply.setCookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTIONS);
    return reply.status(200).send({ accessToken: result.accessToken });
  });

  // POST /api/auth/google — Google OAuth ID token verification
  fastify.post('/google', async (request, reply) => {
    const { idToken } = request.body as { idToken?: string };

    if (!idToken) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'idToken is required' },
      });
    }

    // Verify the Google ID token
    const { OAuth2Client } = await import('google-auth-library');
    const client = new OAuth2Client(config.GOOGLE_OAUTH_CLIENT_ID);

    let email: string;
    let name: string;
    try {
      const ticket = await client.verifyIdToken({
        idToken,
        audience: config.GOOGLE_OAUTH_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      if (!payload?.email) throw new Error('No email in token');
      email = payload.email;
      name = payload.name ?? email;
    } catch {
      return reply.status(401).send({
        error: { code: 'INVALID_TOKEN', message: 'Invalid Google ID token' },
      });
    }

    const user = await db('users').where('email', email).first();
    if (!user) {
      return reply.status(401).send({
        error: { code: 'USER_NOT_FOUND', message: 'No account found for this Google account' },
      });
    }
    if (user.status !== 'active') {
      return reply.status(401).send({
        error: { code: 'ACCOUNT_DEACTIVATED', message: 'This account has been deactivated' },
      });
    }

    // Update name if it has changed
    if (user.name !== name) {
      await db('users').where('id', user.id).update({ name, updated_at: new Date() });
    }

    const { generateRefreshToken, storeRefreshToken, createAccessToken } = await import(
      '../services/auth.service.js'
    );
    const refreshToken = generateRefreshToken();
    await storeRefreshToken(db, user.id, refreshToken);
    const accessToken = createAccessToken(user.id, user.role, config.JWT_SECRET);

    reply.setCookie(REFRESH_COOKIE, refreshToken, COOKIE_OPTIONS);
    return reply.status(200).send({ accessToken });
  });

  // POST /api/auth/refresh — single-use refresh token rotation (§8.2)
  fastify.post('/refresh', async (request, reply) => {
    const rawToken = request.cookies[REFRESH_COOKIE];

    if (!rawToken) {
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'No refresh token provided' },
      });
    }

    const result = await rotateRefreshToken(db, rawToken, config.JWT_SECRET);

    if (!result.success) {
      // Clear the stale cookie
      reply.clearCookie(REFRESH_COOKIE, { path: '/' });
      return reply.status(401).send({
        error: {
          code: 'INVALID_REFRESH_TOKEN',
          message: result.reason === 'theft' ? 'Token reuse detected — please log in again' : 'Refresh token is invalid or expired',
        },
      });
    }

    reply.setCookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTIONS);
    return reply.status(200).send({ accessToken: result.accessToken });
  });

  // POST /api/auth/logout — invalidate the refresh token
  fastify.post('/logout', async (request, reply) => {
    const rawToken = request.cookies[REFRESH_COOKIE];

    if (rawToken) {
      const tokenHash = hashRefreshToken(rawToken);
      const existing = await db('refresh_tokens').where('token_hash', tokenHash).first();
      if (existing) {
        await invalidateUserRefreshTokens(db, existing.user_id);
      }
    }

    reply.clearCookie(REFRESH_COOKIE, { path: '/' });
    return reply.status(200).send({ message: 'Logged out' });
  });
};

export default authRoutes;
