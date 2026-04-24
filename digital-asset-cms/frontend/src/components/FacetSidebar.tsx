import { ActiveFilters, Facets } from '../types';

interface FacetSidebarProps {
  facets: Facets;
  activeFilters: ActiveFilters;
  onFilterChange: (filters: ActiveFilters) => void;
}

const typeIcons: Record<string, string> = {
  image: '▣',
  video: '▶',
  text: '▤',
  document: '▦',
};

const PRODUCT_STATUS_ORDER = ['unlinked', 'linked-unpushed', 'active', 'draft', 'archived'];

const PRODUCT_STATUS_LABELS: Record<string, string> = {
  'unlinked': 'unlinked',
  'linked-unpushed': 'linked (unpushed)',
  'active': 'active',
  'draft': 'draft',
  'archived': 'archived',
};

export function FacetSidebar({ facets, activeFilters, onFilterChange }: FacetSidebarProps) {
  const handleTypeClick = (value: string) => {
    if (activeFilters.type === value) {
      const { type: _type, ...rest } = activeFilters;
      onFilterChange(rest);
    } else {
      onFilterChange({ ...activeFilters, type: value });
    }
  };

  const handleProductStatusClick = (value: string) => {
    if (activeFilters.product_status === value) {
      const { product_status: _ps, ...rest } = activeFilters;
      onFilterChange(rest);
    } else {
      onFilterChange({ ...activeFilters, product_status: value });
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

  const hasFilters =
    activeFilters.type ||
    activeFilters.product_status ||
    Object.keys(activeFilters.tags ?? {}).length > 0;

  return (
    <aside className="sketch-sidebar" style={{ minHeight: 640, width: 240, flexShrink: 0 }}>
      {/* Type facets */}
      {facets.asset_type && facets.asset_type.length > 0 && (
        <>
          <div className="side-h">Type</div>
          {facets.asset_type.map(({ value, count }) => (
            <button
              key={value}
              onClick={() => handleTypeClick(value)}
              className={`facet-item ${activeFilters.type === value ? 'active' : ''}`}
              aria-pressed={activeFilters.type === value}
            >
              <span>{typeIcons[value] ?? '▪'} {value}</span>
              <span className="facet-count">{count.toLocaleString()}</span>
            </button>
          ))}
        </>
      )}

      {/* Product status facets */}
      {facets.product_status && facets.product_status.length > 0 && (
        <>
          <div className="side-h">Product Status</div>
          {PRODUCT_STATUS_ORDER
            .map((ps) => facets.product_status!.find((f) => f.value === ps))
            .filter((f): f is { value: string; count: number } => f !== undefined)
            .map(({ value, count }) => (
              <button
                key={value}
                onClick={() => handleProductStatusClick(value)}
                className={`facet-item ${activeFilters.product_status === value ? 'active' : ''}`}
                aria-pressed={activeFilters.product_status === value}
              >
                <span>{PRODUCT_STATUS_LABELS[value] ?? value}</span>
                <span className="facet-count">{count.toLocaleString()}</span>
              </button>
            ))
          }
        </>
      )}

      {/* Tag facets */}
      {facets.tags && Object.keys(facets.tags).length > 0 && (
        <>
          <div className="side-h">Tags</div>
          {Object.entries(facets.tags).map(([key, values]) => (
            <div key={key}>
              <div className="sub-h">{key}</div>
              {values.map(({ value, count }) => (
                <button
                  key={value}
                  onClick={() => handleTagClick(key, value)}
                  className={`facet-item ${activeFilters.tags?.[key] === value ? 'active' : ''}`}
                  aria-pressed={activeFilters.tags?.[key] === value}
                >
                  <span>{value}</span>
                  <span className="facet-count">{count.toLocaleString()}</span>
                </button>
              ))}
            </div>
          ))}
        </>
      )}

      {hasFilters && (
        <div style={{ marginTop: 24 }}>
          <button
            className="btn-sketch sm ghost"
            onClick={() => onFilterChange({})}
          >
            ＋ clear all filters
          </button>
        </div>
      )}
    </aside>
  );
}
