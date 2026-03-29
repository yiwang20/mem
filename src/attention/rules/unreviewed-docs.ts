import type Database from 'better-sqlite3';
import type { AttentionItem } from '../../types/index.js';
import { AttentionItemType, EntityType, EntityStatus } from '../../types/index.js';
import { ulid } from '../../utils/ulid.js';
import { clamp, combineSignals, timeDecay } from '../scoring.js';

/** Documents ingested more than this long ago without being linked are considered unreviewed. */
const DEFAULT_UNREVIEWED_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Don't surface unreviewed documents older than 30 days. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Detect unreviewed documents.
 *
 * A document entity is considered "unreviewed" when:
 * - Its type is EntityType.Document
 * - It was first seen more than the review window ago (it has had time to be reviewed)
 * - It has appeared in fewer than 2 entity_episodes (i.e. has not been revisited)
 * - It has no relationships pointing outward (no topic links, assignments, etc.)
 */
export function detectUnreviewedDocuments(
  db: Database.Database,
  existingItemsByEntityId: Map<string, AttentionItemType[]>,
  options: { windowMs?: number; now?: number } = {},
): AttentionItem[] {
  const windowMs = options.windowMs ?? DEFAULT_UNREVIEWED_WINDOW_MS;
  const now = options.now ?? Date.now();

  const reviewedBefore = now - windowMs;
  const maxAge = now - MAX_AGE_MS;

  // Find document entities that:
  // - Are active
  // - Were first seen before the review window (old enough to be reviewed)
  // - Were first seen recently enough to still be relevant (within max age)
  // - Have at most 1 episode (seen only once — never revisited)
  // - Have no outgoing relationships (not yet linked to anything)
  const rows = db
    .prepare(
      `SELECT e.*,
              COUNT(ee.raw_item_id) AS episode_count
       FROM entities e
       LEFT JOIN entity_episodes ee ON ee.entity_id = e.id
       WHERE e.type = ?
         AND e.status = ?
         AND e.merged_into IS NULL
         AND e.first_seen_at < ?
         AND e.first_seen_at >= ?
       GROUP BY e.id
       HAVING episode_count <= 1
          AND NOT EXISTS (
            SELECT 1 FROM relationships r
            WHERE r.from_entity_id = e.id
              AND r.valid_until IS NULL
          )
       ORDER BY e.first_seen_at DESC`,
    )
    .all(EntityType.Document, EntityStatus.Active, reviewedBefore, maxAge) as Array<
    Record<string, unknown>
  >;

  const results: AttentionItem[] = [];

  for (const row of rows) {
    const entityId = row['id'] as string;

    // Skip if we already have an unreviewed_document item for this entity
    const existing = existingItemsByEntityId.get(entityId) ?? [];
    if (existing.includes(AttentionItemType.UnreviewedDocument)) continue;

    const firstSeenAt = row['first_seen_at'] as number;
    const canonicalName = row['canonical_name'] as string;
    const nameAlt = (row['name_alt'] as string | null) ?? null;

    const elapsedMs = now - firstSeenAt;
    // Urgency grows with time unreviewed (half-life = 7 days), caps at 1
    const recencySignal = 1.0 - timeDecay(elapsedMs, 7 * 24 * 60 * 60 * 1000);
    const urgencyScore = clamp(
      combineSignals([
        [recencySignal, 1.5],
        // Flat baseline so even fresh unreviewed docs get some urgency
        [0.4, 0.5],
      ]),
    );

    const displayName = nameAlt ?? canonicalName;
    const ingestedDate = new Date(firstSeenAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });

    results.push({
      id: ulid(),
      type: AttentionItemType.UnreviewedDocument,
      entityId,
      rawItemId: null,
      urgencyScore,
      title: `Unreviewed document: ${displayName}`,
      description: `Received ${ingestedDate} — no links or follow-up recorded`,
      detectedAt: now,
      resolvedAt: null,
      dismissedAt: null,
      snoozedUntil: null,
      resolutionType: null,
    });
  }

  return results;
}
