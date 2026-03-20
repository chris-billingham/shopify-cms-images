import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'crypto';
import type { Knex } from 'knex';

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ACCESS_TOKEN_EXPIRY = '15m';

export interface AccessTokenPayload {
  user_id: string;
  role: string;
}

// ── Password ──────────────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// ── JWT ───────────────────────────────────────────────────────────────────────

export function createAccessToken(userId: string, role: string, secret: string): string {
  return jwt.sign({ user_id: userId, role }, secret, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

export function verifyAccessToken(token: string, secret: string): AccessTokenPayload {
  const decoded = jwt.verify(token, secret);
  if (typeof decoded === 'string') throw new Error('Invalid token payload');
  return decoded as AccessTokenPayload;
}

// ── Refresh Tokens ────────────────────────────────────────────────────────────

export function generateRefreshToken(): string {
  return randomBytes(40).toString('hex');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function storeRefreshToken(db: Knex, userId: string, rawToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(rawToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  await db('refresh_tokens').insert({ user_id: userId, token_hash: tokenHash, expires_at: expiresAt });
}

export async function invalidateUserRefreshTokens(db: Knex, userId: string): Promise<void> {
  await db('refresh_tokens').where('user_id', userId).delete();
}

// ── Rotation (with theft detection per §8.2) ──────────────────────────────────

export type RotateResult =
  | { success: true; accessToken: string; refreshToken: string; userId: string }
  | { success: false; reason: 'not_found' | 'expired' | 'theft' | 'user_inactive' };

export async function rotateRefreshToken(
  db: Knex,
  rawToken: string,
  jwtSecret: string
): Promise<RotateResult> {
  const tokenHash = hashRefreshToken(rawToken);
  const existing = await db('refresh_tokens').where('token_hash', tokenHash).first();

  if (!existing) {
    return { success: false, reason: 'not_found' };
  }

  if (existing.used) {
    // Theft detection: a used token was presented — invalidate all tokens for this user
    await db('refresh_tokens').where('user_id', existing.user_id).delete();
    return { success: false, reason: 'theft' };
  }

  if (new Date(existing.expires_at) < new Date()) {
    await db('refresh_tokens').where('id', existing.id).delete();
    return { success: false, reason: 'expired' };
  }

  // Mark current token as used before issuing new one
  await db('refresh_tokens').where('id', existing.id).update({ used: true });

  const user = await db('users').where('id', existing.user_id).first();
  if (!user || user.status !== 'active') {
    return { success: false, reason: 'user_inactive' };
  }

  const newRefreshToken = generateRefreshToken();
  await storeRefreshToken(db, user.id, newRefreshToken);
  const accessToken = createAccessToken(user.id, user.role, jwtSecret);

  return { success: true, accessToken, refreshToken: newRefreshToken, userId: user.id };
}

// ── Email/Password Login ───────────────────────────────────────────────────────

export type LoginResult =
  | { success: true; accessToken: string; refreshToken: string; userId: string }
  | { success: false; reason: 'not_found' | 'wrong_password' | 'deactivated' };

export async function loginWithPassword(
  db: Knex,
  email: string,
  password: string,
  jwtSecret: string
): Promise<LoginResult> {
  const user = await db('users').where('email', email).first();

  if (!user || !user.password_hash) {
    return { success: false, reason: 'not_found' };
  }

  if (user.status !== 'active') {
    return { success: false, reason: 'deactivated' };
  }

  const valid = await verifyPassword(user.password_hash, password);
  if (!valid) {
    return { success: false, reason: 'wrong_password' };
  }

  const refreshToken = generateRefreshToken();
  await storeRefreshToken(db, user.id, refreshToken);
  const accessToken = createAccessToken(user.id, user.role, jwtSecret);

  return { success: true, accessToken, refreshToken, userId: user.id };
}
