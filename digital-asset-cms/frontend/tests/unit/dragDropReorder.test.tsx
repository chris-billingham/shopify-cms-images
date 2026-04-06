/**
 * 13.T2 — Drag-and-drop reorder
 *
 * Renders the linked-asset list for a product. Simulates a drag-and-drop
 * reorder. Asserts the PATCH API is called with the new sort order.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LinkedAssetList } from '../../src/components/LinkedAssetList';
import { LinkedAsset } from '../../src/types';

const mockAssets: LinkedAsset[] = [
  { id: 'la-1', asset_id: 'a1', file_name: 'alpha.jpg', asset_type: 'image', sort_order: 0 },
  { id: 'la-2', asset_id: 'a2', file_name: 'beta.jpg',  asset_type: 'image', sort_order: 1 },
  { id: 'la-3', asset_id: 'a3', file_name: 'gamma.jpg', asset_type: 'image', sort_order: 2 },
];

let capturedBody: unknown;

const server = setupServer(
  http.patch(
    'http://localhost/api/products/prod-1/assets/reorder',
    async ({ request }) => {
      capturedBody = await request.json();
      return HttpResponse.json({ ok: true });
    },
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => {
  server.resetHandlers();
  capturedBody = undefined;
});
afterAll(() => server.close());

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('LinkedAssetList drag-and-drop reorder', () => {
  it('calls PATCH with reordered asset IDs after drag-and-drop', async () => {
    render(
      <LinkedAssetList productId="prod-1" assets={mockAssets} />,
      { wrapper },
    );

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('alpha.jpg');
    expect(items[1]).toHaveTextContent('beta.jpg');
    expect(items[2]).toHaveTextContent('gamma.jpg');

    // Drag item at index 0 (alpha) to the position of item at index 2 (gamma)
    fireEvent.dragStart(items[0]);
    fireEvent.dragOver(items[2]);
    fireEvent.drop(items[2]);

    // Expected order after reorder(assets, 0, 2): [beta, gamma, alpha]
    await waitFor(() => {
      expect(capturedBody).toEqual({ assetIds: ['a2', 'a3', 'a1'] });
    });
  });

  it('does nothing when item is dropped on itself', async () => {
    render(
      <LinkedAssetList productId="prod-1" assets={mockAssets} />,
      { wrapper },
    );

    const items = screen.getAllByRole('listitem');

    fireEvent.dragStart(items[1]);
    fireEvent.dragOver(items[1]);
    fireEvent.drop(items[1]);

    // No PATCH should have been called
    await new Promise((r) => setTimeout(r, 50));
    expect(capturedBody).toBeUndefined();
  });
});
