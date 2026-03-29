import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Event types mirroring the backend WS protocol
// ---------------------------------------------------------------------------

export type WsEventType =
  | 'entity:created'
  | 'entity:updated'
  | 'entity:merged'
  | 'attention:detected'
  | 'attention:resolved'
  | 'ingest:started'
  | 'ingest:completed'
  | 'stats:updated';

export interface WsEvent {
  type: WsEventType;
  payload: unknown;
}

type EventCallback = (payload: unknown) => void;

// ---------------------------------------------------------------------------
// Backoff constants
// ---------------------------------------------------------------------------

const MIN_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

function nextDelay(current: number): number {
  return Math.min(current * 2, MAX_DELAY_MS);
}

// ---------------------------------------------------------------------------
// Query invalidation map
// Specifies which TanStack Query keys to invalidate for each event type.
// ---------------------------------------------------------------------------

function invalidationsFor(type: WsEventType): string[][] {
  switch (type) {
    case 'entity:created':
    case 'entity:updated':
    case 'entity:merged':
      return [['entities'], ['stats']];
    case 'attention:detected':
    case 'attention:resolved':
      return [['attention'], ['stats']];
    case 'ingest:started':
    case 'ingest:completed':
      return [['stats'], ['entities'], ['attention']];
    case 'stats:updated':
      return [['stats']];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// useWebSocket
// ---------------------------------------------------------------------------

/**
 * Connects to the backend WebSocket at `/api/ws`.
 * Auto-reconnects with exponential backoff (1s → 30s cap).
 * Invalidates TanStack Query caches on relevant events.
 *
 * Returns `onEvent(type, callback)` to subscribe to specific event types.
 * Call this at the top of the component tree (once per app).
 */
export function useWebSocket() {
  const queryClient = useQueryClient();

  // listeners: type → set of callbacks
  const listeners = useRef<Map<string, Set<EventCallback>>>(new Map());

  // stable ref to avoid stale closures in reconnect logic
  const delayRef = useRef(MIN_DELAY_MS);
  const wsRef = useRef<WebSocket | null>(null);
  const unmountedRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (unmountedRef.current) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/api/ws`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      // If WebSocket construction throws (e.g. in test env), schedule retry
      scheduleReconnect();
      return;
    }

    wsRef.current = ws;

    ws.onopen = () => {
      delayRef.current = MIN_DELAY_MS; // reset backoff on successful connect
    };

    ws.onmessage = (evt) => {
      let event: WsEvent;
      try {
        event = JSON.parse(evt.data as string) as WsEvent;
      } catch {
        return;
      }

      // Invalidate relevant queries
      for (const queryKey of invalidationsFor(event.type)) {
        void queryClient.invalidateQueries({ queryKey });
      }

      // Notify subscribers
      const callbacks = listeners.current.get(event.type);
      if (callbacks) {
        for (const cb of callbacks) {
          cb(event.payload);
        }
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose fires after onerror — reconnect handled there
      ws.close();
    };
  }, [queryClient]);

  function scheduleReconnect() {
    if (unmountedRef.current) return;
    const delay = delayRef.current;
    delayRef.current = nextDelay(delay);
    retryTimerRef.current = setTimeout(connect, delay);
  }

  useEffect(() => {
    unmountedRef.current = false;
    connect();

    return () => {
      unmountedRef.current = true;
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  /**
   * Subscribe to a specific WS event type.
   * Call this in a useEffect — the returned unsubscribe function cleans up.
   */
  const onEvent = useCallback((type: WsEventType, callback: EventCallback): (() => void) => {
    if (!listeners.current.has(type)) {
      listeners.current.set(type, new Set());
    }
    listeners.current.get(type)!.add(callback);

    return () => {
      listeners.current.get(type)?.delete(callback);
    };
  }, []);

  return { onEvent };
}
