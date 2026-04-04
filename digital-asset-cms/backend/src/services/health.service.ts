import { Redis } from 'ioredis';
import { google } from 'googleapis';
import { db } from '../db/connection.js';
import { config } from '../config/index.js';

export interface DependencyStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  quota_warning?: boolean;
}

export async function checkPostgresHealth(): Promise<DependencyStatus> {
  try {
    await db.raw('SELECT 1');
    return { status: 'healthy' };
  } catch (err) {
    return { status: 'unhealthy', message: err instanceof Error ? err.message : 'PostgreSQL unreachable' };
  }
}

export async function checkRedisHealth(redisUrl: string): Promise<DependencyStatus> {
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 3000,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
  });
  try {
    await client.connect();
    await client.ping();
    await client.quit();
    return { status: 'healthy' };
  } catch (err) {
    client.disconnect();
    return { status: 'degraded', message: err instanceof Error ? err.message : 'Redis unreachable' };
  }
}

export async function checkDriveHealth(): Promise<DependencyStatus> {
  try {
    const credentials = JSON.parse(config.GOOGLE_SERVICE_ACCOUNT_KEY) as object;
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    const drive = google.drive({ version: 'v3', auth });
    const res = await drive.about.get({ fields: 'storageQuota' });

    let quotaWarning = false;
    const quota = res.data.storageQuota;
    if (quota?.limit && quota?.usage) {
      const usageRatio = Number(quota.usage) / Number(quota.limit);
      quotaWarning = usageRatio > 0.9;
    }

    const result: DependencyStatus = { status: 'healthy' };
    if (quotaWarning) result.quota_warning = true;
    return result;
  } catch (err) {
    return { status: 'degraded', message: err instanceof Error ? err.message : 'Google Drive unreachable' };
  }
}

export async function checkShopifyHealth(): Promise<DependencyStatus> {
  try {
    const response = await fetch(
      `https://${config.SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/shop.json`,
      {
        headers: { 'X-Shopify-Access-Token': config.SHOPIFY_ADMIN_API_TOKEN },
        signal: AbortSignal.timeout(5000),
      }
    );
    // 401 means the store is reachable (just auth issue), treat as healthy connectivity
    if (response.ok || response.status === 401) {
      return { status: 'healthy' };
    }
    return { status: 'degraded', message: `Shopify returned HTTP ${response.status}` };
  } catch (err) {
    return { status: 'degraded', message: err instanceof Error ? err.message : 'Shopify unreachable' };
  }
}
