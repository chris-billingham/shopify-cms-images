import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { WebSocketMessage, JobProgressPayload } from '../types';
import { apiClient } from '../api/client';
import { useWebSocket } from '../hooks/useWebSocket';

interface SyncStatus {
  last_sync_at: string | null;
  recent_jobs: Array<{ id: string; type: string; status: string; created_at: string }>;
}

export function ShopifySyncPanel() {
  const queryClient = useQueryClient();
  const [syncProgress, setSyncProgress] = useState<number | null>(null);
  const [syncJobId, setSyncJobId] = useState<string | null>(null);

  const { data: status } = useQuery({
    queryKey: ['shopify', 'status'],
    queryFn: async () => {
      const { data } = await apiClient.get<SyncStatus>('/shopify/status');
      return data;
    },
    refetchInterval: 30_000,
  });

  useWebSocket((msg: WebSocketMessage) => {
    if (msg.type === 'job_progress') {
      const payload = msg.payload as JobProgressPayload;
      if (payload.jobName.includes('sync') || payload.jobName.includes('import')) {
        setSyncJobId(payload.jobId);
        setSyncProgress(payload.progress);
        if (payload.status === 'completed' || payload.status === 'failed') {
          setTimeout(() => {
            setSyncProgress(null);
            setSyncJobId(null);
            queryClient.invalidateQueries({ queryKey: ['shopify', 'status'] });
          }, 2000);
        }
      }
    }
  });

  const syncMutation = useMutation({
    mutationFn: async () => apiClient.post('/shopify/sync-products', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shopify', 'status'] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Shopify Sync</h3>
        <button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending || syncProgress !== null}
          className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {syncMutation.isPending ? 'Starting…' : 'Sync Now'}
        </button>
      </div>

      <div className="text-sm space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-gray-500">Last synced:</span>
          <span>
            {status?.last_sync_at
              ? new Date(status.last_sync_at).toLocaleString()
              : 'Never'}
          </span>
        </div>
        {status?.recent_jobs && status.recent_jobs.length > 0 && (
          <div>
            <span className="text-gray-500">Last job:</span>{' '}
            <span className={
              status.recent_jobs[0].status === 'completed' ? 'text-green-600' :
              status.recent_jobs[0].status === 'failed' ? 'text-red-500' : 'text-blue-600'
            }>
              {status.recent_jobs[0].status}
            </span>
          </div>
        )}
      </div>

      {syncProgress !== null && (
        <div>
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>Sync in progress</span>
            <span>{syncProgress}%</span>
          </div>
          <progress
            value={syncProgress}
            max={100}
            aria-label="Sync progress"
            className="w-full h-1.5"
          />
        </div>
      )}
    </div>
  );
}
