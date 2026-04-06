/**
 * 12.T6 — Concurrency conflict UI
 *
 * Mocks the API to return 409 on a PATCH.
 * Edits an asset.
 * Asserts the conflict notification is displayed with a refresh button.
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AssetDetailPanel } from '../../src/components/AssetDetailPanel';
import { Asset } from '../../src/types';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const mockAsset: Asset = {
  id: 'asset-2',
  file_name: 'jacket.png',
  asset_type: 'image',
  status: 'active',
  drive_file_id: 'drive-456',
  file_size: 512000,
  mime_type: 'image/png',
  tags: { colour: 'navy', season: 'SS26' },
  version: 3,
  created_at: '2026-02-01T00:00:00Z',
  updated_at: '2026-02-15T12:00:00Z',
};

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(['asset', mockAsset.id], mockAsset);

  return render(
    <QueryClientProvider client={queryClient}>
      <AssetDetailPanel asset={mockAsset} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe('concurrency conflict (409)', () => {
  it('shows conflict notification when PATCH returns 409', async () => {
    server.use(
      http.patch('http://localhost/api/assets/asset-2', () => {
        return new HttpResponse(
          JSON.stringify({ error: 'Conflict', message: 'Asset was modified by another user' }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );

    renderPanel();

    // Trigger a tag mutation
    const removeBtn = screen.getByLabelText('Remove tag colour');
    fireEvent.click(removeBtn);

    // Conflict notification should appear
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/modified by another user/i);

    // Refresh button should be present inside the alert
    const alertEl = screen.getByRole('alert');
    expect(within(alertEl).getByRole('button', { name: /refresh/i })).toBeInTheDocument();
  });

  it('hides the conflict notification after clicking Refresh', async () => {
    server.use(
      http.patch('http://localhost/api/assets/asset-2', () => {
        return new HttpResponse(null, { status: 409 });
      }),
    );

    renderPanel();

    const removeBtn = screen.getByLabelText('Remove tag colour');
    fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    // Click the Refresh button inside the conflict alert
    const alertEl = screen.getByRole('alert');
    const refreshBtn = within(alertEl).getByRole('button', { name: /refresh/i });
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});
