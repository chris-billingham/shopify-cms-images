/**
 * 13.T1 — Product browser rendering
 *
 * Mocks the products API. Renders ProductBrowser. Asserts products are
 * displayed with correct columns. Expands a product — asserts variants shown.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ProductBrowser } from '../../src/components/ProductBrowser';

const mockProducts = [
  {
    id: 'prod-1',
    title: 'Classic Polo Shirt',
    vendor: 'Acme',
    category: 'Apparel',
    shopify_product_id: 'shop-001',
    variants: [
      { id: 'var-1', sku: 'SKU-001', title: 'Blue / S' },
      { id: 'var-2', sku: 'SKU-002', title: 'Blue / M' },
    ],
  },
  {
    id: 'prod-2',
    title: 'Running Shorts',
    vendor: 'Sportify',
    category: 'Sport',
    variants: [{ id: 'var-3', sku: 'SKU-100', title: 'Black / L' }],
  },
];

const server = setupServer(
  http.get('http://localhost/api/products', () => HttpResponse.json(mockProducts)),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

describe('ProductBrowser', () => {
  it('renders product titles and columns', async () => {
    render(<ProductBrowser />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('Classic Polo Shirt')).toBeInTheDocument();
      expect(screen.getByText('Running Shorts')).toBeInTheDocument();
    });

    // Vendor and category columns
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Sportify')).toBeInTheDocument();
    expect(screen.getByText('Apparel')).toBeInTheDocument();

    // Variant count column — prod-1 has 2 variants
    expect(screen.getByText('2')).toBeInTheDocument();
    // prod-2 has 1 variant
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('shows variants when the expand button is clicked', async () => {
    render(<ProductBrowser />, { wrapper });

    await waitFor(() =>
      expect(screen.getByText('Classic Polo Shirt')).toBeInTheDocument(),
    );

    // Variants not yet visible
    expect(screen.queryByText('SKU-001')).not.toBeInTheDocument();

    // Click the expand button for prod-1
    const expandBtn = screen.getByLabelText('Expand Classic Polo Shirt');
    fireEvent.click(expandBtn);

    expect(screen.getByText('SKU-001')).toBeInTheDocument();
    expect(screen.getByText('Blue / S')).toBeInTheDocument();
    expect(screen.getByText('SKU-002')).toBeInTheDocument();
    expect(screen.getByText('Blue / M')).toBeInTheDocument();

    // Collapse again
    fireEvent.click(expandBtn);
    expect(screen.queryByText('SKU-001')).not.toBeInTheDocument();
  });

  it('shows Sync Products and Import Images buttons', async () => {
    render(<ProductBrowser />, { wrapper });

    await waitFor(() =>
      expect(screen.getByText('Classic Polo Shirt')).toBeInTheDocument(),
    );

    expect(screen.getByRole('button', { name: 'Sync Products' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import Images' })).toBeInTheDocument();
  });
});
