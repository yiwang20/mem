import type { FastifyInstance } from 'fastify';
import type { MindFlowEngine } from '../../../core/engine.js';

export async function registerIngestRoutes(
  app: FastifyInstance,
  engine: MindFlowEngine,
): Promise<void> {
  /**
   * POST /api/ingest
   *
   * Triggers one ingestion cycle in the background and returns immediately.
   * The response reports the raw_item count before and after so the caller
   * can infer how many items were ingested, without blocking on the full run.
   */
  app.post('/api/ingest', async (_req, reply) => {
    const statsBefore = engine.getStats();

    // Fire-and-forget: do not await so the HTTP response returns immediately.
    // Errors are logged but not propagated to the caller — the UI polls /api/stats
    // to observe progress.
    engine.ingest().catch((err: unknown) => {
      console.error('[POST /api/ingest] ingestion error:', err);
    });

    return reply.status(202).send({
      success: true,
      message: 'Ingestion started',
      itemsProcessedBefore: statsBefore.rawItemCount,
    });
  });
}
