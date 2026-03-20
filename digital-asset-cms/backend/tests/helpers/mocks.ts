// Mock helpers for Google Drive and Shopify APIs
// Used in unit tests to avoid real API calls

export const mockDriveService = {
  uploadFile: async () => ({ id: 'mock-drive-id', webViewLink: 'https://drive.google.com/mock' }),
  downloadFile: async () => {},
  deleteFile: async () => {},
  listFiles: async () => [],
  getFile: async () => ({ id: 'mock-drive-id', name: 'test.jpg', md5Checksum: 'abc123' }),
};

export const mockShopifyService = {
  syncProducts: async () => ({ products_affected: 0 }),
  pushAsset: async () => ({ shopify_image_id: 'mock-shopify-id' }),
  verifyWebhook: () => true,
};
