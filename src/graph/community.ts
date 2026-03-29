import type Database from 'better-sqlite3';
import type { Community } from '../types/index.js';
import { EntityType } from '../types/index.js';
import { ulid } from '../utils/ulid.js';

const MAX_ITERATIONS = 20;
const MIN_COMMUNITY_SIZE = 3;

// ---------------------------------------------------------------------------
// Label Propagation helpers
// ---------------------------------------------------------------------------

/**
 * Build an adjacency list for person entities connected via active relationships.
 * Returns { nodeIds, neighbors } where neighbors[i] is a list of indices adjacent to i.
 */
function buildAdjacency(db: Database.Database): {
  nodeIds: string[];
  neighborIdx: Map<number, number[]>;
} {
  // Fetch all active person entity IDs
  const personRows = db
    .prepare(
      `SELECT id FROM entities
       WHERE type = ? AND status = 'active' AND merged_into IS NULL`,
    )
    .all(EntityType.Person) as Array<{ id: string }>;

  const nodeIds = personRows.map((r) => r.id);
  const idToIdx = new Map<string, number>();
  nodeIds.forEach((id, i) => idToIdx.set(id, i));

  const neighborIdx = new Map<number, number[]>();
  nodeIds.forEach((_, i) => neighborIdx.set(i, []));

  // Fetch all active relationships between persons
  const relRows = db
    .prepare(
      `SELECT r.from_entity_id, r.to_entity_id
       FROM relationships r
       JOIN entities fe ON fe.id = r.from_entity_id
       JOIN entities te ON te.id = r.to_entity_id
       WHERE fe.type = ? AND te.type = ?
         AND fe.status = 'active' AND te.status = 'active'
         AND r.valid_until IS NULL`,
    )
    .all(EntityType.Person, EntityType.Person) as Array<{
    from_entity_id: string;
    to_entity_id: string;
  }>;

  for (const rel of relRows) {
    const fromIdx = idToIdx.get(rel.from_entity_id);
    const toIdx = idToIdx.get(rel.to_entity_id);
    if (fromIdx === undefined || toIdx === undefined) continue;
    neighborIdx.get(fromIdx)!.push(toIdx);
    neighborIdx.get(toIdx)!.push(fromIdx);
  }

  return { nodeIds, neighborIdx };
}

/**
 * Run label propagation and return a map of nodeIndex → communityLabel (also an index).
 */
function runLabelPropagation(
  nodeCount: number,
  neighborIdx: Map<number, number[]>,
): number[] {
  // Each node starts with its own label
  const labels = Array.from({ length: nodeCount }, (_, i) => i);

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let changed = false;

    // Process nodes in random order to avoid bias
    const order = Array.from({ length: nodeCount }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = order[i] as number;
      order[i] = order[j] as number;
      order[j] = tmp;
    }

    for (const nodeIdx of order) {
      const neighbors = neighborIdx.get(nodeIdx);
      if (!neighbors || neighbors.length === 0) continue;

      // Count neighbor label frequencies
      const freq = new Map<number, number>();
      for (const nIdx of neighbors) {
        const lbl = labels[nIdx] as number;
        freq.set(lbl, (freq.get(lbl) ?? 0) + 1);
      }

      // Choose the most frequent label (tie-break: smallest label)
      let bestLabel = labels[nodeIdx] as number;
      let bestCount = 0;
      for (const [lbl, count] of freq) {
        if (count > bestCount || (count === bestCount && lbl < bestLabel)) {
          bestLabel = lbl;
          bestCount = count;
        }
      }

      if (bestLabel !== (labels[nodeIdx] as number)) {
        labels[nodeIdx] = bestLabel;
        changed = true;
      }
    }

    if (!changed) break;
  }

  return labels;
}

/**
 * Group node indices by label into communities, filtering those below MIN_COMMUNITY_SIZE.
 */
function groupByLabel(
  labels: number[],
  nodeIds: string[],
): Map<number, string[]> {
  const groups = new Map<number, string[]>();
  labels.forEach((lbl, i) => {
    const group = groups.get(lbl) ?? [];
    group.push(nodeIds[i] as string);
    groups.set(lbl, group);
  });

  // Filter small communities
  for (const [lbl, members] of groups) {
    if (members.length < MIN_COMMUNITY_SIZE) groups.delete(lbl);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Community naming
// ---------------------------------------------------------------------------

/**
 * Generate a community name from the most-mentioned topic entities connected
 * to the member persons. Falls back to "Group of N" if no topics found.
 */
function generateCommunityName(
  db: Database.Database,
  memberIds: string[],
): string {
  if (memberIds.length === 0) return 'Empty Group';

  const placeholders = memberIds.map(() => '?').join(',');

  // Count how often each topic appears in relationships from community members
  const topicRows = db
    .prepare(
      `SELECT te.canonical_name, COUNT(*) AS cnt
       FROM relationships r
       JOIN entities te ON te.id = r.to_entity_id
       WHERE r.from_entity_id IN (${placeholders})
         AND te.type = ?
         AND te.status = 'active'
         AND r.valid_until IS NULL
       GROUP BY te.id
       ORDER BY cnt DESC
       LIMIT 3`,
    )
    .all(...memberIds, EntityType.Topic) as Array<{
    canonical_name: string;
    cnt: number;
  }>;

  if (topicRows.length === 0) {
    return `Group of ${memberIds.length}`;
  }

  // Use top topic name(s) to form a label
  const topName = (topicRows[0] as { canonical_name: string }).canonical_name;
  if (topicRows.length >= 2) {
    return `${topName} Team`;
  }
  return `${topName} Group`;
}

// ---------------------------------------------------------------------------
// CommunityDetector
// ---------------------------------------------------------------------------

export interface DetectedCommunity {
  community: Community;
  /** True if the community already existed and was updated, false if newly created */
  updated: boolean;
}

export class CommunityDetector {
  constructor(private readonly db: Database.Database) {}

  /**
   * Run label propagation over person entities, derive communities, persist them,
   * and create member_of relationships.
   *
   * Returns the list of persisted communities (new + updated).
   */
  detectCommunities(): DetectedCommunity[] {
    const now = Date.now();

    const { nodeIds, neighborIdx } = buildAdjacency(this.db);
    if (nodeIds.length < MIN_COMMUNITY_SIZE) return [];

    const labels = runLabelPropagation(nodeIds.length, neighborIdx);
    const groups = groupByLabel(labels, nodeIds);

    if (groups.size === 0) return [];

    const results: DetectedCommunity[] = [];

    const persistCommunity = this.db.transaction(
      (memberIds: string[], existingId: string | null) => {
        const name = generateCommunityName(this.db, memberIds);
        const description = `Auto-detected community of ${memberIds.length} people`;

        let communityId: string;
        let updated: boolean;

        if (existingId) {
          communityId = existingId;
          updated = true;
          this.db
            .prepare(
              `UPDATE communities
               SET name = ?, description = ?, member_entity_ids = ?, updated_at = ?
               WHERE id = ?`,
            )
            .run(name, description, JSON.stringify(memberIds), now, communityId);
        } else {
          communityId = ulid();
          updated = false;
          this.db
            .prepare(
              `INSERT INTO communities (id, name, description, member_entity_ids, centroid_embedding, created_at, updated_at)
               VALUES (?, ?, ?, ?, NULL, ?, ?)`,
            )
            .run(
              communityId,
              name,
              description,
              JSON.stringify(memberIds),
              now,
              now,
            );
        }

        // Note: member_of relationships are not stored in the `relationships`
        // table because communities are not entities (no FK in entities table).
        // Membership is encoded in communities.member_entity_ids instead.

        const community: Community = {
          id: communityId,
          name,
          description,
          memberEntityIds: memberIds,
          centroidEmbedding: null,
          createdAt: updated ? now : now,
          updatedAt: now,
        };

        return { community, updated };
      },
    );

    // Find existing communities to match against (by overlapping membership)
    const existingRows = this.db
      .prepare('SELECT id, member_entity_ids FROM communities')
      .all() as Array<{ id: string; member_entity_ids: string }>;

    const existingMap = new Map<string, string>();
    for (const row of existingRows) {
      let ids: string[] = [];
      try {
        ids = JSON.parse(row.member_entity_ids) as string[];
      } catch {
        // ignore
      }
      // Key by sorted members for quick lookup
      existingMap.set(ids.sort().join(','), row.id);
    }

    for (const [, memberIds] of groups) {
      const key = [...memberIds].sort().join(',');
      const existingId = existingMap.get(key) ?? null;
      const result = persistCommunity(memberIds, existingId);
      results.push(result);
    }

    return results;
  }

  /**
   * Return all communities with member counts and names.
   */
  getCommunities(): Array<Community & { memberCount: number }> {
    const rows = this.db
      .prepare(
        `SELECT id, name, description, member_entity_ids, centroid_embedding, created_at, updated_at
         FROM communities
         ORDER BY updated_at DESC`,
      )
      .all() as Array<Record<string, unknown>>;

    return rows.map((row) => {
      let memberEntityIds: string[] = [];
      try {
        memberEntityIds = JSON.parse(row['member_entity_ids'] as string) as string[];
      } catch {
        // ignore
      }
      return {
        id: row['id'] as string,
        name: row['name'] as string,
        description: (row['description'] as string | null) ?? null,
        memberEntityIds,
        centroidEmbedding: (row['centroid_embedding'] as Buffer | null) ?? null,
        createdAt: row['created_at'] as number,
        updatedAt: row['updated_at'] as number,
        memberCount: memberEntityIds.length,
      };
    });
  }
}
