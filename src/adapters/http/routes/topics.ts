import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MindFlowEngine } from '../../../core/engine.js';

// ----------------------------------------------------------------------------
// Response types
// ----------------------------------------------------------------------------

interface TopicTreeNode {
  id: string;
  label: string;
  labelAlt: string | null;
  messageCount: number;
  status: string;
  children: TopicTreeNode[];
}

// ----------------------------------------------------------------------------
// Validation schemas
// ----------------------------------------------------------------------------

const ReparentBodySchema = z.object({
  newParentId: z.string().min(1).nullable(),
});

const TopicIdParamsSchema = z.object({
  id: z.string().min(1),
});

// ----------------------------------------------------------------------------
// Route registration
// ----------------------------------------------------------------------------

export async function registerTopicsRoutes(
  app: FastifyInstance,
  engine: MindFlowEngine,
): Promise<void> {
  const db = engine.db.db;

  // GET /api/topics/tree — full topic hierarchy as nested tree
  app.get('/api/topics/tree', async (_req, reply) => {
    type TopicRow = {
      id: string;
      canonical_name: string;
      name_alt: string | null;
      parent_entity_id: string | null;
      status: string;
      depth: number;
    };

    const rows = db
      .prepare(
        `WITH RECURSIVE topic_tree AS (
           SELECT id, canonical_name, name_alt, parent_entity_id, status, 0 AS depth
           FROM entities
           WHERE type = 'topic' AND parent_entity_id IS NULL AND status != 'merged'
           UNION ALL
           SELECT e.id, e.canonical_name, e.name_alt, e.parent_entity_id, e.status, tt.depth + 1
           FROM entities e
           JOIN topic_tree tt ON e.parent_entity_id = tt.id
           WHERE e.type = 'topic' AND e.status != 'merged' AND tt.depth < 4
         )
         SELECT tt.*, COALESCE(ep.cnt, 0) AS message_count
         FROM topic_tree tt
         LEFT JOIN (
           SELECT entity_id, COUNT(*) AS cnt FROM entity_episodes GROUP BY entity_id
         ) ep ON ep.entity_id = tt.id
         ORDER BY tt.depth, tt.canonical_name`,
      )
      .all() as Array<TopicRow & { message_count: number }>;

    // Build tree structure from flat rows ordered by depth
    const nodeMap = new Map<string, TopicTreeNode>();
    const roots: TopicTreeNode[] = [];

    for (const row of rows) {
      const node: TopicTreeNode = {
        id: row.id,
        label: row.canonical_name,
        labelAlt: row.name_alt,
        messageCount: row.message_count,
        status: row.status,
        children: [],
      };
      nodeMap.set(row.id, node);

      if (row.parent_entity_id === null) {
        roots.push(node);
      } else {
        const parent = nodeMap.get(row.parent_entity_id);
        if (parent) {
          parent.children.push(node);
        } else {
          // Parent not yet built (shouldn't happen with depth-ordered query, but be safe)
          roots.push(node);
        }
      }
    }

    return reply.send({ roots });
  });

  // GET /api/topics/:id/ancestors — ancestor path + direct children of a topic
  app.get<{ Params: { id: string } }>(
    '/api/topics/:id/ancestors',
    async (req, reply) => {
      const params = TopicIdParamsSchema.safeParse(req.params);
      if (!params.success) {
        return reply.status(400).send({ error: 'Invalid topic id' });
      }

      const topicId = params.data.id;

      // Verify topic exists
      const topic = db
        .prepare(`SELECT id FROM entities WHERE id = ? AND type = 'topic' AND status != 'merged'`)
        .get(topicId) as { id: string } | undefined;

      if (!topic) {
        return reply.status(404).send({ error: 'Topic not found' });
      }

      // Build ancestor path from root down to this topic using a recursive CTE
      // that walks up via parent_entity_id, then reverses the result.
      type AncestorRow = { id: string; canonical_name: string; depth: number };
      const ancestorRows = db
        .prepare(
          `WITH RECURSIVE ancestors AS (
             SELECT id, canonical_name, parent_entity_id, 0 AS depth
             FROM entities WHERE id = ?
             UNION ALL
             SELECT e.id, e.canonical_name, e.parent_entity_id, a.depth + 1
             FROM entities e
             JOIN ancestors a ON e.id = a.parent_entity_id
             WHERE e.type = 'topic' AND e.status != 'merged'
           )
           SELECT id, canonical_name, depth FROM ancestors
           ORDER BY depth DESC`,
        )
        .all(topicId) as AncestorRow[];

      // The CTE returns [root, ..., parent, self] ordered by depth DESC
      // (highest depth = root, depth 0 = the topic itself).
      // Prepend a virtual "Topics" root node before the chain.
      const path = [
        { id: 'root', label: 'Topics', type: 'topic' },
        ...ancestorRows.map((r) => ({ id: r.id, label: r.canonical_name, type: 'topic' })),
      ];

      // Direct children of this topic
      type ChildRow = { id: string; canonical_name: string; status: string; msg_count: number };
      const childRows = db
        .prepare(
          `SELECT e.id, e.canonical_name, e.status,
                  COALESCE(ep.cnt, 0) AS msg_count
           FROM entities e
           LEFT JOIN (
             SELECT entity_id, COUNT(*) AS cnt FROM entity_episodes GROUP BY entity_id
           ) ep ON ep.entity_id = e.id
           WHERE e.parent_entity_id = ? AND e.type = 'topic' AND e.status != 'merged'
           ORDER BY e.canonical_name`,
        )
        .all(topicId) as ChildRow[];

      const children = childRows.map((r) => ({
        id: r.id,
        label: r.canonical_name,
        status: r.status,
        messageCount: r.msg_count,
      }));

      return reply.send({ path, children });
    },
  );

  // POST /api/topics/:id/reparent — move a topic to a new parent
  app.post<{ Params: { id: string } }>(
    '/api/topics/:id/reparent',
    async (req, reply) => {
      const params = TopicIdParamsSchema.safeParse(req.params);
      if (!params.success) {
        return reply.status(400).send({ error: 'Invalid topic id' });
      }

      const body = ReparentBodySchema.safeParse(req.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.flatten() });
      }

      const topicId = params.data.id;
      const newParentId = body.data.newParentId;

      // Verify the topic being moved exists and is a topic
      const topic = db
        .prepare(`SELECT id, type FROM entities WHERE id = ? AND status != 'merged'`)
        .get(topicId) as { id: string; type: string } | undefined;

      if (!topic) {
        return reply.status(404).send({ error: 'Topic not found' });
      }
      if (topic.type !== 'topic') {
        return reply.status(400).send({ error: 'Entity is not a topic' });
      }

      // If newParentId is provided, validate it
      if (newParentId !== null) {
        const parent = db
          .prepare(`SELECT id, type FROM entities WHERE id = ? AND status != 'merged'`)
          .get(newParentId) as { id: string; type: string } | undefined;

        if (!parent) {
          return reply.status(404).send({ error: 'New parent topic not found' });
        }
        if (parent.type !== 'topic') {
          return reply.status(400).send({ error: 'New parent is not a topic' });
        }

        // Cycle check: newParentId must not be a descendant of topicId
        const descendantIds = getDescendantIds(db, topicId);
        if (descendantIds.has(newParentId)) {
          return reply.status(400).send({ error: 'Cannot reparent: would create a cycle' });
        }

        // Depth check: new depth must be <= 4
        const newParentDepth = getDepth(db, newParentId);
        if (newParentDepth >= 4) {
          return reply
            .status(400)
            .send({ error: 'Cannot reparent: would exceed maximum hierarchy depth of 4' });
        }
      }

      db.prepare(
        `UPDATE entities SET parent_entity_id = ?, updated_at = ? WHERE id = ?`,
      ).run(newParentId, Date.now(), topicId);

      return reply.send({ success: true, topicId, newParentId });
    },
  );
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Return the set of all descendant IDs (children, grandchildren, …) of a topic.
 * Used for cycle detection.
 */
function getDescendantIds(db: import('better-sqlite3').Database, topicId: string): Set<string> {
  type Row = { id: string };
  const rows = db
    .prepare(
      `WITH RECURSIVE descendants AS (
         SELECT id FROM entities WHERE parent_entity_id = ? AND type = 'topic'
         UNION ALL
         SELECT e.id FROM entities e
         JOIN descendants d ON e.parent_entity_id = d.id
         WHERE e.type = 'topic'
       )
       SELECT id FROM descendants`,
    )
    .all(topicId) as Row[];
  return new Set(rows.map((r) => r.id));
}

/**
 * Return the depth of a topic in the hierarchy (root = 0).
 */
function getDepth(db: import('better-sqlite3').Database, topicId: string): number {
  type Row = { depth: number };
  const row = db
    .prepare(
      `WITH RECURSIVE ancestors AS (
         SELECT id, parent_entity_id, 0 AS depth
         FROM entities WHERE id = ?
         UNION ALL
         SELECT e.id, e.parent_entity_id, a.depth + 1
         FROM entities e
         JOIN ancestors a ON e.id = a.parent_entity_id
         WHERE e.type = 'topic'
       )
       SELECT MAX(depth) AS depth FROM ancestors`,
    )
    .get(topicId) as Row | undefined;
  return row?.depth ?? 0;
}
