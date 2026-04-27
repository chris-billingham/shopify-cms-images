import { useState, useEffect } from 'react';
import { Asset } from '../types';

function previewUrl(assetId: string, token: string | null) {
  return token ? `/api/assets/${assetId}/preview?token=${encodeURIComponent(token)}` : null;
}

export function Lightbox({
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

      {/* Media */}
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
        ) : asset.asset_type === 'video' && src ? (
          <video
            key={asset.id}
            src={src}
            controls
            style={{ maxWidth: '90vw', maxHeight: '80vh', display: 'block' }}
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
