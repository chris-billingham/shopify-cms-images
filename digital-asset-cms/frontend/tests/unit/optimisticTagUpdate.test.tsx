/**
 * 12.T5 — Optimistic tag update
 *
 * Renders AssetDetailPanel. Changes a tag. Asserts the UI reflects the
 * change immediately (before API responds). Mocks the API to return an
 * error and asserts the change is reverted.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  id: 'asset-1',
  file_name: 'polo-shirt.jpg',
  asset_type: 'image',
  status: 'active',
  drive_file_id: 'drive-123',
  file_size: 204800,
  mime_type: 'image/jpeg',
  tags: { colour: 'red', season: 'AW26' },
  version: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // Seed the asset in the query cache
  queryClient.setQueryData(['asset', mockAsset.id], mockAsset);
  return {
    queryClient,
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

describe('optimistic tag update', () => {
  it('reflects the tag removal immediately in the cache before API responds', async () => {
    let resolveRequest!: () => void;
    const requestPromise = new Promise<void>((res) => { resolveRequest = res; });

    server.use(
      http.patch('http://localhost/api/assets/asset-1', async () => {
        // Hold the response until we tell it to resolve
        await requestPromise;
        return HttpResponse.json({ ...mockAsset, tags: { season: 'AW26' } });
      }),
    );

    const { wrapper, queryClient } = makeWrapper();
    render(
      <AssetDetailPanel asset={mockAsset} onClose={() => {}} />,
      { wrapper },
    );

    // Remove the "colour" tag
    const removeColourBtn = screen.getByLabelText('Remove tag colour');
    fireEvent.click(removeColourBtn);

    // The optimistic update should have applied immediately
    await waitFor(() => {
      const cached = queryClient.getQueryData<Asset>(['asset', 'asset-1']);
      expect(cached?.tags).not.toHaveProperty('colour');
    });

    // Resolve the pending API call
    resolveRequest();
  });

  it('reverts the optimistic update when the API returns an error', async () => {
    server.use(
      http.patch('http://localhost/api/assets/asset-1', () => {
        return new HttpResponse(null, { status: 500 });
      }),
    );

    const { wrapper, queryClient } = makeWrapper();
    render(
      <AssetDetailPanel asset={mockAsset} onClose={() => {}} />,
      { wrapper },
    );

    const removeColourBtn = screen.getByLabelText('Remove tag colour');
    fireEvent.click(removeColourBtn);

    // After the error, the cache should revert to the original
    await waitFor(() => {
      const cached = queryClient.getQueryData<Asset>(['asset', 'asset-1']);
      // The mutation errored — the onError handler restores previous state
      // (invalidation also runs, but with no server mock for GET it leaves prev data)
      expect(cached?.tags).toHaveProperty('colour', 'red');
    });
  });
});
