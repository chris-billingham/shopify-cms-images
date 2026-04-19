import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FacetSidebar } from './FacetSidebar';
import { Asset, ActiveFilters, SearchResult } from '../types';
import { apiClient } from '../api/client';
import { usePermissions } from '../hooks/usePermissions';
import { useAuthStore } from '../stores/authStore';

interface AssetLibraryProps {
  onAssetClick?: (asset: Asset) => void;
}

const SORT_OPTIONS = [
  { value: 'newest', label: 'newest' },
  { value: 'oldest', label: 'oldest' },
  { value: 'name', label: 'name A–Z' },
  { value: 'size', label: 'size' },
];

async function fetchAssets(query: string, filters: ActiveFilters, sort: string): Promise<SearchResult> {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (filters.type) params.set('type', filters.type);
  if (filters.status) params.set('status', filters.status);
  if (filters.tags) {
    Object.entries(filters.tags).forEach(([k, v]) => {
      params.set(`tags[${k}]`, v);
    });
  }
  if (sort) params.set('sort', sort);
  params.set('facets', 'true');
  const { data } = await apiClient.get<SearchResult>(`/search?${params}`);
  return data;
}

const TYPE_ICON: Record<string, string> = { image: 'img', video: 'vid', text: 'txt', document: 'doc' };
const THUMB_COLORS = ['#f0c8b4', '#cbdaf0', '#d5e4c8', '#f5e6a8', '#e4d4ea'];

function previewUrl(assetId: string, token: string | null) {
  return token ? `/api/assets/${assetId}/preview?token=${encodeURIComponent(token)}` : null;
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
  const src = previewUrl(asset.id, token);
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

export function AssetLibrary({ onAssetClick }: AssetLibraryProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<ActiveFilters>({});
  const [sort, setSort] = useState('newest');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const { canUpload } = usePermissions();
  const token = useAuthStore((s) => s.accessToken);
  const navigate = useNavigate();

  const { data, isLoading, isError, dataUpdatedAt } = useQuery({
    queryKey: ['assets', 'search', searchQuery, filters, sort],
    queryFn: () => fetchAssets(searchQuery, filters, sort),
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
    setSearchQuery(searchInput);
  };

  const refreshedAgo = dataUpdatedAt
    ? Math.round((Date.now() - dataUpdatedAt) / 1000)
    : null;

  return (
    <>
    <div style={{ display: 'flex', minHeight: '100%' }}>
      <FacetSidebar
        facets={data?.facets ?? {}}
        activeFilters={filters}
        onFilterChange={setFilters}
      />

      <div style={{ flex: 1, padding: 18, minWidth: 0, minHeight: 640 }}>
        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="bulk-bar">
            <strong>{selectedIds.size} selected</strong>
            <button className="btn-sketch sm">＋ tag</button>
            <button className="btn-sketch sm">link to product…</button>
            <button className="btn-sketch sm">↓ bulk download</button>
            <button className="btn-sketch sm">push to shopify</button>
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

          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="btn-sketch"
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
              onClick={() => {
                const idx = SORT_OPTIONS.findIndex((o) => o.value === sort);
                setSort(SORT_OPTIONS[(idx + 1) % SORT_OPTIONS.length].value);
              }}
            >
              sort: {SORT_OPTIONS.find((o) => o.value === sort)?.label} ▾
            </button>
          </div>

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
