import type Database from 'better-sqlite3';
import type { Relationship } from '../types/index.js';
import { EntityType, RelationshipType } from '../types/index.js';
import { ulid } from '../utils/ulid.js';

/** Two cross-channel items are considered related if within this window. */
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CrossChannelCandidate {
  entityId: string;
  entityType: string;
  // Two raw_items from different channels that co-occur for this entity
  itemA: { id: string; channel: string; threadEntityId: string | null; eventTime: number };
  itemB: { id: string; channel: string; threadEntityId: string | null; eventTime: number };
}

/**
 * CrossChannelLinker detects when the same topic or person is discussed across
 * multiple channels within a short time window, and creates ContinuesIn
 * relationships between the corresponding thread entities.
 */
export class CrossChannelLinker {
  constructor(private readonly db: Database.Database) {}

  /**
   * Scan for cross-channel continuations and insert ContinuesIn relationships.
   *
   * Algorithm:
   * 1. Find entities (Person or Topic) that have episodes in 2+ distinct channels.
   * 2. For each such entity, find pairs of raw_items across different channels
   *    where both items fall within the 24-hour window.
   * 3. For each qualifying pair where both items belong to thread entities,
   *    insert a ContinuesIn relationship (earlier thread → later thread).
   * 4. Skip pairs already linked.
   *
   * Returns the number of new relationships created.
   */
  detectContinuations(options: { windowMs?: number; now?: number } = {}): number {
    const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    const now = options.now ?? Date.now();

    // Find entities with episodes across 2+ distinct channels
    const multiChannelEntities = this.db
      .prepare(
        `SELECT ee.entity_id, e.type, COUNT(DISTINCT ri.channel) AS channel_count
         FROM entity_episodes ee
         JOIN raw_items ri ON ri.id = ee.raw_item_id
         JOIN entities e ON e.id = ee.entity_id
         WHERE e.type IN (?, ?)
           AND e.status != 'merged'
           AND ri.event_time >= ?
         GROUP BY ee.entity_id
         HAVING channel_count >= 2`,
      )
      .all(EntityType.Person, EntityType.Topic, now - windowMs) as Array<{
      entity_id: string;
      type: string;
      channel_count: number;
    }>;

    if (multiChannelEntities.length === 0) return 0;

    let created = 0;

    for (const entity of multiChannelEntities) {
      const candidates = this.findCrossChannelPairs(entity.entity_id, windowMs, now);
      for (const pair of candidates) {
        const inserted = this.linkThreadEntities(pair, now);
        if (inserted) created++;
      }
    }

    return created;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Find raw_item pairs for an entity that are from different channels and
   * within the time window. Returns pairs (earlier item first).
   */
  private findCrossChannelPairs(
    entityId: string,
    windowMs: number,
    now: number,
  ): CrossChannelCandidate[] {
    // Get all episodes within the window for this entity, joined with thread entity info
    const rows = this.db
      .prepare(
        `SELECT
           ri.id          AS item_id,
           ri.channel,
           ri.event_time,
           -- Look up the thread entity for this item's thread_id
           (SELECT e.id FROM entities e
            WHERE e.type = ?
              AND e.status != 'merged'
              AND json_extract(e.attributes, '$.externalThreadId') = ri.thread_id
            LIMIT 1) AS thread_entity_id
         FROM entity_episodes ee
         JOIN raw_items ri ON ri.id = ee.raw_item_id
         WHERE ee.entity_id = ?
           AND ri.event_time >= ?
           AND ri.event_time <= ?
         ORDER BY ri.event_time ASC`,
      )
      .all(EntityType.Thread, entityId, now - windowMs, now) as Array<{
      item_id: string;
      channel: string;
      event_time: number;
      thread_entity_id: string | null;
    }>;

    const results: CrossChannelCandidate[] = [];

    // Compare all pairs — O(n²) but n is small (items within 24h window per entity)
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i]!;
        const b = rows[j]!;

        // Must be from different channels
        if (a.channel === b.channel) continue;

        // Both must belong to thread entities to create a thread-to-thread link
        if (!a.thread_entity_id || !b.thread_entity_id) continue;

        // No point linking the same thread entity to itself
        if (a.thread_entity_id === b.thread_entity_id) continue;

        results.push({
          entityId,
          entityType: EntityType.Person, // type label only used for context
          itemA: {
            id: a.item_id,
            channel: a.channel,
            threadEntityId: a.thread_entity_id,
            eventTime: a.event_time,
          },
          itemB: {
            id: b.item_id,
            channel: b.channel,
            threadEntityId: b.thread_entity_id,
            eventTime: b.event_time,
          },
        });
      }
    }

    return results;
  }

  /**
   * Insert a ContinuesIn relationship between two thread entities if one does
   * not already exist. Earlier thread is `from`, later thread is `to`.
   * Returns true if a new relationship was inserted.
   */
  private linkThreadEntities(candidate: CrossChannelCandidate, now: number): boolean {
    // Ensure earlier → later ordering
    const [earlier, later] =
      candidate.itemA.eventTime <= candidate.itemB.eventTime
        ? [candidate.itemA, candidate.itemB]
        : [candidate.itemB, candidate.itemA];

    const fromEntityId = earlier.threadEntityId!;
    const toEntityId = later.threadEntityId!;

    // Check if this pair is already linked
    const existing = this.db
      .prepare(
        `SELECT id FROM relationships
         WHERE from_entity_id = ?
           AND to_entity_id = ?
           AND type = ?
           AND valid_until IS NULL
         LIMIT 1`,
      )
      .get(fromEntityId, toEntityId, RelationshipType.ContinuesIn);

    if (existing) return false;

    const rel: Relationship = {
      id: ulid(),
      fromEntityId,
      toEntityId,
      type: RelationshipType.ContinuesIn,
      strength: 0.7,
      eventTime: later.eventTime,
      ingestionTime: now,
      validFrom: earlier.eventTime,
      validUntil: null,
      occurrenceCount: 1,
      sourceItemIds: [earlier.id, later.id],
      metadata: {
        fromChannel: earlier.channel,
        toChannel: later.channel,
        bridgingEntityId: candidate.entityId,
      },
    };

    this.db
      .prepare(
        `INSERT INTO relationships (
           id, from_entity_id, to_entity_id, type, strength,
           event_time, ingestion_time, valid_from, valid_until,
           occurrence_count, source_item_ids, metadata
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        rel.id,
        rel.fromEntityId,
        rel.toEntityId,
        rel.type,
        rel.strength,
        rel.eventTime,
        rel.ingestionTime,
        rel.validFrom,
        rel.validUntil,
        rel.occurrenceCount,
        JSON.stringify(rel.sourceItemIds),
        JSON.stringify(rel.metadata),
      );

    return true;
  }
}
