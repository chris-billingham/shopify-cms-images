import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { JobDashboard } from './JobDashboard';
import { ShopifySyncPanel } from './ShopifySyncPanel';

type Tab = 'users' | 'drive' | 'shopify' | 'tags' | 'jobs' | 'health';

interface DependencyStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  quota_warning?: boolean;
}

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  dependencies: {
    postgres: DependencyStatus;
    redis: DependencyStatus;
    google_drive: DependencyStatus;
    shopify: DependencyStatus;
  };
}

// ── Users tab ────────────────────────────────────────────────────────────────

function UsersTab() {
  return (
    <div style={{ fontSize: 13, color: 'var(--ink-soft)', fontFamily: "'JetBrains Mono', monospace" }}>
      User management API not yet implemented. Users are currently managed directly in the database.
    </div>
  );
}

// ── Drive tab ─────────────────────────────────────────────────────────────────

interface DriveFolder { id: string; name: string; }
interface ActiveFolder { folder_id: string; folder_name: string; is_default: boolean; }

function FolderBrowser({
  onSelect,
  onCancel,
}: {
  onSelect: (id: string, name: string) => void;
  onCancel: () => void;
}) {
  const [stack, setStack] = useState<Array<{ id: string; name: string }>>([
    { id: '', name: 'Team Drive root' },
  ]);
  const currentParent = stack[stack.length - 1];

  const { data: folders, isLoading, isError } = useQuery({
    queryKey: ['drive', 'folders', currentParent.id],
    queryFn: async () => {
      const params = currentParent.id ? `?parentId=${currentParent.id}` : '';
      const { data } = await apiClient.get<{ folders: DriveFolder[] }>(`/drive/folders${params}`);
      return data.folders;
    },
  });

  const navigateInto = (folder: DriveFolder) => {
    setStack((prev) => [...prev, { id: folder.id, name: folder.name }]);
  };

  const navigateTo = (idx: number) => {
    setStack((prev) => prev.slice(0, idx + 1));
  };

  return (
    <div style={{
      border: '1.5px solid var(--ink)',
      background: '#fff',
      boxShadow: '3px 3px 0 var(--shadow)',
      marginTop: 10,
    }}>
      {/* Breadcrumb */}
      <div style={{
        padding: '6px 10px',
        borderBottom: '1.5px solid var(--ink)',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 2,
        fontSize: 12,
        fontFamily: "'JetBrains Mono', monospace",
        background: 'var(--paper-2)',
      }}>
        {stack.map((crumb, idx) => (
          <span key={idx} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {idx > 0 && <span style={{ color: 'var(--ink-soft)' }}>/</span>}
            <button
              onClick={() => navigateTo(idx)}
              style={{
                background: 'none', border: 'none', cursor: idx < stack.length - 1 ? 'pointer' : 'default',
                color: idx < stack.length - 1 ? 'var(--blue)' : 'var(--ink)',
                textDecoration: idx < stack.length - 1 ? 'underline' : 'none',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12, padding: 0,
              }}
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </div>

      {/* Folder list */}
      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
        {isLoading && (
          <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--ink-soft)' }}>Loading…</div>
        )}
        {isError && (
          <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--accent)' }}>Failed to load folders.</div>
        )}
        {!isLoading && !isError && folders?.length === 0 && (
          <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--ink-soft)' }}>No subfolders here.</div>
        )}
        {folders?.map((folder) => (
          <div
            key={folder.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 12px',
              borderBottom: '1px dashed var(--ink-soft)',
              fontSize: 13,
            }}
          >
            <button
              onClick={() => navigateInto(folder)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontFamily: "'Architects Daughter', sans-serif",
                color: 'var(--ink)', textAlign: 'left', flex: 1, padding: 0,
              }}
            >
              📁 {folder.name}
            </button>
            <button
              onClick={() => onSelect(folder.id, folder.name)}
              className="btn-sketch sm primary"
              style={{ marginLeft: 8, flexShrink: 0 }}
            >
              Select
            </button>
          </div>
        ))}
      </div>

      {/* Footer: select current level or cancel */}
      <div style={{
        padding: '8px 12px',
        borderTop: '1.5px solid var(--ink)',
        display: 'flex',
        gap: 6,
        justifyContent: 'space-between',
        background: 'var(--paper-2)',
      }}>
        <button
          onClick={() => onSelect(currentParent.id, currentParent.name)}
          className="btn-sketch sm"
        >
          ✓ Use "{currentParent.name}"
        </button>
        <button onClick={onCancel} className="btn-sketch sm ghost">Cancel</button>
      </div>
    </div>
  );
}

function DriveTab() {
  const queryClient = useQueryClient();
  const [browsing, setBrowsing] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const { data } = await apiClient.get<HealthStatus>('/health');
      return data;
    },
  });

  const { data: activeFolder, isLoading } = useQuery({
    queryKey: ['drive', 'folder'],
    queryFn: async () => {
      const { data } = await apiClient.get<ActiveFolder>('/drive/folder');
      return data;
    },
  });

  const setFolder = useMutation({
    mutationFn: async ({ folderId }: { folderId: string }) =>
      apiClient.put('/drive/folder', { folder_id: folderId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drive', 'folder'] });
      setBrowsing(false);
      setSaveMsg('Folder saved.');
      setTimeout(() => setSaveMsg(null), 3000);
    },
  });

  const drive = health?.dependencies.google_drive;
  const connected = drive?.status === 'healthy';

  return (
    <div style={{ fontSize: 13 }}>
      {/* Connection status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ color: 'var(--ink-soft)' }}>Status:</span>
        <span style={{
          color: connected ? 'var(--green)' : drive?.status === 'degraded' ? '#a06000' : 'var(--accent)',
        }}>
          {connected ? '● Connected' : drive?.status === 'degraded' ? '● Degraded' : '● Disconnected'}
        </span>
      </div>

      {/* Active upload folder */}
      <div className="kv-row" style={{ marginBottom: 8 }}>
        <span className="kv-key">upload folder</span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
          {isLoading ? '…' : activeFolder?.folder_name ?? '—'}
          {activeFolder?.is_default && (
            <span style={{ marginLeft: 6, color: 'var(--ink-soft)', fontSize: 10 }}>(default)</span>
          )}
        </span>
      </div>

      {saveMsg && (
        <div style={{ fontSize: 12, color: 'var(--green)', marginBottom: 8 }}>{saveMsg}</div>
      )}

      {!browsing && (
        <button
          className="btn-sketch sm"
          onClick={() => setBrowsing(true)}
          disabled={!connected}
        >
          ◫ Browse &amp; change folder
        </button>
      )}

      {browsing && (
        <FolderBrowser
          onSelect={(id, name) => setFolder.mutate({ folderId: id })}
          onCancel={() => setBrowsing(false)}
        />
      )}
    </div>
  );
}

// ── Tags tab ──────────────────────────────────────────────────────────────────

function TagsTab() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['tags', 'keys'],
    queryFn: async () => {
      const { data } = await apiClient.get<{ keys: string[] }>('/tags/keys');
      return data.keys;
    },
  });

  if (isLoading) return <p className="text-sm text-gray-400">Loading…</p>;
  if (isError) return <p className="text-sm text-red-500">Failed to load tag keys.</p>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">Tag keys are derived from asset metadata. Add tags to assets to see keys here.</p>
      <ul className="space-y-1">
        {(data ?? []).map((key) => (
          <li key={key} className="text-sm">
            <span className="font-medium">{key}</span>
          </li>
        ))}
        {data?.length === 0 && (
          <li className="text-sm text-gray-400">No tag keys yet.</li>
        )}
      </ul>
    </div>
  );
}

// ── Health tab ────────────────────────────────────────────────────────────────

function HealthTab() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'health'],
    queryFn: async () => {
      const { data } = await apiClient.get<HealthStatus>('/health');
      return data;
    },
    refetchInterval: 30_000,
  });

  const services: { key: keyof HealthStatus['dependencies']; label: string }[] = [
    { key: 'postgres', label: 'db' },
    { key: 'redis',    label: 'redis' },
    { key: 'google_drive', label: 'drive' },
    { key: 'shopify',  label: 'shopify' },
  ];

  if (isLoading) return <p className="text-sm text-gray-400">Checking…</p>;
  if (isError)   return <p className="text-sm text-red-500">Could not reach health endpoint.</p>;

  return (
    <div className="space-y-2 text-sm">
      {data && (
        <div className="mb-3 text-xs text-gray-400 uppercase tracking-wide">
          Overall: <span className={
            data.status === 'healthy' ? 'text-green-600' :
            data.status === 'degraded' ? 'text-yellow-600' : 'text-red-500'
          }>{data.status}</span>
        </div>
      )}
      {services.map(({ key, label }) => {
        const dep = data?.dependencies[key];
        return (
          <div key={key} className="flex items-start gap-3">
            <span className="w-20 capitalize text-gray-500">{label}</span>
            {dep ? (
              <div>
                <span className={
                  dep.status === 'healthy'   ? 'text-green-600' :
                  dep.status === 'degraded'  ? 'text-yellow-600' : 'text-red-500'
                }>
                  {dep.status === 'healthy' ? '● OK' :
                   dep.status === 'degraded' ? '● Degraded' : '● Unhealthy'}
                </span>
                {dep.message && (
                  <div className="text-xs text-gray-400 mt-0.5">{dep.message}</div>
                )}
                {dep.quota_warning && (
                  <div className="text-xs text-yellow-600 mt-0.5">Quota &gt; 90%</div>
                )}
              </div>
            ) : (
              <span className="text-gray-300">—</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function AdminSettings() {
  const [activeTab, setActiveTab] = useState<Tab>('users');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'users', label: 'Users' },
    { id: 'drive', label: 'Drive' },
    { id: 'shopify', label: 'Shopify' },
    { id: 'tags', label: 'Tags' },
    { id: 'jobs', label: 'Jobs' },
    { id: 'health', label: 'Health' },
  ];

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Admin Settings</h2>

      <nav className="flex gap-1 mb-6 border-b">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            aria-selected={activeTab === t.id}
            className={`px-4 py-2 text-sm -mb-px border-b-2 ${
              activeTab === t.id
                ? 'border-blue-600 text-blue-600 font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="max-w-2xl">
        {activeTab === 'users' && <UsersTab />}
        {activeTab === 'drive' && <DriveTab />}
        {activeTab === 'shopify' && <ShopifySyncPanel />}
        {activeTab === 'tags' && <TagsTab />}
        {activeTab === 'jobs' && <JobDashboard />}
        {activeTab === 'health' && <HealthTab />}
      </div>
    </div>
  );
}
