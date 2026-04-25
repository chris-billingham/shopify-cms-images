import axios, { InternalAxiosRequestConfig } from 'axios';
import { getAccessToken, setAccessToken, useAuthStore } from '../stores/authStore';
import { useAlertStore } from '../stores/alertStore';

export const apiClient = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

// Bare instance for refresh calls — same baseURL, no interceptors to avoid loops
const refreshAxios = axios.create({ baseURL: '/api', withCredentials: true });

// State for queuing concurrent 401s
let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

function notifySubscribers(token: string) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

function subscribeToRefresh(cb: (token: string) => void) {
  refreshSubscribers.push(cb);
}

// Exported for test reset
export function __resetRefreshState() {
  isRefreshing = false;
  refreshSubscribers = [];
}

function redirectToLogin() {
  setAccessToken(null);
  if (typeof window !== 'undefined') {
    window.location.href = '/login';
  }
}

// Attach bearer token from in-memory store
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken();
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

// Transparent token refresh on 401
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    if (error.response?.status === 429) {
      const data = error.response.data as { retryAfter?: string };
      const retryAfter = data.retryAfter ?? 'a moment';
      useAlertStore.getState().setRateLimitAlert(`Rate limit reached — try again in ${retryAfter}`);
      setTimeout(() => useAlertStore.getState().setRateLimitAlert(null), 5000);
      return Promise.reject(error);
    }

    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    // Another refresh is already in progress — queue this request
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        subscribeToRefresh((token: string) => {
          originalRequest._retry = true;
          originalRequest.headers['Authorization'] = `Bearer ${token}`;
          resolve(apiClient(originalRequest));
        });
      });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      const { data } = await refreshAxios.post('/auth/refresh', {});
      const newToken: string = data.accessToken;
      setAccessToken(newToken);
      try {
        const payload = JSON.parse(atob(newToken.split('.')[1]));
        useAuthStore.getState().setRole(payload.role);
      } catch { /* ignore */ }
      isRefreshing = false;
      notifySubscribers(newToken);
      originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
      return apiClient(originalRequest);
    } catch (refreshError) {
      isRefreshing = false;
      refreshSubscribers = [];
      redirectToLogin();
      return Promise.reject(refreshError);
    }
  },
);
