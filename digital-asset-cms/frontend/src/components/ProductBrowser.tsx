import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Product, ProductVariant, WebSocketMessage, JobProgressPayload } from '../types';
import { apiClient } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { useWebSocket } from '../hooks/useWebSocket';

const PRODUCT_PAGE_SIZE = 50;

const PRODUCT_SORT_MAP: Record<string, { sort: string; order: string }> = {
  'title-asc':      { sort: 'title',             order: 'asc'  },
  'title-desc':     { sort: 'title',             order: 'desc' },
  'vendor':         { sort: 'vendor',            order: 'asc'  },
  'variants-desc':  { sort: 'variants',          order: 'desc' },
  'variants-asc':   { sort: 'variants',          order: 'asc'  },
  'newest':         { sort: 'synced_at',         order: 'desc' },
  'oldest':         { sort: 'synced_at',         order: 'asc'  },
  'shopify-newest': { sort: 'shopify_created_at', order: 'desc' },
  'shopify-oldest': { sort: 'shopify_created_at', order: 'asc'  },
};

async function fetchProducts(params: URLSearchParams): Promise<{ products: Product[]; total: number }> {
  const { data } = await apiClient.get<{ products: Product[]; total: number }>(`/products?${params}`);
  return { products: data.products ?? [], total: data.total ?? 0 };
}

async function fetchFilterOptions(): Promise<{ vendors: string[]; categories: string[]; statuses: string[] }> {
  const { data } = await apiClient.get<{ vendors: string[]; categories: string[]; statuses: string[] }>('/products/filter-options');
  return data;
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
  shopify_image_id: string | null;
}

async function fetchProductAssets(productId: string): Promise<LinkedAsset[]> {
  const { data } = await apiClient.get<{ assets: LinkedAsset[] }>(`/products/${productId}/assets`);
  return data.assets ?? [];
}

function ProductDetail({ productId, shopifyCreatedAt }: { productId: string; shopifyCreatedAt?: string }) {
  const token = useAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const dragIndex = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const { data: variants, isLoading: variantsLoading } = useQuery({
    queryKey: ['products', productId, 'variants'],
    queryFn: () => fetchVariants(productId),
  });

  const { data: assets, isLoading: assetsLoading } = useQuery({
    queryKey: ['products', productId, 'assets'],
    queryFn: () => fetchProductAssets(productId),
  });

  const reorderMutation = useMutation({
    mutationFn: async (order: string[]) => {
      await apiClient.post(`/products/${productId}/assets/reorder`, { order });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products', productId, 'assets'] }),
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

      {/* Shopify metadata */}
      {shopifyCreatedAt && (
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--ink-soft)' }}>
          created in shopify:{' '}
          <span style={{ color: 'var(--ink)' }}>
            {new Date(shopifyCreatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        </div>
      )}

      {/* Images */}
      <div>
        {sectionLabel('linked images')}
        {assetsLoading ? (
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', fontFamily: "'JetBrains Mono', monospace" }}>Loading…</div>
        ) : !assets?.length ? (
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', fontFamily: "'JetBrains Mono', monospace" }}>No images linked.</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {assets.map((asset, index) => {
              const t = token ? encodeURIComponent(token) : null;
              const fallbackSrc = asset.asset_type === 'image' && t
                ? `/api/assets/${asset.asset_id}/preview?token=${t}`
                : null;
              const imgSrc = asset.asset_type === 'image' && t
                ? (asset.thumbnail_url ? `${asset.thumbnail_url}?token=${t}` : fallbackSrc)
                : null;
              const isDragOver = dragOverIndex === index;
              return (
                <div
                  key={asset.link_id}
                  title={asset.file_name}
                  draggable
                  onDragStart={() => { dragIndex.current = index; }}
                  onDragOver={(e) => { e.preventDefault(); setDragOverIndex(index); }}
                  onDragLeave={() => setDragOverIndex(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = dragIndex.current;
                    if (from === null || from === index) { setDragOverIndex(null); return; }
                    const reordered = [...assets];
                    const [moved] = reordered.splice(from, 1);
                    reordered.splice(index, 0, moved);
                    // Optimistic update
                    queryClient.setQueryData(['products', productId, 'assets'], reordered);
                    reorderMutation.mutate(reordered.map((a) => a.link_id));
                    dragIndex.current = null;
                    setDragOverIndex(null);
                  }}
                  onDragEnd={() => { dragIndex.current = null; setDragOverIndex(null); }}
                  style={{
                    width: 72, height: 72,
                    border: isDragOver ? '2px dashed var(--accent)' : '1.5px solid var(--ink)',
                    background: 'var(--paper)',
                    overflow: 'hidden',
                    flexShrink: 0,
                    position: 'relative',
                    cursor: 'grab',
                    opacity: reorderMutation.isPending ? 0.7 : 1,
                    transition: 'border 0.1s, opacity 0.1s',
                  }}
                >
                  {imgSrc ? (
                    <img
                      src={imgSrc}
                      alt={asset.file_name}
                      loading="lazy"
                      onError={(e) => { if (fallbackSrc && e.currentTarget.src !== fallbackSrc) e.currentTarget.src = fallbackSrc; }}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
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
                  <span style={{
                    position: 'absolute', top: 2, right: 2,
                    fontSize: 8, padding: '1px 3px',
                    background: 'rgba(0,0,0,0.45)', color: '#fff',
                    fontFamily: "'JetBrains Mono', monospace",
                  }}>
                    {index + 1}
                  </span>
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
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [sort, setSort] = useState('title-asc');
  const [page, setPage] = useState(1);
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [showImportOptions, setShowImportOptions] = useState(false);
  const [importStatuses, setImportStatuses] = useState<string[]>(['active']);

  // Debounce text search — only send to server 300ms after typing stops
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset page when any filter or sort changes
  useEffect(() => {
    setPage(1);
  }, [vendorFilter, categoryFilter, statusFilter, sort]);

  const sortParams = PRODUCT_SORT_MAP[sort] ?? { sort: 'created_at', order: 'desc' };

  const productsQueryParams = new URLSearchParams();
  if (debouncedSearch) productsQueryParams.set('q', debouncedSearch);
  if (vendorFilter)   productsQueryParams.set('vendor', vendorFilter);
  if (categoryFilter) productsQueryParams.set('category', categoryFilter);
  if (statusFilter)   productsQueryParams.set('status', statusFilter);
  productsQueryParams.set('sort', sortParams.sort);
  productsQueryParams.set('order', sortParams.order);
  productsQueryParams.set('limit', String(PRODUCT_PAGE_SIZE));
  productsQueryParams.set('offset', String((page - 1) * PRODUCT_PAGE_SIZE));

  const { data: productsData, isLoading, isError } = useQuery({
    queryKey: ['products', 'list', debouncedSearch, vendorFilter, categoryFilter, statusFilter, sort, page],
    queryFn: () => fetchProducts(productsQueryParams),
    staleTime: 5 * 60 * 1000,
  });

  const { data: filterOptions } = useQuery({
    queryKey: ['products', 'filter-options'],
    queryFn: fetchFilterOptions,
    staleTime: 10 * 60 * 1000,
  });

  const products = productsData?.products ?? [];
  const total = productsData?.total ?? 0;
  const totalPages = Math.ceil(total / PRODUCT_PAGE_SIZE);
  const vendors = filterOptions?.vendors ?? [];
  const categories = filterOptions?.categories ?? [];
  const statuses = filterOptions?.statuses ?? [];

  useWebSocket((msg: WebSocketMessage) => {
    if (msg.type !== 'job_progress') return;
    const payload = msg.payload as JobProgressPayload;
    setActiveJob((prev) => {
      if (!prev || prev.id !== payload.jobId) return prev;
      const next = { ...prev, progress: payload.progress, status: payload.status };
      if (payload.status === 'completed' || payload.status === 'failed') {
        setTimeout(() => {
          setActiveJob(null);
          queryClient.invalidateQueries({ queryKey: ['products', 'list'] });
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
    mutationFn: async (statuses: string[]) => {
      const { data } = await apiClient.post<{ job_id: string }>('/shopify/import-images', { statuses });
      return data;
    },
    onSuccess: (data) => {
      setShowImportOptions(false);
      setActiveJob({ id: data.job_id, type: 'import', progress: 0, status: 'running' });
    },
  });

  const jobRunning = activeJob !== null && activeJob.status === 'running';
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h2 style={{ fontFamily: "'Caveat', cursive", fontSize: 22, margin: 0 }}>Products</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending || jobRunning}
            aria-label="Sync Products"
            className="btn-sketch primary"
          >
            {syncMutation.isPending ? 'Starting…' : 'Sync Products'}
          </button>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowImportOptions((v) => !v)}
              disabled={importMutation.isPending || jobRunning}
              aria-label="Import Images"
              className="btn-sketch"
            >
              {importMutation.isPending ? 'Starting…' : 'Import Images ▾'}
            </button>
            {showImportOptions && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 10,
                border: '1.5px solid var(--ink)', background: 'var(--paper)', padding: '10px 12px',
                fontFamily: "'JetBrains Mono', monospace", fontSize: 12, minWidth: 180,
                boxShadow: '3px 3px 0 var(--shadow)',
              }}>
                <div style={{ fontSize: 10, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                  import from products
                </div>
                {(['active', 'draft', 'archived'] as const).map((s) => (
                  <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={importStatuses.includes(s)}
                      onChange={(e) => setImportStatuses((prev) =>
                        e.target.checked ? [...prev, s] : prev.filter((x) => x !== s)
                      )}
                      style={{ accentColor: 'var(--ink)' }}
                    />
                    {s}
                  </label>
                ))}
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  <button
                    onClick={() => importMutation.mutate(importStatuses)}
                    disabled={importStatuses.length === 0 || importMutation.isPending}
                    style={{
                      flex: 1, padding: '4px 8px', fontSize: 11,
                      background: 'var(--ink)', color: 'var(--paper)',
                      border: 'none', cursor: importStatuses.length === 0 ? 'not-allowed' : 'pointer',
                      fontFamily: "'JetBrains Mono', monospace", opacity: importStatuses.length === 0 ? 0.5 : 1,
                    }}
                  >
                    start import
                  </button>
                  <button
                    onClick={() => setShowImportOptions(false)}
                    style={{
                      padding: '4px 8px', fontSize: 11,
                      background: 'none', border: '1px solid var(--ink-soft)',
                      cursor: 'pointer', fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Job progress bar */}
      {activeJob && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, marginBottom: 4, color: 'var(--ink-soft)', fontFamily: "'JetBrains Mono', monospace" }}>
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

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <input
          type="search"
          placeholder="Search products…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sketch-input"
          style={{ flex: '0 0 60%' }}
          aria-label="Search products"
        />
        <div style={{ display: 'flex', gap: 8, flex: 1 }}>
          {vendors.length > 0 && (
            <select
              value={vendorFilter}
              onChange={(e) => setVendorFilter(e.target.value)}
              className="sketch-input"
              style={{ flex: 1, minWidth: 0 }}
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
              className="sketch-input"
              style={{ flex: 1, minWidth: 0 }}
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
              className="sketch-input"
              style={{ flex: 1, minWidth: 0 }}
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="sketch-input"
            style={{ flex: 1, minWidth: 0 }}
            aria-label="Sort products"
          >
            <option value="title-asc">Title A–Z</option>
            <option value="title-desc">Title Z–A</option>
            <option value="vendor">Vendor A–Z</option>
            <option value="variants-desc">Most variants</option>
            <option value="variants-asc">Fewest variants</option>
            <option value="newest">Newest sync</option>
            <option value="oldest">Oldest sync</option>
            <option value="shopify-newest">Newest in Shopify</option>
            <option value="shopify-oldest">Oldest in Shopify</option>
          </select>
        </div>
      </div>

      {isLoading && <p role="status" style={{ color: 'var(--ink-soft)', fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>Loading products…</p>}
      {isError && <p role="alert" style={{ color: 'var(--accent)', fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>Failed to load products.</p>}

      {!isLoading && (
        <>
          {total > 0 && (
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>
              {total.toLocaleString()} product{total !== 1 ? 's' : ''}
              {totalPages > 1 && ` · page ${page} of ${totalPages}`}
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: "'Architects Daughter', sans-serif" }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--ink)', textAlign: 'left' }}>
                {(['Title', 'Vendor', 'Category'] as const).map((h) => (
                  <th key={h} style={{ padding: '4px 12px 6px 0', fontSize: 10, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 400, fontFamily: "'JetBrains Mono', monospace" }}>{h}</th>
                ))}
                <th style={{ padding: '4px 12px 6px 0', fontSize: 10, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 400, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>Stock</th>
                <th style={{ padding: '4px 12px 6px 0', fontSize: 10, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 400, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>Variants</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {products.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: '16px 0', textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>No products match the current filters.</td>
                </tr>
              )}
              {products.map((product) => (
                <React.Fragment key={product.id}>
                  <tr
                    style={{
                      borderBottom: '1px dashed var(--ink-soft)',
                      background: hoveredRow === product.id ? 'var(--paper-2)' : undefined,
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={() => setHoveredRow(product.id)}
                    onMouseLeave={() => setHoveredRow(null)}
                  >
                    <td style={{ padding: '7px 12px 7px 0', fontWeight: 600 }}>{product.title}</td>
                    <td style={{ padding: '7px 12px 7px 0', color: 'var(--ink-soft)' }}>{product.vendor ?? '—'}</td>
                    <td style={{ padding: '7px 12px 7px 0', color: 'var(--ink-soft)' }}>{product.category ?? '—'}</td>
                    <td style={{ padding: '7px 12px 7px 0', color: 'var(--ink-soft)', textAlign: 'right' }}>{product.total_inventory.toLocaleString()}</td>
                    <td style={{ padding: '7px 12px 7px 0', color: 'var(--ink-soft)', textAlign: 'right' }}>{product.variant_count}</td>
                    <td style={{ padding: '7px 0' }}>
                      <button
                        aria-label={`${expandedId === product.id ? 'Collapse' : 'Expand'} ${product.title}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedId((prev) => prev === product.id ? null : product.id);
                        }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-soft)', fontSize: 11, fontFamily: "'JetBrains Mono', monospace", padding: '2px 4px' }}
                      >
                        {expandedId === product.id ? '▲' : '▼'}
                      </button>
                    </td>
                  </tr>
                  {expandedId === product.id && (
                    <tr>
                      <td colSpan={6} style={{ padding: 0, borderBottom: '1.5px solid var(--ink)' }}>
                        <ProductDetail productId={product.id} shopifyCreatedAt={product.shopify_created_at} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 4, marginTop: 16,
              fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
            }}>
              <button className="btn-sketch sm" onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>← prev</button>
              {page > 2 && <button className="btn-sketch sm" onClick={() => setPage(1)}>1</button>}
              {page > 3 && <span style={{ color: 'var(--ink-soft)', padding: '0 2px' }}>…</span>}
              {page > 1 && <button className="btn-sketch sm" onClick={() => setPage((p) => p - 1)}>{page - 1}</button>}
              <button className="btn-sketch sm primary" aria-current="page">{page}</button>
              {page < totalPages && <button className="btn-sketch sm" onClick={() => setPage((p) => p + 1)}>{page + 1}</button>}
              {page < totalPages - 2 && <span style={{ color: 'var(--ink-soft)', padding: '0 2px' }}>…</span>}
              {page < totalPages - 1 && <button className="btn-sketch sm" onClick={() => setPage(totalPages)}>{totalPages}</button>}
              <button className="btn-sketch sm" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages}>next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
