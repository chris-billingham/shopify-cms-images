import { useEffect, useRef, useCallback } from 'react';
import { getAccessToken } from '../stores/authStore';
import { WebSocketMessage } from '../types';

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
const MAX_RETRIES = 10;

/**
 * Connects to the backend WebSocket endpoint and calls `onMessage` for each
 * received event. Reconnects with exponential backoff on disconnect.
 * The retry count is NOT reset on successful connection, so delays grow
 * monotonically: 1 s, 2 s, 4 s, 8 s … up to MAX_DELAY_MS.
 */
export function useWebSocket(
  onMessage: (msg: WebSocketMessage) => void,
  enabled = true,
) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const retryCountRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const connect = useCallback(() => {
    if (!enabledRef.current) return;
    const token = getAccessToken();
    if (!token) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/api/ws?token=${encodeURIComponent(token)}`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      return;
    }
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as WebSocketMessage;
        onMessageRef.current(msg);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      if (!enabledRef.current) return;
      if (retryCountRef.current >= MAX_RETRIES) return;
      const delay = Math.min(
        BASE_DELAY_MS * Math.pow(2, retryCountRef.current),
        MAX_DELAY_MS,
      );
      retryCountRef.current++;
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => ws.close();
  }, []); // stable reference — uses refs for all mutable state

  useEffect(() => {
    if (enabled) connect();
    return () => {
      enabledRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect loop on cleanup close
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, enabled]);

  return wsRef;
}
