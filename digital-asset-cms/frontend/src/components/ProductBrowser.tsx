import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Product, LinkedAsset } from '../types';
import { apiClient } from '../api/client';
import { LinkedAssetList } from './LinkedAssetList';

async function fetchProducts(): Promise<Product[]> {
  const { data } = await apiClient.get<Product[]>('/products');
  return data;
}

async function fetchLinkedAssets(productId: string): Promise<LinkedAsset[]> {
  const { data } = await apiClient.get<LinkedAsset[]>(`/products/${productId}/assets`);
  return data;
}

function ProductAssets({ productId }: { productId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['products', productId, 'assets'],
    queryFn: () => fetchLinkedAssets(productId),
  });

  if (isLoading) return <p className="text-xs text-gray-400 p-2">Loading assets…</p>;
  if (!data?.length) return <p className="text-xs text-gray-400 p-2">No linked assets.</p>;

  return (
    <div className="px-4 pb-3">
      <LinkedAssetList productId={productId} assets={data} />
    </div>
  );
}

export function ProductBrowser() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: products, isLoading, isError } = useQuery({
    queryKey: ['products'],
    queryFn: fetchProducts,
  });

  const syncMutation = useMutation({
    mutationFn: async () => apiClient.post('/shopify/sync', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
  });

  const importMutation = useMutation({
    mutationFn: async () => apiClient.post('/shopify/import', {}),
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
            {products.map((product) => (
              <React.Fragment key={product.id}>
                <tr
                  className="border-b hover:bg-gray-50 cursor-pointer"
                  onClick={() =>
                    setSelectedId((prev) => (prev === product.id ? null : product.id))
                  }
                >
                  <td className="py-2 pr-4 font-medium">{product.title}</td>
                  <td className="py-2 pr-4 text-gray-600">{product.vendor ?? '—'}</td>
                  <td className="py-2 pr-4 text-gray-600">{product.category ?? '—'}</td>
                  <td className="py-2 pr-4 text-gray-600">{product.variants.length}</td>
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
                      <ul className="space-y-0.5">
                        {product.variants.map((v) => (
                          <li key={v.id} className="text-xs text-gray-600 flex gap-4">
                            <span className="font-mono">{v.sku}</span>
                            <span>{v.title}</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}

                {/* Linked assets (selected) */}
                {selectedId === product.id && (
                  <tr key={`${product.id}-assets`}>
                    <td colSpan={5} className="pb-2">
                      <ProductAssets productId={product.id} />
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
