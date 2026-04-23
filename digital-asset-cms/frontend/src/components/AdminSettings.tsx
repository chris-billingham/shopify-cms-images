import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { getAccessToken } from '../stores/authStore';
import { JobDashboard } from './JobDashboard';
import { ShopifySyncPanel } from './ShopifySyncPanel';

type Tab = 'users' | 'drive' | 'shopify' | 'tags' | 'jobs' | 'health' | 'library';

// ── Shopify tab ───────────────────────────────────────────────────────────────

interface ShopifySettings {
  store_domain: string;
  admin_api_token_hint: string;
  webhook_secret_hint: string;
  source: 'database' | 'environment';
}

function ShopifyTab() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ store_domain: '', admin_api_token: '', webhook_secret: '' });
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['shopify', 'settings'],
    queryFn: async () => {
      const { data } = await apiClient.get<ShopifySettings>('/shopify/settings');
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      await apiClient.put('/shopify/settings', form);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shopify', 'settings'] });
      setForm({ store_domain: '', admin_api_token: '', webhook_secret: '' });
      setSaveError(null);
      setSaveMsg('Settings saved.');
      setTimeout(() => setSaveMsg(null), 3000);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message ?? 'Failed to save settings';
      setSaveError(msg);
    },
  });

  const sectionLabel = (text: string) => (
    <div style={{
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11,
      color: 'var(--ink-soft)',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      marginBottom: 8,
    }}>
      {text}
    </div>
  );

  const kv = (label: string, value: string | undefined) => (
    <div className="kv-row" style={{ marginBottom: 4 }}>
      <span className="kv-key">{label}</span>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
        {isLoading ? '…' : value ?? '—'}
      </span>
    </div>
  );

  return (
    <div style={{ fontSize: 13 }}>
      {/* Current values */}
      <div style={{ marginBottom: 16 }}>
        {sectionLabel('current connection')}
        <div style={{
          border: '1.5px solid var(--ink)',
          boxShadow: '3px 3px 0 var(--shadow)',
          background: 'var(--paper-2)',
          padding: '10px 12px',
        }}>
          {kv('store domain', data?.store_domain)}
          {kv('api token', data?.admin_api_token_hint)}
          {kv('webhook secret', data?.webhook_secret_hint)}
          {data && (
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-soft)', fontFamily: "'JetBrains Mono', monospace" }}>
              source: {data.source}
            </div>
          )}
        </div>
      </div>

      {/* Edit form */}
      <div style={{ marginBottom: 20 }}>
        {sectionLabel('update settings')}
        <div style={{
          border: '1.5px solid var(--ink)',
          boxShadow: '3px 3px 0 var(--shadow)',
          background: '#fff',
        }}>
          <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(
              [
                { key: 'store_domain', label: 'store domain', placeholder: 'mystore.myshopify.com', type: 'text' },
                { key: 'admin_api_token', label: 'api token', placeholder: 'leave blank to keep current', type: 'password' },
                { key: 'webhook_secret', label: 'webhook secret', placeholder: 'leave blank to keep current', type: 'password' },
              ] as const
            ).map(({ key, label, placeholder, type }) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{
                  width: 110, fontSize: 12, color: 'var(--ink-soft)', flexShrink: 0,
                  fontFamily: "'JetBrains Mono', monospace",
                }}>
                  {label}
                </label>
                <input
                  type={type}
                  value={form[key]}
                  placeholder={placeholder}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  style={{
                    flex: 1,
                    border: '1.5px solid var(--ink)',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 12,
                    padding: '3px 6px',
                    background: '#fff',
                  }}
                />
              </div>
            ))}

            {saveError && (
              <div style={{ fontSize: 12, color: 'var(--accent)', fontFamily: "'JetBrains Mono', monospace" }}>
                {saveError}
              </div>
            )}
            {saveMsg && (
              <div style={{ fontSize: 12, color: 'var(--green)', fontFamily: "'JetBrains Mono', monospace" }}>
                {saveMsg}
              </div>
            )}

            <div>
              <button
                className="btn-sketch sm primary"
                onClick={() => save.mutate()}
                disabled={save.isPending || (!form.store_domain && !form.admin_api_token && !form.webhook_secret)}
              >
                {save.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Sync controls */}
      <div>
        {sectionLabel('sync')}
      </div>
    </div>
  );
}

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

interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'editor' | 'viewer';
  status: 'active' | 'inactive';
  created_at: string;
}

const ROLE_OPTIONS: User['role'][] = ['admin', 'editor', 'viewer'];

const ROLE_COLORS: Record<User['role'], string> = {
  admin: 'var(--blue)',
  editor: '#5a8a00',
  viewer: 'var(--ink-soft)',
};

function UserRow({
  user,
  isSelf,
  onRoleChange,
  onStatusToggle,
  onDelete,
}: {
  user: User;
  isSelf: boolean;
  onRoleChange: (id: string, role: User['role']) => void;
  onStatusToggle: (id: string, newStatus: 'active' | 'inactive') => void;
  onDelete: (id: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr auto auto auto',
      gap: '8px 12px',
      alignItems: 'center',
      padding: '8px 12px',
      borderBottom: '1px dashed var(--ink-soft)',
      opacity: user.status === 'inactive' ? 0.5 : 1,
      fontSize: 13,
    }}>
      {/* Name + email */}
      <div>
        <div style={{ fontFamily: "'Architects Daughter', sans-serif" }}>
          {user.name}
          {isSelf && <span style={{ fontSize: 10, color: 'var(--ink-soft)', marginLeft: 4 }}>(you)</span>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-soft)', fontFamily: "'JetBrains Mono', monospace" }}>
          {user.email}
        </div>
      </div>

      {/* Role selector */}
      <select
        value={user.role}
        disabled={isSelf}
        onChange={(e) => onRoleChange(user.id, e.target.value as User['role'])}
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12,
          border: '1.5px solid var(--ink)',
          background: '#fff',
          padding: '2px 6px',
          cursor: isSelf ? 'not-allowed' : 'pointer',
          color: ROLE_COLORS[user.role],
        }}
      >
        {ROLE_OPTIONS.map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>

      {/* Status toggle */}
      <button
        className="btn-sketch sm ghost"
        disabled={isSelf}
        onClick={() => onStatusToggle(user.id, user.status === 'active' ? 'inactive' : 'active')}
        title={isSelf ? 'Cannot change your own status' : undefined}
      >
        {user.status === 'active' ? 'Deactivate' : 'Activate'}
      </button>

      {/* Delete */}
      {confirmDelete ? (
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn-sketch sm primary" onClick={() => onDelete(user.id)}>Confirm</button>
          <button className="btn-sketch sm ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
        </div>
      ) : (
        <button
          className="btn-sketch sm ghost"
          disabled={isSelf}
          onClick={() => setConfirmDelete(true)}
          style={{ color: 'var(--accent)' }}
        >
          Delete
        </button>
      )}
    </div>
  );
}

function AddUserForm({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: '', name: '', role: 'viewer' as User['role'], password: '' });
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      await apiClient.post('/users', form);
    },
    onSuccess: () => {
      setForm({ email: '', name: '', role: 'viewer', password: '' });
      setError(null);
      setOpen(false);
      onSuccess();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message ?? 'Failed to create user';
      setError(msg);
    },
  });

  if (!open) {
    return (
      <button className="btn-sketch sm" onClick={() => setOpen(true)} style={{ marginTop: 12 }}>
        + Add user
      </button>
    );
  }

  return (
    <div style={{
      marginTop: 12,
      border: '1.5px solid var(--ink)',
      boxShadow: '3px 3px 0 var(--shadow)',
      background: 'var(--paper-2)',
    }}>
      <div style={{
        padding: '6px 12px',
        borderBottom: '1.5px solid var(--ink)',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12,
        color: 'var(--ink-soft)',
      }}>
        new user
      </div>
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(['email', 'name', 'password'] as const).map((field) => (
          <div key={field} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{
              width: 72, fontSize: 12, color: 'var(--ink-soft)',
              fontFamily: "'JetBrains Mono', monospace", flexShrink: 0,
            }}>
              {field}
            </label>
            <input
              type={field === 'password' ? 'password' : 'text'}
              value={form[field]}
              onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
              style={{
                flex: 1,
                border: '1.5px solid var(--ink)',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
                padding: '3px 6px',
                background: '#fff',
              }}
            />
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{
            width: 72, fontSize: 12, color: 'var(--ink-soft)',
            fontFamily: "'JetBrains Mono', monospace", flexShrink: 0,
          }}>
            role
          </label>
          <select
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as User['role'] }))}
            style={{
              border: '1.5px solid var(--ink)',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12, padding: '3px 6px', background: '#fff',
            }}
          >
            {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        {error && (
          <div style={{ fontSize: 12, color: 'var(--accent)', fontFamily: "'JetBrains Mono', monospace" }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <button
            className="btn-sketch sm primary"
            onClick={() => create.mutate()}
            disabled={create.isPending}
          >
            {create.isPending ? 'Creating…' : 'Create'}
          </button>
          <button className="btn-sketch sm ghost" onClick={() => { setOpen(false); setError(null); }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function UsersTab() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const { data } = await apiClient.get<{ users: User[] }>('/users');
      return data.users;
    },
  });

  // Derive current user id from JWT stored in memory
  const selfId = (() => {
    try {
      const token = getAccessToken();
      if (!token) return null;
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.user_id as string;
    } catch {
      return null;
    }
  })();

  const updateUser = useMutation({
    mutationFn: async ({ id, ...patch }: { id: string; role?: User['role']; status?: 'active' | 'inactive' }) => {
      await apiClient.patch(`/users/${id}`, patch);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  const deleteUser = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/users/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  if (isLoading) {
    return (
      <div style={{ fontSize: 13, color: 'var(--ink-soft)', fontFamily: "'JetBrains Mono', monospace" }}>
        Loading…
      </div>
    );
  }

  if (isError) {
    return (
      <div style={{ fontSize: 13, color: 'var(--accent)', fontFamily: "'JetBrains Mono', monospace" }}>
        Failed to load users.
      </div>
    );
  }

  return (
    <div>
      <div style={{
        border: '1.5px solid var(--ink)',
        boxShadow: '3px 3px 0 var(--shadow)',
      }}>
        {/* Header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr auto auto auto',
          gap: '8px 12px',
          padding: '6px 12px',
          borderBottom: '1.5px solid var(--ink)',
          background: 'var(--paper-2)',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          color: 'var(--ink-soft)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          <span>user</span>
          <span>role</span>
          <span></span>
          <span></span>
          <span></span>
        </div>

        {/* Rows */}
        {data?.length === 0 && (
          <div style={{ padding: '12px', fontSize: 13, color: 'var(--ink-soft)', fontFamily: "'JetBrains Mono', monospace" }}>
            No users found.
          </div>
        )}
        {data?.map((user) => (
          <UserRow
            key={user.id}
            user={user}
            isSelf={user.id === selfId}
            onRoleChange={(id, role) => updateUser.mutate({ id, role })}
            onStatusToggle={(id, status) => updateUser.mutate({ id, status })}
            onDelete={(id) => deleteUser.mutate(id)}
          />
        ))}
      </div>

      <AddUserForm onSuccess={() => queryClient.invalidateQueries({ queryKey: ['users'] })} />
    </div>
  );
}

// ── Drive tab ─────────────────────────────────────────────────────────────────

interface DriveSettings {
  client_email: string | null;
  project_id: string | null;
  source: 'database' | 'environment';
}

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
  const [folderSaveMsg, setFolderSaveMsg] = useState<string | null>(null);
  const [keyJson, setKeyJson] = useState('');
  const [keySaveMsg, setKeySaveMsg] = useState<string | null>(null);
  const [keySaveError, setKeySaveError] = useState<string | null>(null);

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const { data } = await apiClient.get<HealthStatus>('/health');
      return data;
    },
  });

  const { data: activeFolder, isLoading: folderLoading } = useQuery({
    queryKey: ['drive', 'folder'],
    queryFn: async () => {
      const { data } = await apiClient.get<ActiveFolder>('/drive/folder');
      return data;
    },
  });

  const { data: driveSettings, isLoading: settingsLoading } = useQuery({
    queryKey: ['drive', 'settings'],
    queryFn: async () => {
      const { data } = await apiClient.get<DriveSettings>('/drive/settings');
      return data;
    },
  });

  const setFolder = useMutation({
    mutationFn: async ({ folderId }: { folderId: string }) =>
      apiClient.put('/drive/folder', { folder_id: folderId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drive', 'folder'] });
      setBrowsing(false);
      setFolderSaveMsg('Folder saved.');
      setTimeout(() => setFolderSaveMsg(null), 3000);
    },
  });

  const saveKey = useMutation({
    mutationFn: async () => {
      await apiClient.put('/drive/settings', { service_account_key: keyJson });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drive', 'settings'] });
      queryClient.invalidateQueries({ queryKey: ['health'] });
      setKeyJson('');
      setKeySaveError(null);
      setKeySaveMsg('Service account key saved.');
      setTimeout(() => setKeySaveMsg(null), 3000);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message ?? 'Failed to save key';
      setKeySaveError(msg);
    },
  });

  const drive = health?.dependencies.google_drive;
  const connected = drive?.status === 'healthy';

  const sectionLabel = (text: string) => (
    <div style={{
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11,
      color: 'var(--ink-soft)',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      marginBottom: 8,
    }}>
      {text}
    </div>
  );

  return (
    <div style={{ fontSize: 13 }}>
      {/* Connection status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <span style={{ color: 'var(--ink-soft)' }}>Status:</span>
        <span style={{
          color: connected ? 'var(--green)' : drive?.status === 'degraded' ? '#a06000' : 'var(--accent)',
        }}>
          {connected ? '● Connected' : drive?.status === 'degraded' ? '● Degraded' : '● Disconnected'}
        </span>
      </div>

      {/* Service account key */}
      <div style={{ marginBottom: 20 }}>
        {sectionLabel('service account')}
        <div style={{
          border: '1.5px solid var(--ink)',
          boxShadow: '3px 3px 0 var(--shadow)',
          background: 'var(--paper-2)',
          padding: '10px 12px',
          marginBottom: 10,
        }}>
          <div className="kv-row" style={{ marginBottom: 4 }}>
            <span className="kv-key">account</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
              {settingsLoading ? '…' : driveSettings?.client_email ?? '—'}
            </span>
          </div>
          <div className="kv-row" style={{ marginBottom: 4 }}>
            <span className="kv-key">project</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
              {settingsLoading ? '…' : driveSettings?.project_id ?? '—'}
            </span>
          </div>
          {driveSettings && (
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-soft)', fontFamily: "'JetBrains Mono', monospace" }}>
              source: {driveSettings.source}
            </div>
          )}
        </div>

        <div style={{
          border: '1.5px solid var(--ink)',
          boxShadow: '3px 3px 0 var(--shadow)',
          background: '#fff',
        }}>
          <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 12, color: 'var(--ink-soft)', fontFamily: "'JetBrains Mono', monospace" }}>
              paste service account JSON key
            </label>
            <textarea
              value={keyJson}
              onChange={(e) => setKeyJson(e.target.value)}
              placeholder={'{\n  "type": "service_account",\n  "project_id": "...",\n  ...\n}'}
              rows={6}
              style={{
                border: '1.5px solid var(--ink)',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                padding: '6px 8px',
                background: '#fff',
                resize: 'vertical',
                width: '100%',
                boxSizing: 'border-box',
              }}
            />

            {keySaveError && (
              <div style={{ fontSize: 12, color: 'var(--accent)', fontFamily: "'JetBrains Mono', monospace" }}>
                {keySaveError}
              </div>
            )}
            {keySaveMsg && (
              <div style={{ fontSize: 12, color: 'var(--green)', fontFamily: "'JetBrains Mono', monospace" }}>
                {keySaveMsg}
              </div>
            )}

            <div>
              <button
                className="btn-sketch sm primary"
                onClick={() => saveKey.mutate()}
                disabled={saveKey.isPending || !keyJson.trim()}
              >
                {saveKey.isPending ? 'Saving…' : 'Save key'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Upload folder */}
      <div style={{ marginBottom: 16 }}>
        {sectionLabel('upload folder')}
        <div className="kv-row" style={{ marginBottom: 8 }}>
          <span className="kv-key">folder</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
            {folderLoading ? '…' : activeFolder?.folder_name ?? '—'}
            {activeFolder?.is_default && (
              <span style={{ marginLeft: 6, color: 'var(--ink-soft)', fontSize: 10 }}>(default)</span>
            )}
          </span>
        </div>

        {folderSaveMsg && (
          <div style={{ fontSize: 12, color: 'var(--green)', marginBottom: 8 }}>{folderSaveMsg}</div>
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
            onSelect={(id, _name) => setFolder.mutate({ folderId: id })}
            onCancel={() => setBrowsing(false)}
          />
        )}
      </div>
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

// ── Library tab ───────────────────────────────────────────────────────────────

function LibraryTab() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [trashDrive, setTrashDrive] = useState(false);
  const [result, setResult] = useState<{ reset_count: number; drive_trashed: number; drive_errors: number } | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['assets', 'stats'],
    queryFn: async () => {
      const { data } = await apiClient.get<{ active_count: number }>('/assets/stats');
      return data;
    },
  });

  const reset = useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post<{
        reset_count: number;
        drive_trashed: number;
        drive_errors: number;
      }>('/assets/reset-library', { trash_drive_files: trashDrive });
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      setConfirming(false);
      setResult(data);
      setResetError(null);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message ?? 'Reset failed';
      setResetError(msg);
    },
  });

  const sectionLabel = (text: string) => (
    <div style={{
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11,
      color: 'var(--ink-soft)',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      marginBottom: 8,
    }}>
      {text}
    </div>
  );

  const activeCount = stats?.active_count ?? 0;

  return (
    <div style={{ fontSize: 13 }}>

      {/* Stats */}
      <div style={{ marginBottom: 20 }}>
        {sectionLabel('library')}
        <div style={{
          border: '1.5px solid var(--ink)',
          boxShadow: '3px 3px 0 var(--shadow)',
          background: 'var(--paper-2)',
          padding: '10px 12px',
        }}>
          <div className="kv-row">
            <span className="kv-key">active assets</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
              {statsLoading ? '…' : activeCount}
            </span>
          </div>
        </div>
      </div>

      {/* Danger zone */}
      <div>
        {sectionLabel('danger zone')}
        <div style={{
          border: '1.5px solid var(--accent)',
          boxShadow: '3px 3px 0 var(--shadow)',
          background: 'var(--paper-2)',
          padding: '12px',
        }}>
          <div style={{
            fontSize: 12,
            fontFamily: "'JetBrains Mono', monospace",
            color: 'var(--ink)',
            marginBottom: 12,
            lineHeight: 1.6,
          }}>
            Soft-delete all assets and remove all product–asset links.
            Assets remain in the database with <span style={{ color: 'var(--accent)' }}>status=deleted</span>.
          </div>

          {result && !confirming && (
            <div style={{
              marginBottom: 12,
              fontSize: 12,
              color: 'var(--green)',
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              Reset complete — {result.reset_count} assets deleted
              {result.drive_trashed > 0 && `, ${result.drive_trashed} Drive files trashed`}
              {result.drive_errors > 0 && ` (${result.drive_errors} Drive errors)`}.
            </div>
          )}

          {!confirming ? (
            <button
              className="btn-sketch sm"
              style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
              onClick={() => { setResult(null); setResetError(null); setConfirming(true); }}
              disabled={activeCount === 0 && !statsLoading}
            >
              Reset library…
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{
                fontSize: 12,
                color: 'var(--accent)',
                fontFamily: "'JetBrains Mono', monospace",
                fontWeight: 600,
              }}>
                This will soft-delete {activeCount} asset{activeCount !== 1 ? 's' : ''} and clear all product links.
              </div>

              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                fontFamily: "'JetBrains Mono', monospace",
                cursor: 'pointer',
                userSelect: 'none',
              }}>
                <input
                  type="checkbox"
                  checked={trashDrive}
                  onChange={(e) => setTrashDrive(e.target.checked)}
                />
                Also trash files in Google Drive
              </label>

              {resetError && (
                <div style={{ fontSize: 12, color: 'var(--accent)', fontFamily: "'JetBrains Mono', monospace" }}>
                  {resetError}
                </div>
              )}

              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="btn-sketch sm"
                  style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
                  onClick={() => reset.mutate()}
                  disabled={reset.isPending}
                >
                  {reset.isPending ? 'Resetting…' : 'Confirm reset'}
                </button>
                <button
                  className="btn-sketch sm ghost"
                  onClick={() => { setConfirming(false); setResetError(null); }}
                  disabled={reset.isPending}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

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
    { id: 'library', label: 'Library' },
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
        {activeTab === 'shopify' && (
          <>
            <ShopifyTab />
            <ShopifySyncPanel />
          </>
        )}
        {activeTab === 'tags' && <TagsTab />}
        {activeTab === 'jobs' && <JobDashboard />}
        {activeTab === 'health' && <HealthTab />}
        {activeTab === 'library' && <LibraryTab />}
      </div>
    </div>
  );
}
