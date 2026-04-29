import { useState, useRef } from 'react';
import { Asset } from '../types';

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

export function AssetCard({
  asset,
  selected,
  focused,
  onSelect,
  onClick,
  onPreview,
  index,
  token,
}: {
  asset: Asset;
  selected: boolean;
  focused: boolean;
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
  const tokenRef = useRef(token);
  if (assetIdRef.current !== asset.id) {
    assetIdRef.current = asset.id;
    tokenRef.current = token;
    setSrc(thumbnailUrl(asset, token));
  } else if (tokenRef.current !== token) {
    tokenRef.current = token;
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
        outline: focused
          ? '2.5px dashed #4a90d9'
          : selected
          ? '2px solid var(--accent)'
          : undefined,
        outlineOffset: (selected || focused) ? 2 : undefined,
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
          <span
            style={{
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

        {/* Shopify image deleted badge */}
        {asset.shopify_image_deleted && (
          <span style={{
            position: 'absolute', bottom: 6, left: 6,
            fontSize: 10, padding: '1px 5px',
            background: '#ff4444', color: '#fff',
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            shopify deleted
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
