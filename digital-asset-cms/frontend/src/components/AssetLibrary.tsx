import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FacetSidebar } from './FacetSidebar';
import { Asset, ActiveFilters, SearchResult } from '../types';
import { apiClient } from '../api/client';
import { usePermissions } from '../hooks/usePermissions';
import { useAuthStore } from '../stores/authStore';
import { useLibraryFilterStore } from '../stores/filterStore';

interface AssetLibraryProps {
  onAssetClick?: (asset: Asset) => void;
}

const SORT_OPTIONS = [
  { value: 'newest', label: 'newest' },
  { value: 'oldest', label: 'oldest' },
  { value: 'name', label: 'name A–Z' },
  { value: 'size', label: 'size' },
];

const PAGE_SIZE = 50;

const SORT_MAP: Record<string, { sort: string; order: string }> = {
  newest: { sort: 'created_at', order: 'desc' },
  oldest: { sort: 'created_at', order: 'asc' },
  name:   { sort: 'file_name',  order: 'asc'  },
  size:   { sort: 'file_size',  order: 'desc' },
};

function buildFilterParams(filters: ActiveFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.type) params.set('type', filters.type);
  if (filters.product_status) params.set('product_status', filters.product_status);
  if (filters.tags) {
    Object.entries(filters.tags).forEach(([k, v]) => params.set(`tags[${k}]`, v));
  }
  return params;
}

async function fetchAssets(query: string, filters: ActiveFilters, sort: string, page: number): Promise<SearchResult> {
  const params = buildFilterParams(filters);
  if (query) params.set('q', query);
  const sortParams = SORT_MAP[sort];
  if (sortParams) {
    params.set('sort', sortParams.sort);
    params.set('order', sortParams.order);
  }
  params.set('page', String(page));
  params.set('limit', String(PAGE_SIZE));
  const { data } = await apiClient.get<SearchResult>(`/search?${params}`);
  return data;
}

async function fetchFacets(query: string, filters: ActiveFilters): Promise<SearchResult['facets']> {
  const params = buildFilterParams(filters);
  if (query) params.set('q', query);
  params.set('limit', '1');
  params.set('facets', 'true');
  const { data } = await apiClient.get<SearchResult>(`/search?${params}`);
  return data.facets;
}

const TYPE_ICON: Record<string, string> = { image: 'img', video: 'vid', text: 'txt', document: 'doc' };
const THUMB_COLORS = ['#f0c8b4', '#cbdaf0', '#d5e4c8', '#f5e6a8', '#e4d4ea'];

function previewUrl(assetId: string, token: string | null) {
  return token ? `/api/assets/${assetId}/preview?token=${encodeURIComponent(token)}` : null;
}

function thumbnailUrl(asset: Asset, token: string | null) {
  if (!token) return null;
  const t = encodeURIComponent(token);
  return asset.thumbnail_url
    ? `${asset.thumbnail_url}?token=${t}`
    : `/api/assets/${asset.id}/preview?token=${t}`;
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

function Lightbox({
  assets,
  initialIndex,
  token,
  onClose,
}: {
  assets: Asset[];
  initialIndex: number;
  token: string | null;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(initialIndex);
  const asset = assets[idx];
  const isImage = asset.asset_type === 'image';
  const src = previewUrl(asset.id, token);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setIdx((i) => Math.min(i + 1, assets.length - 1));
      if (e.key === 'ArrowLeft') setIdx((i) => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [assets.length, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(20, 16, 10, 0.88)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      {/* Top bar */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed', top: 0, left: 0, right: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px',
          background: 'rgba(20,16,10,0.7)',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12, color: '#e8e4da',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
          {asset.file_name}
          <span style={{ marginLeft: 12, opacity: 0.5 }}>{idx + 1} / {assets.length}</span>
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <a
            href={src ?? '#'}
            download={asset.file_name}
            onClick={(e) => e.stopPropagation()}
            style={{ color: '#e8e4da', fontSize: 12, textDecoration: 'underline' }}
          >
            ↓ download
          </a>
          <button
            onClick={onClose}
            aria-label="Close preview"
            style={{
              background: 'none', border: 'none', color: '#e8e4da',
              cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 4px',
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Image */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '90vw', maxHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        {isImage && src ? (
          <img
            key={asset.id}
            src={src}
            alt={asset.file_name}
            style={{ maxWidth: '90vw', maxHeight: '80vh', objectFit: 'contain', display: 'block' }}
          />
        ) : (
          <div style={{
            width: 300, height: 200, border: '2px dashed rgba(255,255,255,0.2)',
            display: 'grid', placeItems: 'center',
            fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'rgba(255,255,255,0.5)',
          }}>
            [ {asset.asset_type} — no preview ]
          </div>
        )}
      </div>

      {/* Prev / Next */}
      {idx > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); setIdx((i) => i - 1); }}
          aria-label="Previous"
          style={{
            position: 'fixed', left: 12, top: '50%', transform: 'translateY(-50%)',
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
            color: '#fff', fontSize: 22, cursor: 'pointer', padding: '8px 14px',
          }}
        >
          ‹
        </button>
      )}
      {idx < assets.length - 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); setIdx((i) => i + 1); }}
          aria-label="Next"
          style={{
            position: 'fixed', right: 12, top: '50%', transform: 'translateY(-50%)',
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
            color: '#fff', fontSize: 22, cursor: 'pointer', padding: '8px 14px',
          }}
        >
          ›
        </button>
      )}
    </div>
  );
}

// ── Asset card ────────────────────────────────────────────────────────────────

function AssetCard({
  asset,
  selected,
  onSelect,
  onClick,
  onPreview,
  index,
  token,
}: {
  asset: Asset;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onClick: () => void;
  onPreview: () => void;
  index: number;
  token: string | null;
}) {
  const kindLabel = TYPE_ICON[asset.asset_type] ?? asset.asset_type;
  const hue = THUMB_COLORS[index % THUMB_COLORS.length];
  const angle = (index * 37) % 180;
  const skuTag = asset.tags['sku'] ?? asset.tags['SKU'];
  const fallbackSrc = previewUrl(asset.id, token);
  const [src, setSrc] = useState(() => thumbnailUrl(asset, token));
  const assetIdRef = useRef(asset.id);
  if (assetIdRef.current !== asset.id) {
    assetIdRef.current = asset.id;
    setSrc(thumbnailUrl(asset, token));
  }
  const isImage = asset.asset_type === 'image';

  return (
    <div
      style={{
        border: '1.5px solid var(--ink)',
        background: '#fff',
        boxShadow: '3px 3px 0 var(--shadow)',
        overflow: 'hidden',
        position: 'relative',
        transform: selected ? 'translate(-1px,-1px)' : undefined,
        outline: selected ? '2px solid var(--accent)' : undefined,
        outlineOffset: selected ? 2 : undefined,
        cursor: 'pointer',
        transition: 'transform 0.1s',
      }}
      onClick={onClick}
    >
      {/* Checkbox */}
      <div
        style={{ position: 'absolute', top: 6, right: 6, zIndex: 2 }}
        onClick={(e) => { e.stopPropagation(); onSelect(asset.id, !selected); }}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => { e.stopPropagation(); onSelect(asset.id, e.target.checked); }}
          style={{ width: 14, height: 14, cursor: 'pointer', accentColor: 'var(--accent)' }}
          aria-label={`Select ${asset.file_name}`}
        />
      </div>

      {/* Thumbnail */}
      <div
        onClick={(e) => { if (isImage && src) { e.stopPropagation(); onPreview(); } }}
        style={{
          aspectRatio: '1/1',
          background: src
            ? undefined
            : `repeating-linear-gradient(${angle}deg, ${hue} 0 8px, #fff 8px 16px)`,
          display: 'grid',
          placeItems: 'center',
          position: 'relative',
          overflow: 'hidden',
          cursor: isImage && src ? 'zoom-in' : 'pointer',
        }}
      >
        {src ? (
          <img
            src={src}
            alt={asset.file_name}
            loading="lazy"
            onError={() => { if (src !== fallbackSrc) setSrc(fallbackSrc); }}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            color: 'var(--ink-soft)',
          }}>
            {kindLabel}
          </span>
        )}

        {/* Type badge */}
        <span style={{
          position: 'absolute', top: 6, left: 6,
          fontSize: 10, padding: '1px 5px',
          background: 'var(--ink)', color: 'var(--paper)',
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {kindLabel}
        </span>

        {/* Zoom hint on hover — images only */}
        {isImage && src && (
          <span style={{
            position: 'absolute', inset: 0,
            display: 'grid', placeItems: 'center',
            background: 'rgba(0,0,0,0)',
            transition: 'background 0.15s',
            fontSize: 22, color: '#fff',
            opacity: 0,
          }}
          className="thumb-zoom-hint"
          >
            ⊕
          </span>
        )}

        {/* SKU badge */}
        {skuTag && (
          <span style={{
            position: 'absolute', bottom: 6, right: 6,
            fontSize: 10, padding: '1px 5px',
            background: 'var(--green-soft)', color: 'var(--ink)',
            fontFamily: "'JetBrains Mono', monospace",
            border: '1px solid var(--ink)',
          }}>
            {skuTag}
          </span>
        )}
      </div>

      {/* Meta */}
      <div style={{
        padding: '6px 8px',
        borderTop: '1.5px dashed var(--ink-soft)',
        fontSize: 12,
      }}>
        <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {asset.file_name}
        </div>
        {Object.keys(asset.tags).length > 0 && (
          <div style={{
            marginTop: 2, fontSize: 10, color: 'var(--ink-soft)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {Object.entries(asset.tags).map(([k, v]) => `${k}: ${v}`).join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Pager ─────────────────────────────────────────────────────────────────────

function Pager({ page, total, limit, onChange }: {
  page: number;
  total: number;
  limit: number;
  onChange: (p: number) => void;
}) {
  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1) return null;

  const windowSize = 5;
  const half = Math.floor(windowSize / 2);
  let start = Math.max(1, page - half);
  const end = Math.min(totalPages, start + windowSize - 1);
  if (end - start < windowSize - 1) start = Math.max(1, end - windowSize + 1);
  const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      marginTop: 20,
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 12,
    }}>
      <button
        className="btn-sketch sm"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
      >
        ← prev
      </button>

      {start > 1 && (
        <>
          <button className="btn-sketch sm" onClick={() => onChange(1)}>1</button>
          {start > 2 && <span style={{ color: 'var(--ink-soft)', padding: '0 2px' }}>…</span>}
        </>
      )}

      {pages.map((p) => (
        <button
          key={p}
          className={`btn-sketch sm${p === page ? ' primary' : ''}`}
          onClick={() => onChange(p)}
          aria-current={p === page ? 'page' : undefined}
        >
          {p}
        </button>
      ))}

      {end < totalPages && (
        <>
          {end < totalPages - 1 && <span style={{ color: 'var(--ink-soft)', padding: '0 2px' }}>…</span>}
          <button className="btn-sketch sm" onClick={() => onChange(totalPages)}>{totalPages}</button>
        </>
      )}

      <button
        className="btn-sketch sm"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
      >
        next →
      </button>

      <span style={{ marginLeft: 8, color: 'var(--ink-soft)' }}>
        page {page} of {totalPages}
      </span>
    </div>
  );
}

export function AssetLibrary({ onAssetClick }: AssetLibraryProps) {
  const { searchQuery, searchInput, filters, sort,
          setSearchQuery, setSearchInput, setFilters, setSort } = useLibraryFilterStore();
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const { canUpload } = usePermissions();
  const token = useAuthStore((s) => s.accessToken);
  const navigate = useNavigate();

  const [bulkDownloadStatus, setBulkDownloadStatus] = useState<'idle' | 'started' | 'error'>('idle');

  const bulkDownload = useMutation({
    mutationFn: async (ids: string[]) => {
      const { data } = await apiClient.post<{ job_id: string; asset_count: number }>(
        '/assets/bulk-download',
        { asset_ids: ids },
      );
      return data;
    },
    onSuccess: () => {
      setBulkDownloadStatus('started');
      setTimeout(() => setBulkDownloadStatus('idle'), 4000);
    },
    onError: () => {
      setBulkDownloadStatus('error');
      setTimeout(() => setBulkDownloadStatus('idle'), 4000);
    },
  });

  const { data, isLoading, isError, dataUpdatedAt } = useQuery({
    queryKey: ['assets', 'search', searchQuery, filters, sort, page],
    queryFn: () => fetchAssets(searchQuery, filters, sort, page),
  });

  const { data: facets } = useQuery({
    queryKey: ['assets', 'facets', searchQuery, filters],
    queryFn: () => fetchFacets(searchQuery, filters),
    staleTime: 60_000,
  });

  const handleSelect = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearchQuery(searchInput);
  };

  const handleFilterChange = (next: ActiveFilters) => {
    setPage(1);
    setFilters(next);
  };

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const refreshedAgo = dataUpdatedAt ? Math.round((now - dataUpdatedAt) / 1000) : null;

  return (
    <>
    <div style={{ display: 'flex', minHeight: '100%' }}>
      <FacetSidebar
        facets={facets ?? data?.facets ?? {}}
        activeFilters={filters}
        onFilterChange={handleFilterChange}
      />

      <div style={{ flex: 1, padding: 18, minWidth: 0, minHeight: 640 }}>
        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="bulk-bar">
            <strong>{selectedIds.size} selected</strong>
            <button className="btn-sketch sm" disabled title="Not yet implemented" style={{ opacity: 0.4 }}>＋ tag</button>
            <button className="btn-sketch sm" disabled title="Not yet implemented" style={{ opacity: 0.4 }}>link to product…</button>
            <button
              className="btn-sketch sm"
              onClick={() => bulkDownload.mutate([...selectedIds])}
              disabled={bulkDownload.isPending}
            >
              {bulkDownload.isPending
                ? '…'
                : bulkDownloadStatus === 'started'
                ? '↓ download queued ✓'
                : bulkDownloadStatus === 'error'
                ? '↓ download failed'
                : '↓ bulk download'}
            </button>
            <button className="btn-sketch sm" disabled title="Not yet implemented" style={{ opacity: 0.4 }}>push to shopify</button>
            <span
              style={{ marginLeft: 'auto', opacity: 0.7, cursor: 'pointer', fontSize: 12 }}
              onClick={() => setSelectedIds(new Set())}
            >
              clear selection
            </span>
          </div>
        )}

        {/* Search row */}
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
          <div className="search-bar">
            <span className="search-icon" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search file names, SKUs, product titles, tag values…"
            />
          </div>

          <select
            value={sort}
            onChange={(e) => { setSort(e.target.value); setPage(1); }}
            className="btn-sketch"
            aria-label="Sort assets"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          {canUpload && (
            <button
              type="button"
              onClick={() => navigate('/upload')}
              className="btn-sketch primary"
            >
              ＋ Upload
            </button>
          )}
        </form>

        {/* Result count */}
        {data && (
          <div className="muted-label" style={{ marginBottom: 8 }}>
            {data.total.toLocaleString()} results
            {refreshedAgo !== null && ` · refreshed ${refreshedAgo}s ago`}
          </div>
        )}

        {isLoading && (
          <div style={{ color: 'var(--ink-soft)', fontSize: 14 }} role="status">
            Loading…
          </div>
        )}

        {isError && (
          <div role="alert" style={{
            padding: '8px 12px',
            background: 'var(--accent-soft)',
            border: '1.5px solid var(--accent)',
            fontSize: 13,
          }}>
            Failed to load assets.
          </div>
        )}

        {data && data.assets.length === 0 && (
          <div style={{ color: 'var(--ink-soft)', fontSize: 14 }}>No assets found.</div>
        )}

        {data && data.assets.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
              gap: 14,
            }}
            role="list"
            aria-label="Asset grid"
          >
            {data.assets.map((asset, i) => (
              <div key={asset.id} role="listitem">
                <AssetCard
                  asset={asset}
                  selected={selectedIds.has(asset.id)}
                  onSelect={handleSelect}
                  onClick={() => onAssetClick?.(asset)}
                  onPreview={() => setPreviewIndex(i)}
                  index={i}
                  token={token}
                />
              </div>
            ))}
          </div>
        )}

        {data && data.total > data.limit && (
          <Pager
            page={data.page}
            total={data.total}
            limit={data.limit}
            onChange={setPage}
          />
        )}
      </div>
    </div>

    {previewIndex !== null && data && (
      <Lightbox
        assets={data.assets}
        initialIndex={previewIndex}
        token={token}
        onClose={() => setPreviewIndex(null)}
      />
    )}
    </>
  );
}
