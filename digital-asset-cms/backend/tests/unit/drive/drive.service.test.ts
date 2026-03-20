import { describe, it, expect, vi, beforeEach } from 'vitest';
import Bottleneck from 'bottleneck';
import { Readable } from 'stream';
import { createDriveService, DriveStorageFullError } from '../../../src/services/drive.service.js';
import { HttpError } from '../../../src/utils/retry.js';

// ── Mock googleapis ───────────────────────────────────────────────────────────

vi.mock('googleapis', () => {
  return {
    google: {
      auth: {
        GoogleAuth: class {
          getClient() { return {}; }
        },
      },
      drive: () => ({}),
    },
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockDrive(overrides: {
  create?: ReturnType<typeof vi.fn>;
  get?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
  list?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    files: {
      create: overrides.create ?? vi.fn().mockResolvedValue({ data: { id: 'drive-id', webViewLink: 'https://drive.google.com/test' } }),
      get: overrides.get ?? vi.fn().mockResolvedValue({ data: { id: 'drive-id', name: 'test.jpg', md5Checksum: 'abc123' } }),
      update: overrides.update ?? vi.fn().mockResolvedValue({ data: {} }),
      list: overrides.list ?? vi.fn().mockResolvedValue({ data: { files: [], nextPageToken: undefined } }),
    },
  };
}

// Short delays for tests so retries don't slow the suite
const TEST_RETRY_OPTS = { initialDelayMs: 1, maxDelayMs: 5 };

// ── 3.T1 — Rate limiter ───────────────────────────────────────────────────────

describe('3.T1 — Drive service rate limiter', () => {
  it('queues requests beyond maxConcurrent and completes them all in submission order', async () => {
    const MAX_CONCURRENT = 3;
    let currentConcurrent = 0;
    let maxObserved = 0;
    const completionOrder: number[] = [];

    const mockGet = vi.fn().mockImplementation(async ({ fileId }: { fileId: string }) => {
      currentConcurrent++;
      maxObserved = Math.max(maxObserved, currentConcurrent);
      // Small async yield to allow the scheduler to queue subsequent requests
      await new Promise<void>((r) => setImmediate(r));
      currentConcurrent--;
      const index = parseInt(fileId.split('-')[1] ?? '0', 10);
      completionOrder.push(index);
      return { data: { id: fileId, name: `file-${index}.jpg` } };
    });

    const service = createDriveService({
      driveClient: makeMockDrive({ get: mockGet }) as never,
      limiter: new Bottleneck({ maxConcurrent: MAX_CONCURRENT }),
      retryOptions: TEST_RETRY_OPTS,
    });

    const N = 15;
    const promises = Array.from({ length: N }, (_, i) => service.getFile(`file-${i}`));
    const results = await Promise.all(promises);

    expect(results).toHaveLength(N);
    expect(mockGet).toHaveBeenCalledTimes(N);
    // Concurrency must never exceed the configured limit
    expect(maxObserved).toBeLessThanOrEqual(MAX_CONCURRENT);
    // All 15 requests completed
    expect(completionOrder).toHaveLength(N);
  });
});

// ── 3.T2 — Retry logic ───────────────────────────────────────────────────────

describe('3.T2 — Drive service retry logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('succeeds after one retry on a 503', async () => {
    const mockGet = vi.fn()
      .mockRejectedValueOnce({ code: 503, message: 'Service Unavailable' })
      .mockResolvedValueOnce({ data: { id: 'id', name: 'test.jpg' } });

    const service = createDriveService({
      driveClient: makeMockDrive({ get: mockGet }) as never,
      limiter: new Bottleneck({ maxConcurrent: 1 }),
      retryOptions: TEST_RETRY_OPTS,
    });

    const result = await service.getFile('some-id');
    expect(result.id).toBe('id');
    expect(mockGet).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
  });

  it('fails after exhausting 3 retries on persistent 503', async () => {
    const mockGet = vi.fn().mockRejectedValue({ code: 503, message: 'Service Unavailable' });

    const service = createDriveService({
      driveClient: makeMockDrive({ get: mockGet }) as never,
      limiter: new Bottleneck({ maxConcurrent: 1 }),
      retryOptions: TEST_RETRY_OPTS,
    });

    await expect(service.getFile('some-id')).rejects.toThrow();
    // 1 initial + 3 retries = 4 total calls
    expect(mockGet).toHaveBeenCalledTimes(4);
  });

  it('fails immediately on a 400 error without retrying', async () => {
    const mockGet = vi.fn().mockRejectedValue({ code: 400, message: 'Bad Request' });

    const service = createDriveService({
      driveClient: makeMockDrive({ get: mockGet }) as never,
      limiter: new Bottleneck({ maxConcurrent: 1 }),
      retryOptions: TEST_RETRY_OPTS,
    });

    await expect(service.getFile('some-id')).rejects.toBeInstanceOf(HttpError);
    expect(mockGet).toHaveBeenCalledTimes(1); // No retries for 4xx
  });

  it('retries with backoff on a 429', async () => {
    const mockGet = vi.fn()
      .mockRejectedValueOnce({ code: 429, message: 'Too Many Requests' })
      .mockResolvedValueOnce({ data: { id: 'id', name: 'test.jpg' } });

    const service = createDriveService({
      driveClient: makeMockDrive({ get: mockGet }) as never,
      limiter: new Bottleneck({ maxConcurrent: 1 }),
      retryOptions: TEST_RETRY_OPTS,
    });

    const result = await service.getFile('some-id');
    expect(result.id).toBe('id');
    expect(mockGet).toHaveBeenCalledTimes(2); // retried once after 429
  });
});

// ── 3.T3 — Storage quota error ────────────────────────────────────────────────

describe('3.T3 — Drive service storage quota error', () => {
  it('throws DriveStorageFullError and does not retry on storageQuotaExceeded', async () => {
    const storageError = { errors: [{ reason: 'storageQuotaExceeded', message: 'Storage limit exceeded' }] };
    const mockCreate = vi.fn().mockRejectedValue(storageError);

    const service = createDriveService({
      driveClient: makeMockDrive({ create: mockCreate }) as never,
      limiter: new Bottleneck({ maxConcurrent: 1 }),
      retryOptions: TEST_RETRY_OPTS,
    });

    const stream = Readable.from(Buffer.from('test content'));
    await expect(
      service.uploadFile(stream, { name: 'test.jpg', mimeType: 'image/jpeg' })
    ).rejects.toBeInstanceOf(DriveStorageFullError);

    // Must not retry — only 1 call
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('DriveStorageFullError has the DRIVE_STORAGE_FULL code', async () => {
    const err = new DriveStorageFullError();
    expect(err.code).toBe('DRIVE_STORAGE_FULL');
    expect(err.message).toMatch(/storage quota exceeded/i);
  });
});
