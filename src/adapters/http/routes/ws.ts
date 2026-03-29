import type { FastifyInstance } from 'fastify';
import type { MindFlowEngine } from '../../../core/engine.js';
import type { MindFlowEventName, MindFlowEvents } from '../../../types/index.js';

// Events forwarded to WebSocket clients
const FORWARDED_EVENTS: MindFlowEventName[] = [
  'entity:created',
  'entity:updated',
  'entity:merged',
  'relationship:created',
  'attention:created',
  'attention:resolved',
  'items:ingested',
  'item:processed',
  'sync:started',
  'sync:completed',
  'sync:error',
  'pipeline:progress',
];

export async function registerWsRoutes(
  app: FastifyInstance,
  engine: MindFlowEngine,
): Promise<void> {
  // GET /api/ws — upgrade to WebSocket, receive real-time engine events
  app.get('/api/ws', { websocket: true }, (socket) => {
    // Build typed handlers so we can remove them on disconnect
    const handlers = new Map<
      MindFlowEventName,
      (data: MindFlowEvents[MindFlowEventName]) => void
    >();

    for (const eventName of FORWARDED_EVENTS) {
      const handler = (data: MindFlowEvents[typeof eventName]): void => {
        if (socket.readyState !== socket.OPEN) return;
        try {
          socket.send(JSON.stringify({ event: eventName, data }));
        } catch {
          // Client may have disconnected between the readyState check and send
        }
      };

      // EventBus is typed per event; cast here to satisfy the generic constraint
      engine.eventBus.on(
        eventName,
        handler as (data: MindFlowEvents[typeof eventName]) => void,
      );
      handlers.set(eventName, handler as (data: MindFlowEvents[MindFlowEventName]) => void);
    }

    socket.on('close', () => {
      for (const [eventName, handler] of handlers) {
        engine.eventBus.off(
          eventName,
          handler as (data: MindFlowEvents[typeof eventName]) => void,
        );
      }
      handlers.clear();
    });
  });
}
