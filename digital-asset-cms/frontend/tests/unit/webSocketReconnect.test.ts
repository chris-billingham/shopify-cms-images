/**
 * 13.T3 — WebSocket reconnection with exponential backoff
 *
 * Mocks a WebSocket that disconnects. Asserts the client reconnects with
 * exponential backoff: first retry after ~1 second, second after ~2 seconds.
 */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useWebSocket } from '../../src/hooks/useWebSocket';
import { setAccessToken } from '../../src/stores/authStore';

// Minimal WebSocket mock —————————————————————————————————————————————————————
interface MockWS {
  url: string;
  onopen: (() => void) | null;
  onmessage: ((e: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  close: () => void;
}

let mockInstances: MockWS[] = [];

class MockWebSocket implements MockWS {
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    mockInstances.push(this);
  }

  close() {
    this.onclose?.();
  }

  send(_data: string) {}
}

describe('useWebSocket exponential backoff reconnect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockInstances = [];
    setAccessToken('test-token');
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setAccessToken(null);
  });

  it('reconnects after 1 s on first disconnect, 2 s on second disconnect', () => {
    const { unmount } = renderHook(() => useWebSocket(vi.fn()));

    // Initial connection established synchronously
    expect(mockInstances).toHaveLength(1);

    // ── First disconnect ──────────────────────────────────────────────────
    mockInstances[0].close();
    // delay = 1000 * 2^0 = 1000 ms

    vi.advanceTimersByTime(999);
    expect(mockInstances).toHaveLength(1); // not yet

    vi.advanceTimersByTime(1);             // total 1000 ms
    expect(mockInstances).toHaveLength(2); // reconnected

    // ── Second disconnect ─────────────────────────────────────────────────
    mockInstances[1].close();
    // delay = 1000 * 2^1 = 2000 ms

    vi.advanceTimersByTime(1999);
    expect(mockInstances).toHaveLength(2); // not yet

    vi.advanceTimersByTime(1);             // total 2000 ms
    expect(mockInstances).toHaveLength(3); // reconnected

    unmount();
  });

  it('does not reconnect after unmount', () => {
    const { unmount } = renderHook(() => useWebSocket(vi.fn()));

    expect(mockInstances).toHaveLength(1);

    unmount();

    // Trigger close AFTER unmount — should not spawn a reconnect
    mockInstances[0].onclose?.();
    vi.advanceTimersByTime(5000);
    expect(mockInstances).toHaveLength(1);
  });
});
