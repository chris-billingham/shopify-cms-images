import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FacetSidebar } from './FacetSidebar';
import { Asset, ActiveFilters, SearchResult } from '../types';
import { apiClient } from '../api/client';
import { usePermissions } from '../hooks/usePermissions';

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

function AssetCard({
  asset,
  selected,
  onSelect,
  onClick,
  index,
}: {
  asset: Asset;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onClick: () => void;
  index: number;
}) {
  const kindLabel = TYPE_ICON[asset.asset_type] ?? asset.asset_type;
  const hue = THUMB_COLORS[index % THUMB_COLORS.length];
  const angle = (index * 37) % 180;
  const skuTag = asset.tags['sku'] ?? asset.tags['SKU'];

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
      <div style={{
        aspectRatio: '1/1',
        background: asset.thumbnail_url
          ? undefined
          : `repeating-linear-gradient(${angle}deg, ${hue} 0 8px, #fff 8px 16px)`,
        display: 'grid',
        placeItems: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {asset.thumbnail_url ? (
          <img
            src={asset.thumbnail_url}
            alt={asset.file_name}
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
  const { canUpload } = usePermissions();
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
                  index={i}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
