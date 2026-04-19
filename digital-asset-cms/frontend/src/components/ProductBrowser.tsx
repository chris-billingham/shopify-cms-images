import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Product, ProductVariant } from '../types';
import { apiClient } from '../api/client';

async function fetchProducts(): Promise<Product[]> {
  const { data } = await apiClient.get<{ products: Product[] }>('/products');
  return data.products ?? [];
}

async function fetchVariants(productId: string): Promise<ProductVariant[]> {
  const { data } = await apiClient.get<{ variants: ProductVariant[] }>(`/products/${productId}/variants`);
  return data.variants ?? [];
}

function ProductVariants({ productId }: { productId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['products', productId, 'variants'],
    queryFn: () => fetchVariants(productId),
  });

  if (isLoading) return <p className="text-xs text-gray-400 p-2">Loading variants…</p>;
  if (!data?.length) return <p className="text-xs text-gray-400 p-2">No variants.</p>;

  return (
    <ul className="space-y-0.5">
      {data.map((v) => (
        <li key={v.id} className="text-xs text-gray-600 flex gap-4">
          <span className="font-mono">{v.sku || '—'}</span>
          <span>{v.title}</span>
          {v.price && <span className="text-gray-400">£{v.price}</span>}
        </li>
      ))}
    </ul>
  );
}

export function ProductBrowser() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const { data: products, isLoading, isError } = useQuery({
    queryKey: ['products'],
    queryFn: fetchProducts,
  });

  const vendors = useMemo(
    () => [...new Set(products?.map((p) => p.vendor).filter(Boolean) as string[])].sort(),
    [products],
  );

  const categories = useMemo(
    () => [...new Set(products?.map((p) => p.category).filter(Boolean) as string[])].sort(),
    [products],
  );

  const statuses = useMemo(
    () => [...new Set(products?.map((p) => p.status).filter(Boolean) as string[])].sort(),
    [products],
  );

  const filtered = useMemo(() => {
    if (!products) return [];
    const q = search.toLowerCase();
    return products.filter((p) => {
      if (q && !p.title.toLowerCase().includes(q)) return false;
      if (vendorFilter && p.vendor !== vendorFilter) return false;
      if (categoryFilter && p.category !== categoryFilter) return false;
      if (statusFilter && p.status !== statusFilter) return false;
      return true;
    });
  }, [products, search, vendorFilter, categoryFilter, statusFilter]);

  const syncMutation = useMutation({
    mutationFn: async () => apiClient.post('/shopify/sync-products', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
  });

  const importMutation = useMutation({
    mutationFn: async () => apiClient.post('/shopify/import-images', {}),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Products</h2>
        <div className="flex gap-2">
          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            aria-label="Sync Products"
            className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {syncMutation.isPending ? 'Syncing…' : 'Sync Products'}
          </button>
          <button
            onClick={() => importMutation.mutate()}
            disabled={importMutation.isPending}
            aria-label="Import Images"
            className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded text-sm hover:bg-gray-200 disabled:opacity-50"
          >
            {importMutation.isPending ? 'Importing…' : 'Import Images'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <input
          type="search"
          placeholder="Search products…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm flex-1 min-w-40"
          aria-label="Search products"
        />
        {vendors.length > 0 && (
          <select
            value={vendorFilter}
            onChange={(e) => setVendorFilter(e.target.value)}
            className="border rounded px-3 py-1.5 text-sm bg-white"
            aria-label="Filter by vendor"
          >
            <option value="">All vendors</option>
            {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        )}
        {categories.length > 0 && (
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="border rounded px-3 py-1.5 text-sm bg-white"
            aria-label="Filter by category"
          >
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {statuses.length > 0 && (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border rounded px-3 py-1.5 text-sm bg-white"
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>

      {isLoading && <p role="status" className="text-gray-500 text-sm">Loading products…</p>}
      {isError && <p role="alert" className="text-red-500 text-sm">Failed to load products.</p>}

      {products && (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="pb-2 pr-4">Title</th>
              <th className="pb-2 pr-4">Vendor</th>
              <th className="pb-2 pr-4">Category</th>
              <th className="pb-2 pr-4">Variants</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && !isLoading && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-gray-400 text-sm">No products match the current filters.</td>
              </tr>
            )}
            {filtered.map((product) => (
              <React.Fragment key={product.id}>
                <tr className="border-b hover:bg-gray-50">
                  <td className="py-2 pr-4 font-medium">{product.title}</td>
                  <td className="py-2 pr-4 text-gray-600">{product.vendor ?? '—'}</td>
                  <td className="py-2 pr-4 text-gray-600">{product.category ?? '—'}</td>
                  <td className="py-2 pr-4 text-gray-600">{product.variant_count}</td>
                  <td className="py-2">
                    <button
                      aria-label={`${expandedId === product.id ? 'Collapse' : 'Expand'} ${product.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedId((prev) =>
                          prev === product.id ? null : product.id,
                        );
                      }}
                      className="text-gray-400 hover:text-gray-600 text-xs"
                    >
                      {expandedId === product.id ? '▲' : '▼'}
                    </button>
                  </td>
                </tr>

                {/* Variants (expanded) */}
                {expandedId === product.id && (
                  <tr>
                    <td colSpan={5} className="pb-2 pl-4">
                      <ProductVariants productId={product.id} />
                    </td>
                  </tr>
                )}

              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
