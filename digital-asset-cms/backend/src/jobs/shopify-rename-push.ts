import { Readable } from 'stream';
import { db } from '../db/connection.js';
import { createShopifyService, getActiveShopifyCredentials, type ShopifyService } from '../services/shopify.service.js';
import { driveService as defaultDriveService, type DriveService } from '../services/drive.service.js';
import { createJob, setJobRunning, completeJob, failJob } from '../services/job.service.js';
import * as auditService from '../services/audit.service.js';

export async function submitShopifyRenamePush(assetId: string, userId: string): Promise<string> {
  const job = await createJob('shopify_rename_push', userId);
  return job.id;
}

export async function runShopifyRenamePush(
  jobId: string,
  assetId: string,
  shopify?: ShopifyService,
  drive: DriveService = defaultDriveService
): Promise<void> {
  await setJobRunning(jobId);
  try {
    const asset = await db('assets').where('id', assetId).whereNot('status', 'deleted').first();
    if (!asset) throw new Error(`Asset ${assetId} not found`);
    if (!asset.shopify_image_id) throw new Error(`Asset ${assetId} has no shopify_image_id`);

    const link = await db('asset_products as ap')
      .join('products as p', 'ap.product_id', 'p.id')
      .where('ap.asset_id', assetId)
      .whereNotNull('p.shopify_id')
      .select('ap.product_id', 'p.shopify_id')
      .first();

    if (!link) throw new Error(`Asset ${assetId} is not linked to a product with a Shopify ID`);

    const svc = shopify ?? createShopifyService(await getActiveShopifyCredentials());

    const stream = await drive.downloadFile(asset.google_drive_id as string);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    const buffer = Buffer.concat(chunks);

    const oldShopifyImageId = asset.shopify_image_id as string;
    const shopifyProductId = String(link.shopify_id);

    const newImage = await svc.pushImage(shopifyProductId, buffer, {
      filename: asset.file_name as string,
      alt: (asset.alt_text as string | null) ?? undefined,
    });

    await svc.deleteImage(shopifyProductId, oldShopifyImageId);

    await db('assets').where('id', assetId).update({ shopify_image_id: String(newImage.id), shopify_image_deleted: false });

    await auditService.log(null, 'rename_push_shopify', 'asset', assetId, {
      old_shopify_image_id: oldShopifyImageId,
      new_shopify_image_id: String(newImage.id),
      shopify_product_id: shopifyProductId,
    });

    await completeJob(jobId, { new_shopify_image_id: String(newImage.id) });
  } catch (err) {
    await failJob(jobId, err instanceof Error ? err.message : String(err));
  }
}
