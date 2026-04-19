import type { FastifyPluginAsync } from 'fastify';
import { authenticate, requireRole } from '../middleware/auth.js';
import { driveService } from '../services/drive.service.js';
import { getSetting, setSetting, DRIVE_FOLDER_KEY } from '../services/settings.service.js';
import { config } from '../config/index.js';

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
};

export default driveRoutes;
