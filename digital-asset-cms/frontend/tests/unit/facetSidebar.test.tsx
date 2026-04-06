/**
 * 12.T3 — Faceted filter rendering
 *
 * Renders FacetSidebar with mock facet data.
 * Asserts each facet group is displayed with correct counts.
 * Clicking a facet calls onFilterChange with the correct filter.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FacetSidebar } from '../../src/components/FacetSidebar';
import { Facets, ActiveFilters } from '../../src/types';

const facets: Facets = {
  asset_type: [
    { value: 'image', count: 42 },
    { value: 'video', count: 8 },
    { value: 'document', count: 3 },
  ],
  tags: {
    colour: [
      { value: 'red', count: 5 },
      { value: 'blue', count: 12 },
    ],
    season: [
      { value: 'AW26', count: 20 },
    ],
  },
};

describe('FacetSidebar', () => {
  it('renders all facet groups with correct values and counts', () => {
    render(
      <FacetSidebar facets={facets} activeFilters={{}} onFilterChange={vi.fn()} />,
    );

    // Asset type facets
    expect(screen.getByText('image')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('video')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('document')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();

    // Tag facets
    expect(screen.getByText('red')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('blue')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('AW26')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
  });

  it('calls onFilterChange with the selected type when a type facet is clicked', () => {
    const onFilterChange = vi.fn();
    render(
      <FacetSidebar facets={facets} activeFilters={{}} onFilterChange={onFilterChange} />,
    );

    fireEvent.click(screen.getByText('image'));
    expect(onFilterChange).toHaveBeenCalledWith({ type: 'image' });
  });

  it('calls onFilterChange with a tag filter when a tag facet is clicked', () => {
    const onFilterChange = vi.fn();
    render(
      <FacetSidebar facets={facets} activeFilters={{}} onFilterChange={onFilterChange} />,
    );

    fireEvent.click(screen.getByText('blue'));
    expect(onFilterChange).toHaveBeenCalledWith({ tags: { colour: 'blue' } });
  });

  it('de-selects a type facet when clicking the active one', () => {
    const onFilterChange = vi.fn();
    const activeFilters: ActiveFilters = { type: 'image' };
    render(
      <FacetSidebar facets={facets} activeFilters={activeFilters} onFilterChange={onFilterChange} />,
    );

    fireEvent.click(screen.getByText('image'));
    // Should be called with no type filter
    const called = onFilterChange.mock.calls[0][0] as ActiveFilters;
    expect(called.type).toBeUndefined();
  });

  it('shows the active filter as pressed', () => {
    render(
      <FacetSidebar
        facets={facets}
        activeFilters={{ type: 'video' }}
        onFilterChange={vi.fn()}
      />,
    );

    const videoBtn = screen.getByText('video').closest('button');
    expect(videoBtn).toHaveAttribute('aria-pressed', 'true');

    const imageBtn = screen.getByText('image').closest('button');
    expect(imageBtn).toHaveAttribute('aria-pressed', 'false');
  });
});
