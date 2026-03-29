import type Database from 'better-sqlite3';
import type { AttentionItem } from '../../types/index.js';
import { AttentionItemType, EntityType, EntityStatus } from '../../types/index.js';
import { ulid } from '../../utils/ulid.js';
import { clamp, combineSignals } from '../scoring.js';

/**
 * Minimum number of distinct raw_items that must mention a person entity
 * within the observation window to be considered "repeatedly mentioned".
 */
const DEFAULT_MIN_MENTIONS = 3;

/** Observation window — only count mentions within the last N days. */
const DEFAULT_OBSERVATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Detect repeatedly mentioned entities.
 *
 * Surfaces person entities that appear in many distinct raw_items within a
 * rolling window but have no recent outbound communication from the user —
 * a signal that the person is being discussed or thought about but not yet
 * acted on.
 *
 * Scoring factors:
 * - Raw mention count relative to the threshold (more = more urgent)
 * - How recently the mentions occurred (recency of last mention)
 */
export function detectRepeatedMentions(
  db: Database.Database,
  existingItemsByEntityId: Map<string, AttentionItemType[]>,
  options: { minMentions?: number; windowMs?: number; now?: number } = {},
): AttentionItem[] {
  const minMentions = options.minMentions ?? DEFAULT_MIN_MENTIONS;
  const windowMs = options.windowMs ?? DEFAULT_OBSERVATION_WINDOW_MS;
  const now = options.now ?? Date.now();
  const windowStart = now - windowMs;

  // Find person entities with >= minMentions distinct raw_item episodes in window
  const rows = db
    .prepare(
      `SELECT
         e.*,
         COUNT(DISTINCT ee.raw_item_id) AS mention_count,
         MAX(ri.event_time) AS last_mention_at
       FROM entities e
       JOIN entity_episodes ee ON ee.entity_id = e.id
       JOIN raw_items ri ON ri.id = ee.raw_item_id
       WHERE e.type = ?
         AND e.status = ?
         AND e.merged_into IS NULL
         AND ri.event_time >= ?
       GROUP BY e.id
       HAVING mention_count >= ?
       ORDER BY mention_count DESC, last_mention_at DESC`,
    )
    .all(EntityType.Person, EntityStatus.Active, windowStart, minMentions) as Array<
    Record<string, unknown>
  >;

  const results: AttentionItem[] = [];

  for (const row of rows) {
    const entityId = row['id'] as string;

    // Skip if we already have a repeated_mentions item for this entity
    const existing = existingItemsByEntityId.get(entityId) ?? [];
    if (existing.includes(AttentionItemType.RepeatedMentions)) continue;

    const mentionCount = row['mention_count'] as number;
    const lastMentionAt = row['last_mention_at'] as number;
    const canonicalName = row['canonical_name'] as string;
    const nameAlt = (row['name_alt'] as string | null) ?? null;

    // Urgency: mention volume (saturates at 10×threshold) + recency of last mention
    const volumeSignal = clamp((mentionCount - minMentions) / (minMentions * 7));
    const recencyMs = now - lastMentionAt;
    // Recent mentions are more urgent — decay over the full window
    const recencySignal = clamp(1.0 - recencyMs / windowMs);

    const urgencyScore = clamp(
      combineSignals([
        [volumeSignal, 1.0],
        [recencySignal, 2.0],
      ]),
    );

    const displayName = nameAlt ?? canonicalName;
    const lastDate = new Date(lastMentionAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });

    results.push({
      id: ulid(),
      type: AttentionItemType.RepeatedMentions,
      entityId,
      rawItemId: null,
      urgencyScore,
      title: `Repeated mentions: ${displayName}`,
      description: `Mentioned ${mentionCount} time${mentionCount === 1 ? '' : 's'} in the last 7 days (last: ${lastDate})`,
      detectedAt: now,
      resolvedAt: null,
      dismissedAt: null,
      snoozedUntil: null,
      resolutionType: null,
    });
  }

  return results;
}
