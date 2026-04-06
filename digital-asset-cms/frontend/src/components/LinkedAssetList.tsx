import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LinkedAsset } from '../types';
import { apiClient } from '../api/client';

interface LinkedAssetListProps {
  productId: string;
  assets: LinkedAsset[];
}

function reorder<T>(list: T[], from: number, to: number): T[] {
  const result = [...list];
  const [moved] = result.splice(from, 1);
  result.splice(to, 0, moved);
  return result;
}

export function LinkedAssetList({ productId, assets }: LinkedAssetListProps) {
  const queryClient = useQueryClient();
  const dragFromRef = useRef<number | null>(null);
  const [localAssets, setLocalAssets] = useState<LinkedAsset[]>(assets);

  const reorderMutation = useMutation({
    mutationFn: async (newOrder: LinkedAsset[]) => {
      await apiClient.patch(`/products/${productId}/assets/reorder`, {
        assetIds: newOrder.map((a) => a.asset_id),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products', productId, 'assets'] });
    },
  });

  const handleReorder = (newOrder: LinkedAsset[]) => {
    setLocalAssets(newOrder);
    reorderMutation.mutate(newOrder);
  };

  return (
    <ul aria-label="Linked assets" className="space-y-1">
      {localAssets.map((asset, index) => (
        <li
          key={asset.id}
          role="listitem"
          draggable
          onDragStart={() => {
            dragFromRef.current = index;
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragFromRef.current === null || dragFromRef.current === index) return;
            const newOrder = reorder(localAssets, dragFromRef.current, index);
            dragFromRef.current = null;
            handleReorder(newOrder);
          }}
          className="flex items-center gap-2 px-2 py-1 bg-white border border-gray-200 rounded cursor-grab text-sm"
        >
          <span className="text-gray-400">⠿</span>
          <span className="truncate">{asset.file_name}</span>
        </li>
      ))}
    </ul>
  );
}
