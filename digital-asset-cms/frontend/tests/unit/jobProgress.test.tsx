/**
 * 13.T5 — Job progress display
 *
 * Renders the job dashboard. Simulates a WebSocket `job_progress` event.
 * Asserts the progress bar updates in real time.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JobDashboard } from '../../src/components/JobDashboard';
import { setAccessToken } from '../../src/stores/authStore';
import { Job } from '../../src/types';

// ── Mock WebSocket ─────────────────────────────────────────────────────────────
interface MockWS {
  onmessage: ((e: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

let wsInstances: MockWS[] = [];

class MockWebSocket {
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(_url: string) {
    wsInstances.push(this);
  }

  close() {}
  send(_data: string) {}
}

// ── MSW server for /api/jobs ────────────────────────────────────────────────
const initialJobs: Job[] = [
  {
    id: 'job-sync-1',
    name: 'shopify-sync',
    status: 'active',
    progress: 10,
    created_at: '2026-01-01T00:00:00Z',
  },
];

const server = setupServer(
  http.get('http://localhost/api/jobs', () => HttpResponse.json(initialJobs)),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => {
  server.resetHandlers();
  wsInstances = [];
  setAccessToken(null);
  vi.unstubAllGlobals();
});
afterAll(() => server.close());

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('JobDashboard', () => {
  it('updates progress bar in real time from a WebSocket job_progress event', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    setAccessToken('test-token');

    render(<JobDashboard />, { wrapper });

    // Wait for jobs to load from the API
    await waitFor(() =>
      expect(screen.getByRole('listitem')).toBeInTheDocument(),
    );

    // Initial progress should be 10
    const bar = screen.getByTestId('job-progress-job-sync-1') as HTMLProgressElement;
    expect(bar.value).toBe(10);

    // Simulate a WS job_progress message pushing progress to 75
    expect(wsInstances).toHaveLength(1);
    wsInstances[0].onmessage?.({
      data: JSON.stringify({
        type: 'job_progress',
        payload: {
          jobId: 'job-sync-1',
          jobName: 'shopify-sync',
          progress: 75,
          status: 'active',
        },
      }),
    });

    // Progress bar should reflect the new value
    await waitFor(() => {
      const updatedBar = screen.getByTestId(
        'job-progress-job-sync-1',
      ) as HTMLProgressElement;
      expect(updatedBar.value).toBe(75);
    });
  });

  it('shows "No jobs running" when the list is empty', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    setAccessToken('test-token');

    server.use(
      http.get('http://localhost/api/jobs', () => HttpResponse.json([])),
    );

    render(<JobDashboard />, { wrapper });

    await waitFor(() =>
      expect(screen.getByText('No jobs running.')).toBeInTheDocument(),
    );
  });
});
