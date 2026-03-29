import type Database from 'better-sqlite3';
import type {
  Entity,
  EntityType,
  GraphEdge,
  GraphNode,
  RawItem,
  Relationship,
  RelationshipType,
} from '../types/index.js';

// ----------------------------------------------------------------------------
// Layer types
// ----------------------------------------------------------------------------

export interface RingNode {
  id: string;
  type: string;
  label: string;
  badge: number;
  alsoIn: Array<{ id: string; label: string }>;
}

export interface LayerResponse {
  center: {
    id: string;
    type: string;
    label: string;
    labelAlt: string | null;
    attributes: Record<string, unknown>;
    stats: { messageCount: number; relationshipCount: number };
  };
  children: RingNode[];
  totalAvailable: number;
  hasChildren: boolean;
}

// ----------------------------------------------------------------------------
// Filter types
// ----------------------------------------------------------------------------

export interface TimelineFilters {
  /** Only include items after this timestamp (ms) */
  after?: number;
  /** Only include items before this timestamp (ms) */
  before?: number;
  /** Filter by source channel (email/imessage/file) */
  channel?: string;
  /** Keyword search within body/subject via FTS5 */
  q?: string;
  /** Number of items to skip (for pagination) */
  offset?: number;
  /** Maximum items to return (default 50) */
  limit?: number;
}

export interface TimelinePage {
  items: RawItem[];
  total: number;
  hasMore: boolean;
}

export interface EntityStats {
  entityId: string;
  messageCount: number;
  relationshipCount: number;
  firstSeenAt: number | null;
  lastSeenAt: number | null;
}

// ----------------------------------------------------------------------------
// Row mappers (minimal — only what we need locally)
// ----------------------------------------------------------------------------

function rowToEntity(row: Record<string, unknown>): Entity {
  return {
    id: row['id'] as string,
    type: row['type'] as EntityType,
    canonicalName: row['canonical_name'] as string,
    nameAlt: (row['name_alt'] as string | null) ?? null,
    aliases: parseJson<string[]>(row['aliases'] as string | null, []),
    attributes: parseJson<Record<string, unknown>>(row['attributes'] as string | null, {}),
    confidence: row['confidence'] as number,
    status: row['status'] as Entity['status'],
    mergedInto: (row['merged_into'] as string | null) ?? null,
    parentEntityId: (row['parent_entity_id'] as string | null) ?? null,
    firstSeenAt: row['first_seen_at'] as number,
    lastSeenAt: row['last_seen_at'] as number,
    createdAt: row['created_at'] as number,
    updatedAt: row['updated_at'] as number,
  };
}

function rowToRelationship(row: Record<string, unknown>): Relationship {
  return {
    id: row['id'] as string,
    fromEntityId: row['from_entity_id'] as string,
    toEntityId: row['to_entity_id'] as string,
    type: row['type'] as RelationshipType,
    strength: row['strength'] as number,
    eventTime: (row['event_time'] as number | null) ?? null,
    ingestionTime: row['ingestion_time'] as number,
    validFrom: (row['valid_from'] as number | null) ?? null,
    validUntil: (row['valid_until'] as number | null) ?? null,
    occurrenceCount: row['occurrence_count'] as number,
    sourceItemIds: parseJson<string[]>(row['source_item_ids'] as string | null, []),
    metadata: parseJson<Record<string, unknown>>(row['metadata'] as string | null, {}),
  };
}

function rowToRawItem(row: Record<string, unknown>): RawItem {
  return {
    id: row['id'] as string,
    sourceAdapter: row['source_adapter'] as RawItem['sourceAdapter'],
    channel: row['channel'] as RawItem['channel'],
    externalId: row['external_id'] as string,
    threadId: (row['thread_id'] as string | null) ?? null,
    senderEntityId: (row['sender_entity_id'] as string | null) ?? null,
    recipientEntityIds: parseJson<string[]>(row['recipient_entity_ids'] as string | null, []),
    subject: (row['subject'] as string | null) ?? null,
    body: row['body'] as string,
    bodyFormat: row['body_format'] as RawItem['bodyFormat'],
    contentHash: row['content_hash'] as string,
    language: (row['language'] as RawItem['language']) ?? null,
    eventTime: row['event_time'] as number,
    ingestedAt: row['ingested_at'] as number,
    processingStatus: row['processing_status'] as RawItem['processingStatus'],
    attachments: parseJson(row['attachments'] as string | null, []),
    metadata: parseJson(row['metadata'] as string | null, {}),
  };
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// ----------------------------------------------------------------------------
// GraphOperations
// ----------------------------------------------------------------------------

export class GraphOperations {
  constructor(private readonly db: Database.Database) {}

  /**
   * Return an N-hop subgraph around centerId using a recursive CTE.
   * Only traverses valid (non-expired) edges; only includes active entities.
   */
  getSubgraph(
    centerId: string,
    depth = 2,
    edgeLimit = 200,
  ): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const edgeRows = this.db
      .prepare(
        `WITH RECURSIVE traversal(from_id, to_id, rel_id, depth) AS (
           -- Seed: all edges directly from or to the center
           SELECT from_entity_id, to_entity_id, id, 1
           FROM relationships
           WHERE from_entity_id = ? AND valid_until IS NULL
           UNION ALL
           SELECT to_entity_id, from_entity_id, id, 1
           FROM relationships
           WHERE to_entity_id = ? AND valid_until IS NULL
           UNION ALL
           -- Recurse outward
           SELECT r.from_entity_id, r.to_entity_id, r.id, t.depth + 1
           FROM relationships r
           JOIN traversal t ON r.from_entity_id = t.to_id
           WHERE t.depth < ? AND r.valid_until IS NULL
         )
         SELECT DISTINCT r.*
         FROM traversal tr
         JOIN relationships r ON r.id = tr.rel_id
         LIMIT ?`,
      )
      .all(centerId, centerId, depth, edgeLimit) as Array<Record<string, unknown>>;

    const relationships = edgeRows.map(rowToRelationship);

    const entityIds = new Set<string>([centerId]);
    for (const r of relationships) {
      entityIds.add(r.fromEntityId);
      entityIds.add(r.toEntityId);
    }

    const placeholders = Array.from(entityIds).map(() => '?').join(', ');
    const entityRows = this.db
      .prepare(
        `SELECT * FROM entities WHERE id IN (${placeholders}) AND status = 'active'`,
      )
      .all(...Array.from(entityIds)) as Array<Record<string, unknown>>;

    const nodes: GraphNode[] = entityRows.map((row) => {
      const e = rowToEntity(row);
      return { id: e.id, type: e.type, label: e.canonicalName, attributes: e.attributes };
    });

    const edges: GraphEdge[] = relationships.map((r) => ({
      id: r.id,
      source: r.fromEntityId,
      target: r.toEntityId,
      type: r.type,
      strength: r.strength,
    }));

    return { nodes, edges };
  }

  /**
   * Get chronological raw items related to an entity (via entity_episodes),
   * with optional channel/time/keyword filtering and pagination.
   *
   * When `q` is provided the result set is first narrowed via a FTS5 match on
   * `raw_items_fts`, then the entity-episode join is applied on top.
   */
  getTimeline(entityId: string, filters: TimelineFilters = {}): TimelinePage {
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    // Sanitize FTS5 query: wrap in double-quotes to treat as phrase literal
    const ftsQuery = filters.q
      ? `"${filters.q.replace(/"/g, '""')}"`
      : null;

    // ---- Build the inner query that returns matching raw_item IDs -----------

    let innerSql: string;
    const innerParams: unknown[] = [];

    if (ftsQuery) {
      // FTS path: start from the FTS index, join back to entity_episodes
      innerSql = `
        SELECT ri.id, ri.event_time
        FROM raw_items_fts fts
        JOIN raw_items ri ON ri.rowid = fts.rowid
        JOIN entity_episodes ee ON ee.raw_item_id = ri.id
        WHERE raw_items_fts MATCH ?
          AND ee.entity_id = ?`;
      innerParams.push(ftsQuery, entityId);
    } else {
      innerSql = `
        SELECT ri.id, ri.event_time
        FROM raw_items ri
        JOIN entity_episodes ee ON ee.raw_item_id = ri.id
        WHERE ee.entity_id = ?`;
      innerParams.push(entityId);
    }

    if (filters.after !== undefined) {
      innerSql += ' AND ri.event_time > ?';
      innerParams.push(filters.after);
    }
    if (filters.before !== undefined) {
      innerSql += ' AND ri.event_time < ?';
      innerParams.push(filters.before);
    }
    if (filters.channel !== undefined) {
      innerSql += ' AND ri.channel = ?';
      innerParams.push(filters.channel);
    }

    // ---- Count total matching rows (for hasMore) ----------------------------

    let total: number;
    try {
      const countRow = this.db
        .prepare(`SELECT COUNT(*) as n FROM (${innerSql})`)
        .get(...innerParams) as { n: number };
      total = countRow.n;
    } catch {
      total = 0;
    }

    if (total === 0) return { items: [], total: 0, hasMore: false };

    // ---- Fetch the page -----------------------------------------------------

    const pageSql = `
      SELECT ri.*
      FROM raw_items ri
      WHERE ri.id IN (
        SELECT id FROM (${innerSql})
      )
      ORDER BY ri.event_time ASC
      LIMIT ? OFFSET ?`;

    let rows: Array<Record<string, unknown>>;
    try {
      rows = this.db
        .prepare(pageSql)
        .all(...innerParams, limit, offset) as Array<Record<string, unknown>>;
    } catch {
      rows = [];
    }

    return {
      items: rows.map(rowToRawItem),
      total,
      hasMore: offset + rows.length < total,
    };
  }

  /**
   * Get raw items where both entityId1 and entityId2 appear together.
   */
  getCrossReference(entityId1: string, entityId2: string, limit = 50): RawItem[] {
    const rows = this.db
      .prepare(
        `SELECT ri.*
         FROM raw_items ri
         JOIN entity_episodes ee1 ON ee1.raw_item_id = ri.id AND ee1.entity_id = ?
         JOIN entity_episodes ee2 ON ee2.raw_item_id = ri.id AND ee2.entity_id = ?
         ORDER BY ri.event_time DESC
         LIMIT ?`,
      )
      .all(entityId1, entityId2, limit) as Array<Record<string, unknown>>;

    return rows.map(rowToRawItem);
  }

  /**
   * Aggregate statistics for a single entity.
   */
  getEntityStats(entityId: string): EntityStats {
    const msgRow = this.db
      .prepare(
        `SELECT COUNT(*) as cnt FROM entity_episodes WHERE entity_id = ?`,
      )
      .get(entityId) as { cnt: number };

    const relRow = this.db
      .prepare(
        `SELECT COUNT(*) as cnt
         FROM relationships
         WHERE (from_entity_id = ? OR to_entity_id = ?)
           AND valid_until IS NULL`,
      )
      .get(entityId, entityId) as { cnt: number };

    const entityRow = this.db
      .prepare(`SELECT first_seen_at, last_seen_at FROM entities WHERE id = ?`)
      .get(entityId) as { first_seen_at: number; last_seen_at: number } | undefined;

    return {
      entityId,
      messageCount: msgRow.cnt,
      relationshipCount: relRow.cnt,
      firstSeenAt: entityRow?.first_seen_at ?? null,
      lastSeenAt: entityRow?.last_seen_at ?? null,
    };
  }

  /**
   * Find the shortest path between two entities using a BFS over the
   * relationships table via a recursive CTE.
   *
   * Returns the ordered node and edge lists along the shortest path, or
   * empty arrays when no path exists within maxDepth hops.
   */
  getShortestPath(
    entityId1: string,
    entityId2: string,
    maxDepth = 5,
  ): { nodes: GraphNode[]; edges: GraphEdge[] } {
    if (entityId1 === entityId2) {
      // Trivial: same node
      const rows = this.db
        .prepare(`SELECT * FROM entities WHERE id = ? AND status = 'active'`)
        .all(entityId1) as Array<Record<string, unknown>>;
      const nodes: GraphNode[] = rows.map((row) => {
        const e = rowToEntity(row);
        return { id: e.id, type: e.type, label: e.canonicalName, attributes: e.attributes };
      });
      return { nodes, edges: [] };
    }

    // BFS via recursive CTE.
    // Each row tracks: current node id, relationship id used to reach it,
    // the predecessor node id, and the hop depth.
    // We use UNION (not UNION ALL) to avoid revisiting the same node.
    //
    // The CTE terminates as soon as entityId2 is first reached (min depth = BFS).
    // We cap at maxDepth to bound query cost.
    const pathRows = this.db
      .prepare(
        `WITH RECURSIVE bfs(node_id, rel_id, prev_id, depth) AS (
           -- Seed: both directed edges from entityId1
           SELECT to_entity_id,   id, from_entity_id, 1
           FROM   relationships
           WHERE  from_entity_id = ? AND valid_until IS NULL
           UNION
           SELECT from_entity_id, id, to_entity_id,   1
           FROM   relationships
           WHERE  to_entity_id = ? AND valid_until IS NULL
           UNION
           -- Expand one hop from the frontier
           SELECT r.to_entity_id,   r.id, bfs.node_id, bfs.depth + 1
           FROM   relationships r
           JOIN   bfs ON r.from_entity_id = bfs.node_id
           WHERE  bfs.depth < ? AND r.valid_until IS NULL
           UNION
           SELECT r.from_entity_id, r.id, bfs.node_id, bfs.depth + 1
           FROM   relationships r
           JOIN   bfs ON r.to_entity_id = bfs.node_id
           WHERE  bfs.depth < ? AND r.valid_until IS NULL
         )
         SELECT node_id, rel_id, prev_id, depth
         FROM   bfs
         WHERE  node_id = ?
         ORDER  BY depth ASC
         LIMIT  1`,
      )
      .all(entityId1, entityId1, maxDepth, maxDepth, entityId2) as Array<{
        node_id: string;
        rel_id: string;
        prev_id: string;
        depth: number;
      }>;

    if (pathRows.length === 0) {
      // No path found within maxDepth
      return { nodes: [], edges: [] };
    }

    // We found entityId2. Now reconstruct the full path by walking backwards
    // through the BFS table. Pull ALL bfs rows so we can trace back.
    const allRows = this.db
      .prepare(
        `WITH RECURSIVE bfs(node_id, rel_id, prev_id, depth) AS (
           SELECT to_entity_id,   id, from_entity_id, 1
           FROM   relationships
           WHERE  from_entity_id = ? AND valid_until IS NULL
           UNION
           SELECT from_entity_id, id, to_entity_id,   1
           FROM   relationships
           WHERE  to_entity_id = ? AND valid_until IS NULL
           UNION
           SELECT r.to_entity_id,   r.id, bfs.node_id, bfs.depth + 1
           FROM   relationships r
           JOIN   bfs ON r.from_entity_id = bfs.node_id
           WHERE  bfs.depth < ? AND r.valid_until IS NULL
           UNION
           SELECT r.from_entity_id, r.id, bfs.node_id, bfs.depth + 1
           FROM   relationships r
           JOIN   bfs ON r.to_entity_id = bfs.node_id
           WHERE  bfs.depth < ? AND r.valid_until IS NULL
         )
         SELECT node_id, rel_id, prev_id, depth
         FROM   bfs
         ORDER  BY depth ASC`,
      )
      .all(entityId1, entityId1, maxDepth, maxDepth) as Array<{
        node_id: string;
        rel_id: string;
        prev_id: string;
        depth: number;
      }>;

    // Build a map from node_id → best (lowest-depth) BFS row for back-tracking.
    const bfsMap = new Map<string, { rel_id: string; prev_id: string; depth: number }>();
    for (const row of allRows) {
      const existing = bfsMap.get(row.node_id);
      if (!existing || row.depth < existing.depth) {
        bfsMap.set(row.node_id, { rel_id: row.rel_id, prev_id: row.prev_id, depth: row.depth });
      }
    }
    // entityId1 is the virtual root — not in the BFS rows.
    bfsMap.set(entityId1, { rel_id: '', prev_id: '', depth: 0 });

    // Trace back from entityId2 to entityId1.
    const pathNodeIds: string[] = [];
    const pathRelIds: string[] = [];
    let cursor = entityId2;
    while (cursor !== entityId1) {
      const entry = bfsMap.get(cursor);
      if (!entry) break; // Shouldn't happen if BFS succeeded
      pathNodeIds.push(cursor);
      if (entry.rel_id) pathRelIds.push(entry.rel_id);
      cursor = entry.prev_id;
    }
    pathNodeIds.push(entityId1);
    pathNodeIds.reverse();
    pathRelIds.reverse();

    if (pathNodeIds.length === 0) return { nodes: [], edges: [] };

    // Fetch entities along the path.
    const nodePlaceholders = pathNodeIds.map(() => '?').join(', ');
    const entityRows = this.db
      .prepare(
        `SELECT * FROM entities WHERE id IN (${nodePlaceholders}) AND status = 'active'`,
      )
      .all(...pathNodeIds) as Array<Record<string, unknown>>;

    const entityMap = new Map<string, GraphNode>();
    for (const row of entityRows) {
      const e = rowToEntity(row);
      entityMap.set(e.id, { id: e.id, type: e.type, label: e.canonicalName, attributes: e.attributes });
    }
    const nodes = pathNodeIds.flatMap((id) => {
      const n = entityMap.get(id);
      return n ? [n] : [];
    });

    // Fetch relationships along the path.
    let edges: GraphEdge[] = [];
    if (pathRelIds.length > 0) {
      const relPlaceholders = pathRelIds.map(() => '?').join(', ');
      const relRows = this.db
        .prepare(`SELECT * FROM relationships WHERE id IN (${relPlaceholders})`)
        .all(...pathRelIds) as Array<Record<string, unknown>>;
      const relMap = new Map(relRows.map((r) => [r['id'] as string, rowToRelationship(r)]));
      edges = pathRelIds.flatMap((id) => {
        const r = relMap.get(id);
        return r
          ? [{ id: r.id, source: r.fromEntityId, target: r.toEntityId, type: r.type, strength: r.strength }]
          : [];
      });
    }

    return { nodes, edges };
  }

  /**
   * Return the layer data for the Focus Swap graph UI.
   * Center is identified by entityId; special prefixed IDs handle virtual nodes:
   *   'root'             → L0 virtual root
   *   'category:people'  → L1 people list
   *   'category:topics'  → L1 top-level topics list
   *   'category:documents' → L1 documents list
   *   'category:pending' → L1 pending attention items
   *   'category:groups'  → L1 communities
   *   <entity-id>        → L2+ entity detail
   */
  getLayerData(entityId: string, maxRing = 15): LayerResponse {
    if (entityId === 'root') {
      return this.getRootLayer(maxRing);
    }
    if (entityId.startsWith('category:')) {
      return this.getCategoryLayer(entityId, maxRing);
    }
    if (entityId.startsWith('urgency:')) {
      return this.getUrgencyGroupLayer(entityId, maxRing);
    }
    return this.getEntityLayer(entityId, maxRing);
  }

  private getRootLayer(maxRing: number): LayerResponse {
    type CountRow = { type: string; n: number };
    const counts = this.db
      .prepare(
        `SELECT type, COUNT(*) as n FROM entities
         WHERE status = 'active'
           AND type IN ('person','topic','action_item','key_fact','document','thread')
         GROUP BY type`,
      )
      .all() as CountRow[];
    const countMap = new Map(counts.map((r) => [r.type, r.n]));

    const topicCount = (
      this.db
        .prepare(
          `SELECT COUNT(*) as n FROM entities
           WHERE type = 'topic' AND parent_entity_id IS NULL AND status = 'active'`,
        )
        .get() as { n: number }
    ).n;

    const pendingCount = (
      this.db
        .prepare(
          `SELECT COUNT(*) as n FROM attention_items
           WHERE resolved_at IS NULL AND dismissed_at IS NULL`,
        )
        .get() as { n: number }
    ).n;

    const groupsCount = (
      this.db.prepare('SELECT COUNT(*) as n FROM communities').get() as { n: number }
    ).n;

    const categories: RingNode[] = [
      { id: 'category:people', type: 'category', label: 'People', badge: countMap.get('person') ?? 0, alsoIn: [] },
      { id: 'category:topics', type: 'category', label: 'Topics', badge: topicCount, alsoIn: [] },
      { id: 'category:documents', type: 'category', label: 'Documents', badge: countMap.get('document') ?? 0, alsoIn: [] },
      { id: 'category:pending', type: 'category', label: 'Pending', badge: pendingCount, alsoIn: [] },
      { id: 'category:groups', type: 'category', label: 'Groups', badge: groupsCount, alsoIn: [] },
    ];

    return {
      center: {
        id: 'root',
        type: 'root',
        label: 'Me',
        labelAlt: null,
        attributes: {},
        stats: { messageCount: 0, relationshipCount: 0 },
      },
      children: categories.slice(0, maxRing),
      totalAvailable: categories.length,
      hasChildren: true,
    };
  }

  private getCategoryLayer(categoryId: string, maxRing: number): LayerResponse {
    const category = categoryId.slice('category:'.length);

    type EntityRow = { id: string; canonical_name: string; name_alt: string | null; type: string; attributes: string | null };

    let children: RingNode[];
    let totalAvailable: number;

    if (category === 'people') {
      const rows = this.db
        .prepare(
          `SELECT id, canonical_name, name_alt, type, attributes
           FROM entities WHERE type = 'person' AND status = 'active'
           ORDER BY last_seen_at DESC LIMIT ?`,
        )
        .all(maxRing) as EntityRow[];

      totalAvailable = (
        this.db
          .prepare(`SELECT COUNT(*) as n FROM entities WHERE type = 'person' AND status = 'active'`)
          .get() as { n: number }
      ).n;

      children = rows.map((r) => ({
        id: r.id,
        type: r.type,
        label: r.canonical_name,
        badge: this.getMessageCount(r.id),
        alsoIn: [],
      }));

    } else if (category === 'topics') {
      const rows = this.db
        .prepare(
          `SELECT id, canonical_name, name_alt, type, attributes
           FROM entities
           WHERE type = 'topic' AND parent_entity_id IS NULL AND status = 'active'
           ORDER BY last_seen_at DESC LIMIT ?`,
        )
        .all(maxRing) as EntityRow[];

      totalAvailable = (
        this.db
          .prepare(
            `SELECT COUNT(*) as n FROM entities
             WHERE type = 'topic' AND parent_entity_id IS NULL AND status = 'active'`,
          )
          .get() as { n: number }
      ).n;

      children = rows.map((r) => ({
        id: r.id,
        type: r.type,
        label: r.canonical_name,
        badge: this.getMessageCount(r.id),
        alsoIn: [],
      }));

    } else if (category === 'documents') {
      const rows = this.db
        .prepare(
          `SELECT id, canonical_name, name_alt, type, attributes
           FROM entities WHERE type = 'document' AND status = 'active'
           ORDER BY last_seen_at DESC LIMIT ?`,
        )
        .all(maxRing) as EntityRow[];

      totalAvailable = (
        this.db
          .prepare(`SELECT COUNT(*) as n FROM entities WHERE type = 'document' AND status = 'active'`)
          .get() as { n: number }
      ).n;

      children = rows.map((r) => ({
        id: r.id,
        type: r.type,
        label: r.canonical_name,
        badge: this.getMessageCount(r.id),
        alsoIn: [],
      }));

    } else if (category === 'pending') {
      // Group attention items into urgency buckets — each bucket is a virtual children node
      type CountRow = { bucket: string; n: number };
      const bucketRows = this.db
        .prepare(
          `SELECT
             CASE
               WHEN urgency_score >= 1.0 THEN 'overdue'
               WHEN urgency_score >= 0.7 THEN 'this_week'
               WHEN urgency_score >= 0.5 THEN 'upcoming'
               ELSE 'no_date'
             END AS bucket,
             COUNT(*) AS n
           FROM attention_items
           WHERE resolved_at IS NULL AND dismissed_at IS NULL
           GROUP BY bucket`,
        )
        .all() as CountRow[];

      const bucketMap = new Map(bucketRows.map((r) => [r.bucket, r.n]));

      children = [
        {
          id: 'urgency:overdue',
          type: 'urgency_group',
          label: 'Overdue 逾期',
          badge: bucketMap.get('overdue') ?? 0,
          alsoIn: [],
        },
        {
          id: 'urgency:this_week',
          type: 'urgency_group',
          label: 'This Week 本周',
          badge: bucketMap.get('this_week') ?? 0,
          alsoIn: [],
        },
        {
          id: 'urgency:upcoming',
          type: 'urgency_group',
          label: 'Upcoming 即将',
          badge: bucketMap.get('upcoming') ?? 0,
          alsoIn: [],
        },
        {
          id: 'urgency:no_date',
          type: 'urgency_group',
          label: 'No Date 无日期',
          badge: bucketMap.get('no_date') ?? 0,
          alsoIn: [],
        },
      ];

      totalAvailable = children.length;

    } else if (category === 'groups') {
      type CommRow = { id: string; name: string; member_entity_ids: string | null };
      const rows = this.db
        .prepare(
          `SELECT id, name, member_entity_ids FROM communities ORDER BY updated_at DESC LIMIT ?`,
        )
        .all(maxRing) as CommRow[];

      totalAvailable = (
        this.db.prepare('SELECT COUNT(*) as n FROM communities').get() as { n: number }
      ).n;

      children = rows.map((r) => {
        let memberCount = 0;
        try {
          memberCount = (JSON.parse(r.member_entity_ids ?? '[]') as unknown[]).length;
        } catch { /* ignore */ }
        return { id: r.id, type: 'community', label: r.name, badge: memberCount, alsoIn: [] };
      });

    } else {
      children = [];
      totalAvailable = 0;
    }

    return {
      center: {
        id: categoryId,
        type: 'category',
        label: this.categoryLabel(category),
        labelAlt: null,
        attributes: {},
        stats: { messageCount: 0, relationshipCount: 0 },
      },
      children,
      totalAvailable,
      hasChildren: totalAvailable > 0,
    };
  }

  private getUrgencyGroupLayer(groupId: string, maxRing: number): LayerResponse {
    const group = groupId.slice('urgency:'.length) as 'overdue' | 'this_week' | 'upcoming' | 'no_date';

    const scoreFilter: Record<string, string> = {
      overdue:   'urgency_score >= 1.0',
      this_week: 'urgency_score >= 0.7 AND urgency_score < 1.0',
      upcoming:  'urgency_score >= 0.5 AND urgency_score < 0.7',
      no_date:   'urgency_score < 0.5',
    };

    const groupLabels: Record<string, string> = {
      overdue:   'Overdue 逾期',
      this_week: 'This Week 本周',
      upcoming:  'Upcoming 即将',
      no_date:   'No Date 无日期',
    };

    const filter = scoreFilter[group];
    if (!filter) {
      return {
        center: { id: groupId, type: 'urgency_group', label: groupId, labelAlt: null, attributes: {}, stats: { messageCount: 0, relationshipCount: 0 } },
        children: [],
        totalAvailable: 0,
        hasChildren: false,
      };
    }

    type AttRow = {
      id: string;
      title: string;
      description: string | null;
      urgency_score: number;
      entity_id: string | null;
      entity_name: string | null;
    };

    const rows = this.db
      .prepare(
        `SELECT ai.id, ai.title, ai.description, ai.urgency_score,
                ai.entity_id, e.canonical_name AS entity_name
         FROM attention_items ai
         LEFT JOIN entities e ON e.id = ai.entity_id
         WHERE ai.resolved_at IS NULL AND ai.dismissed_at IS NULL
           AND ${filter}
         ORDER BY ai.urgency_score DESC, ai.detected_at DESC
         LIMIT ?`,
      )
      .all(maxRing) as AttRow[];

    const totalRow = this.db
      .prepare(
        `SELECT COUNT(*) as n FROM attention_items
         WHERE resolved_at IS NULL AND dismissed_at IS NULL AND ${filter}`,
      )
      .get() as { n: number };

    const children: RingNode[] = rows.map((r) => ({
      id: r.id,
      type: 'attention_item',
      label: r.title,
      badge: Math.round(r.urgency_score * 100),
      alsoIn: r.entity_name ? [{ id: r.entity_id!, label: r.entity_name }] : [],
    }));

    return {
      center: {
        id: groupId,
        type: 'urgency_group',
        label: groupLabels[group] ?? groupId,
        labelAlt: null,
        attributes: {},
        stats: { messageCount: 0, relationshipCount: 0 },
      },
      children,
      totalAvailable: totalRow.n,
      hasChildren: totalRow.n > 0,
    };
  }

  private getEntityLayer(entityId: string, maxRing: number): LayerResponse {
    type EntityRow = {
      id: string;
      type: string;
      canonical_name: string;
      name_alt: string | null;
      attributes: string | null;
    };

    const centerRow = this.db
      .prepare(`SELECT id, type, canonical_name, name_alt, attributes FROM entities WHERE id = ?`)
      .get(entityId) as EntityRow | undefined;

    if (!centerRow) {
      // Return empty layer for missing entity
      return {
        center: { id: entityId, type: 'unknown', label: 'Unknown', labelAlt: null, attributes: {}, stats: { messageCount: 0, relationshipCount: 0 } },
        children: [],
        totalAvailable: 0,
        hasChildren: false,
      };
    }

    const centerType = centerRow.type;
    const stats = this.getEntityStats(entityId);

    type RelRow = { id: string; type: string; canonical_name: string; name_alt: string | null; rel_type: string };

    let ringRows: RelRow[] = [];
    let totalAvailable = 0;

    if (centerType === 'topic') {
      // Child topics first, then related people, then related documents
      const childRows = this.db
        .prepare(
          `SELECT id, type, canonical_name, name_alt, 'child_topic' AS rel_type
           FROM entities
           WHERE parent_entity_id = ? AND status = 'active'
           ORDER BY last_seen_at DESC`,
        )
        .all(entityId) as RelRow[];

      const relatedRows = this.db
        .prepare(
          `SELECT DISTINCT e.id, e.type, e.canonical_name, e.name_alt,
                  r.type AS rel_type
           FROM relationships r
           JOIN entities e ON (
             CASE WHEN r.from_entity_id = ? THEN e.id = r.to_entity_id
                  ELSE e.id = r.from_entity_id END
           )
           WHERE (r.from_entity_id = ? OR r.to_entity_id = ?)
             AND e.status = 'active'
             AND e.type IN ('person','document')
             AND r.valid_until IS NULL
           ORDER BY r.strength DESC`,
        )
        .all(entityId, entityId, entityId) as RelRow[];

      const combined = [...childRows, ...relatedRows];
      totalAvailable = combined.length;
      ringRows = combined.slice(0, maxRing);

    } else if (centerType === 'person') {
      const relatedRows = this.db
        .prepare(
          `SELECT DISTINCT e.id, e.type, e.canonical_name, e.name_alt,
                  r.type AS rel_type
           FROM relationships r
           JOIN entities e ON (
             CASE WHEN r.from_entity_id = ? THEN e.id = r.to_entity_id
                  ELSE e.id = r.from_entity_id END
           )
           WHERE (r.from_entity_id = ? OR r.to_entity_id = ?)
             AND e.status = 'active'
             AND e.type IN ('topic','action_item','key_fact')
             AND r.valid_until IS NULL
           ORDER BY r.strength DESC`,
        )
        .all(entityId, entityId, entityId) as RelRow[];

      totalAvailable = relatedRows.length;
      ringRows = relatedRows.slice(0, maxRing);

    } else if (centerType === 'action_item') {
      const relatedRows = this.db
        .prepare(
          `SELECT DISTINCT e.id, e.type, e.canonical_name, e.name_alt,
                  r.type AS rel_type
           FROM relationships r
           JOIN entities e ON (
             CASE WHEN r.from_entity_id = ? THEN e.id = r.to_entity_id
                  ELSE e.id = r.from_entity_id END
           )
           WHERE (r.from_entity_id = ? OR r.to_entity_id = ?)
             AND e.status = 'active'
             AND e.type IN ('person','topic','thread')
             AND r.valid_until IS NULL
           ORDER BY r.strength DESC`,
        )
        .all(entityId, entityId, entityId) as RelRow[];

      totalAvailable = relatedRows.length;
      ringRows = relatedRows.slice(0, maxRing);

    } else if (centerType === 'community') {
      // Member entities
      const commRow = this.db
        .prepare(`SELECT member_entity_ids FROM communities WHERE id = ?`)
        .get(entityId) as { member_entity_ids: string | null } | undefined;

      let memberIds: string[] = [];
      try {
        memberIds = JSON.parse(commRow?.member_entity_ids ?? '[]') as string[];
      } catch { /* ignore */ }

      totalAvailable = memberIds.length;
      const limitedIds = memberIds.slice(0, maxRing);

      if (limitedIds.length > 0) {
        const placeholders = limitedIds.map(() => '?').join(',');
        ringRows = (
          this.db
            .prepare(
              `SELECT id, type, canonical_name, name_alt, 'member' AS rel_type
               FROM entities WHERE id IN (${placeholders}) AND status = 'active'`,
            )
            .all(...limitedIds) as RelRow[]
        );
      }

    } else {
      // Generic: all related entities
      const relatedRows = this.db
        .prepare(
          `SELECT DISTINCT e.id, e.type, e.canonical_name, e.name_alt,
                  r.type AS rel_type
           FROM relationships r
           JOIN entities e ON (
             CASE WHEN r.from_entity_id = ? THEN e.id = r.to_entity_id
                  ELSE e.id = r.from_entity_id END
           )
           WHERE (r.from_entity_id = ? OR r.to_entity_id = ?)
             AND e.status = 'active'
             AND r.valid_until IS NULL
           ORDER BY r.strength DESC`,
        )
        .all(entityId, entityId, entityId) as RelRow[];

      totalAvailable = relatedRows.length;
      ringRows = relatedRows.slice(0, maxRing);
    }

    // Build children nodes with alsoIn cross-references
    const children = ringRows.map((r): RingNode => ({
      id: r.id,
      type: r.type,
      label: r.canonical_name,
      badge: this.getMessageCount(r.id),
      alsoIn: this.getAlsoIn(entityId, r.id, centerType, r.type),
    }));

    // hasChildren: entity has children in its hierarchy (sub-topics or children nodes)
    const childCount = (
      this.db
        .prepare(
          `SELECT COUNT(*) as n FROM entities
           WHERE parent_entity_id = ? AND status = 'active'`,
        )
        .get(entityId) as { n: number }
    ).n;

    return {
      center: {
        id: centerRow.id,
        type: centerType,
        label: centerRow.canonical_name,
        labelAlt: centerRow.name_alt,
        attributes: parseJson(centerRow.attributes, {}),
        stats: { messageCount: stats.messageCount, relationshipCount: stats.relationshipCount },
      },
      children,
      totalAvailable,
      hasChildren: childCount > 0 || totalAvailable > 0,
    };
  }

  /**
   * Compute cross-context references for a child node.
   * For a topic child node under a person center: other people who share that topic.
   * For a person child node under a topic center: other topics that person shares.
   */
  private getAlsoIn(
    centerId: string,
    ringNodeId: string,
    centerType: string,
    ringNodeType: string,
  ): Array<{ id: string; label: string }> {
    if (centerType === 'person' && ringNodeType === 'topic') {
      // Other people who also discuss this topic
      type Row = { id: string; canonical_name: string };
      const rows = this.db
        .prepare(
          `SELECT DISTINCT e.id, e.canonical_name
           FROM relationships r1
           JOIN relationships r2 ON r2.to_entity_id = r1.to_entity_id
           JOIN entities e ON e.id = r2.from_entity_id
           WHERE r1.from_entity_id = ?
             AND r1.to_entity_id = ?
             AND r2.from_entity_id != ?
             AND e.type = 'person'
             AND e.status = 'active'
           LIMIT 5`,
        )
        .all(centerId, ringNodeId, centerId) as Row[];
      return rows.map((r) => ({ id: r.id, label: r.canonical_name }));

    } else if (centerType === 'topic' && ringNodeType === 'person') {
      // Other topics this person also appears in
      type Row = { id: string; canonical_name: string };
      const rows = this.db
        .prepare(
          `SELECT DISTINCT e.id, e.canonical_name
           FROM relationships r1
           JOIN relationships r2 ON r2.from_entity_id = r1.from_entity_id
           JOIN entities e ON e.id = r2.to_entity_id
           WHERE r1.from_entity_id = ?
             AND r1.to_entity_id = ?
             AND r2.to_entity_id != ?
             AND e.type = 'topic'
             AND e.status = 'active'
           LIMIT 5`,
        )
        .all(ringNodeId, centerId, centerId) as Row[];
      return rows.map((r) => ({ id: r.id, label: r.canonical_name }));
    }

    return [];
  }

  private getMessageCount(entityId: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) as n FROM entity_episodes WHERE entity_id = ?`)
      .get(entityId) as { n: number };
    return row.n;
  }

  private categoryLabel(category: string): string {
    const labels: Record<string, string> = {
      people: 'People',
      topics: 'Topics',
      documents: 'Documents',
      pending: 'Pending',
      groups: 'Groups',
    };
    return labels[category] ?? category;
  }

  /**
   * Get the top entities of a given type, ordered by recency or frequency.
   */
  getTopEntities(
    type: EntityType,
    limit = 20,
    sortBy: 'recency' | 'frequency' = 'recency',
  ): Entity[] {
    let sql: string;
    const params: unknown[] = [type];

    if (sortBy === 'frequency') {
      params.push(limit);
      sql = `
        SELECT e.*
        FROM entities e
        LEFT JOIN entity_episodes ee ON ee.entity_id = e.id
        WHERE e.type = ? AND e.status = 'active'
        GROUP BY e.id
        ORDER BY COUNT(ee.raw_item_id) DESC
        LIMIT ?
      `;
    } else {
      params.push(limit);
      sql = `
        SELECT * FROM entities
        WHERE type = ? AND status = 'active'
        ORDER BY last_seen_at DESC
        LIMIT ?
      `;
    }

    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map(rowToEntity);
  }
}
