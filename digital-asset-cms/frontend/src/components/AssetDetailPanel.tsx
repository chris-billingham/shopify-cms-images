import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Asset } from '../types';
import { apiClient } from '../api/client';
import { usePermissions } from '../hooks/usePermissions';

interface AssetDetailPanelProps {
  asset: Asset;
  onClose: () => void;
}

interface TagUpdatePayload {
  tags: Record<string, string>;
  updated_at: string;
}

export function AssetDetailPanel({ asset, onClose }: AssetDetailPanelProps) {
  const [conflictError, setConflictError] = useState(false);
  const queryClient = useQueryClient();
  const { canEditTags, canDelete } = usePermissions();

  const patchAsset = useMutation({
    mutationFn: async (payload: TagUpdatePayload) => {
      const { data } = await apiClient.patch(`/assets/${asset.id}`, payload);
      return data;
    },
    // Optimistic update: apply tags immediately to the cache
    onMutate: async (payload: TagUpdatePayload) => {
      await queryClient.cancelQueries({ queryKey: ['asset', asset.id] });
      const previous = queryClient.getQueryData<Asset>(['asset', asset.id]);

      queryClient.setQueryData<Asset>(['asset', asset.id], (old) =>
        old ? { ...old, tags: payload.tags } : old,
      );

      return { previous };
    },
    onError: (error: unknown, _variables, context) => {
      // Revert on error
      if (context?.previous) {
        queryClient.setQueryData(['asset', asset.id], context.previous);
      }
      // Show conflict notification on 409
      const axiosError = error as { response?: { status: number } };
      if (axiosError?.response?.status === 409) {
        setConflictError(true);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['asset', asset.id] });
    },
  });

  const handleTagRemove = (key: string) => {
    const { [key]: _removed, ...newTags } = asset.tags;
    patchAsset.mutate({ tags: newTags, updated_at: asset.updated_at });
  };

  const handleRefresh = () => {
    setConflictError(false);
    queryClient.invalidateQueries({ queryKey: ['asset', asset.id] });
  };

  return (
    <div
      role="dialog"
      aria-label="Asset detail"
      className="fixed inset-y-0 right-0 w-96 bg-white shadow-xl flex flex-col z-50"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h2 className="font-semibold truncate">{asset.file_name}</h2>
        <button onClick={onClose} aria-label="Close panel" className="text-gray-500 hover:text-gray-700">
          ✕
        </button>
      </div>

      {conflictError && (
        <div
          role="alert"
          className="mx-4 mt-3 p-3 bg-yellow-50 border border-yellow-300 rounded text-sm text-yellow-800"
        >
          <p>This asset has been modified by another user. Please refresh and try again.</p>
          <button
            onClick={handleRefresh}
            className="mt-2 text-blue-600 underline text-xs"
          >
            Refresh
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Preview */}
        <div className="rounded border border-gray-200 overflow-hidden bg-gray-50 flex items-center justify-center min-h-48">
          {asset.asset_type === 'image' && asset.thumbnail_url ? (
            <img src={asset.thumbnail_url} alt={asset.file_name} className="max-w-full max-h-64 object-contain" />
          ) : (
            <span className="text-gray-400 text-sm">{asset.asset_type} preview</span>
          )}
        </div>

        {/* Metadata */}
        <div className="text-sm space-y-1 text-gray-600">
          <p><span className="font-medium">Type:</span> {asset.asset_type}</p>
          <p><span className="font-medium">Size:</span> {(asset.file_size / 1024).toFixed(1)} KB</p>
          <p><span className="font-medium">Version:</span> {asset.version}</p>
          <p><span className="font-medium">Uploaded:</span> {new Date(asset.created_at).toLocaleDateString()}</p>
        </div>

        {/* Tags */}
        <div>
          <h3 className="font-medium text-sm mb-2">Tags</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(asset.tags).map(([key, value]) => (
              <span
                key={key}
                className="inline-flex items-center px-2 py-1 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700"
              >
                <span className="font-medium">{key}:</span>&nbsp;{value}
                <button
                  onClick={() => handleTagRemove(key)}
                  aria-label={`Remove tag ${key}`}
                  disabled={!canEditTags}
                  className="ml-1 text-blue-400 hover:text-blue-600 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 py-3 border-t flex gap-2 flex-wrap">
        <button className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">
          Download
        </button>
        {canEditTags && (
          <button className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded text-sm hover:bg-gray-200">
            Replace
          </button>
        )}
        {canDelete && (
          <button className="px-3 py-1.5 bg-red-50 text-red-600 rounded text-sm hover:bg-red-100">
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
