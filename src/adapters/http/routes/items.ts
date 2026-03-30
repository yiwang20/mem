import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MindFlowEngine } from '../../../core/engine.js';

const ItemIdParamsSchema = z.object({
  id: z.string().min(1),
});

export async function registerItemRoutes(
  app: FastifyInstance,
  engine: MindFlowEngine,
): Promise<void> {
  // DELETE /api/items/:id — delete a raw item and its associated jobs
  app.delete<{ Params: { id: string } }>('/api/items/:id', async (req, reply) => {
    const params = ItemIdParamsSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid item id' });
    }

    const existing = engine.rawItems.findById(params.data.id);
    if (!existing) {
      return reply.status(404).send({ error: 'Item not found' });
    }

    try {
      engine.rawItems.deleteById(params.data.id);
      return reply.send({ success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });
}
