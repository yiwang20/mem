import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MindFlowEngine } from '../../../core/engine.js';
import { GraphOperations } from '../../../graph/operations.js';
import { EntityType } from '../../../types/index.js';

const PatchEntityBodySchema = z.object({
  canonicalName: z.string().min(1).optional(),
  nameAlt: z.string().nullable().optional(),
  attributes: z.record(z.unknown()).optional(),
});

const MergeParamsSchema = z.object({
  id: z.string().min(1),
  otherId: z.string().min(1),
});

const ListEntitiesQuerySchema = z.object({
  type: z.nativeEnum(EntityType).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  sort: z.enum(['recent', 'frequent']).default('recent'),
  search: z.string().min(1).max(500).optional(),
});

const EntityIdParamsSchema = z.object({
  id: z.string().min(1),
});

const TimelineQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  after: z.coerce.number().optional(),
  before: z.coerce.number().optional(),
  channel: z.enum(['email', 'imessage', 'file']).optional(),
  q: z.string().min(1).optional(),
});

const CrossRefParamsSchema = z.object({
  id1: z.string().min(1),
  id2: z.string().min(1),
});

export async function registerEntityRoutes(
  app: FastifyInstance,
  engine: MindFlowEngine,
): Promise<void> {
  const graphOps = new GraphOperations(engine.db.db);

  // GET /api/entities?type=person&limit=20&sort=recent&search=alice
  app.get('/api/entities', async (req, reply) => {
    const parsed = ListEntitiesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { type, limit, sort, search } = parsed.data;

    // When search is present, use FTS5 on the entities table
    if (search) {
      const entities = engine.entities.search(search, limit);
      return reply.send({ entities });
    }

    const entities = type
      ? graphOps.getTopEntities(type, limit, sort === 'frequent' ? 'frequency' : 'recency')
      : (() => {
          // No type filter — fetch top across all types
          const allTypes = Object.values(EntityType);
          const perType = Math.ceil(limit / allTypes.length);
          return allTypes
            .flatMap((t) =>
              graphOps.getTopEntities(t, perType, sort === 'frequent' ? 'frequency' : 'recency'),
            )
            .slice(0, limit);
        })();

    return reply.send({ entities });
  });

  // GET /api/entities/:id
  app.get<{ Params: { id: string } }>('/api/entities/:id', async (req, reply) => {
    const params = EntityIdParamsSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid id' });
    }

    const entity = engine.getEntity(params.data.id);
    if (!entity) {
      return reply.status(404).send({ error: 'Entity not found' });
    }

    const stats = graphOps.getEntityStats(params.data.id);
    return reply.send({ entity, stats });
  });

  // GET /api/entities/:id/timeline?limit=50
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    '/api/entities/:id/timeline',
    async (req, reply) => {
      const params = EntityIdParamsSchema.safeParse(req.params);
      if (!params.success) {
        return reply.status(400).send({ error: 'Invalid id' });
      }

      const query = TimelineQuerySchema.safeParse(req.query);
      if (!query.success) {
        return reply.status(400).send({ error: query.error.flatten() });
      }

      const entity = engine.getEntity(params.data.id);
      if (!entity) {
        return reply.status(404).send({ error: 'Entity not found' });
      }

      const page = graphOps.getTimeline(params.data.id, {
        limit: query.data.limit,
        offset: query.data.offset,
        after: query.data.after,
        before: query.data.before,
        channel: query.data.channel,
        q: query.data.q,
      });

      return reply.send(page);
    },
  );

  // GET /api/entities/:id1/crossref/:id2
  app.get<{ Params: { id1: string; id2: string } }>(
    '/api/entities/:id1/crossref/:id2',
    async (req, reply) => {
      const params = CrossRefParamsSchema.safeParse(req.params);
      if (!params.success) {
        return reply.status(400).send({ error: 'Invalid entity IDs' });
      }

      const entity1 = engine.getEntity(params.data.id1);
      const entity2 = engine.getEntity(params.data.id2);

      if (!entity1 || !entity2) {
        return reply.status(404).send({ error: 'One or both entities not found' });
      }

      const items = graphOps.getCrossReference(params.data.id1, params.data.id2);
      return reply.send({ items, entity1, entity2 });
    },
  );

  // PATCH /api/entities/:id — update name or attributes
  app.patch<{ Params: { id: string } }>('/api/entities/:id', async (req, reply) => {
    const params = EntityIdParamsSchema.safeParse(req.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid id' });

    const body = PatchEntityBodySchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const entity = engine.getEntity(params.data.id);
    if (!entity) return reply.status(404).send({ error: 'Entity not found' });

    const { canonicalName, nameAlt, attributes } = body.data;

    try {
      if (canonicalName !== undefined || nameAlt !== undefined) {
        engine.correctionManager.rename(params.data.id, { canonicalName, nameAlt });
      }
      if (attributes !== undefined) {
        engine.correctionManager.updateAttributes(params.data.id, { attributes });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: msg });
    }

    const updated = engine.getEntity(params.data.id);
    return reply.send({ entity: updated });
  });

  // POST /api/entities/:id/merge/:otherId — merge otherId into :id
  app.post<{ Params: { id: string; otherId: string } }>(
    '/api/entities/:id/merge/:otherId',
    async (req, reply) => {
      const params = MergeParamsSchema.safeParse(req.params);
      if (!params.success) return reply.status(400).send({ error: 'Invalid entity IDs' });

      if (params.data.id === params.data.otherId) {
        return reply.status(400).send({ error: 'Cannot merge entity with itself' });
      }

      try {
        const auditId = engine.correctionManager.merge(params.data.id, params.data.otherId);
        const surviving = engine.getEntity(params.data.id);
        return reply.status(200).send({ entity: surviving, auditId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(400).send({ error: msg });
      }
    },
  );

  // POST /api/entities/:id/split — undo the most recent merge for :id
  app.post<{ Params: { id: string } }>('/api/entities/:id/split', async (req, reply) => {
    const params = EntityIdParamsSchema.safeParse(req.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid id' });

    try {
      engine.correctionManager.split(params.data.id);
      const restored = engine.entities.findById(params.data.id);
      return reply.status(200).send({ entity: restored });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: msg });
    }
  });
}
