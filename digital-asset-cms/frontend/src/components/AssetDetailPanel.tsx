import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Asset } from '../types';
import { apiClient } from '../api/client';
import { usePermissions } from '../hooks/usePermissions';
import { useAuthStore } from '../stores/authStore';

interface AssetDetailPanelProps {
  asset: Asset;
  onClose: () => void;
}

interface TagUpdatePayload {
  tags: Record<string, string>;
  updatedAt: string;
}

interface LinkedProduct {
  link_id: string;
  product_id: string;
  title: string;
  shopify_id: string | null;
  role: string;
  sort_order: number;
}

interface Product {
  id: string;
  title: string;
  shopify_id: string | null;
}

export function AssetDetailPanel({ asset, onClose }: AssetDetailPanelProps) {
  const [conflictError, setConflictError] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [pushStatus, setPushStatus] = useState<'idle' | 'pushing' | 'done' | 'error'>('idle');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [newTagKey, setNewTagKey] = useState('');
  const [newTagValue, setNewTagValue] = useState('');

  const queryClient = useQueryClient();
  const { canEditTags, canDelete, canLinkProducts, canPushToShopify } = usePermissions();
  const token = useAuthStore((s) => s.accessToken);

  const { data: taxonomy } = useQuery({
    queryKey: ['tags', 'taxonomy'],
    queryFn: async () => {
      const { data } = await apiClient.get<{ taxonomy: Record<string, string[]> }>('/tags/taxonomy');
      return data.taxonomy;
    },
    enabled: canEditTags,
  });
  const previewSrc = token ? `/api/assets/${asset.id}/preview?token=${encodeURIComponent(token)}` : null;

  const { data: linkedData, refetch: refetchLinks } = useQuery({
    queryKey: ['asset-products', asset.id],
    queryFn: async () => {
      const { data } = await apiClient.get<{ links: LinkedProduct[] }>(`/assets/${asset.id}/products`);
      return data.links;
    },
  });

  const { data: searchData } = useQuery({
    queryKey: ['products-search', productSearch],
    queryFn: async () => {
      const { data } = await apiClient.get<{ products: Product[] }>('/products', {
        params: { q: productSearch, limit: 10 },
      });
      return data.products;
    },
    enabled: productSearch.length > 0,
  });

  const patchAsset = useMutation({
    mutationFn: async (payload: TagUpdatePayload) => {
      const { data } = await apiClient.patch(`/assets/${asset.id}`, payload);
      return data;
    },
    onMutate: async (payload: TagUpdatePayload) => {
      await queryClient.cancelQueries({ queryKey: ['asset', asset.id] });
      const previous = queryClient.getQueryData<Asset>(['asset', asset.id]);
      queryClient.setQueryData<Asset>(['asset', asset.id], (old) =>
        old ? { ...old, tags: payload.tags } : old,
      );
      return { previous };
    },
    onError: (error: unknown, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['asset', asset.id], context.previous);
      }
      const axiosError = error as { response?: { status: number } };
      if (axiosError?.response?.status === 409) setConflictError(true);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['asset', asset.id] });
    },
  });

  const linkProduct = useMutation({
    mutationFn: async (productId: string) => {
      await apiClient.post(`/products/${productId}/assets`, {
        assetId: asset.id,
        role: 'gallery',
      });
    },
    onSuccess: () => {
      setProductSearch('');
      refetchLinks();
    },
  });

  const unlinkProduct = useMutation({
    mutationFn: async ({ productId, linkId }: { productId: string; linkId: string }) => {
      await apiClient.delete(`/products/${productId}/assets/${linkId}`);
    },
    onSuccess: () => refetchLinks(),
  });

  const handleDelete = async () => {
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    try {
      await apiClient.delete(`/assets/${asset.id}`);
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      onClose();
    } catch {
      setDeleteConfirm(false);
    }
  };

  const handlePushToShopify = async () => {
    setPushStatus('pushing');
    try {
      await apiClient.post(`/shopify/push/${asset.id}`);
      setPushStatus('done');
      setTimeout(() => setPushStatus('idle'), 3000);
    } catch {
      setPushStatus('error');
      setTimeout(() => setPushStatus('idle'), 3000);
    }
  };

  const handleTagRemove = (key: string) => {
    const { [key]: _removed, ...newTags } = asset.tags;
    patchAsset.mutate({ tags: newTags, updatedAt: asset.updated_at });
  };

  const handleTagAdd = () => {
    const key = newTagKey.trim();
    const value = newTagValue.trim();
    if (!key || !value) return;
    patchAsset.mutate({ tags: { ...asset.tags, [key]: value }, updatedAt: asset.updated_at });
    setNewTagKey('');
    setNewTagValue('');
  };

  const handleRefresh = () => {
    setConflictError(false);
    queryClient.invalidateQueries({ queryKey: ['asset', asset.id] });
  };

  const linkedProducts = linkedData ?? [];
  const hasShopifyLink = linkedProducts.some((p) => p.shopify_id);

  const fileSizeMB = (asset.file_size / (1024 * 1024)).toFixed(1);

  return (
    <div
      role="dialog"
      aria-label="Asset detail"
      style={{
        position: 'fixed',
        inset: '0 0 0 auto',
        width: 360,
        background: 'var(--paper)',
        borderLeft: '2px solid var(--ink)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 50,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        padding: '14px 16px 10px',
        borderBottom: '2px solid var(--ink)',
        background: 'var(--paper)',
      }}>
        <h3 style={{
          fontFamily: "'Caveat', cursive",
          fontSize: 20,
          margin: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: 280,
        }}>
          {asset.file_name}
        </h3>
        <button
          onClick={onClose}
          aria-label="Close panel"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 16,
            color: 'var(--ink-soft)',
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {conflictError && (
          <div role="alert" style={{
            padding: '8px 12px',
            background: 'var(--yellow-soft)',
            border: '1.5px solid var(--ink)',
            fontSize: 13,
            marginBottom: 12,
          }}>
            This asset was modified by another user.{' '}
            <button onClick={handleRefresh} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              textDecoration: 'underline', fontSize: 13, color: 'var(--blue)',
            }}>Refresh</button>
          </div>
        )}

        {/* Preview */}
        <div style={{
          aspectRatio: '4/3',
          border: '1.5px solid var(--ink)',
          background: asset.thumbnail_url
            ? undefined
            : 'repeating-linear-gradient(45deg, var(--paper-2) 0 10px, #fff 10px 20px)',
          display: 'grid',
          placeItems: 'center',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          color: 'var(--ink-soft)',
          marginBottom: 10,
          overflow: 'hidden',
        }}>
          {previewSrc && asset.asset_type === 'image' ? (
            <img
              src={previewSrc}
              alt={asset.file_name}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          ) : (
            `[ ${asset.asset_type} — no preview ]`
          )}
        </div>

        {/* Metadata KV */}
        <div className="kv-row"><span className="kv-key">type</span><span>{asset.mime_type}</span></div>
        <div className="kv-row"><span className="kv-key">size</span><span>{fileSizeMB} MB</span></div>
        <div className="kv-row"><span className="kv-key">version</span><span>{asset.version}</span></div>
        <div className="kv-row"><span className="kv-key">uploaded</span><span>{new Date(asset.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
        <div className="kv-row" style={{ borderBottom: 'none' }}>
          <span className="kv-key">drive id</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
            {asset.drive_file_id?.slice(0, 8)}…
          </span>
        </div>

        {/* Tags */}
        <div className="section-h">Tags</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0' }}>
          {Object.entries(asset.tags).map(([key, value]) => (
            <span key={key} className="chip">
              {key}: {value}
              {canEditTags && (
                <span
                  className="chip-x"
                  onClick={() => handleTagRemove(key)}
                  role="button"
                  aria-label={`Remove tag ${key}`}
                >
                  ×
                </span>
              )}
            </span>
          ))}
          {Object.keys(asset.tags).length === 0 && (
            <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>No tags</span>
          )}
        </div>
        {canEditTags && (() => {
          const taxKeys = taxonomy ? Object.keys(taxonomy) : [];
          const allowedValues = taxonomy && newTagKey ? (taxonomy[newTagKey] ?? []) : [];
          const inputStyle: React.CSSProperties = {
            flex: 1,
            border: '1.5px solid var(--ink)',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12,
            padding: '3px 6px',
            background: '#fff',
          };
          return (
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              {taxKeys.length > 0 ? (
                <select
                  value={newTagKey}
                  onChange={(e) => { setNewTagKey(e.target.value); setNewTagValue(''); }}
                  style={inputStyle}
                >
                  <option value="">key…</option>
                  {taxKeys.map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder="key"
                  value={newTagKey}
                  onChange={(e) => setNewTagKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleTagAdd()}
                  style={inputStyle}
                />
              )}
              {allowedValues.length > 0 ? (
                <select
                  value={newTagValue}
                  onChange={(e) => setNewTagValue(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">value…</option>
                  {allowedValues.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder="value"
                  value={newTagValue}
                  onChange={(e) => setNewTagValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleTagAdd()}
                  style={inputStyle}
                />
              )}
              <button
                className="btn-sketch sm"
                onClick={handleTagAdd}
                disabled={!newTagKey.trim() || !newTagValue.trim() || patchAsset.isPending}
              >
                +
              </button>
            </div>
          );
        })()}

        {/* Linked products */}
        <div className="section-h">Linked products</div>
        {linkedProducts.map((link) => (
          <div key={link.link_id} className="link-row">
            <span>
              <strong>{link.title}</strong>
              {' '}· role: {link.role}
              {link.shopify_id && <span className="shopify-tag">shopify</span>}
            </span>
            {canLinkProducts && (
              <button
                className="btn-sketch sm ghost"
                onClick={() => unlinkProduct.mutate({ productId: link.product_id, linkId: link.link_id })}
              >
                unlink
              </button>
            )}
          </div>
        ))}

        {canLinkProducts && (
          <div style={{ marginTop: 8, position: 'relative' }}>
            <input
              type="text"
              placeholder="search products to link…"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              className="sketch-input"
            />
            {productSearch.length > 0 && searchData && searchData.length > 0 && (
              <ul style={{
                position: 'absolute',
                zIndex: 10,
                width: '100%',
                marginTop: 2,
                background: '#fff',
                border: '1.5px solid var(--ink)',
                boxShadow: '3px 3px 0 var(--shadow)',
                maxHeight: 200,
                overflowY: 'auto',
                listStyle: 'none',
                margin: '2px 0 0',
                padding: 0,
              }}>
                {searchData.map((product) => (
                  <li key={product.id}>
                    <button
                      onClick={() => linkProduct.mutate(product.id)}
                      disabled={linkedProducts.some((l) => l.product_id === product.id)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '6px 10px',
                        fontSize: 13,
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontFamily: "'Architects Daughter', sans-serif",
                        color: 'var(--ink)',
                        borderBottom: '1px dashed var(--ink-soft)',
                      }}
                    >
                      {product.title}
                      {product.shopify_id && (
                        <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--green)' }}>Shopify</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {productSearch.length > 0 && searchData?.length === 0 && (
              <div style={{
                position: 'absolute',
                zIndex: 10,
                width: '100%',
                marginTop: 2,
                background: '#fff',
                border: '1.5px solid var(--ink)',
                padding: '8px 10px',
                fontSize: 13,
                color: 'var(--ink-soft)',
              }}>
                No products found. Run a Shopify sync first.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{
        padding: '12px 16px',
        borderTop: '2px solid var(--ink)',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
      }}>
        <a
          href={previewSrc ?? '#'}
          download={asset.file_name}
          className="btn-sketch primary"
          style={{ textDecoration: 'none' }}
        >
          ↓ Download
        </a>

        {canPushToShopify && hasShopifyLink && (
          <button
            onClick={handlePushToShopify}
            disabled={pushStatus === 'pushing'}
            className={`btn-sketch shop`}
          >
            {pushStatus === 'pushing' ? 'Pushing…' :
             pushStatus === 'done'    ? 'Pushed ✓' :
             pushStatus === 'error'   ? 'Push failed' :
             '▲ Push to Shopify'}
          </button>
        )}

        <button className="btn-sketch ghost">↻ Replace file</button>

        {canDelete && (
          <button
            onClick={handleDelete}
            className={`btn-sketch ${deleteConfirm ? 'primary' : 'danger'}`}
          >
            {deleteConfirm ? 'Confirm delete' : '🗑 Delete'}
          </button>
        )}
      </div>
    </div>
  );
}
