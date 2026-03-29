import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MindFlowEngine } from '../../../core/engine.js';
import { ResolutionType } from '../../../types/index.js';

const AttentionIdParamsSchema = z.object({
  id: z.string().min(1),
});

const SnoozeBodySchema = z.object({
  until: z.number().int().positive(),
});

export async function registerAttentionRoutes(
  app: FastifyInstance,
  engine: MindFlowEngine,
): Promise<void> {
  // GET /api/attention?status=pending
  // Currently only pending items are surfaced (status param reserved for future)
  app.get('/api/attention', async (_req, reply) => {
    const items = engine.getAttentionItems();
    return reply.send({ items });
  });

  // POST /api/attention/:id/dismiss
  app.post<{ Params: { id: string } }>('/api/attention/:id/dismiss', async (req, reply) => {
    const params = AttentionIdParamsSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid id' });
    }

    engine.attentionItems.dismiss(params.data.id);
    return reply.status(204).send();
  });

  // POST /api/attention/:id/resolve
  app.post<{ Params: { id: string } }>('/api/attention/:id/resolve', async (req, reply) => {
    const params = AttentionIdParamsSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid id' });
    }

    engine.attentionItems.resolve(params.data.id, ResolutionType.Done);
    return reply.status(204).send();
  });

  // POST /api/attention/:id/snooze { until: timestamp }
  app.post<{ Params: { id: string } }>('/api/attention/:id/snooze', async (req, reply) => {
    const params = AttentionIdParamsSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid id' });
    }

    const body = SnoozeBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    engine.attentionItems.snooze(params.data.id, body.data.until);
    return reply.status(204).send();
  });
}
