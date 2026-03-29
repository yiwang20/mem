import type { FastifyInstance } from 'fastify';
import type { MindFlowEngine } from '../../../core/engine.js';

export async function registerStatsRoutes(
  app: FastifyInstance,
  engine: MindFlowEngine,
): Promise<void> {
  // GET /api/stats
  app.get('/api/stats', async (_req, reply) => {
    const stats = engine.getStats();
    return reply.send(stats);
  });
}
