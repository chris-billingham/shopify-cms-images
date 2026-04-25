import { create } from 'zustand';
import { ActiveFilters } from '../types';

interface LibraryFilterState {
  searchQuery: string;
  searchInput: string;
  filters: ActiveFilters;
  sort: string;
  setSearchQuery: (q: string) => void;
  setSearchInput: (q: string) => void;
  setFilters: (f: ActiveFilters) => void;
  setSort: (s: string) => void;
}

interface ProductFilterState {
  search: string;
  vendorFilter: string;
  categoryFilter: string;
  statusFilter: string;
  sort: string;
  setSearch: (s: string) => void;
  setVendorFilter: (v: string) => void;
  setCategoryFilter: (c: string) => void;
  setStatusFilter: (s: string) => void;
  setSort: (s: string) => void;
}

export const useLibraryFilterStore = create<LibraryFilterState>((set) => ({
  searchQuery: '',
  searchInput: '',
  filters: {},
  sort: 'newest',
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSearchInput: (q) => set({ searchInput: q }),
  setFilters: (f) => set({ filters: f }),
  setSort: (s) => set({ sort: s }),
}));

export const useProductFilterStore = create<ProductFilterState>((set) => ({
  search: '',
  vendorFilter: '',
  categoryFilter: '',
  statusFilter: 'active',
  sort: 'title-asc',
  setSearch: (s) => set({ search: s }),
  setVendorFilter: (v) => set({ vendorFilter: v }),
  setCategoryFilter: (c) => set({ categoryFilter: c }),
  setStatusFilter: (s) => set({ statusFilter: s }),
  setSort: (s) => set({ sort: s }),
}));
