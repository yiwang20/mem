import type Database from 'better-sqlite3';
import type { AttentionItem, RawItem } from '../../types/index.js';
import { AttentionItemType } from '../../types/index.js';
import { ulid } from '../../utils/ulid.js';
import { clamp, combineSignals, timeDecay } from '../scoring.js';

/** Configurable detection window — default 48 hours. */
const DEFAULT_UNANSWERED_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Heuristics to detect whether a message is a question or request.
 * Covers English and Chinese.
 */
function isQuestionOrRequest(body: string): boolean {
  // Question marks (ASCII and full-width)
  if (/[?？]/.test(body)) return true;

  // Action-oriented English keywords
  if (/\b(please|could you|can you|would you|let me know|send me|share|update|confirm|review|approve|reply|respond|get back)\b/i.test(body)) {
    return true;
  }

  // Action-oriented Chinese keywords
  if (/帮我|麻烦你|请你|能不能|可以吗|需要你|告诉我|确认一下|回复|给我|发给|看一下|处理/.test(body)) {
    return true;
  }

  return false;
}

/**
 * Check whether the user (identified by their own entity IDs) responded to
 * a given raw_item within the detection window.
 *
 * "Responded" means: a raw_item exists from the user in the same thread
 * (or from any sender if thread is null) after the candidate item's event_time
 * and within the response window.
 */
function userRespondedInWindow(
  db: Database.Database,
  item: RawItem,
  userEntityIds: string[],
  windowMs: number,
): boolean {
  if (userEntityIds.length === 0) return false;

  const windowEnd = item.eventTime + windowMs;

  if (item.threadId) {
    // Look for a reply from the user in the same thread
    const placeholders = userEntityIds.map(() => '?').join(',');
    const row = db
      .prepare(
        `SELECT 1 FROM raw_items
         WHERE thread_id = ?
           AND sender_entity_id IN (${placeholders})
           AND event_time > ?
           AND event_time <= ?
         LIMIT 1`,
      )
      .get(item.threadId, ...userEntityIds, item.eventTime, windowEnd);
    return row !== undefined;
  }

  // No thread — look for any outbound message to the same sender
  const senderInRecipients = userEntityIds.some((id) =>
    item.recipientEntityIds.includes(id),
  );
  if (!senderInRecipients && item.senderEntityId !== null) {
    // Check if the user sent anything to the original sender
    const placeholders = userEntityIds.map(() => '?').join(',');
    const row = db
      .prepare(
        `SELECT 1 FROM raw_items
         WHERE sender_entity_id IN (${placeholders})
           AND event_time > ?
           AND event_time <= ?
         LIMIT 1`,
      )
      .get(...userEntityIds, item.eventTime, windowEnd);
    return row !== undefined;
  }

  return false;
}

/**
 * Look up the entity IDs that represent "the user" — i.e. entities that appear
 * most frequently as the sender of outbound messages.  For MVP we use a simple
 * heuristic: the top-N most-frequent sender_entity_ids.
 */
function inferUserEntityIds(db: Database.Database, topN = 3): string[] {
  const rows = db
    .prepare(
      `SELECT sender_entity_id, COUNT(*) as cnt
       FROM raw_items
       WHERE sender_entity_id IS NOT NULL
       GROUP BY sender_entity_id
       ORDER BY cnt DESC
       LIMIT ?`,
    )
    .all(topN) as Array<{ sender_entity_id: string; cnt: number }>;
  return rows.map((r) => r.sender_entity_id);
}

/**
 * Build an AttentionItem for an unanswered request.
 */
function buildAttentionItem(
  item: RawItem,
  urgencyScore: number,
  now: number,
): AttentionItem {
  const senderLabel = item.senderEntityId ?? 'Unknown sender';
  const preview =
    item.subject ??
    (item.body.length > 80 ? item.body.slice(0, 80) + '…' : item.body);

  return {
    id: ulid(),
    type: AttentionItemType.UnansweredRequest,
    entityId: item.senderEntityId,
    rawItemId: item.id,
    urgencyScore,
    title: `Unanswered request from ${senderLabel}`,
    description: preview,
    detectedAt: now,
    resolvedAt: null,
    dismissedAt: null,
    snoozedUntil: null,
    resolutionType: null,
  };
}

/**
 * Detect unanswered requests.
 *
 * Scans raw_items sent by others (not by the user) that look like questions
 * or requests, and where the user has not replied within the configured window.
 */
export function detectUnansweredRequests(
  db: Database.Database,
  existingItemsByRawItemId: Set<string>,
  options: { windowMs?: number; now?: number } = {},
): AttentionItem[] {
  const windowMs = options.windowMs ?? DEFAULT_UNANSWERED_WINDOW_MS;
  const now = options.now ?? Date.now();

  // Only look at messages that arrived before the window cut-off (so they've had
  // a chance to be replied to), but not more than 30 days ago (avoid noise from
  // very old items).
  const cutoffOldest = now - 30 * 24 * 60 * 60 * 1000;
  const cutoffNewest = now - windowMs;

  const userEntityIds = inferUserEntityIds(db);

  // Fetch candidate items sent by someone else
  const userPlaceholders =
    userEntityIds.length > 0
      ? `AND sender_entity_id NOT IN (${userEntityIds.map(() => '?').join(',')})`
      : '';

  const rows = db
    .prepare(
      `SELECT * FROM raw_items
       WHERE event_time >= ?
         AND event_time <= ?
         AND sender_entity_id IS NOT NULL
         ${userPlaceholders}
       ORDER BY event_time DESC`,
    )
    .all(
      cutoffOldest,
      cutoffNewest,
      ...(userEntityIds.length > 0 ? userEntityIds : []),
    ) as Array<Record<string, unknown>>;

  const results: AttentionItem[] = [];

  for (const row of rows) {
    const item = rowToRawItem(row);

    // Skip if we already have an attention item for this raw_item
    if (existingItemsByRawItemId.has(item.id)) continue;

    // Check heuristic: is this a question or request?
    if (!isQuestionOrRequest(item.body)) continue;

    // Check if the user responded within the window
    if (userRespondedInWindow(db, item, userEntityIds, windowMs)) continue;

    // Score urgency: time elapsed since the message + basic staleness decay
    const elapsedMs = now - item.eventTime;
    const staleness = 1.0 - timeDecay(elapsedMs, windowMs * 2);
    const urgencyScore = clamp(
      combineSignals([
        [staleness, 2.0],
        // Shorter items tend to be direct requests — slight boost
        [item.body.length < 300 ? 0.7 : 0.3, 0.5],
      ]),
    );

    results.push(buildAttentionItem(item, urgencyScore, now));
  }

  return results;
}

// ---------------------------------------------------------------------------
// Inline row mapper (avoids circular import with repositories.ts)
// ---------------------------------------------------------------------------

function rowToRawItem(row: Record<string, unknown>): RawItem {
  return {
    id: row['id'] as string,
    sourceAdapter: row['source_adapter'] as RawItem['sourceAdapter'],
    channel: row['channel'] as RawItem['channel'],
    externalId: row['external_id'] as string,
    threadId: (row['thread_id'] as string | null) ?? null,
    senderEntityId: (row['sender_entity_id'] as string | null) ?? null,
    recipientEntityIds: parseJsonArray(row['recipient_entity_ids'] as string | null),
    subject: (row['subject'] as string | null) ?? null,
    body: row['body'] as string,
    bodyFormat: row['body_format'] as RawItem['bodyFormat'],
    contentHash: row['content_hash'] as string,
    language: (row['language'] as RawItem['language']) ?? null,
    eventTime: row['event_time'] as number,
    ingestedAt: row['ingested_at'] as number,
    processingStatus: row['processing_status'] as RawItem['processingStatus'],
    attachments: parseJsonArray(row['attachments'] as string | null),
    metadata: parseJsonObject(row['metadata'] as string | null),
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
