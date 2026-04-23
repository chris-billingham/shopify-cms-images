import type { FastifyPluginAsync } from 'fastify';
import { authenticate, requireRole } from '../middleware/auth.js';
import { driveService } from '../services/drive.service.js';
import { getSetting, setSetting, DRIVE_FOLDER_KEY, GOOGLE_SERVICE_ACCOUNT_KEY_SETTING } from '../services/settings.service.js';
import { config } from '../config/index.js';
import * as auditService from '../services/audit.service.js';

const driveRoutes: FastifyPluginAsync = async (fastify) => {

  // ── GET /api/drive/folders?parentId=xxx — list subfolders ─────────────────
  fastify.get(
    '/folders',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { parentId } = request.query as { parentId?: string };
      try {
        const folders = await driveService.listFolders(parentId);
        return reply.send({ folders });
      } catch (err) {
        const e = err as { message?: string };
        return reply.status(502).send({
          error: { code: 'DRIVE_ERROR', message: e.message ?? 'Failed to list Drive folders' },
        });
      }
    }
  );

  // ── GET /api/drive/folder — get current active upload folder ──────────────
  fastify.get(
    '/folder',
    { preHandler: [authenticate] },
    async (_request, reply) => {
      const storedId = await getSetting(DRIVE_FOLDER_KEY);
      const folderId = storedId ?? config.GOOGLE_DRIVE_FOLDER_ID ?? config.GOOGLE_TEAM_DRIVE_ID;

      let name = 'Team Drive root';
      if (folderId !== config.GOOGLE_TEAM_DRIVE_ID) {
        try {
          const info = await driveService.getFolderInfo(folderId);
          name = info.name ?? folderId;
        } catch {
          name = folderId;
        }
      }

      return reply.send({
        folder_id: folderId,
        folder_name: name,
        is_default: !storedId,
      });
    }
  );

  // ── PUT /api/drive/folder — set active upload folder ─────────────────────
  fastify.put(
    '/folder',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const body = request.body as { folder_id?: string };
      if (!body?.folder_id) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'folder_id is required' },
        });
      }

      // Verify the folder exists before saving
      try {
        const info = await driveService.getFolderInfo(body.folder_id);
        await setSetting(DRIVE_FOLDER_KEY, body.folder_id);
        return reply.send({ folder_id: body.folder_id, folder_name: info.name ?? body.folder_id });
      } catch (err) {
        const e = err as { message?: string };
        return reply.status(502).send({
          error: { code: 'DRIVE_ERROR', message: e.message ?? 'Could not verify folder' },
        });
      }
    }
  );

  // ── GET /api/drive/settings — service account key info ────────────────────
  fastify.get(
    '/settings',
    { preHandler: [authenticate, requireRole('admin')] },
    async (_request, reply) => {
      const storedKey = await getSetting(GOOGLE_SERVICE_ACCOUNT_KEY_SETTING);
      const source = storedKey ? 'database' : 'environment';

      let client_email: string | null = null;
      let project_id: string | null = null;
      try {
        const parsed = JSON.parse(storedKey ?? config.GOOGLE_SERVICE_ACCOUNT_KEY) as Record<string, unknown>;
        client_email = typeof parsed.client_email === 'string' ? parsed.client_email : null;
        project_id = typeof parsed.project_id === 'string' ? parsed.project_id : null;
      } catch {
        // ignore parse errors
      }

      return reply.send({ client_email, project_id, source });
    }
  );

  // ── PUT /api/drive/settings — save service account key ───────────────────
  fastify.put(
    '/settings',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const body = request.body as { service_account_key?: string };
      const raw = body?.service_account_key?.trim();

      if (!raw) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'service_account_key is required' },
        });
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'service_account_key must be valid JSON' },
        });
      }

      if (parsed.type !== 'service_account' || !parsed.client_email || !parsed.private_key) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'JSON does not appear to be a valid service account key' },
        });
      }

      await setSetting(GOOGLE_SERVICE_ACCOUNT_KEY_SETTING, raw);
      driveService.resetAuth();

      await auditService.log(request.user!.user_id, 'update_settings', 'system', 'google_drive', {
        updated_keys: ['google_service_account_key'],
      });

      return reply.send({ ok: true, client_email: parsed.client_email, project_id: parsed.project_id ?? null });
    }
  );
};

export default driveRoutes;
