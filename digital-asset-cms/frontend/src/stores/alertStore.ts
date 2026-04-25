import { create } from 'zustand';

interface AlertState {
  driveWatcherAlert: string | null;
  rateLimitAlert: string | null;
  setDriveWatcherAlert: (msg: string | null) => void;
  setRateLimitAlert: (msg: string | null) => void;
}

export const useAlertStore = create<AlertState>((set) => ({
  driveWatcherAlert: null,
  rateLimitAlert: null,
  setDriveWatcherAlert: (msg) => set({ driveWatcherAlert: msg }),
  setRateLimitAlert: (msg) => set({ rateLimitAlert: msg }),
}));
