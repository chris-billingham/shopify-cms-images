import { create } from 'zustand';

interface AuthState {
  accessToken: string | null;
  setAccessToken: (token: string | null) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  setAccessToken: (token) => set({ accessToken: token }),
  clearAuth: () => set({ accessToken: null }),
}));

// Module-level accessors for use outside React (interceptors, etc.)
export const getAccessToken = (): string | null =>
  useAuthStore.getState().accessToken;

export const setAccessToken = (token: string | null): void =>
  useAuthStore.getState().setAccessToken(token);
