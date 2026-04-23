import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Product, ProductVariant, WebSocketMessage, JobProgressPayload } from '../types';
import { apiClient } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { useWebSocket } from '../hooks/useWebSocket';

async function fetchProducts(): Promise<Product[]> {
  const { data } = await apiClient.get<{ products: Product[] }>('/products');
  return data.products ?? [];
}

async function fetchVariants(productId: string): Promise<ProductVariant[]> {
  const { data } = await apiClient.get<{ variants: ProductVariant[] }>(`/products/${productId}/variants`);
  return data.variants ?? [];
}

interface LinkedAsset {
  link_id: string;
  asset_id: string;
  file_name: string;
  asset_type: string;
  thumbnail_url: string | null;
  role: string;
  sort_order: number;
}

async function fetchProductAssets(productId: string): Promise<LinkedAsset[]> {
  const { data } = await apiClient.get<{ assets: LinkedAsset[] }>(`/products/${productId}/assets`);
  return data.assets ?? [];
}

function ProductDetail({ productId }: { productId: string }) {
  const token = useAuthStore((s) => s.accessToken);

  const { data: variants, isLoading: variantsLoading } = useQuery({
    queryKey: ['products', productId, 'variants'],
    queryFn: () => fetchVariants(productId),
  });

  const { data: assets, isLoading: assetsLoading } = useQuery({
    queryKey: ['products', productId, 'assets'],
    queryFn: () => fetchProductAssets(productId),
  });

  const sectionLabel = (text: string) => (
    <div style={{
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 10,
      color: 'var(--ink-soft)',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      marginBottom: 8,
    }}>
      {text}
    </div>
  );

  return (
    <div style={{ padding: '12px 16px', background: 'var(--paper-2)', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Images */}
      <div>
        {sectionLabel('linked images')}
        {assetsLoading ? (
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', fontFamily: "'JetBrains Mono', monospace" }}>Loading…</div>
        ) : !assets?.length ? (
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', fontFamily: "'JetBrains Mono', monospace" }}>No images linked.</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {assets.map((asset) => {
              const previewSrc = asset.asset_type === 'image' && token
                ? `/api/assets/${asset.asset_id}/preview?token=${encodeURIComponent(token)}`
                : null;
              return (
                <div
                  key={asset.link_id}
                  title={asset.file_name}
                  style={{
                    width: 72, height: 72,
                    border: '1.5px solid var(--ink)',
                    background: 'var(--paper)',
                    overflow: 'hidden',
                    flexShrink: 0,
                    position: 'relative',
                  }}
                >
                  {previewSrc ? (
                    <img
                      src={previewSrc}
                      alt={asset.file_name}
                      loading="lazy"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div style={{
                      width: '100%', height: '100%',
                      display: 'grid', placeItems: 'center',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 10, color: 'var(--ink-soft)',
                    }}>
                      {asset.asset_type}
                    </div>
                  )}
                  {asset.role && asset.role !== 'gallery' && (
                    <span style={{
                      position: 'absolute', bottom: 2, left: 2,
                      fontSize: 8, padding: '1px 3px',
                      background: 'var(--ink)', color: 'var(--paper)',
                      fontFamily: "'JetBrains Mono', monospace",
                    }}>
                      {asset.role}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Inventory */}
      <div>
        {sectionLabel('inventory')}
        {variantsLoading ? (
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', fontFamily: "'JetBrains Mono', monospace" }}>Loading…</div>
        ) : !variants?.length ? (
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', fontFamily: "'JetBrains Mono', monospace" }}>No variants.</div>
        ) : (
          <div style={{ border: '1.5px solid var(--ink)', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>
              <thead>
                <tr style={{ background: 'var(--paper-2)', borderBottom: '1.5px solid var(--ink)' }}>
                  {(['sku', 'title', 'price', 'stock', 'shopify id'] as const).map((h) => (
                    <th key={h} style={{
                      padding: '4px 10px', textAlign: 'left',
                      fontSize: 10, color: 'var(--ink-soft)',
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                      fontWeight: 400, whiteSpace: 'nowrap',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {variants.map((v) => (
                  <tr key={v.id} style={{ borderBottom: '1px dashed var(--ink-soft)' }}>
                    <td style={{ padding: '5px 10px', color: v.sku ? 'var(--ink)' : 'var(--ink-soft)' }}>
                      {v.sku || '—'}
                    </td>
                    <td style={{ padding: '5px 10px' }}>{v.title || '—'}</td>
                    <td style={{ padding: '5px 10px' }}>
                      {v.price != null ? `£${Number(v.price).toFixed(2)}` : '—'}
                    </td>
                    <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                      {v.inventory_quantity != null ? v.inventory_quantity : '—'}
                    </td>
                    <td style={{ padding: '5px 10px', color: 'var(--ink-soft)', fontSize: 10 }}>
                      {v.shopify_variant_id || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              {variants.some((v) => v.inventory_quantity != null) && (
                <tfoot>
                  <tr style={{ borderTop: '1.5px solid var(--ink)', background: 'var(--paper-2)' }}>
                    <td colSpan={3} style={{ padding: '4px 10px', fontSize: 10, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      total stock
                    </td>
                    <td style={{ padding: '4px 10px', textAlign: 'right', fontWeight: 600 }}>
                      {variants.reduce((sum, v) => sum + (v.inventory_quantity ?? 0), 0)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

    </div>
  );
}

interface ActiveJob {
  id: string;
  type: 'sync' | 'import';
  progress: number;
  status: JobProgressPayload['status'];
}

export function ProductBrowser() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);

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

  useWebSocket((msg: WebSocketMessage) => {
    if (msg.type !== 'job_progress') return;
    const payload = msg.payload as JobProgressPayload;
    setActiveJob((prev) => {
      if (!prev || prev.id !== payload.jobId) return prev;
      const next = { ...prev, progress: payload.progress, status: payload.status };
      if (payload.status === 'completed' || payload.status === 'failed') {
        setTimeout(() => {
          setActiveJob(null);
          queryClient.invalidateQueries({ queryKey: ['products'] });
        }, 2500);
      }
      return next;
    });
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post<{ job_id: string }>('/shopify/sync-products', {});
      return data;
    },
    onSuccess: (data) => {
      setActiveJob({ id: data.job_id, type: 'sync', progress: 0, status: 'running' });
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post<{ job_id: string }>('/shopify/import-images', {});
      return data;
    },
    onSuccess: (data) => {
      setActiveJob({ id: data.job_id, type: 'import', progress: 0, status: 'running' });
    },
  });

  const jobRunning = activeJob !== null && activeJob.status === 'running';

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">Products</h2>
        <div className="flex gap-2">
          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending || jobRunning}
            aria-label="Sync Products"
            className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {syncMutation.isPending ? 'Starting…' : 'Sync Products'}
          </button>
          <button
            onClick={() => importMutation.mutate()}
            disabled={importMutation.isPending || jobRunning}
            aria-label="Import Images"
            className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded text-sm hover:bg-gray-200 disabled:opacity-50"
          >
            {importMutation.isPending ? 'Starting…' : 'Import Images'}
          </button>
        </div>
      </div>

      {/* Job progress bar */}
      {activeJob && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs mb-1" style={{ color: 'var(--ink-soft)', fontFamily: "'JetBrains Mono', monospace" }}>
            <span>
              {activeJob.type === 'sync' ? 'Syncing products' : 'Importing images'}
              {activeJob.status === 'completed' ? ' — done' : activeJob.status === 'failed' ? ' — failed' : '…'}
            </span>
            <span style={{ color: activeJob.status === 'failed' ? 'var(--accent)' : activeJob.status === 'completed' ? 'var(--green)' : 'var(--ink-soft)' }}>
              {activeJob.status === 'running' && activeJob.type === 'sync' ? '' : `${activeJob.progress}%`}
            </span>
          </div>
          <div style={{ height: 3, background: 'var(--paper-2)', border: '1px solid var(--ink-soft)', overflow: 'hidden' }}>
            {activeJob.status === 'running' && activeJob.type === 'sync' ? (
              <div style={{
                height: '100%',
                width: '40%',
                background: 'var(--blue)',
                animation: 'progress-indeterminate 1.4s ease-in-out infinite',
              }} />
            ) : (
              <div style={{
                height: '100%',
                width: `${activeJob.progress}%`,
                background: activeJob.status === 'failed' ? 'var(--accent)' : activeJob.status === 'completed' ? 'var(--green)' : 'var(--blue)',
                transition: 'width 0.3s ease',
              }} />
            )}
          </div>
        </div>
      )}

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

                {/* Detail panel (expanded) */}
                {expandedId === product.id && (
                  <tr>
                    <td colSpan={5} style={{ padding: 0, borderBottom: '1.5px solid var(--ink)' }}>
                      <ProductDetail productId={product.id} />
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
