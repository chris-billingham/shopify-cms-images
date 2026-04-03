import { db } from '../db/connection.js';
import { driveService as defaultDriveService, type DriveService } from '../services/drive.service.js';
import { log } from '../services/audit.service.js';

export async function runOrphanCleanup(
  driveService: DriveService = defaultDriveService
): Promise<{ orphans: number }> {
  // Check asset records that have no corresponding Drive file
  const assets = await db('assets')
    .where('status', 'active')
    .select('id', 'google_drive_id', 'file_name');

  let orphans = 0;
  for (const asset of assets) {
    try {
      await driveService.getFile(asset.google_drive_id);
    } catch {
      orphans++;
      await log(null, 'orphan_detected', 'asset', asset.id, {
        google_drive_id: asset.google_drive_id,
        file_name: asset.file_name,
        reason: 'Asset record has no corresponding Drive file',
      });
    }
  }

  return { orphans };
}
