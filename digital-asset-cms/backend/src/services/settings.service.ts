import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { db } from '../db/connection.js';
import { config } from '../config/index.js';

const ALGO = 'aes-256-gcm';
const ENC_PREFIX = 'enc:';

function getKey(): Buffer {
  return Buffer.from(config.SETTINGS_ENCRYPTION_KEY, 'hex');
}

function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

function decrypt(stored: string): string {
  const body = stored.slice(ENC_PREFIX.length);
  const [ivHex, tagHex, ctHex] = body.split(':');
  const decipher = createDecipheriv(ALGO, getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(ctHex, 'hex')).toString('utf8') + decipher.final('utf8');
}

export async function getSetting(key: string): Promise<string | null> {
  const row = await db('system_settings').where({ key }).first();
  if (!row?.value) return null;

  // Transparently re-encrypt any legacy plaintext values
  if (!row.value.startsWith(ENC_PREFIX)) {
    const encrypted = encrypt(row.value);
    await db('system_settings')
      .where({ key })
      .update({ value: encrypted, updated_at: new Date() });
    return row.value;
  }

  return decrypt(row.value);
}

export async function setSetting(key: string, value: string): Promise<void> {
  const encrypted = encrypt(value);
  await db('system_settings')
    .insert({ key, value: encrypted, updated_at: new Date() })
    .onConflict('key')
    .merge(['value', 'updated_at']);
}

export const DRIVE_FOLDER_KEY = 'drive_upload_folder_id';
export const GOOGLE_SERVICE_ACCOUNT_KEY_SETTING = 'google_service_account_key';
