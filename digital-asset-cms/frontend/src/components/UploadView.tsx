import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZES, getAssetType } from '../types';

interface SearchProduct {
  id: string;
  title: string;
  shopify_id: string | null;
}
import { apiClient } from '../api/client';

interface FileState {
  file: File;
  status: 'pending' | 'checking' | 'duplicate' | 'uploading' | 'done' | 'error';
  progress: number;
  error?: string;
  duplicateAsset?: { id: string; file_name: string };
}

interface DuplicateCheckResponse {
  duplicate: boolean;
  asset?: { id: string; file_name: string };
}

function validateFile(file: File): string | null {
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return `File type "${file.type}" is not supported.`;
  }
  const assetType = getAssetType(file.type);
  if (assetType) {
    const maxSize = MAX_FILE_SIZES[assetType];
    if (file.size > maxSize) {
      const mb = maxSize / (1024 * 1024);
      return `File exceeds the ${mb} MB size limit for ${assetType} files.`;
    }
  }
  return null;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function StatusDot({ status, progress }: { status: FileState['status']; progress: number }) {
  if (status === 'uploading') {
    return <span className="status-dot ok">{progress}%</span>;
  }
  if (status === 'done') return <span className="status-dot ok">done ✓</span>;
  if (status === 'error') return <span className="status-dot err">rejected</span>;
  if (status === 'duplicate') return <span className="status-dot warn">duplicate detected</span>;
  if (status === 'checking') return <span className="status-dot">checking…</span>;
  return <span className="status-dot">queued</span>;
}

export function UploadView() {
  const [files, setFiles] = useState<FileState[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // Batch tag sidebar state
  const [batchProductSearch, setBatchProductSearch] = useState('');
  const [debouncedBatchSearch, setDebouncedBatchSearch] = useState('');
  const [batchRole, setBatchRole] = useState('gallery');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedBatchSearch(batchProductSearch), 300);
    return () => clearTimeout(t);
  }, [batchProductSearch]);
  const [batchTags, setBatchTags] = useState<Array<{ key: string; value: string }>>([]);
  const [newTagKey, setNewTagKey] = useState('');
  const [newTagValue, setNewTagValue] = useState('');

  const { data: productSearchData } = useQuery({
    queryKey: ['products-search-upload', debouncedBatchSearch],
    queryFn: async () => {
      const { data } = await apiClient.get<{ products: SearchProduct[] }>('/products', {
        params: { q: debouncedBatchSearch, limit: 10 },
      });
      return data.products;
    },
    enabled: debouncedBatchSearch.length > 1,
  });

  const checkDuplicate = useMutation({
    mutationFn: async (file: File) => {
      const { data } = await apiClient.get<DuplicateCheckResponse>(
        '/assets/check-duplicate',
        { params: { fileName: file.name, fileSize: file.size } },
      );
      return data;
    },
  });

  const processFiles = async (incomingFiles: File[]) => {
    const newStates: FileState[] = incomingFiles.map((file) => {
      const validationError = validateFile(file);
      return {
        file,
        status: validationError ? 'error' : 'pending',
        progress: 0,
        error: validationError ?? undefined,
      };
    });

    setFiles((prev) => [...prev, ...newStates]);

    for (const state of newStates) {
      if (state.status === 'error') continue;

      setFiles((prev) =>
        prev.map((f) => f.file === state.file ? { ...f, status: 'checking' } : f),
      );

      try {
        const result = await checkDuplicate.mutateAsync(state.file);
        if (result.duplicate) {
          setFiles((prev) =>
            prev.map((f) =>
              f.file === state.file
                ? { ...f, status: 'duplicate', duplicateAsset: result.asset }
                : f,
            ),
          );
        } else {
          setFiles((prev) =>
            prev.map((f) => f.file === state.file ? { ...f, status: 'uploading' } : f),
          );
          await uploadFile(state.file);
        }
      } catch {
        setFiles((prev) =>
          prev.map((f) =>
            f.file === state.file ? { ...f, status: 'error', error: 'Upload failed' } : f,
          ),
        );
      }
    }
  };

  const uploadFile = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    // Apply batch tags
    if (batchTags.length > 0) {
      const tagObj: Record<string, string> = {};
      batchTags.forEach((t) => { tagObj[t.key] = t.value; });
      formData.append('tags', JSON.stringify(tagObj));
    }
    if (batchRole) formData.append('role', batchRole);

    try {
      await apiClient.post('/assets', formData, {
        headers: { 'Content-Type': undefined },
        onUploadProgress: (e) => {
          const pct = e.total ? Math.round((e.loaded / e.total) * 100) : 0;
          setFiles((prev) =>
            prev.map((f) => f.file === file ? { ...f, progress: pct } : f),
          );
        },
      });
      setFiles((prev) =>
        prev.map((f) => f.file === file ? { ...f, status: 'done', progress: 100 } : f),
      );
      queryClient.invalidateQueries({ queryKey: ['assets'] });
    } catch {
      setFiles((prev) =>
        prev.map((f) =>
          f.file === file ? { ...f, status: 'error', error: 'Upload failed' } : f,
        ),
      );
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length > 0) processFiles(dropped);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length > 0) processFiles(selected);
  };

  const handleDismissDuplicate = (file: File) => {
    setFiles((prev) => prev.filter((f) => f.file !== file));
  };

  const handleReplaceExisting = async (file: File, assetId: string) => {
    setFiles((prev) =>
      prev.map((f) => f.file === file ? { ...f, status: 'uploading' } : f),
    );
    const formData = new FormData();
    formData.append('file', file);
    try {
      await apiClient.post(`/assets/${assetId}/replace`, formData, {
        headers: { 'Content-Type': undefined },
        onUploadProgress: (e) => {
          const pct = e.total ? Math.round((e.loaded / e.total) * 100) : 0;
          setFiles((prev) =>
            prev.map((f) => f.file === file ? { ...f, progress: pct } : f),
          );
        },
      });
      setFiles((prev) =>
        prev.map((f) => f.file === file ? { ...f, status: 'done', progress: 100 } : f),
      );
      queryClient.invalidateQueries({ queryKey: ['assets'] });
    } catch {
      setFiles((prev) =>
        prev.map((f) => f.file === file ? { ...f, status: 'error', error: 'Replace failed' } : f),
      );
    }
  };

  const handleUploadAnyway = async (file: File) => {
    setFiles((prev) =>
      prev.map((f) => f.file === file ? { ...f, status: 'uploading' } : f),
    );
    await uploadFile(file);
  };

  const addBatchTag = () => {
    if (!newTagKey.trim() || !newTagValue.trim()) return;
    setBatchTags((prev) => [...prev, { key: newTagKey.trim(), value: newTagValue.trim() }]);
    setNewTagKey('');
    setNewTagValue('');
  };

  const removeBatchTag = (idx: number) => {
    setBatchTags((prev) => prev.filter((_, i) => i !== idx));
  };

  const queuedCount = files.filter((f) => f.status !== 'done' && f.status !== 'error').length;
  const dupCount = files.filter((f) => f.status === 'duplicate').length;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 320px',
      minHeight: 'calc(100vh - 50px)',
    }}>
      {/* Main upload area */}
      <div style={{ padding: 18, position: 'relative' }}>
        {/* Dropzone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`dropzone ${isDragging ? 'drag-over' : ''}`}
          role="region"
          aria-label="Drop zone"
        >
          drop files here
          <div className="dropzone-hint">
            or click to browse · images ≤ 100MB · video ≤ 1GB · pdf ≤ 50MB
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>

        {/* Summary */}
        {files.length > 0 && (
          <div className="muted-label" style={{ marginBottom: 6 }}>
            {queuedCount > 0 && `${queuedCount} file${queuedCount > 1 ? 's' : ''} queued`}
            {dupCount > 0 && ` · ${dupCount} duplicate${dupCount > 1 ? 's' : ''} detected`}
          </div>
        )}

        {/* File list */}
        {files.map((fileState, idx) => (
          <div key={idx}>
            {fileState.status === 'duplicate' ? (
              // Duplicate — full-width inline
              <div style={{
                border: '1.5px solid var(--ink)',
                background: '#fff',
                padding: '8px 12px',
                marginBottom: 6,
                fontSize: 13,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                  <div>
                    <strong>{fileState.file.name}</strong>
                    <div className="muted-label">{formatSize(fileState.file.size)} · {fileState.file.type}</div>
                  </div>
                  <StatusDot status={fileState.status} progress={fileState.progress} />
                </div>
                {fileState.duplicateAsset && (
                  <div className="dup-modal">
                    <strong>Looks like this file is already in the library.</strong><br />
                    Match: <em>{fileState.duplicateAsset.file_name}</em>
                    <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                      <button className="btn-sketch sm" onClick={() => handleDismissDuplicate(fileState.file)}>
                        skip
                      </button>
                      <button className="btn-sketch sm primary" onClick={() => handleReplaceExisting(fileState.file, fileState.duplicateAsset!.id)}>
                        replace existing (new version)
                      </button>
                      <button className="btn-sketch sm ghost" onClick={() => handleUploadAnyway(fileState.file)}>
                        upload anyway as separate asset
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="file-item">
                <div>
                  <strong>{fileState.file.name}</strong>
                  <div className="muted-label">{formatSize(fileState.file.size)} · {fileState.file.type}</div>
                  {fileState.error && (
                    <div style={{ color: 'var(--accent)', fontSize: 11, marginTop: 2 }} role="alert">
                      {fileState.error}
                    </div>
                  )}
                </div>

                {fileState.status === 'uploading' ? (
                  <div className="progress-sketch">
                    <span className="progress-sketch-bar" style={{ width: `${fileState.progress}%` }} />
                  </div>
                ) : <div />}

                <StatusDot status={fileState.status} progress={fileState.progress} />

                {fileState.status === 'uploading' ? (
                  <span className="status-dot ok">uploading</span>
                ) : fileState.status === 'error' && !fileState.duplicateAsset ? (
                  <span className="muted-label">unsupported type</span>
                ) : (
                  <div />
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Right sidebar: apply to all */}
      <aside className="sketch-sidebar" style={{
        borderLeft: '2px solid var(--ink)',
        borderRight: 'none',
        padding: 16,
      }}>
        <div className="side-h">Apply to all (optional)</div>

        <div className="sub-h">product (optional)</div>
        <input
          placeholder="search product…"
          value={batchProductSearch}
          onChange={(e) => setBatchProductSearch(e.target.value)}
          className="sketch-input"
          style={{ marginBottom: 4 }}
        />
        {batchProductSearch.length > 1 && productSearchData && productSearchData.length > 0 && (
          <ul style={{
            border: '1.5px solid var(--ink)',
            background: '#fff',
            listStyle: 'none',
            padding: 0,
            margin: '0 0 8px',
            maxHeight: 120,
            overflowY: 'auto',
          }}>
            {productSearchData.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => setBatchProductSearch(p.title)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '5px 8px',
                    fontSize: 13,
                    background: 'none',
                    border: 'none',
                    borderBottom: '1px dashed var(--ink-soft)',
                    cursor: 'pointer',
                    fontFamily: "'Architects Daughter', sans-serif",
                    color: 'var(--ink)',
                  }}
                >
                  {p.title}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="sub-h">role</div>
        <select
          value={batchRole}
          onChange={(e) => setBatchRole(e.target.value)}
          className="sketch-input"
          style={{ marginBottom: 8 }}
        >
          <option value="gallery">gallery</option>
          <option value="hero">hero</option>
          <option value="swatch">swatch</option>
        </select>

        <div className="sub-h">tags</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {batchTags.map((t, i) => (
            <span key={i} className="chip">
              {t.key}: {t.value}
              <span className="chip-x" onClick={() => removeBatchTag(i)}>×</span>
            </span>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
          <input
            placeholder="key"
            value={newTagKey}
            onChange={(e) => setNewTagKey(e.target.value)}
            className="sketch-input"
            style={{ flex: 1 }}
          />
          <input
            placeholder="value"
            value={newTagValue}
            onChange={(e) => setNewTagValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addBatchTag()}
            className="sketch-input"
            style={{ flex: 1 }}
          />
        </div>
        <button className="btn-sketch sm ghost" onClick={addBatchTag} style={{ marginBottom: 16 }}>
          ＋ add tag
        </button>

        <div style={{
          border: '1.5px dashed var(--accent)',
          background: 'rgba(216,87,42,0.06)',
          padding: '6px 10px',
          fontSize: 12,
          fontFamily: "'Architects Daughter', sans-serif",
          color: 'var(--accent)',
        }}>
          ✱ These are applied at upload — you can still edit each asset afterwards.
        </div>
      </aside>
    </div>
  );
}
