import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MindFlowEngine } from '../../../core/engine.js';
import { DataExporter } from '../../../core/export.js';

const EntityIdParamsSchema = z.object({
  id: z.string().min(1),
});

export async function registerExportRoutes(
  app: FastifyInstance,
  engine: MindFlowEngine,
): Promise<void> {
  const exporter = new DataExporter(engine.db.db);

  // GET /api/export — returns full knowledge graph as JSON-LD
  app.get('/api/export', async (_req, reply) => {
    const doc = await exporter.exportJsonLd();
    return reply
      .header('Content-Type', 'application/ld+json')
      .send(doc);
  });

  // DELETE /api/entities/:id — right-to-delete
  app.delete<{ Params: { id: string } }>('/api/entities/:id', async (req, reply) => {
    const params = EntityIdParamsSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid entity id' });
    }

    const existing = engine.entities.findById(params.data.id);
    if (!existing) {
      return reply.status(404).send({ error: 'Entity not found' });
    }

    try {
      exporter.deleteEntity(params.data.id);
      return reply.status(204).send();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });
}
