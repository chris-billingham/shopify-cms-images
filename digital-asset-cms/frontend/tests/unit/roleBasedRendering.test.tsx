/**
 * 13.T4 — Role-based rendering
 *
 * Renders the asset library + detail panel as viewer / editor / admin.
 * Asserts upload button, delete button, and tag-edit controls appear or are
 * absent / disabled according to the role permission table in §8.3.
 */
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { useAuthStore } from '../../src/stores/authStore';
import { AssetLibrary } from '../../src/components/AssetLibrary';
import { AssetDetailPanel } from '../../src/components/AssetDetailPanel';
import { Asset } from '../../src/types';

const mockAsset: Asset = {
  id: 'asset-1',
  file_name: 'polo.jpg',
  asset_type: 'image',
  status: 'active',
  drive_file_id: 'drive-1',
  file_size: 102400,
  mime_type: 'image/jpeg',
  tags: { colour: 'navy', season: 'AW26' },
  version: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const server = setupServer(
  http.get('http://localhost/api/assets/search', () =>
    HttpResponse.json({ assets: [], total: 0, facets: {} }),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
  useAuthStore.setState({ role: null });
});
afterAll(() => server.close());

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  qc.setQueryData(['asset', mockAsset.id], mockAsset);
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  };
}

describe('role-based rendering', () => {
  it('viewer: no upload button, no delete button, tag edit disabled', () => {
    useAuthStore.setState({ role: 'viewer' });

    render(
      <>
        <AssetLibrary />
        <AssetDetailPanel asset={mockAsset} onClose={() => {}} />
      </>,
      { wrapper: makeWrapper() },
    );

    // Upload button must be absent
    expect(screen.queryByRole('button', { name: /upload/i })).not.toBeInTheDocument();

    // Delete button must be absent
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();

    // Tag remove buttons must exist but be disabled
    const removeButtons = screen.getAllByLabelText(/Remove tag/i);
    expect(removeButtons.length).toBeGreaterThan(0);
    removeButtons.forEach((btn) => expect(btn).toBeDisabled());
  });

  it('editor: upload button present, no delete button', () => {
    useAuthStore.setState({ role: 'editor' });

    render(
      <>
        <AssetLibrary />
        <AssetDetailPanel asset={mockAsset} onClose={() => {}} />
      </>,
      { wrapper: makeWrapper() },
    );

    expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();

    // Tag edit controls should be enabled for editors
    const removeButtons = screen.getAllByLabelText(/Remove tag/i);
    removeButtons.forEach((btn) => expect(btn).not.toBeDisabled());
  });

  it('admin: upload button, delete button, and enabled tag edit all present', () => {
    useAuthStore.setState({ role: 'admin' });

    render(
      <>
        <AssetLibrary />
        <AssetDetailPanel asset={mockAsset} onClose={() => {}} />
      </>,
      { wrapper: makeWrapper() },
    );

    expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();

    const removeButtons = screen.getAllByLabelText(/Remove tag/i);
    removeButtons.forEach((btn) => expect(btn).not.toBeDisabled());
  });
});
