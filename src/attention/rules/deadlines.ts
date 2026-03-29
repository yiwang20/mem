import type Database from 'better-sqlite3';
import type { AttentionItem, Entity } from '../../types/index.js';
import { AttentionItemType, EntityType } from '../../types/index.js';
import { ulid } from '../../utils/ulid.js';
import { deadlineScore } from '../scoring.js';

/**
 * Parse a due-date value from an entity's attributes.
 * Supports ISO 8601 strings and numeric epoch milliseconds.
 * Returns null if the value cannot be parsed.
 */
function parseDueDate(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    // Treat as epoch ms if > year 2000 threshold; otherwise treat as epoch seconds
    return value > 1_000_000_000_000 ? value : value * 1000;
  }

  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return isNaN(ms) ? null : ms;
  }

  return null;
}

function buildAttentionItem(
  entity: Entity,
  dueMs: number,
  urgencyScore: number,
  now: number,
): AttentionItem {
  const isOverdue = dueMs < now;
  const dueDate = new Date(dueMs).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return {
    id: ulid(),
    type: AttentionItemType.ApproachingDeadline,
    entityId: entity.id,
    rawItemId: null,
    urgencyScore,
    title: isOverdue
      ? `Overdue: ${entity.canonicalName}`
      : `Deadline approaching: ${entity.canonicalName}`,
    description: isOverdue
      ? `Was due ${dueDate}`
      : `Due ${dueDate}`,
    detectedAt: now,
    resolvedAt: null,
    dismissedAt: null,
    snoozedUntil: null,
    resolutionType: null,
  };
}

/**
 * Detect approaching and overdue deadlines.
 *
 * Scans action_item entities whose `due_date` attribute is set and whose
 * status is not 'done'. Creates an attention item for each, scored by how
 * soon (or how overdue) the deadline is.
 *
 * Only surfaces deadlines within a 2-week lookahead window and overdue items
 * up to 60 days old (beyond that they are likely abandoned).
 */
export function detectApproachingDeadlines(
  db: Database.Database,
  existingItemsByEntityId: Map<string, AttentionItemType[]>,
  options: { now?: number } = {},
): AttentionItem[] {
  const now = options.now ?? Date.now();
  const twoWeeksMs = 14 * 24 * 60 * 60 * 1000;
  const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;

  const rows = db
    .prepare(
      `SELECT * FROM entities
       WHERE type = ?
         AND status != 'merged'
         AND json_extract(attributes, '$.due_date') IS NOT NULL
         AND (json_extract(attributes, '$.status') IS NULL OR json_extract(attributes, '$.status') != 'done')
       ORDER BY last_seen_at DESC`,
    )
    .all(EntityType.ActionItem) as Array<Record<string, unknown>>;

  const results: AttentionItem[] = [];

  for (const row of rows) {
    const entity = rowToEntity(row);

    // Skip if we already have an approaching_deadline item for this entity
    const existing = existingItemsByEntityId.get(entity.id) ?? [];
    if (existing.includes(AttentionItemType.ApproachingDeadline)) continue;

    const dueMs = parseDueDate(entity.attributes['due_date']);
    if (dueMs === null) continue;

    const elapsedSinceDue = now - dueMs;
    const msUntilDue = dueMs - now;

    // Ignore deadlines more than 2 weeks in the future
    if (msUntilDue > twoWeeksMs) continue;

    // Ignore overdue items that are more than 60 days old (likely abandoned)
    if (elapsedSinceDue > sixtyDaysMs) continue;

    const urgencyScore = deadlineScore(dueMs, now);
    results.push(buildAttentionItem(entity, dueMs, urgencyScore, now));
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
