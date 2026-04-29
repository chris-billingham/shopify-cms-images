import type { FastifyPluginAsync } from 'fastify';
import { authenticate, requireRole } from '../middleware/auth.js';
import { db } from '../db/connection.js';
import { hashPassword, verifyPassword, invalidateUserRefreshTokens } from '../services/auth.service.js';
import { streamToBuffer } from '../utils/stream.js';
import path from 'path';
import { promises as fsp } from 'fs';
import sharp from 'sharp';

const AVATARS_DIR = path.join(process.cwd(), 'avatars');

const USER_COLS = ['id', 'email', 'name', 'role', 'status', 'avatar_url', 'created_at'];

const usersRoutes: FastifyPluginAsync = async (fastify) => {
  await fsp.mkdir(AVATARS_DIR, { recursive: true });

  const adminOnly = [authenticate, requireRole('admin')];

  // GET /api/users/avatars/:filename — serve avatar images (no auth, filenames are UUID-based)
  fastify.get('/avatars/:filename', async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const safe = path.basename(filename);
    if (safe !== filename) {
      return reply.status(400).send({ error: { code: 'INVALID_REQUEST', message: 'Invalid filename' } });
    }
    try {
      const buffer = await fsp.readFile(path.join(AVATARS_DIR, safe));
      return reply.type('image/jpeg').send(buffer);
    } catch {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Avatar not found' } });
    }
  });

  // GET /api/users/me — current user's profile
  fastify.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
    const user = await db('users')
      .select('id', 'email', 'name', 'role', 'status', 'avatar_url', 'created_at', 'password_hash')
      .where('id', request.user!.user_id)
      .first();
    if (!user) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    }
    const { password_hash, ...userFields } = user;
    return reply.send({ user: { ...userFields, has_password: !!password_hash } });
  });

  // PATCH /api/users/me — update own display name
  fastify.patch('/me', { preHandler: [authenticate] }, async (request, reply) => {
    const { name } = request.body as { name?: string };
    if (!name?.trim()) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'name is required' } });
    }
    const [updated] = await db('users')
      .where('id', request.user!.user_id)
      .update({ name: name.trim(), updated_at: new Date() })
      .returning(USER_COLS);
    return reply.send({ user: updated });
  });

  // POST /api/users/me/avatar — upload profile image
  fastify.post('/me/avatar', { preHandler: [authenticate] }, async (request, reply) => {
    const data = await request.file().catch((err: Error) => {
      fastify.log.error({ err }, 'request.file() failed in avatar upload');
      return null;
    });
    if (!data) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'No file uploaded' } });
    }
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(data.mimetype)) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'File must be an image (jpeg, png, webp, gif)' } });
    }

    const buffer = await streamToBuffer(data.file);

    const userId = request.user!.user_id;
    const filename = `${userId}-${Date.now()}.jpg`;
    const filePath = path.join(AVATARS_DIR, filename);

    // Remove old avatars for this user before saving the new one
    const existing = await fsp.readdir(AVATARS_DIR).catch(() => [] as string[]);
    for (const f of existing) {
      if (f.startsWith(`${userId}-`) && f !== filename) {
        await fsp.unlink(path.join(AVATARS_DIR, f)).catch(() => {});
      }
    }

    await sharp(buffer)
      .resize(256, 256, { fit: 'cover' })
      .jpeg({ quality: 85 })
      .toFile(filePath);

    const avatarUrl = `/api/users/avatars/${filename}`;
    const [updated] = await db('users')
      .where('id', userId)
      .update({ avatar_url: avatarUrl, updated_at: new Date() })
      .returning(USER_COLS);

    return reply.send({ user: updated });
  });

  // POST /api/users/me/password — change password (email/password accounts only)
  fastify.post('/me/password', { preHandler: [authenticate] }, async (request, reply) => {
    const { currentPassword, newPassword } = request.body as {
      currentPassword?: string;
      newPassword?: string;
    };
    if (!currentPassword || !newPassword) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'currentPassword and newPassword are required' } });
    }
    if (newPassword.length < 8) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'New password must be at least 8 characters' } });
    }

    const user = await db('users').where('id', request.user!.user_id).first();
    if (!user?.password_hash) {
      return reply.status(400).send({ error: { code: 'FORBIDDEN', message: 'Password change is not available for OAuth accounts' } });
    }

    const valid = await verifyPassword(user.password_hash, currentPassword);
    if (!valid) {
      return reply.status(400).send({ error: { code: 'WRONG_PASSWORD', message: 'Current password is incorrect' } });
    }

    const newHash = await hashPassword(newPassword);
    await db('users')
      .where('id', request.user!.user_id)
      .update({ password_hash: newHash, updated_at: new Date() });

    return reply.send({ message: 'Password updated successfully' });
  });

  // GET /api/users — list all users (admin)
  fastify.get('/', { preHandler: adminOnly }, async (_request, reply) => {
    const users = await db('users')
      .select(...USER_COLS)
      .orderBy('created_at', 'asc');
    return reply.send({ users });
  });

  // POST /api/users — create a user (admin)
  fastify.post('/', { preHandler: adminOnly }, async (request, reply) => {
    const { email, name, role, password } = request.body as {
      email?: string;
      name?: string;
      role?: string;
      password?: string;
    };

    if (!email || !name || !role || !password) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'email, name, role, and password are required' },
      });
    }

    const validRoles = ['admin', 'editor', 'viewer'];
    if (!validRoles.includes(role)) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: `role must be one of: ${validRoles.join(', ')}` },
      });
    }

    const existing = await db('users').where('email', email.toLowerCase().trim()).first();
    if (existing) {
      return reply.status(409).send({
        error: { code: 'CONFLICT', message: 'A user with that email already exists' },
      });
    }

    const password_hash = await hashPassword(password);
    const [user] = await db('users')
      .insert({
        email: email.toLowerCase().trim(),
        name: name.trim(),
        role,
        status: 'active',
        password_hash,
      })
      .returning(USER_COLS);

    return reply.status(201).send({ user });
  });

  // PATCH /api/users/:id — update role, status, or name (admin)
  fastify.patch('/:id', { preHandler: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { role, status, name } = request.body as {
      role?: string;
      status?: string;
      name?: string;
    };

    if (request.user!.user_id === id && status === 'inactive') {
      return reply.status(400).send({
        error: { code: 'FORBIDDEN', message: 'You cannot deactivate your own account' },
      });
    }

    const user = await db('users').where('id', id).first();
    if (!user) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    }

    const validRoles = ['admin', 'editor', 'viewer'];
    if (role !== undefined && !validRoles.includes(role)) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: `role must be one of: ${validRoles.join(', ')}` },
      });
    }

    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (role !== undefined) updates.role = role;
    if (status !== undefined) updates.status = status;
    if (name !== undefined) updates.name = name.trim();

    const [updated] = await db('users')
      .where('id', id)
      .update(updates)
      .returning(USER_COLS);

    if (status === 'inactive') {
      await invalidateUserRefreshTokens(db, id);
    }

    return reply.send({ user: updated });
  });

  // DELETE /api/users/:id — hard delete (admin)
  fastify.delete('/:id', { preHandler: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    if (request.user!.user_id === id) {
      return reply.status(400).send({
        error: { code: 'FORBIDDEN', message: 'You cannot delete your own account' },
      });
    }

    const user = await db('users').where('id', id).first();
    if (!user) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    }

    await invalidateUserRefreshTokens(db, id);
    await db('users').where('id', id).delete();

    return reply.status(204).send();
  });
};

export default usersRoutes;
