import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  hashPassword,
  verifyPassword,
  createAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
} from '../../../src/services/auth.service.js';

const TEST_SECRET = 'unit-test-secret-at-least-32-characters-long!!';

// ── 2.T1 — Password hashing ───────────────────────────────────────────────────

describe('2.T1 — Password hashing', () => {
  it('hashes a password and the hash is not the plaintext', async () => {
    const hash = await hashPassword('my-secure-password');
    expect(hash).not.toBe('my-secure-password');
    expect(hash.length).toBeGreaterThan(20);
  });

  it('verifyPassword returns true for the correct password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(await verifyPassword(hash, 'correct-horse-battery-staple')).toBe(true);
  });

  it('verifyPassword returns false for an incorrect password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(await verifyPassword(hash, 'wrong-password')).toBe(false);
  });

  it('two hashes of the same password are different (salting)', async () => {
    const hash1 = await hashPassword('same-password');
    const hash2 = await hashPassword('same-password');
    expect(hash1).not.toBe(hash2);
  });
});

// ── 2.T2 — JWT creation and verification ─────────────────────────────────────

describe('2.T2 — JWT creation and verification', () => {
  it('creates a token with the expected payload', () => {
    const token = createAccessToken('user-123', 'editor', TEST_SECRET);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
  });

  it('verifies a valid token and returns the correct payload', () => {
    const token = createAccessToken('user-abc', 'admin', TEST_SECRET);
    const payload = verifyAccessToken(token, TEST_SECRET);
    expect(payload.user_id).toBe('user-abc');
    expect(payload.role).toBe('admin');
  });

  it('throws when verifying with the wrong secret', () => {
    const token = createAccessToken('user-abc', 'admin', TEST_SECRET);
    expect(() => verifyAccessToken(token, 'wrong-secret-that-is-also-32-chars!!')).toThrow();
  });

  it('throws when verifying an expired token', () => {
    // Manually craft a token with exp in the past
    const expiredToken = jwt.sign(
      { user_id: 'user-xyz', role: 'viewer', exp: Math.floor(Date.now() / 1000) - 60 },
      TEST_SECRET
    );
    expect(() => verifyAccessToken(expiredToken, TEST_SECRET)).toThrow();
  });

  it('throws when verifying a malformed token', () => {
    expect(() => verifyAccessToken('not.a.token', TEST_SECRET)).toThrow();
  });
});

// ── Refresh token helpers (no DB needed) ──────────────────────────────────────

describe('Refresh token helpers', () => {
  it('generateRefreshToken produces a non-empty hex string', () => {
    const token = generateRefreshToken();
    expect(typeof token).toBe('string');
    expect(token.length).toBe(80); // 40 bytes = 80 hex chars
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  it('two generated tokens are different', () => {
    expect(generateRefreshToken()).not.toBe(generateRefreshToken());
  });

  it('hashRefreshToken produces consistent SHA-256 hashes', () => {
    const token = 'some-raw-token';
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
    expect(hashRefreshToken(token)).not.toBe(token);
    expect(hashRefreshToken(token).length).toBe(64); // SHA-256 hex = 64 chars
  });
});
