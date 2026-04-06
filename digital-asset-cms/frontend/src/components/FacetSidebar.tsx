import { ActiveFilters, Facets } from '../types';

interface FacetSidebarProps {
  facets: Facets;
  activeFilters: ActiveFilters;
  onFilterChange: (filters: ActiveFilters) => void;
}

export function FacetSidebar({ facets, activeFilters, onFilterChange }: FacetSidebarProps) {
  const handleTypeClick = (value: string) => {
    if (activeFilters.type === value) {
      const { type: _type, ...rest } = activeFilters;
      onFilterChange(rest);
    } else {
      onFilterChange({ ...activeFilters, type: value });
    }
  };

  const handleTagClick = (key: string, value: string) => {
    const currentTags = activeFilters.tags ?? {};
    if (currentTags[key] === value) {
      const { [key]: _removed, ...restTags } = currentTags;
      onFilterChange({ ...activeFilters, tags: restTags });
    } else {
      onFilterChange({ ...activeFilters, tags: { ...currentTags, [key]: value } });
    }
  };

  return (
    <aside className="w-64 flex-shrink-0 space-y-4">
      {facets.asset_type && facets.asset_type.length > 0 && (
        <div>
          <h3 className="font-semibold text-sm text-gray-700 uppercase mb-2">Type</h3>
          <ul className="space-y-1">
            {facets.asset_type.map(({ value, count }) => (
              <li key={value}>
                <button
                  onClick={() => handleTypeClick(value)}
                  className={`flex items-center justify-between w-full px-2 py-1 rounded text-sm ${
                    activeFilters.type === value
                      ? 'bg-blue-100 text-blue-800 font-medium'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                  aria-pressed={activeFilters.type === value}
                >
                  <span>{value}</span>
                  <span className="ml-2 text-gray-500">{count}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {facets.tags && Object.keys(facets.tags).length > 0 && (
        <div>
          <h3 className="font-semibold text-sm text-gray-700 uppercase mb-2">Tags</h3>
          {Object.entries(facets.tags).map(([key, values]) => (
            <div key={key} className="mb-3">
              <h4 className="text-xs font-medium text-gray-600 mb-1 capitalize">{key}</h4>
              <ul className="space-y-1">
                {values.map(({ value, count }) => (
                  <li key={value}>
                    <button
                      onClick={() => handleTagClick(key, value)}
                      className={`flex items-center justify-between w-full px-2 py-1 rounded text-sm ${
                        activeFilters.tags?.[key] === value
                          ? 'bg-blue-100 text-blue-800 font-medium'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                      aria-pressed={activeFilters.tags?.[key] === value}
                    >
                      <span>{value}</span>
                      <span className="ml-2 text-gray-500">{count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
