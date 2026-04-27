import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Asset } from '../types';
import { apiClient } from '../api/client';
import { usePermissions } from '../hooks/usePermissions';
import { useAuthStore } from '../stores/authStore';

interface AssetDetailPanelProps {
  asset: Asset;
  onClose: () => void;
  isMobile?: boolean;
}

interface PatchAssetPayload {
  tags?: Record<string, string>;
  altText?: string | null;
  updatedAt: string;
}

interface RenamePayload {
  newFileName: string;
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

export function AssetDetailPanel({ asset, onClose, isMobile }: AssetDetailPanelProps) {
  const [conflictError, setConflictError] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [debouncedProductSearch, setDebouncedProductSearch] = useState('');
  const [pushStatus, setPushStatus] = useState<'idle' | 'pushing' | 'done' | 'error'>('idle');
  const [pushAltStatus, setPushAltStatus] = useState<'idle' | 'pushing' | 'done' | 'error'>('idle');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [newTagKey, setNewTagKey] = useState('');
  const [newTagValue, setNewTagValue] = useState('');
  const [editingAlt, setEditingAlt] = useState(false);
  const [altDraft, setAltDraft] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [nameError, setNameError] = useState('');
  const [shopifyRenameQueued, setShopifyRenameQueued] = useState(false);
  const [replaceStatus, setReplaceStatus] = useState<'idle' | 'replacing' | 'done' | 'error'>('idle');
  const replaceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedProductSearch(productSearch), 300);
    return () => clearTimeout(t);
  }, [productSearch]);

  const queryClient = useQueryClient();
  const { canEditTags, canDelete, canLinkProducts, canPushToShopify } = usePermissions();
  const token = useAuthStore((s) => s.accessToken);

  const { data: liveAssetData } = useQuery({
    queryKey: ['asset', asset.id],
    queryFn: async () => {
      const { data } = await apiClient.get<Asset>(`/assets/${asset.id}`);
      return data;
    },
    initialData: asset,
  });
  const liveAsset = liveAssetData ?? asset;

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
    queryKey: ['products-search', debouncedProductSearch],
    queryFn: async () => {
      const { data } = await apiClient.get<{ products: Product[] }>('/products', {
        params: { q: debouncedProductSearch, limit: 10 },
      });
      return data.products;
    },
    enabled: debouncedProductSearch.length > 0,
  });

  const patchAsset = useMutation({
    mutationFn: async (payload: PatchAssetPayload) => {
      const { data } = await apiClient.patch(`/assets/${asset.id}`, payload);
      return data;
    },
    onMutate: async (payload: PatchAssetPayload) => {
      await queryClient.cancelQueries({ queryKey: ['asset', asset.id] });
      const previous = queryClient.getQueryData<Asset>(['asset', asset.id]);
      queryClient.setQueryData<Asset>(['asset', asset.id], (old) => {
        if (!old) return old;
        const next = { ...old };
        if (payload.tags !== undefined) next.tags = payload.tags;
        if (payload.altText !== undefined) next.alt_text = payload.altText;
        return next;
      });
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

  const renameAssetMutation = useMutation({
    mutationFn: async (payload: RenamePayload) => {
      const { data } = await apiClient.post<Asset & { shopifyPushQueued: boolean }>(`/assets/${asset.id}/rename`, payload);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['asset', asset.id] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      setEditingName(false);
      setNameError('');
      if (data.shopifyPushQueued) setShopifyRenameQueued(true);
    },
    onError: (error: unknown) => {
      const axiosError = error as { response?: { status: number; data?: { error?: { code: string; message: string } } } };
      const code = axiosError?.response?.data?.error?.code;
      const message = axiosError?.response?.data?.error?.message;
      if (axiosError?.response?.status === 409 && code === 'CONFLICT') {
        setConflictError(true);
        setEditingName(false);
      } else if (code === 'NAME_CONFLICT') {
        setNameError(message ?? 'A file with that name already exists');
      } else if (code === 'EXTENSION_CHANGE') {
        setNameError('File extension cannot be changed');
      } else {
        setNameError(message ?? 'Rename failed');
      }
    },
  });

  const replaceFileMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      form.append('updatedAt', liveAsset.updated_at);
      const { data } = await apiClient.post(`/assets/${asset.id}/replace`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data;
    },
    onSuccess: () => {
      setReplaceStatus('done');
      queryClient.invalidateQueries({ queryKey: ['asset', asset.id] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      setTimeout(() => setReplaceStatus('idle'), 3000);
    },
    onError: () => {
      setReplaceStatus('error');
      setTimeout(() => setReplaceStatus('idle'), 3000);
    },
  });

  const handleReplaceFile = () => replaceInputRef.current?.click();

  const handleReplaceFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReplaceStatus('replacing');
    replaceFileMutation.mutate(file);
    e.target.value = '';
  };

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
    const { [key]: _removed, ...newTags } = liveAsset.tags;
    patchAsset.mutate({ tags: newTags, updatedAt: liveAsset.updated_at });
  };

  const handleTagAdd = () => {
    const key = newTagKey.trim();
    const value = newTagValue.trim();
    if (!key || !value) return;
    patchAsset.mutate({ tags: { ...liveAsset.tags, [key]: value }, updatedAt: liveAsset.updated_at });
    setNewTagKey('');
    setNewTagValue('');
  };

  const handleRefresh = () => {
    setConflictError(false);
    queryClient.invalidateQueries({ queryKey: ['asset', asset.id] });
  };

  const handleNameEdit = () => {
    // Pre-fill with base name only (strip extension)
    const name = liveAsset.file_name;
    const dotIdx = name.lastIndexOf('.');
    setNameDraft(dotIdx > 0 ? name.slice(0, dotIdx) : name);
    setNameError('');
    setEditingName(true);
  };

  const handleNameSave = () => {
    const ext = liveAsset.file_name.slice(liveAsset.file_name.lastIndexOf('.'));
    const base = nameDraft.trim();
    if (!base) { setNameError('Name cannot be empty'); return; }
    renameAssetMutation.mutate({ newFileName: base + ext, updatedAt: liveAsset.updated_at });
  };

  const handleAltEdit = () => {
    setAltDraft(liveAsset.alt_text ?? '');
    setEditingAlt(true);
  };

  const handleAltSave = () => {
    const trimmed = altDraft.trim();
    patchAsset.mutate({ altText: trimmed || null, updatedAt: liveAsset.updated_at });
    setEditingAlt(false);
  };

  const handleAltRemove = () => {
    patchAsset.mutate({ altText: null, updatedAt: liveAsset.updated_at });
    setEditingAlt(false);
  };

  const handlePushAltToShopify = async () => {
    setPushAltStatus('pushing');
    try {
      await apiClient.post(`/shopify/push-alt/${asset.id}`);
      setPushAltStatus('done');
      setTimeout(() => setPushAltStatus('idle'), 3000);
    } catch {
      setPushAltStatus('error');
      setTimeout(() => setPushAltStatus('idle'), 3000);
    }
  };

  const linkedProducts = linkedData ?? [];
  const hasShopifyLink = linkedProducts.some((p) => p.shopify_id);
  const canPushAlt = canPushToShopify && hasShopifyLink && !!liveAsset.shopify_image_id;

  const fileSizeMB = (liveAsset.file_size / (1024 * 1024)).toFixed(1);

  return (
    <div
      role="dialog"
      aria-label="Asset detail"
      style={{
        position: 'fixed',
        inset: isMobile ? 0 : '0 0 0 auto',
        width: isMobile ? '100%' : 360,
        background: 'var(--paper)',
        borderLeft: isMobile ? 'none' : '2px solid var(--ink)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 50,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      {isMobile ? (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 16px',
          borderBottom: '2px solid var(--ink)',
          background: 'var(--paper)',
        }}>
          <button onClick={onClose} className="btn-sketch sm" aria-label="Back to Library">
            ← back
          </button>
          <h3 style={{
            fontFamily: "'Caveat', cursive",
            fontSize: 20,
            margin: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}>
            {asset.file_name}
          </h3>
        </div>
      ) : (
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
      )}

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
          ) : previewSrc && asset.asset_type === 'video' ? (
            <video
              src={previewSrc}
              controls
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          ) : (
            `[ ${asset.asset_type} — no preview ]`
          )}
        </div>

        {/* Shopify image deleted notice */}
        {liveAsset.shopify_image_deleted && (
          <div role="alert" style={{
            padding: '8px 12px',
            background: '#fff0f0',
            border: '1.5px solid var(--ink)',
            fontSize: 12,
            marginBottom: 10,
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            Image deleted on Shopify. Push again to restore, or remove from CMS below.
          </div>
        )}

        {/* Shopify rename queued notice */}
        {shopifyRenameQueued && (
          <div role="status" style={{
            padding: '6px 10px',
            background: 'var(--yellow-soft)',
            border: '1.5px solid var(--ink)',
            fontSize: 12,
            marginBottom: 10,
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            Shopify re-push queued — check Job Dashboard for status
            <button onClick={() => setShopifyRenameQueued(false)} style={{
              background: 'none', border: 'none', cursor: 'pointer', marginLeft: 8,
              fontSize: 12, color: 'var(--ink-soft)',
            }}>✕</button>
          </div>
        )}

        {/* Filename */}
        <div className="section-h">Filename</div>
        {editingName ? (
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="text"
                value={nameDraft}
                onChange={(e) => { setNameDraft(e.target.value); setNameError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleNameSave(); if (e.key === 'Escape') setEditingName(false); }}
                autoFocus
                style={{
                  flex: 1,
                  border: '1.5px solid var(--ink)',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12,
                  padding: '3px 6px',
                  background: '#fff',
                }}
              />
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--ink-soft)', flexShrink: 0 }}>
                {liveAsset.file_name.slice(liveAsset.file_name.lastIndexOf('.'))}
              </span>
            </div>
            {nameError && (
              <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 3, fontFamily: "'JetBrains Mono', monospace" }}>
                {nameError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              <button className="btn-sketch sm primary" onClick={handleNameSave} disabled={renameAssetMutation.isPending}>
                save
              </button>
              <button className="btn-sketch sm ghost" onClick={() => { setEditingName(false); setNameError(''); }}>
                cancel
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span style={{ flex: 1, fontSize: 12, fontFamily: "'JetBrains Mono', monospace", wordBreak: 'break-all' }}>
              {liveAsset.file_name}
            </span>
            {canEditTags && (
              <button className="btn-sketch sm ghost" onClick={handleNameEdit}>
                edit
              </button>
            )}
          </div>
        )}

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
          {Object.entries(liveAsset.tags).map(([key, value]) => (
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
          {Object.keys(liveAsset.tags).length === 0 && (
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

        {/* Alt text */}
        <div className="section-h">Alt text</div>
        {editingAlt ? (
          <div style={{ marginBottom: 8 }}>
            <textarea
              value={altDraft}
              onChange={(e) => setAltDraft(e.target.value)}
              rows={3}
              placeholder="Describe the image for accessibility…"
              style={{
                width: '100%',
                border: '1.5px solid var(--ink)',
                fontFamily: "'Architects Daughter', sans-serif",
                fontSize: 13,
                padding: '4px 6px',
                background: '#fff',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              <button className="btn-sketch sm primary" onClick={handleAltSave} disabled={patchAsset.isPending}>
                save
              </button>
              <button className="btn-sketch sm ghost" onClick={() => setEditingAlt(false)}>
                cancel
              </button>
              {liveAsset.alt_text && (
                <button className="btn-sketch sm danger" onClick={handleAltRemove} disabled={patchAsset.isPending}>
                  remove
                </button>
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 8 }}>
            <span style={{
              flex: 1,
              fontSize: 13,
              fontFamily: "'Architects Daughter', sans-serif",
              color: liveAsset.alt_text ? 'var(--ink)' : 'var(--ink-soft)',
              fontStyle: liveAsset.alt_text ? 'normal' : 'italic',
            }}>
              {liveAsset.alt_text || 'No alt text'}
            </span>
            {canEditTags && (
              <button className="btn-sketch sm ghost" onClick={handleAltEdit}>
                edit
              </button>
            )}
          </div>
        )}

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

        {canPushAlt && (
          <button
            onClick={handlePushAltToShopify}
            disabled={pushAltStatus === 'pushing'}
            className={`btn-sketch shop`}
          >
            {pushAltStatus === 'pushing' ? 'Pushing…' :
             pushAltStatus === 'done'    ? 'Alt pushed ✓' :
             pushAltStatus === 'error'   ? 'Push failed' :
             '▲ Push alt text'}
          </button>
        )}

        <input
          type="file"
          ref={replaceInputRef}
          style={{ display: 'none' }}
          onChange={handleReplaceFileChange}
          accept="image/*,video/*"
        />
        <button
          className="btn-sketch ghost"
          onClick={handleReplaceFile}
          disabled={replaceStatus === 'replacing'}
        >
          {replaceStatus === 'replacing' ? 'Replacing…' :
           replaceStatus === 'done'      ? 'Replaced ✓' :
           replaceStatus === 'error'     ? 'Replace failed' :
           '↻ Replace file'}
        </button>

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
