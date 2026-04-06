/**
 * 12.T1 — Token interceptor
 *
 * Tests that:
 * 1. A 401 response triggers token refresh, then retries the original request.
 * 2. Multiple simultaneous 401s trigger only one refresh call.
 * 3. A failed refresh redirects to /login.
 */
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient, __resetRefreshState } from '../../src/api/client';
import { useAuthStore } from '../../src/stores/authStore';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  __resetRefreshState();
  useAuthStore.setState({ accessToken: null });
});
afterAll(() => server.close());

describe('token refresh interceptor', () => {
  it('retries the original request after a successful refresh', async () => {
    useAuthStore.setState({ accessToken: 'old-token' });
    let assetCallCount = 0;

    server.use(
      http.get('http://localhost/api/assets', ({ request }) => {
        assetCallCount++;
        if (request.headers.get('Authorization') === 'Bearer old-token') {
          return new HttpResponse(null, { status: 401 });
        }
        return HttpResponse.json({ assets: [], total: 0, facets: {} });
      }),
      http.post('http://localhost/api/auth/refresh', () => {
        return HttpResponse.json({ accessToken: 'new-token' });
      }),
    );

    const response = await apiClient.get('/assets');
    expect(response.status).toBe(200);
    // Called twice: once with old token (401), once with new token (200)
    expect(assetCallCount).toBe(2);
    expect(useAuthStore.getState().accessToken).toBe('new-token');
  });

  it('makes only one refresh call when multiple requests fail with 401 simultaneously', async () => {
    useAuthStore.setState({ accessToken: 'old-token' });
    let refreshCallCount = 0;

    server.use(
      http.get('http://localhost/api/assets', ({ request }) => {
        if (request.headers.get('Authorization') === 'Bearer old-token') {
          return new HttpResponse(null, { status: 401 });
        }
        return HttpResponse.json({ assets: [], total: 0, facets: {} });
      }),
      http.get('http://localhost/api/products', ({ request }) => {
        if (request.headers.get('Authorization') === 'Bearer old-token') {
          return new HttpResponse(null, { status: 401 });
        }
        return HttpResponse.json({ products: [] });
      }),
      http.post('http://localhost/api/auth/refresh', () => {
        refreshCallCount++;
        return HttpResponse.json({ accessToken: 'new-token' });
      }),
    );

    const [r1, r2] = await Promise.all([
      apiClient.get('/assets'),
      apiClient.get('/products'),
    ]);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(refreshCallCount).toBe(1);
  });

  it('redirects to login when the refresh call fails', async () => {
    useAuthStore.setState({ accessToken: 'expired-token' });

    // Capture href assignments without breaking window.location structure
    let assignedHref = '';
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: {
        ...window.location,
        origin: window.location.origin,
        get href() { return assignedHref || window.location.origin + '/'; },
        set href(value: string) { assignedHref = value; },
      },
    });

    server.use(
      http.get('http://localhost/api/assets', () => {
        return new HttpResponse(null, { status: 401 });
      }),
      http.post('http://localhost/api/auth/refresh', () => {
        return new HttpResponse(null, { status: 401 });
      }),
    );

    await expect(apiClient.get('/assets')).rejects.toThrow();
    expect(assignedHref).toBe('/login');
    expect(useAuthStore.getState().accessToken).toBeNull();

    // Restore original window.location
    if (originalDescriptor) {
      Object.defineProperty(window, 'location', originalDescriptor);
    }
  });
});
