import type Database from 'better-sqlite3';
import type { AttentionItem, Entity } from '../../types/index.js';
import { AttentionItemType, EntityStatus, EntityType } from '../../types/index.js';
import { ulid } from '../../utils/ulid.js';
import { staleConversationScore } from '../scoring.js';

/** A topic is considered stale after 7 days without new raw_items. */
const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

/** Don't surface stale conversations older than 90 days. */
const MAX_STALE_AGE_MS = 90 * 24 * 60 * 60 * 1000;

function buildAttentionItem(
  entity: Entity,
  lastActivityMs: number,
  urgencyScore: number,
  now: number,
): AttentionItem {
  const staleForDays = Math.round((now - lastActivityMs) / (24 * 60 * 60 * 1000));
  const lastDate = new Date(lastActivityMs).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  return {
    id: ulid(),
    type: AttentionItemType.StaleConversation,
    entityId: entity.id,
    rawItemId: null,
    urgencyScore,
    title: `Stale topic: ${entity.canonicalName}`,
    description: `No activity for ${staleForDays} day${staleForDays === 1 ? '' : 's'} (last seen ${lastDate})`,
    detectedAt: now,
    resolvedAt: null,
    dismissedAt: null,
    snoozedUntil: null,
    resolutionType: null,
  };
}

/**
 * Detect stale conversations.
 *
 * A "stale conversation" is a topic entity with status='active' that has had
 * no new raw_items (via entity_episodes) in 7+ days.
 *
 * Urgency is scored based on:
 * - How long the topic has been stale
 * - How active it was before (temporal span of prior activity + message count)
 */
export function detectStaleConversations(
  db: Database.Database,
  existingItemsByEntityId: Map<string, AttentionItemType[]>,
  options: { staleThresholdMs?: number; now?: number } = {},
): AttentionItem[] {
  const staleThresholdMs = options.staleThresholdMs ?? STALE_THRESHOLD_MS;
  const now = options.now ?? Date.now();
  const staleAfter = now - staleThresholdMs;
  const maxAge = now - MAX_STALE_AGE_MS;

  // Find active topics whose most recent episode is older than the stale threshold
  const rows = db
    .prepare(
      `SELECT
         e.*,
         MAX(ri.event_time) AS last_activity,
         MIN(ri.event_time) AS first_activity,
         COUNT(ee.raw_item_id) AS episode_count
       FROM entities e
       JOIN entity_episodes ee ON ee.entity_id = e.id
       JOIN raw_items ri ON ri.id = ee.raw_item_id
       WHERE e.type = ?
         AND e.status = ?
         AND e.merged_into IS NULL
       GROUP BY e.id
       HAVING last_activity < ?
          AND last_activity >= ?
       ORDER BY last_activity DESC`,
    )
    .all(
      EntityType.Topic,
      EntityStatus.Active,
      staleAfter,
      maxAge,
    ) as Array<Record<string, unknown>>;

  const results: AttentionItem[] = [];

  for (const row of rows) {
    const entity = rowToEntity(row);
    const lastActivityMs = row['last_activity'] as number;
    const firstActivityMs = row['first_activity'] as number;
    const episodeCount = row['episode_count'] as number;

    // Skip if we already have a stale_conversation item for this entity
    const existing = existingItemsByEntityId.get(entity.id) ?? [];
    if (existing.includes(AttentionItemType.StaleConversation)) continue;

    const staleMs = now - lastActivityMs;
    const priorActivityMs = lastActivityMs - firstActivityMs;

    const urgencyScore = staleConversationScore(staleMs, priorActivityMs, episodeCount);
    results.push(buildAttentionItem(entity, lastActivityMs, urgencyScore, now));
  }

  return results;
}

// ---------------------------------------------------------------------------
// Inline row mapper
// ---------------------------------------------------------------------------

function rowToEntity(row: Record<string, unknown>): Entity {
  return {
    id: row['id'] as string,
    type: row['type'] as Entity['type'],
    canonicalName: row['canonical_name'] as string,
    nameAlt: (row['name_alt'] as string | null) ?? null,
    aliases: parseJsonArray(row['aliases'] as string | null),
    attributes: parseJsonObject(row['attributes'] as string | null),
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

function parseJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    return JSON.parse(value) as T[];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}
