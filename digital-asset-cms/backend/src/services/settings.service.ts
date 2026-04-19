import { db } from '../db/connection.js';

export async function getSetting(key: string): Promise<string | null> {
  const row = await db('system_settings').where({ key }).first();
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db('system_settings')
    .insert({ key, value, updated_at: new Date() })
    .onConflict('key')
    .merge(['value', 'updated_at']);
}

export const DRIVE_FOLDER_KEY = 'drive_upload_folder_id';
