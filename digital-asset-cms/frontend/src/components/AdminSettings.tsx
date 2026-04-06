import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { User, UserRole } from '../types';
import { apiClient } from '../api/client';
import { JobDashboard } from './JobDashboard';
import { ShopifySyncPanel } from './ShopifySyncPanel';

type Tab = 'users' | 'drive' | 'shopify' | 'tags' | 'jobs' | 'health';

interface TagKey {
  key: string;
  suggested_values: string[];
}

interface DriveStatus {
  connected: boolean;
  quota_used: number;
  quota_limit: number;
  folder_id: string | null;
}

interface HealthStatus {
  db: 'ok' | 'error';
  redis: 'ok' | 'error';
  drive: 'ok' | 'error';
  shopify: 'ok' | 'error';
}

// ── Users tab ────────────────────────────────────────────────────────────────

function UsersTab() {
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('editor');

  const { data: users } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: async () => {
      const { data } = await apiClient.get<User[]>('/admin/users');
      return data;
    },
  });

  const inviteMutation = useMutation({
    mutationFn: async () =>
      apiClient.post('/admin/users/invite', { email: inviteEmail, role: inviteRole }),
    onSuccess: () => {
      setInviteEmail('');
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async (userId: string) =>
      apiClient.patch(`/admin/users/${userId}`, { status: 'deactivated' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          type="email"
          placeholder="Email address"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          className="border rounded px-2 py-1 text-sm flex-1"
          aria-label="Invite email"
        />
        <select
          value={inviteRole}
          onChange={(e) => setInviteRole(e.target.value as UserRole)}
          className="border rounded px-2 py-1 text-sm"
          aria-label="Invite role"
        >
          <option value="viewer">Viewer</option>
          <option value="editor">Editor</option>
          <option value="admin">Admin</option>
        </select>
        <button
          onClick={() => inviteMutation.mutate()}
          disabled={!inviteEmail || inviteMutation.isPending}
          className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          Invite
        </button>
      </div>

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="pb-2 pr-4">Email</th>
            <th className="pb-2 pr-4">Role</th>
            <th className="pb-2 pr-4">Status</th>
            <th className="pb-2" />
          </tr>
        </thead>
        <tbody>
          {(users ?? []).map((user) => (
            <tr key={user.id} className="border-b">
              <td className="py-1.5 pr-4">{user.email}</td>
              <td className="py-1.5 pr-4 capitalize">{user.role}</td>
              <td className="py-1.5 pr-4">
                <span
                  className={
                    user.status === 'active'
                      ? 'text-green-600'
                      : 'text-gray-400'
                  }
                >
                  {user.status}
                </span>
              </td>
              <td className="py-1.5">
                {user.status === 'active' && (
                  <button
                    onClick={() => deactivateMutation.mutate(user.id)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Deactivate
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Drive tab ─────────────────────────────────────────────────────────────────

function DriveTab() {
  const { data } = useQuery({
    queryKey: ['admin', 'drive'],
    queryFn: async () => {
      const { data } = await apiClient.get<DriveStatus>('/admin/drive/status');
      return data;
    },
  });

  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;

  const quotaPct = data.quota_limit
    ? Math.round((data.quota_used / data.quota_limit) * 100)
    : 0;

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-gray-500">Status:</span>
        <span className={data.connected ? 'text-green-600' : 'text-red-500'}>
          {data.connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>
      <div>
        <div className="flex justify-between text-gray-500 mb-1">
          <span>API quota used</span>
          <span>{quotaPct}%</span>
        </div>
        <progress value={quotaPct} max={100} aria-label="Drive quota" className="w-full h-1.5" />
      </div>
      <div>
        <span className="text-gray-500">Watched folder: </span>
        <span className="font-mono text-xs">{data.folder_id ?? 'Not configured'}</span>
      </div>
    </div>
  );
}

// ── Tags tab ──────────────────────────────────────────────────────────────────

function TagsTab() {
  const queryClient = useQueryClient();
  const [newKey, setNewKey] = useState('');

  const { data: tagKeys } = useQuery({
    queryKey: ['admin', 'tag-keys'],
    queryFn: async () => {
      const { data } = await apiClient.get<TagKey[]>('/admin/tag-keys');
      return data;
    },
  });

  const addKeyMutation = useMutation({
    mutationFn: async () =>
      apiClient.post('/admin/tag-keys', { key: newKey }),
    onSuccess: () => {
      setNewKey('');
      queryClient.invalidateQueries({ queryKey: ['admin', 'tag-keys'] });
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="New tag key"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          className="border rounded px-2 py-1 text-sm flex-1"
          aria-label="New tag key"
        />
        <button
          onClick={() => addKeyMutation.mutate()}
          disabled={!newKey || addKeyMutation.isPending}
          className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          Add
        </button>
      </div>
      <ul className="space-y-1">
        {(tagKeys ?? []).map((tk) => (
          <li key={tk.key} className="text-sm flex items-center gap-2">
            <span className="font-medium">{tk.key}</span>
            {tk.suggested_values.length > 0 && (
              <span className="text-gray-400 text-xs">
                ({tk.suggested_values.join(', ')})
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Health tab ────────────────────────────────────────────────────────────────

function HealthTab() {
  const { data } = useQuery({
    queryKey: ['admin', 'health'],
    queryFn: async () => {
      const { data } = await apiClient.get<HealthStatus>('/health');
      return data;
    },
    refetchInterval: 30_000,
  });

  const services = ['db', 'redis', 'drive', 'shopify'] as const;

  return (
    <div className="space-y-2 text-sm">
      {services.map((svc) => (
        <div key={svc} className="flex items-center gap-3">
          <span className="w-16 capitalize text-gray-500">{svc}</span>
          {data ? (
            <span
              className={
                data[svc] === 'ok' ? 'text-green-600' : 'text-red-500'
              }
            >
              {data[svc] === 'ok' ? '● OK' : '● Error'}
            </span>
          ) : (
            <span className="text-gray-300">—</span>
          )}
        </div>
      ))}
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
