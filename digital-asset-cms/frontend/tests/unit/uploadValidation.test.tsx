/**
 * 12.T4 — Upload flow validation
 *
 * Renders UploadView and drops files.
 * Asserts unsupported MIME type → error shown, no upload started.
 * Asserts oversized image → size error shown.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UploadView } from '../../src/components/UploadView';

const server = setupServer(
  // Default: check-duplicate returns no match so uploads can proceed
  http.post('http://localhost/api/assets/check-duplicate', () => {
    return HttpResponse.json({ isDuplicate: false });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeFile(name: string, type: string, sizeBytes: number): File {
  // Create a Blob of the given size
  const buffer = new Uint8Array(sizeBytes);
  const blob = new Blob([buffer], { type });
  return new File([blob], name, { type });
}

function renderUpload() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <UploadView />
    </QueryClientProvider>,
  );
}

function dropFile(dropZone: HTMLElement, file: File) {
  fireEvent.drop(dropZone, {
    dataTransfer: { files: [file] },
  });
}

describe('UploadView validation', () => {
  it('shows an error and does not start upload for an unsupported MIME type', async () => {
    const uploadMock = vi.fn(() => HttpResponse.json({ id: '1' }));
    server.use(http.post('http://localhost/api/assets', uploadMock));

    renderUpload();
    const dropZone = screen.getByRole('region', { name: /drop zone/i });
    const unsupportedFile = makeFile('archive.zip', 'application/zip', 1024);

    dropFile(dropZone, unsupportedFile);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/not supported/i);

    // Upload endpoint must not have been called
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('shows a size error for an image exceeding the 50 MB limit', async () => {
    const uploadMock = vi.fn(() => HttpResponse.json({ id: '1' }));
    server.use(http.post('http://localhost/api/assets', uploadMock));

    renderUpload();
    const dropZone = screen.getByRole('region', { name: /drop zone/i });

    // 200 MB image (over the 50 MB limit)
    const bigImage = makeFile('huge.jpg', 'image/jpeg', 200 * 1024 * 1024);
    dropFile(dropZone, bigImage);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/size limit/i);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('accepts a valid image file and proceeds to duplicate check', async () => {
    renderUpload();
    const dropZone = screen.getByRole('region', { name: /drop zone/i });
    const validImage = makeFile('photo.jpg', 'image/jpeg', 1024 * 1024); // 1 MB

    dropFile(dropZone, validImage);

    // File should appear in the list (no immediate error)
    await waitFor(() => {
      expect(screen.getByText('photo.jpg')).toBeInTheDocument();
    });

    expect(screen.queryByRole('alert')).toBeNull();
  });
});
