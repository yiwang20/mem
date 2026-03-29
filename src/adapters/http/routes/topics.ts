import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MindFlowEngine } from '../../../core/engine.js';
import type { AnswerContext } from '../../../types/index.js';

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
      // Only include real ancestor entities — no virtual "Topics" root node.
      // The last row is the topic itself; exclude it from the path (it's the current node).
      const path = ancestorRows
        .filter((r) => r.id !== topicId)
        .map((r) => ({ id: r.id, label: r.canonical_name, type: 'topic' }));

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

  // GET /api/topics/:id/overview — AI-generated overview of a topic
  app.get<{ Params: { id: string } }>(
    '/api/topics/:id/overview',
    async (req, reply) => {
      const params = TopicIdParamsSchema.safeParse(req.params);
      if (!params.success) {
        return reply.status(400).send({ error: 'Invalid topic id' });
      }

      const topicId = params.data.id;

      // 1. Verify topic exists (not merged)
      type TopicRow = { id: string; canonical_name: string; status: string };
      const topic = db
        .prepare(`SELECT id, canonical_name, status FROM entities WHERE id = ? AND type = 'topic' AND status != 'merged'`)
        .get(topicId) as TopicRow | undefined;

      if (!topic) {
        return reply.status(404).send({ error: 'Topic not found' });
      }

      // 2. Archived topics: no overview
      if (topic.status === 'archived') {
        return reply.status(204).send();
      }

      // 3. Get actual episode count
      const episodeCountRow = db
        .prepare(`SELECT COUNT(*) AS cnt FROM entity_episodes WHERE entity_id = ?`)
        .get(topicId) as { cnt: number };
      const episodeCount = episodeCountRow.cnt;

      if (episodeCount === 0) {
        return reply.status(204).send();
      }

      // 4. Cache check: if cached episode_count matches, return cached content
      type CacheRow = { content: string; generated_at: number; episode_count: number };
      const cached = db
        .prepare(`SELECT content, generated_at, episode_count FROM topic_overview_cache WHERE topic_id = ?`)
        .get(topicId) as CacheRow | undefined;

      const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
      const cacheExpired = cached && (Date.now() - cached.generated_at > CACHE_TTL_MS);
      if (cached && cached.episode_count === episodeCount && !cacheExpired) {
        return reply.send({
          overview: {
            content: cached.content,
            generatedAt: cached.generated_at,
            topicStatus: topic.status,
          },
        });
      }

      // 5. Check LLM availability (only when cache miss — avoid unnecessary API ping)
      const llmAvailable = await engine['llmProvider'].isAvailable().catch(() => false);
      if (!llmAvailable) {
        return reply.status(204).send();
      }

      // 6. Generate overview via LLM
      const content = await generateOverview(db, engine['llmProvider'], topicId, topic.canonical_name, episodeCount);

      // LLM failed or returned empty — don't cache empty content
      if (!content) {
        return reply.status(204).send();
      }

      // 7. Upsert cache
      const generatedAt = Date.now();
      db.prepare(
        `INSERT INTO topic_overview_cache (topic_id, content, generated_at, episode_count)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(topic_id) DO UPDATE SET
           content = excluded.content,
           generated_at = excluded.generated_at,
           episode_count = excluded.episode_count`,
      ).run(topicId, content, generatedAt, episodeCount);

      return reply.send({
        overview: {
          content,
          generatedAt,
          topicStatus: topic.status,
        },
      });
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
 * Build and execute an LLM-based overview for a topic using progressive summarization.
 * - ≤20 episodes: all raw items
 * - 21–100: most recent 15 + earliest 5
 * - >100: most recent 10 + key_facts from relationships
 */
async function generateOverview(
  db: import('better-sqlite3').Database,
  llmProvider: import('../../../types/index.js').LLMProvider,
  topicId: string,
  topicName: string,
  episodeCount: number,
): Promise<string | null> {
  type RawItemRow = { id: string; subject: string | null; body: string; event_time: number };
  type KeyFactRow = { canonical_name: string };
  type PersonRow = { canonical_name: string };

  let episodes: RawItemRow[];

  if (episodeCount <= 20) {
    episodes = db
      .prepare(
        `SELECT r.id, r.subject, r.body, r.event_time
         FROM raw_items r
         JOIN entity_episodes ee ON ee.raw_item_id = r.id
         WHERE ee.entity_id = ?
         ORDER BY r.event_time DESC`,
      )
      .all(topicId) as RawItemRow[];
  } else if (episodeCount <= 100) {
    const recent = db
      .prepare(
        `SELECT r.id, r.subject, r.body, r.event_time
         FROM raw_items r
         JOIN entity_episodes ee ON ee.raw_item_id = r.id
         WHERE ee.entity_id = ?
         ORDER BY r.event_time DESC
         LIMIT 15`,
      )
      .all(topicId) as RawItemRow[];

    const earliest = db
      .prepare(
        `SELECT r.id, r.subject, r.body, r.event_time
         FROM raw_items r
         JOIN entity_episodes ee ON ee.raw_item_id = r.id
         WHERE ee.entity_id = ?
         ORDER BY r.event_time ASC
         LIMIT 5`,
      )
      .all(topicId) as RawItemRow[];

    // Deduplicate by id (recent and earliest may overlap for small sets)
    const seen = new Set<string>();
    episodes = [];
    for (const row of [...recent, ...earliest]) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        episodes.push(row);
      }
    }
  } else {
    episodes = db
      .prepare(
        `SELECT r.id, r.subject, r.body, r.event_time
         FROM raw_items r
         JOIN entity_episodes ee ON ee.raw_item_id = r.id
         WHERE ee.entity_id = ?
         ORDER BY r.event_time DESC
         LIMIT 10`,
      )
      .all(topicId) as RawItemRow[];
  }

  // Key facts linked to this topic via relationships
  const keyFacts = db
    .prepare(
      `SELECT e.canonical_name
       FROM relationships rel
       JOIN entities e ON e.id = rel.to_entity_id
       WHERE rel.from_entity_id = ? AND e.type = 'key_fact' AND e.status != 'merged'
       UNION
       SELECT e.canonical_name
       FROM relationships rel
       JOIN entities e ON e.id = rel.from_entity_id
       WHERE rel.to_entity_id = ? AND e.type = 'key_fact' AND e.status != 'merged'
       LIMIT 20`,
    )
    .all(topicId, topicId) as KeyFactRow[];

  // Related people via relationships
  const relatedPeople = db
    .prepare(
      `SELECT e.canonical_name
       FROM relationships rel
       JOIN entities e ON e.id = rel.to_entity_id
       WHERE rel.from_entity_id = ? AND e.type = 'person' AND e.status != 'merged'
       UNION
       SELECT e.canonical_name
       FROM relationships rel
       JOIN entities e ON e.id = rel.from_entity_id
       WHERE rel.to_entity_id = ? AND e.type = 'person' AND e.status != 'merged'
       LIMIT 10`,
    )
    .all(topicId, topicId) as PersonRow[];

  // Build prompt sections
  const sections: string[] = [];

  sections.push(
    `Topic: "${topicName}" (${episodeCount} messages total)\n\n` +
    'Summarize this topic in 2–4 sentences based on the information below. ' +
    'Be concise and focus on the most important aspects. ' +
    'When citing a specific piece of information from a message, link it using the format [key info](source:RAW_ITEM_ID) ' +
    'where RAW_ITEM_ID is the id of the source message. ' +
    'Do not use JSON output — respond with plain markdown text only.',
  );

  if (episodes.length > 0) {
    const episodeSummaries = episodes.map((e) => {
      const subj = e.subject ?? '(no subject)';
      const preview = e.body.replace(/<[^>]*>/g, '').slice(0, 200);
      return `[${e.id}] ${subj}: ${preview}`;
    });
    sections.push('Messages:\n' + episodeSummaries.join('\n'));
  }

  if (keyFacts.length > 0) {
    sections.push('Key facts:\n' + keyFacts.map((f) => `  - ${f.canonical_name}`).join('\n'));
  }

  if (relatedPeople.length > 0) {
    sections.push('Related people:\n' + relatedPeople.map((p) => `  - ${p.canonical_name}`).join('\n'));
  }

  const prompt = sections.join('\n\n');

  // Use answer() with empty context — the prompt already contains all context inline
  const emptyContext: AnswerContext = {
    relevantItems: [],
    relevantEntities: [],
    relevantRelationships: [],
  };

  const result = await llmProvider.answer(prompt, emptyContext).catch(() => null);
  return result?.answer || null;
}

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
