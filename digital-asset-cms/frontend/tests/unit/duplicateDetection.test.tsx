/**
 * 12.T7 — Duplicate detection on upload
 *
 * Mocks the check-duplicate API to return a match.
 * Drops a file. Asserts the duplicate modal is shown with
 * options to skip, replace, or proceed.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UploadView } from '../../src/components/UploadView';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

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

describe('duplicate detection', () => {
  it('shows the duplicate modal with skip/replace/proceed options when a duplicate is detected', async () => {
    server.use(
      http.post('http://localhost/api/assets/check-duplicate', () => {
        return HttpResponse.json({
          isDuplicate: true,
          existingAsset: { id: 'existing-1', file_name: 'polo-shirt.jpg' },
        });
      }),
    );

    renderUpload();
    const dropZone = screen.getByRole('region', { name: /drop zone/i });

    const file = new File(['(binary)'], 'polo-shirt.jpg', { type: 'image/jpeg' });
    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });

    // Wait for duplicate modal
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /duplicate/i })).toBeInTheDocument();
    });

    const modal = screen.getByRole('dialog', { name: /duplicate/i });
    expect(modal.textContent).toMatch(/polo-shirt\.jpg/);

    // All three options should be present
    expect(screen.getByText('Skip')).toBeInTheDocument();
    expect(screen.getByText('Replace')).toBeInTheDocument();
    expect(screen.getByText('Upload Anyway')).toBeInTheDocument();
  });

  it('removes the file from the list when Skip is clicked', async () => {
    server.use(
      http.post('http://localhost/api/assets/check-duplicate', () => {
        return HttpResponse.json({
          isDuplicate: true,
          existingAsset: { id: 'existing-1', file_name: 'polo-shirt.jpg' },
        });
      }),
    );

    renderUpload();
    const dropZone = screen.getByRole('region', { name: /drop zone/i });
    const file = new File(['(binary)'], 'polo-shirt.jpg', { type: 'image/jpeg' });
    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /duplicate/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Skip'));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /duplicate/i })).toBeNull();
    });
  });

  it('does not show duplicate modal when no duplicate is found', async () => {
    server.use(
      http.post('http://localhost/api/assets/check-duplicate', () => {
        return HttpResponse.json({ isDuplicate: false });
      }),
      http.post('http://localhost/api/assets', () => {
        return HttpResponse.json({ id: 'new-asset-1' }, { status: 201 });
      }),
    );

    renderUpload();
    const dropZone = screen.getByRole('region', { name: /drop zone/i });
    const file = new File(['(binary)'], 'unique-photo.jpg', { type: 'image/jpeg' });
    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('unique-photo.jpg')).toBeInTheDocument();
    });

    expect(screen.queryByRole('dialog', { name: /duplicate/i })).toBeNull();
  });
});
