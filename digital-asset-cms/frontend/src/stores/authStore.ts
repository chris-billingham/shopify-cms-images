import { create } from 'zustand';
import { UserRole } from '../types';

interface AuthState {
  accessToken: string | null;
  role: UserRole | null;
  setAccessToken: (token: string | null) => void;
  setRole: (role: UserRole | null) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  role: null,
  setAccessToken: (token) => set({ accessToken: token }),
  setRole: (role) => set({ role }),
  clearAuth: () => set({ accessToken: null, role: null }),
}));

// Module-level accessors for use outside React (interceptors, etc.)
export const getAccessToken = (): string | null =>
  useAuthStore.getState().accessToken;

export const setAccessToken = (token: string | null): void =>
  useAuthStore.getState().setAccessToken(token);
