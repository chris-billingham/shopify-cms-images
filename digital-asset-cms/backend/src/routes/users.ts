import type { FastifyPluginAsync } from 'fastify';
import { authenticate, requireRole } from '../middleware/auth.js';
import { db } from '../db/connection.js';
import { hashPassword, invalidateUserRefreshTokens } from '../services/auth.service.js';

const usersRoutes: FastifyPluginAsync = async (fastify) => {
  const adminOnly = [authenticate, requireRole('admin')];

  // GET /api/users/me — current user's profile (any authenticated user)
  fastify.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
    const user = await db('users')
      .select('id', 'email', 'name', 'role', 'status', 'created_at')
      .where('id', request.user!.user_id)
      .first();
    if (!user) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    }
    return reply.send({ user });
  });

  // GET /api/users — list all users
  fastify.get('/', { preHandler: adminOnly }, async (_request, reply) => {
    const users = await db('users')
      .select('id', 'email', 'name', 'role', 'status', 'created_at')
      .orderBy('created_at', 'asc');
    return reply.send({ users });
  });

  // POST /api/users — create a user
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
      .returning(['id', 'email', 'name', 'role', 'status', 'created_at']);

    return reply.status(201).send({ user });
  });

  // PATCH /api/users/:id — update role, status, or name
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
      .returning(['id', 'email', 'name', 'role', 'status', 'created_at']);

    if (status === 'inactive') {
      await invalidateUserRefreshTokens(db, id);
    }

    return reply.send({ user: updated });
  });

  // DELETE /api/users/:id — hard delete
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
