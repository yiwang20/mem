// ============================================================================
// TopicLifecycleManager — transitions topic entity statuses based on activity
// ============================================================================

import type Database from 'better-sqlite3';
import { EntityStatus, EntityType } from '../types/index.js';

const DORMANT_THRESHOLD_MS  = 14 * 24 * 60 * 60 * 1000; // 14 days
const ARCHIVED_THRESHOLD_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

export class TopicLifecycleManager {
  constructor(private readonly db: Database.Database) {}

  /**
   * Scan all non-merged topic entities and transition their status based on
   * the most recent raw_item event time linked via entity_episodes.
   *
   * Transitions:
   *   Active  → Dormant  : no episode activity in last 14 days
   *   Dormant → Archived : no episode activity in last 60 days
   *   Dormant/Archived → Active : a new episode exists within the last 14 days
   *
   * Returns the number of entities whose status was updated.
   */
  updateLifecycles(now: number = Date.now()): number {
    // Fetch all non-merged topic entities together with their latest episode
    // event_time (null when the topic has no episodes at all).
    const rows = this.db
      .prepare(
        `SELECT
           e.id,
           e.status,
           MAX(r.event_time) AS latest_event_time
         FROM entities e
         LEFT JOIN entity_episodes ep ON ep.entity_id = e.id
         LEFT JOIN raw_items r        ON r.id = ep.raw_item_id
         WHERE e.type   = ?
           AND e.status != ?
         GROUP BY e.id`,
      )
      .all(EntityType.Topic, EntityStatus.Merged) as Array<{
        id: string;
        status: string;
        latest_event_time: number | null;
      }>;

    const stmtUpdate = this.db.prepare(
      `UPDATE entities SET status = ?, updated_at = ? WHERE id = ?`,
    );

    let updated = 0;

    for (const row of rows) {
      const currentStatus = row.status as EntityStatus;
      const latestMs = row.latest_event_time ?? 0;
      const idleSinceMs = now - latestMs;

      const targetStatus = this._targetStatus(currentStatus, idleSinceMs);
      if (targetStatus !== null && targetStatus !== currentStatus) {
        stmtUpdate.run(targetStatus, now, row.id);
        updated++;
      }
    }

    return updated;
  }

  private _targetStatus(
    current: EntityStatus,
    idleSinceMs: number,
  ): EntityStatus | null {
    // Any topic with recent activity should be (re-)activated
    if (idleSinceMs < DORMANT_THRESHOLD_MS) {
      if (current === EntityStatus.Dormant || current === EntityStatus.Archived) {
        return EntityStatus.Active;
      }
      return null; // already active
    }

    if (idleSinceMs >= ARCHIVED_THRESHOLD_MS) {
      if (current !== EntityStatus.Archived) {
        return EntityStatus.Archived;
      }
      return null;
    }

    // 14d <= idle < 60d → dormant
    if (current !== EntityStatus.Dormant) {
      return EntityStatus.Dormant;
    }
    return null;
  }
}
