import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MindFlowEngine } from '../../../core/engine.js';
import { EntityType } from '../../../types/index.js';

const LayerParamsSchema = z.object({
  entityId: z.string().min(1),
});

const LayerQuerySchema = z.object({
  maxRing: z.coerce.number().int().min(1).max(50).default(15),
});

const SubgraphParamsSchema = z.object({
  entityId: z.string().min(1),
});

const SubgraphQuerySchema = z.object({
  depth: z.coerce.number().int().min(1).max(5).default(1),
});

const PathParamsSchema = z.object({
  id1: z.string().min(1),
  id2: z.string().min(1),
});

const PathQuerySchema = z.object({
  maxDepth: z.coerce.number().int().min(1).max(10).default(5),
});

export async function registerGraphRoutes(
  app: FastifyInstance,
  engine: MindFlowEngine,
): Promise<void> {
  const graphOps = engine.graphOps;
  const { communityDetector } = engine;

  // GET /api/graph/root — L0 root structure with category counts
  app.get('/api/graph/root', async (_req, reply) => {
    const db = engine.db.db;

    const countByType = (type: EntityType): number => {
      // Topics: only count top-level (no parent) to reflect the visible L1 ring
      if (type === EntityType.Topic) {
        return (
          db
            .prepare(
              `SELECT COUNT(*) as n FROM entities
               WHERE type = ? AND parent_entity_id IS NULL AND status = 'active'`,
            )
            .get(type) as { n: number }
        ).n;
      }
      return (
        db
          .prepare(`SELECT COUNT(*) as n FROM entities WHERE type = ? AND status = 'active'`)
          .get(type) as { n: number }
      ).n;
    };

    const pendingCount = (
      db
        .prepare(
          `SELECT COUNT(*) as n FROM attention_items
           WHERE resolved_at IS NULL AND dismissed_at IS NULL`,
        )
        .get() as { n: number }
    ).n;

    const groupsCount = (
      db.prepare('SELECT COUNT(*) as n FROM communities').get() as { n: number }
    ).n;

    return reply.send({
      categories: [
        { id: 'people', label: 'People', type: EntityType.Person, count: countByType(EntityType.Person) },
        { id: 'topics', label: 'Topics', type: EntityType.Topic, count: countByType(EntityType.Topic) },
        { id: 'documents', label: 'Documents', type: EntityType.Document, count: countByType(EntityType.Document) },
        { id: 'pending', label: 'Pending', type: null, count: pendingCount },
        { id: 'groups', label: 'Groups', type: 'community', count: groupsCount },
      ],
    });
  });

  // GET /api/graph/groups — list all detected communities
  app.get('/api/graph/groups', async (_req, reply) => {
    const communities = communityDetector.getCommunities();
    return reply.send({ communities });
  });

  // GET /api/graph/groups/:id — community details with member entities
  app.get<{ Params: { id: string } }>('/api/graph/groups/:id', async (req, reply) => {
    const id = req.params.id;
    if (!id) return reply.status(400).send({ error: 'Invalid id' });

    const db = engine.db.db;
    const row = db
      .prepare('SELECT * FROM communities WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;

    if (!row) return reply.status(404).send({ error: 'Community not found' });

    let memberIds: string[] = [];
    try {
      memberIds = JSON.parse(row['member_entity_ids'] as string) as string[];
    } catch {
      // ignore
    }

    const members =
      memberIds.length === 0
        ? []
        : (() => {
            const placeholders = memberIds.map(() => '?').join(',');
            return (
              db
                .prepare(
                  `SELECT * FROM entities WHERE id IN (${placeholders}) AND status = 'active'`,
                )
                .all(...memberIds) as Array<Record<string, unknown>>
            ).map((r) => ({
              id: r['id'] as string,
              type: r['type'] as string,
              canonicalName: r['canonical_name'] as string,
            }));
          })();

    return reply.send({
      community: {
        id: row['id'],
        name: row['name'],
        description: row['description'],
        memberCount: memberIds.length,
        createdAt: row['created_at'],
        updatedAt: row['updated_at'],
      },
      members,
    });
  });

  // GET /api/graph/path/:id1/:id2?maxDepth=5
  app.get<{ Params: { id1: string; id2: string }; Querystring: { maxDepth?: string } }>(
    '/api/graph/path/:id1/:id2',
    async (req, reply) => {
      const params = PathParamsSchema.safeParse(req.params);
      if (!params.success) {
        return reply.status(400).send({ error: 'Invalid entity IDs' });
      }

      const query = PathQuerySchema.safeParse(req.query);
      if (!query.success) {
        return reply.status(400).send({ error: query.error.flatten() });
      }

      const { nodes, edges } = graphOps.getShortestPath(
        params.data.id1,
        params.data.id2,
        query.data.maxDepth,
      );

      if (nodes.length === 0) {
        return reply.status(404).send({ error: 'No path found between the given entities' });
      }

      return reply.send({ nodes, edges, pathLength: edges.length });
    },
  );

  // GET /api/graph/layer/:entityId?maxRing=15 — Focus Swap layer data
  app.get<{ Params: { entityId: string }; Querystring: { maxRing?: string } }>(
    '/api/graph/layer/:entityId',
    async (req, reply) => {
      const params = LayerParamsSchema.safeParse(req.params);
      if (!params.success) {
        return reply.status(400).send({ error: 'Invalid entityId' });
      }

      const query = LayerQuerySchema.safeParse(req.query);
      if (!query.success) {
        return reply.status(400).send({ error: query.error.flatten() });
      }

      const layer = graphOps.getLayerData(params.data.entityId, query.data.maxRing);
      return reply.send(layer);
    },
  );

  // GET /api/graph/:entityId?depth=1
  app.get<{ Params: { entityId: string }; Querystring: { depth?: string } }>(
    '/api/graph/:entityId',
    async (req, reply) => {
      const params = SubgraphParamsSchema.safeParse(req.params);
      if (!params.success) {
        return reply.status(400).send({ error: 'Invalid entityId' });
      }

      const query = SubgraphQuerySchema.safeParse(req.query);
      if (!query.success) {
        return reply.status(400).send({ error: query.error.flatten() });
      }

      const subgraph = graphOps.getSubgraph(params.data.entityId, query.data.depth);
      return reply.send(subgraph);
    },
  );
}
