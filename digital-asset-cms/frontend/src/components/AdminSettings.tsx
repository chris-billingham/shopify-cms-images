import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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

function DriveTab() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const { data } = await apiClient.get<HealthStatus>('/health');
      return data;
    },
  });

  if (isLoading) return <p className="text-sm text-gray-400">Checking…</p>;
  if (isError) return <p className="text-sm text-red-500">Could not reach health endpoint.</p>;

  const drive = data?.dependencies.google_drive;
  const connected = drive?.status === 'healthy';

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-gray-500">Status:</span>
        <span className={connected ? 'text-green-600' : drive?.status === 'degraded' ? 'text-yellow-600' : 'text-red-500'}>
          {connected ? 'Connected' : drive?.status === 'degraded' ? 'Degraded' : 'Disconnected'}
        </span>
      </div>
      {drive?.message && (
        <div className="text-xs text-gray-400">{drive.message}</div>
      )}
      {drive?.quota_warning && (
        <div className="text-xs text-yellow-600">Warning: Drive quota &gt; 90%</div>
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
