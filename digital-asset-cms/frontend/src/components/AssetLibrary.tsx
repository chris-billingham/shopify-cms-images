import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { SearchInput } from './SearchInput';
import { FacetSidebar } from './FacetSidebar';
import { Asset, ActiveFilters, SearchResult } from '../types';
import { apiClient } from '../api/client';
import { usePermissions } from '../hooks/usePermissions';

interface AssetLibraryProps {
  onAssetClick?: (asset: Asset) => void;
}

async function fetchAssets(
  query: string,
  filters: ActiveFilters,
): Promise<SearchResult> {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (filters.type) params.set('type', filters.type);
  if (filters.status) params.set('status', filters.status);
  if (filters.tags) {
    Object.entries(filters.tags).forEach(([k, v]) => {
      params.set(`tags[${k}]`, v);
    });
  }
  const { data } = await apiClient.get<SearchResult>(`/assets/search?${params}`);
  return data;
}

export function AssetLibrary({ onAssetClick }: AssetLibraryProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<ActiveFilters>({});
  const { canUpload } = usePermissions();
  const navigate = useNavigate();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['assets', 'search', searchQuery, filters],
    queryFn: () => fetchAssets(searchQuery, filters),
  });

  return (
    <div className="flex h-full">
      <FacetSidebar
        facets={data?.facets ?? {}}
        activeFilters={filters}
        onFilterChange={setFilters}
      />

      <div className="flex-1 flex flex-col min-w-0 ml-6">
        <div className="flex items-center gap-3 mb-4">
          <SearchInput onSearch={setSearchQuery} />
          {canUpload && (
            <button
              onClick={() => navigate('/upload')}
              className="shrink-0 px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
            >
              Upload
            </button>
          )}
        </div>

        {isLoading && (
          <div className="text-gray-500 text-sm" role="status">
            Loading…
          </div>
        )}

        {isError && (
          <div className="text-red-500 text-sm" role="alert">
            Failed to load assets.
          </div>
        )}

        {data && (
          <div
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4"
            role="list"
            aria-label="Asset grid"
          >
            {data.assets.map((asset) => (
              <div
                key={asset.id}
                role="listitem"
                className="cursor-pointer rounded border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
                onClick={() => onAssetClick?.(asset)}
              >
                {asset.thumbnail_url ? (
                  <img
                    src={asset.thumbnail_url}
                    alt={asset.file_name}
                    className="w-full h-32 object-cover"
                  />
                ) : (
                  <div className="w-full h-32 bg-gray-100 flex items-center justify-center text-gray-400 text-xs">
                    {asset.asset_type}
                  </div>
                )}
                <div className="p-2">
                  <p className="text-xs font-medium truncate">{asset.file_name}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
