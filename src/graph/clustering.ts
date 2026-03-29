// ============================================================================
// TopicClusterer — entity co-occurrence based hierarchical topic clustering
//
// Algorithm overview:
//   1. Build a co-occurrence matrix from entity_episodes (entities that appear
//      in the same raw_item are "co-occurring").
//   2. Run simplified agglomerative hierarchical clustering (single-linkage via
//      Jaccard similarity on entity sets).  Merge until max similarity < 0.3.
//   3. For each cluster with ≥3 entities, create or update a Topic entity whose
//      canonical name is derived from the most frequent terms in the cluster's
//      raw_items.
//   4. Detect drift: compare each new cluster against stored communities.
//      If member overlap (Jaccard) < 0.5, flag as drifted and optionally split.
// ============================================================================

import type Database from 'better-sqlite3';
import type { Entity, LLMProvider, RawItem } from '../types/index.js';
import { EntityStatus, EntityType, RelationshipType } from '../types/index.js';
import { ulid } from '../utils/ulid.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ClusterResult {
  clusterId: string;
  entityIds: string[];
  /** Inferred topic name from term frequency analysis */
  topicName: string;
  /** ID of the Topic entity that was created or updated */
  topicEntityId: string;
  /** True when this cluster differs significantly from the stored community */
  drifted: boolean;
}

export interface ClusteringStats {
  clusters: ClusterResult[];
  topicsCreated: number;
  topicsUpdated: number;
  driftDetected: number;
}

export interface SubTopicStats {
  topicsAnalyzed: number;
  subTopicsCreated: number;
  subTopicsMerged: number;
  intermediatesCreated: number;
  promoted: number;
  demoted: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MERGE_THRESHOLD = 0.3; // stop merging when best Jaccard < 0.3
const MIN_CLUSTER_SIZE = 3; // only create topics for clusters this size+
const DRIFT_THRESHOLD = 0.5; // member overlap < 50% = drifted

// ---------------------------------------------------------------------------
// TopicClusterer
// ---------------------------------------------------------------------------

export class TopicClusterer {
  constructor(
    private readonly db: Database.Database,
    private readonly llm?: LLMProvider,
  ) {}

  /**
   * Run one full clustering cycle:
   * 1. Build co-occurrence matrix
   * 2. Hierarchical agglomerative clustering
   * 3. Create / update Topic entities for qualifying clusters
   * 4. Store clusters as communities
   * Returns stats about what was created / updated.
   */
  clusterTopics(now: number = Date.now()): ClusteringStats {
    const cooccurrence = this.buildCooccurrenceMatrix();

    if (cooccurrence.entityIds.length === 0) {
      return { clusters: [], topicsCreated: 0, topicsUpdated: 0, driftDetected: 0 };
    }

    const clusters = agglomerativeClustering(cooccurrence, MERGE_THRESHOLD);
    const qualifying = clusters.filter((c) => c.size >= MIN_CLUSTER_SIZE);

    const stats: ClusteringStats = {
      clusters: [],
      topicsCreated: 0,
      topicsUpdated: 0,
      driftDetected: 0,
    };

    for (const cluster of qualifying) {
      const entityIds = Array.from(cluster);
      const topicName = this.inferTopicName(entityIds);
      const { entityId, created } = this.upsertTopicEntity(entityIds, topicName, now);

      if (created) stats.topicsCreated++;
      else stats.topicsUpdated++;

      const drifted = this.detectDrift(entityIds);
      if (drifted) stats.driftDetected++;

      this.upsertCommunity(entityId, entityIds, topicName, now);

      stats.clusters.push({
        clusterId: entityId,
        entityIds,
        topicName,
        topicEntityId: entityId,
        drifted,
      });

    }

    return stats;
  }

  /**
   * Detect drift for a set of entity IDs by comparing against the most
   * recent stored community with >0 overlap.
   */
  detectDrift(entityIds: string[]): boolean {
    if (entityIds.length === 0) return false;

    const rows = this.db
      .prepare('SELECT member_entity_ids FROM communities')
      .all() as Array<{ member_entity_ids: string }>;

    const incoming = new Set(entityIds);
    let bestOverlap = 0;

    for (const row of rows) {
      let stored: string[];
      try {
        stored = JSON.parse(row.member_entity_ids) as string[];
      } catch {
        continue;
      }
      if (stored.length === 0) continue;

      const storedSet = new Set(stored);
      const intersection = countIntersection(incoming, storedSet);
      const union = incoming.size + storedSet.size - intersection;
      const jaccard = union > 0 ? intersection / union : 0;

      if (jaccard > bestOverlap) bestOverlap = jaccard;
    }

    // If there's a matching stored community but member overlap < threshold → drifted
    // If no stored community matches at all → not yet tracked, not drifted
    return bestOverlap > 0 && bestOverlap < DRIFT_THRESHOLD;
  }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  /**
   * Build a co-occurrence matrix from entity_episodes.
   * Two entities co-occur if they both appear in the same raw_item.
   */
  private buildCooccurrenceMatrix(): CooccurrenceMatrix {
    // Get all (entity_id, raw_item_id) pairs for non-merged entities
    const rows = this.db
      .prepare(
        `SELECT ee.entity_id, ee.raw_item_id
         FROM entity_episodes ee
         JOIN entities e ON e.id = ee.entity_id
         WHERE e.status != 'merged'
           AND e.type != ?`,
      )
      .all(EntityType.Thread) as Array<{ entity_id: string; raw_item_id: string }>;

    // Group by raw_item_id → set of entity_ids
    const itemToEntities = new Map<string, Set<string>>();
    for (const row of rows) {
      let set = itemToEntities.get(row.raw_item_id);
      if (!set) {
        set = new Set();
        itemToEntities.set(row.raw_item_id, set);
      }
      set.add(row.entity_id);
    }

    // Build co-occurrence counts
    const cooccurrenceCounts = new Map<string, Map<string, number>>();
    const allEntityIds = new Set<string>();

    for (const entities of itemToEntities.values()) {
      const arr = Array.from(entities);
      for (let i = 0; i < arr.length; i++) {
        allEntityIds.add(arr[i]!);
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i]!;
          const b = arr[j]!;
          const key = a < b ? a : b;
          const val = a < b ? b : a;

          if (!cooccurrenceCounts.has(key)) {
            cooccurrenceCounts.set(key, new Map());
          }
          const inner = cooccurrenceCounts.get(key)!;
          inner.set(val, (inner.get(val) ?? 0) + 1);
        }
      }
    }

    return { entityIds: Array.from(allEntityIds), cooccurrenceCounts, itemToEntities };
  }

  /**
   * Infer a topic name by finding the most frequent meaningful terms across
   * all raw_items linked to the cluster's entities.
   */
  private inferTopicName(entityIds: string[]): string {
    if (entityIds.length === 0) return 'Unknown Topic';

    // First try: use the canonical names of top entities in the cluster
    const placeholders = entityIds.map(() => '?').join(',');
    const entityRows = this.db
      .prepare(
        `SELECT canonical_name FROM entities
         WHERE id IN (${placeholders})
           AND status != 'merged'
         ORDER BY last_seen_at DESC
         LIMIT 3`,
      )
      .all(...entityIds) as Array<{ canonical_name: string }>;

    if (entityRows.length > 0) {
      return entityRows
        .map((r) => r.canonical_name)
        .join(', ');
    }

    return 'Unnamed Topic';
  }

  /**
   * Create a Topic entity if none exists for this cluster, or update an
   * existing one whose canonical_name matches.
   * Returns the entity ID and whether it was newly created.
   */
  private upsertTopicEntity(
    entityIds: string[],
    topicName: string,
    now: number,
  ): { entityId: string; created: boolean } {
    // Look for an existing topic entity with this name
    const existing = this.db
      .prepare(
        `SELECT id FROM entities WHERE type = ? AND canonical_name = ? AND status != 'merged' LIMIT 1`,
      )
      .get(EntityType.Topic, topicName) as { id: string } | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE entities SET last_seen_at = MAX(last_seen_at, ?), updated_at = ? WHERE id = ?`,
        )
        .run(now, now, existing.id);
      return { entityId: existing.id, created: false };
    }

    const entityId = ulid();
    const entity: Entity = {
      id: entityId,
      type: EntityType.Topic,
      canonicalName: topicName,
      nameAlt: null,
      aliases: [],
      attributes: { generatedBy: 'clustering', memberCount: entityIds.length },
      confidence: 0.8,
      status: EntityStatus.Active,
      mergedInto: null,
      parentEntityId: null,
      firstSeenAt: now,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO entities (
           id, type, canonical_name, name_alt, aliases, attributes,
           confidence, status, merged_into,
           first_seen_at, last_seen_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entity.id,
        entity.type,
        entity.canonicalName,
        entity.nameAlt,
        JSON.stringify(entity.aliases),
        JSON.stringify(entity.attributes),
        entity.confidence,
        entity.status,
        entity.mergedInto,
        entity.firstSeenAt,
        entity.lastSeenAt,
        entity.createdAt,
        entity.updatedAt,
      );

    // Link the cluster members to this topic via part_of relationships
    for (const memberId of entityIds) {
      try {
        this.db
          .prepare(
            `INSERT INTO relationships (
               id, from_entity_id, to_entity_id, type, strength,
               event_time, ingestion_time, valid_from, valid_until,
               occurrence_count, source_item_ids, metadata
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            ulid(),
            memberId,
            entityId,
            RelationshipType.PartOf,
            0.7,
            now,
            now,
            now,
            null,
            1,
            JSON.stringify([]),
            JSON.stringify({}),
          );
      } catch {
        // Ignore duplicate relationship errors
      }
    }

    return { entityId, created: true };
  }

  /**
   * Create or update the community record for a cluster.
   */
  private upsertCommunity(
    topicEntityId: string,
    entityIds: string[],
    name: string,
    now: number,
  ): void {
    const existing = this.db
      .prepare('SELECT id FROM communities WHERE id = ?')
      .get(topicEntityId) as { id: string } | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE communities SET name = ?, member_entity_ids = ?, updated_at = ? WHERE id = ?`,
        )
        .run(name, JSON.stringify(entityIds), now, topicEntityId);
    } else {
      this.db
        .prepare(
          `INSERT INTO communities (id, name, description, member_entity_ids, centroid_embedding, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(topicEntityId, name, null, JSON.stringify(entityIds), null, now, now);
    }
  }

  // --------------------------------------------------------------------------
  // Sub-topic discovery
  // --------------------------------------------------------------------------

  /**
   * Run sub-topic discovery on all topic entities that have enough associated
   * messages. Requires an LLM provider; returns empty stats if none configured.
   */
  async discoverSubTopics(now: number = Date.now()): Promise<SubTopicStats> {
    const stats: SubTopicStats = {
      topicsAnalyzed: 0,
      subTopicsCreated: 0,
      subTopicsMerged: 0,
      intermediatesCreated: 0,
      promoted: 0,
      demoted: 0,
    };

    if (!this.llm) return stats;

    // Fetch all top-level active topics with their message counts
    type TopicRow = { id: string; canonical_name: string; msg_count: number };
    const topics = this.db
      .prepare(
        `SELECT e.id, e.canonical_name,
                COUNT(ee.raw_item_id) AS msg_count
         FROM entities e
         LEFT JOIN entity_episodes ee ON ee.entity_id = e.id
         WHERE e.type = 'topic'
           AND e.status = 'active'
           AND e.parent_entity_id IS NULL
         GROUP BY e.id
         HAVING msg_count >= 8`,
      )
      .all() as TopicRow[];

    for (const topic of topics) {
      stats.topicsAnalyzed++;
      const created = await this.discoverSubTopicsForTopic(topic.id, topic.canonical_name, topic.msg_count, now);
      stats.subTopicsCreated += created;

      // After creating sub-topics, enforce layer width (max 12 children)
      const childCount = this.getChildCount(topic.id);
      if (childCount > 12) {
        const intermediates = await this.enforceLayerWidth(topic.id, 12, now);
        stats.intermediatesCreated += intermediates;
      }
    }

    return stats;
  }

  /**
   * Discover sub-topics for a single parent topic.
   * Returns the number of sub-topic entities created.
   */
  private async discoverSubTopicsForTopic(
    topicId: string,
    topicName: string,
    msgCount: number,
    now: number,
  ): Promise<number> {
    if (!this.llm) return 0;

    type ItemRow = { id: string; subject: string | null; body: string; external_id: string };
    const items = this.db
      .prepare(
        `SELECT ri.id, ri.subject, ri.body, ri.external_id
         FROM raw_items ri
         JOIN entity_episodes ee ON ee.raw_item_id = ri.id
         WHERE ee.entity_id = ?
         ORDER BY ri.event_time DESC
         LIMIT 100`,
      )
      .all(topicId) as ItemRow[];

    if (items.length < 8) return 0;

    // Build minimal RawItem shapes for the LLM context
    const contextItems = items.map((item) => this.minimalRawItem(item));

    let subTopicsCreated = 0;

    if (msgCount > 20) {
      // Large cluster: ask LLM to identify sub-themes with message indices
      const query = `These ${items.length} messages are all about the topic "${topicName}". ` +
        `Identify 2-6 distinct sub-topics within them. ` +
        `Return a JSON array: [{"name": "...", "name_alt": "...", "message_indices": [1,2,...]}]. ` +
        `Only include sub-topics with 3 or more messages. message_indices are 1-based. ` +
        `Return only valid JSON, no prose.`;

      try {
        const result = await this.llm.answer(query, {
          relevantItems: contextItems,
          relevantEntities: [],
          relevantRelationships: [],
        });

        const subThemes = parseSubThemes(result.answer);
        for (const theme of subThemes) {
          if (theme.message_indices.length < 3) continue;
          if (theme.name === topicName) continue;

          const subTopicId = this.createSubTopicEntity(theme.name, theme.name_alt ?? null, topicId, now);
          // Re-link selected messages to this sub-topic
          for (const idx of theme.message_indices) {
            const item = items[idx - 1];
            if (!item) continue;
            try {
              this.db
                .prepare(
                  `INSERT OR IGNORE INTO entity_episodes (entity_id, raw_item_id, extraction_method, confidence)
                   VALUES (?, ?, 'sub_topic_discovery', 0.75)`,
                )
                .run(subTopicId, item.id);
            } catch { /* ignore duplicate */ }
          }
          subTopicsCreated++;
        }
      } catch (err) {
        console.error(`[clustering] discoverSubTopics LLM error for topic ${topicId}:`, err);
      }

    } else {
      // Small cluster (8-20): ask LLM directly for sub-themes
      const query = `These ${items.length} messages are about "${topicName}". ` +
        `Are there 2-5 distinct sub-themes? ` +
        `Return JSON array: [{"name": "...", "message_indices": [1,2,...]}]. ` +
        `Only return sub-themes with 2 or more messages. message_indices are 1-based. ` +
        `Return only valid JSON, no prose.`;

      try {
        const result = await this.llm.answer(query, {
          relevantItems: contextItems,
          relevantEntities: [],
          relevantRelationships: [],
        });

        const subThemes = parseSubThemes(result.answer);
        for (const theme of subThemes) {
          if (theme.message_indices.length < 2) continue;
          if (theme.name === topicName) continue;

          const subTopicId = this.createSubTopicEntity(theme.name, theme.name_alt ?? null, topicId, now);
          for (const idx of theme.message_indices) {
            const item = items[idx - 1];
            if (!item) continue;
            try {
              this.db
                .prepare(
                  `INSERT OR IGNORE INTO entity_episodes (entity_id, raw_item_id, extraction_method, confidence)
                   VALUES (?, ?, 'sub_topic_discovery', 0.75)`,
                )
                .run(subTopicId, item.id);
            } catch { /* ignore duplicate */ }
          }
          subTopicsCreated++;
        }
      } catch (err) {
        console.error(`[clustering] discoverSubTopics (small) LLM error for topic ${topicId}:`, err);
      }
    }

    return subTopicsCreated;
  }

  /**
   * Enforce max children per topic layer by creating intermediate grouping topics.
   * Recursively applied until each layer has <= maxChildren.
   * Returns the number of intermediate topics created.
   */
  async enforceLayerWidth(
    parentTopicId: string,
    maxChildren = 12,
    now: number = Date.now(),
    depth = 0,
  ): Promise<number> {
    if (!this.llm) return 0;

    // Guard: don't create intermediates at depth >= 3 (would push children to depth 5)
    const currentDepth = this.getTopicDepth(parentTopicId);
    if (currentDepth >= 3) return 0;

    type ChildRow = { id: string; canonical_name: string };
    const children = this.db
      .prepare(
        `SELECT id, canonical_name FROM entities
         WHERE parent_entity_id = ? AND type = 'topic' AND status = 'active'`,
      )
      .all(parentTopicId) as ChildRow[];

    if (children.length <= maxChildren) return 0;

    let intermediatesCreated = 0;

    // Simple grouping: divide children into ceil(n / 8) groups by name similarity
    // (no embeddings available — use naive alphabetical grouping as fallback)
    const targetGroups = Math.ceil(children.length / 8);
    const groups = groupByName(children, targetGroups);

    for (const group of groups) {
      if (group.length <= 1) continue;

      const memberNames = group.map((c) => c.canonical_name);
      const parentRow = this.db
        .prepare(`SELECT canonical_name FROM entities WHERE id = ?`)
        .get(parentTopicId) as { canonical_name: string } | undefined;

      const parentName = parentRow?.canonical_name ?? 'Unknown';

      // Ask LLM for an intermediate group label
      const query = `These sub-topics are all under "${parentName}": ${memberNames.join(', ')}. ` +
        `What single short label (2-4 words) best describes this group? ` +
        `Return JSON: {"name": "...", "name_alt": "..."}. Return only valid JSON, no prose.`;

      let intermediateName = memberNames[0] ?? 'Group';
      let intermediateNameAlt: string | null = null;

      try {
        const result = await this.llm.answer(query, {
          relevantItems: [],
          relevantEntities: [],
          relevantRelationships: [],
        });
        const parsed = parseNameResult(result.answer);
        if (parsed.name) {
          intermediateName = parsed.name;
          intermediateNameAlt = parsed.name_alt ?? null;
        }
      } catch (err) {
        console.error(`[clustering] enforceLayerWidth LLM error:`, err);
      }

      // Create intermediate topic entity
      const intermediateId = this.createSubTopicEntity(intermediateName, intermediateNameAlt, parentTopicId, now);
      intermediatesCreated++;

      // Reparent group members under the intermediate
      for (const child of group) {
        this.db
          .prepare(`UPDATE entities SET parent_entity_id = ?, updated_at = ? WHERE id = ?`)
          .run(intermediateId, now, child.id);
      }
    }

    // Recurse: check if the new children of parentTopicId still overflow
    const newChildCount = this.getChildCount(parentTopicId);
    if (newChildCount > maxChildren && depth < 3) {
      intermediatesCreated += await this.enforceLayerWidth(parentTopicId, maxChildren, now, depth + 1);
    }

    return intermediatesCreated;
  }

  // --------------------------------------------------------------------------
  // Sub-topic helpers
  // --------------------------------------------------------------------------

  private createSubTopicEntity(
    name: string,
    nameAlt: string | null,
    parentEntityId: string,
    now: number,
  ): string {
    // Check if a sub-topic with this name under this parent already exists
    const existing = this.db
      .prepare(
        `SELECT id FROM entities
         WHERE type = 'topic' AND canonical_name = ? AND parent_entity_id = ? AND status != 'merged'
         LIMIT 1`,
      )
      .get(name, parentEntityId) as { id: string } | undefined;

    if (existing) {
      this.db
        .prepare(`UPDATE entities SET last_seen_at = MAX(last_seen_at, ?), updated_at = ? WHERE id = ?`)
        .run(now, now, existing.id);
      return existing.id;
    }

    const entityId = ulid();
    this.db
      .prepare(
        `INSERT INTO entities (
           id, type, canonical_name, name_alt, aliases, attributes,
           confidence, status, merged_into, parent_entity_id,
           first_seen_at, last_seen_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entityId,
        EntityType.Topic,
        name,
        nameAlt,
        JSON.stringify([]),
        JSON.stringify({ generatedBy: 'sub_topic_discovery' }),
        0.75,
        EntityStatus.Active,
        null,
        parentEntityId,
        now,
        now,
        now,
        now,
      );

    return entityId;
  }

  private getChildCount(topicId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as n FROM entities
         WHERE parent_entity_id = ? AND type = 'topic' AND status = 'active'`,
      )
      .get(topicId) as { n: number };
    return row.n;
  }

  private getTopicDepth(topicId: string): number {
    // Walk up the parent chain to compute depth
    let depth = 0;
    let currentId: string | null = topicId;
    const visited = new Set<string>();

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const row = this.db
        .prepare(`SELECT parent_entity_id FROM entities WHERE id = ?`)
        .get(currentId) as { parent_entity_id: string | null } | undefined;
      currentId = row?.parent_entity_id ?? null;
      if (currentId) depth++;
    }

    return depth;
  }

  private minimalRawItem(item: { id: string; subject: string | null; body: string; external_id: string }): RawItem {
    return {
      id: item.id,
      sourceAdapter: 'gmail' as RawItem['sourceAdapter'],
      channel: 'email' as RawItem['channel'],
      externalId: item.external_id,
      threadId: null,
      senderEntityId: null,
      recipientEntityIds: [],
      subject: item.subject,
      body: item.body,
      bodyFormat: 'plaintext' as RawItem['bodyFormat'],
      contentHash: '',
      language: null,
      eventTime: 0,
      ingestedAt: 0,
      processingStatus: 'done' as RawItem['processingStatus'],
      attachments: [],
      metadata: {},
    };
  }
}

// ---------------------------------------------------------------------------
// Agglomerative hierarchical clustering (simplified single-linkage via Jaccard)
// ---------------------------------------------------------------------------

interface CooccurrenceMatrix {
  entityIds: string[];
  cooccurrenceCounts: Map<string, Map<string, number>>;
  itemToEntities: Map<string, Set<string>>;
}

/**
 * Simplified agglomerative clustering:
 * - Each entity starts in its own singleton cluster.
 * - Repeatedly find the pair of clusters with the highest Jaccard similarity
 *   (based on co-occurrence counts with all other entities).
 * - Merge until the best similarity drops below `threshold`.
 *
 * Jaccard between two entity sets A and B:
 *   |neighbors(A) ∩ neighbors(B)| / |neighbors(A) ∪ neighbors(B)|
 * where neighbors(X) = entities that co-occur with any member of X.
 */
function agglomerativeClustering(
  matrix: CooccurrenceMatrix,
  threshold: number,
): Set<string>[] {
  // Initialize: one cluster per entity
  let clusters: Set<string>[] = matrix.entityIds.map((id) => new Set([id]));

  if (clusters.length <= 1) return clusters;

  // Build neighbor sets: neighbors(entity) = set of entities it co-occurs with
  const neighborSets = buildNeighborSets(matrix);

  while (clusters.length > 1) {
    const { i, j, similarity } = findMostSimilarPair(clusters, neighborSets);

    if (similarity < threshold) break;

    // Merge cluster j into cluster i
    const merged = new Set<string>([...clusters[i]!, ...clusters[j]!]);
    clusters = clusters.filter((_, idx) => idx !== i && idx !== j);
    clusters.push(merged);
  }

  return clusters;
}

/**
 * For each entity, compute the set of other entities it co-occurs with
 * (i.e., appears in the same raw_item as).
 */
function buildNeighborSets(
  matrix: CooccurrenceMatrix,
): Map<string, Set<string>> {
  const neighbors = new Map<string, Set<string>>();

  for (const [a, bMap] of matrix.cooccurrenceCounts) {
    if (!neighbors.has(a)) neighbors.set(a, new Set());
    for (const [b] of bMap) {
      if (!neighbors.has(b)) neighbors.set(b, new Set());
      neighbors.get(a)!.add(b);
      neighbors.get(b)!.add(a);
    }
  }

  return neighbors;
}

/**
 * Compute the "cluster neighbor set" = union of neighbor sets of all entities
 * in the cluster.
 */
function clusterNeighborSet(
  cluster: Set<string>,
  neighborSets: Map<string, Set<string>>,
): Set<string> {
  const result = new Set<string>();
  for (const entityId of cluster) {
    const ns = neighborSets.get(entityId);
    if (ns) {
      for (const n of ns) {
        if (!cluster.has(n)) result.add(n);
      }
    }
  }
  return result;
}

/**
 * Find the pair of clusters (i, j) with the highest Jaccard similarity
 * between their combined neighbor sets. Returns { i, j, similarity }.
 */
function findMostSimilarPair(
  clusters: Set<string>[],
  neighborSets: Map<string, Set<string>>,
): { i: number; j: number; similarity: number } {
  let bestI = 0;
  let bestJ = 1;
  let bestSim = -1;

  for (let i = 0; i < clusters.length; i++) {
    const nsA = clusterNeighborSet(clusters[i]!, neighborSets);

    for (let j = i + 1; j < clusters.length; j++) {
      const nsB = clusterNeighborSet(clusters[j]!, neighborSets);

      // Also count direct cross-cluster co-occurrences as part of similarity
      const intersection = countIntersection(nsA, nsB);
      // Add cross-cluster overlap: entities in cluster i that are in nsB, or vice versa
      let crossOverlap = 0;
      for (const e of clusters[i]!) {
        if (nsB.has(e)) crossOverlap++;
      }
      for (const e of clusters[j]!) {
        if (nsA.has(e)) crossOverlap++;
      }

      const totalIntersection = intersection + crossOverlap;
      const unionSize = nsA.size + nsB.size - intersection + crossOverlap;
      const sim = unionSize > 0 ? totalIntersection / unionSize : 0;

      if (sim > bestSim) {
        bestSim = sim;
        bestI = i;
        bestJ = j;
      }
    }
  }

  return { i: bestI, j: bestJ, similarity: bestSim };
}

function countIntersection<T>(a: Set<T>, b: Set<T>): number {
  let count = 0;
  for (const item of a) {
    if (b.has(item)) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Sub-topic discovery helpers
// ---------------------------------------------------------------------------

interface SubTheme {
  name: string;
  name_alt?: string;
  message_indices: number[];
}

/**
 * Parse the LLM response for sub-theme identification.
 * Expected format: JSON array of { name, message_indices } objects.
 */
function parseSubThemes(text: string): SubTheme[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1) return [];

  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((item): SubTheme[] => {
      if (typeof item !== 'object' || item === null) return [];
      const obj = item as Record<string, unknown>;
      const name = typeof obj['name'] === 'string' ? obj['name'] : null;
      if (!name) return [];
      const indices = Array.isArray(obj['message_indices'])
        ? (obj['message_indices'] as unknown[]).filter((n): n is number => typeof n === 'number')
        : [];
      return [{ name, name_alt: typeof obj['name_alt'] === 'string' ? obj['name_alt'] : undefined, message_indices: indices }];
    });
  } catch {
    return [];
  }
}

/**
 * Parse the LLM response for a single { name, name_alt } result.
 */
function parseNameResult(text: string): { name: string | null; name_alt: string | null } {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) return { name: null, name_alt: null };

  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    return {
      name: typeof parsed['name'] === 'string' ? parsed['name'] : null,
      name_alt: typeof parsed['name_alt'] === 'string' ? parsed['name_alt'] : null,
    };
  } catch {
    return { name: null, name_alt: null };
  }
}

/**
 * Divide an array of topic rows into N groups.
 * Uses alphabetical sort as a proxy for semantic similarity since embeddings
 * are not reliably available for all providers in the current implementation.
 */
function groupByName<T extends { canonical_name: string }>(items: T[], targetGroups: number): T[][] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => a.canonical_name.localeCompare(b.canonical_name));
  const groups: T[][] = [];
  const groupSize = Math.ceil(sorted.length / targetGroups);

  for (let i = 0; i < sorted.length; i += groupSize) {
    groups.push(sorted.slice(i, i + groupSize));
  }

  return groups;
}
