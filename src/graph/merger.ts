import type Database from 'better-sqlite3';
import type { Entity, MergeAuditRecord } from '../types/index.js';
import { EntityStatus, MergeMethod } from '../types/index.js';
import type {
  EntityRepository,
  EntityAliasRepository,
  MergeAuditRepository,
} from '../storage/repositories.js';
import { ulid } from '../utils/ulid.js';

// ----------------------------------------------------------------------------
// EntityMerger
// ----------------------------------------------------------------------------

export class EntityMerger {
  constructor(
    private readonly db: Database.Database,
    private readonly entityRepo: EntityRepository,
    private readonly aliasRepo: EntityAliasRepository,
    private readonly mergeAuditRepo: MergeAuditRepository,
  ) {}

  /**
   * Merge loser into winner.
   * - All relationships pointing to/from loser are re-pointed to winner.
   * - All entity_episodes for loser are re-pointed to winner.
   * - Aliases from loser are transferred to winner.
   * - Loser is marked merged.
   * - A merge_audit record is created with a pre-merge snapshot.
   *
   * Returns the audit record ID.
   */
  merge(
    winnerId: string,
    loserId: string,
    method: MergeMethod,
    confidence: number,
    mergedBy = 'system',
  ): string {
    const winner = this.entityRepo.findById(winnerId);
    const loser = this.entityRepo.findById(loserId);

    if (!winner) throw new Error(`Winner entity not found: ${winnerId}`);
    if (!loser) throw new Error(`Loser entity not found: ${loserId}`);
    if (loser.status === EntityStatus.Merged) {
      throw new Error(`Entity ${loserId} is already merged`);
    }

    const now = Date.now();
    const auditId = ulid();

    // Capture pre-merge snapshot of the loser entity
    const snapshot = this.buildSnapshot(loser);

    const doMerge = this.db.transaction(() => {
      // Re-point outgoing relationships
      this.db
        .prepare(`UPDATE relationships SET from_entity_id = ? WHERE from_entity_id = ?`)
        .run(winnerId, loserId);

      // Re-point incoming relationships
      this.db
        .prepare(`UPDATE relationships SET to_entity_id = ? WHERE to_entity_id = ?`)
        .run(winnerId, loserId);

      // Re-point entity_episodes (ignore conflicts — winner may already have the episode)
      this.db
        .prepare(`UPDATE OR IGNORE entity_episodes SET entity_id = ? WHERE entity_id = ?`)
        .run(winnerId, loserId);

      // Transfer aliases from loser to winner
      this.db
        .prepare(`UPDATE OR IGNORE entity_aliases SET entity_id = ? WHERE entity_id = ?`)
        .run(winnerId, loserId);

      // Mark loser as merged
      this.db
        .prepare(
          `UPDATE entities
           SET status = ?, merged_into = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(EntityStatus.Merged, winnerId, now, loserId);

      // Update winner's last_seen_at and updated_at
      this.db
        .prepare(
          `UPDATE entities
           SET last_seen_at = MAX(last_seen_at, ?), updated_at = ?
           WHERE id = ?`,
        )
        .run(loser.lastSeenAt, now, winnerId);

      // Insert merge audit record
      this.mergeAuditRepo.insert({
        id: auditId,
        survivingEntityId: winnerId,
        mergedEntityId: loserId,
        mergeMethod: method,
        confidence,
        mergedAt: now,
        mergedBy,
        preMergeSnapshot: snapshot as unknown as Record<string, unknown>,
        undoneAt: null,
      });
    });

    doMerge();
    return auditId;
  }

  /**
   * Reverse a previous merge using the audit record.
   * - Restores the loser entity from its pre-merge snapshot.
   * - Re-points relationships and episodes back to the restored entity where possible.
   * - Marks the audit record as undone.
   */
  unmerge(mergeAuditId: string): void {
    const auditRow = this.db
      .prepare('SELECT * FROM merge_audit WHERE id = ?')
      .get(mergeAuditId) as Record<string, unknown> | undefined;

    if (!auditRow) {
      throw new Error(`Merge audit record not found: ${mergeAuditId}`);
    }
    if (auditRow['undone_at'] !== null) {
      throw new Error(`Merge ${mergeAuditId} is already undone`);
    }

    const loserId = auditRow['merged_entity_id'] as string;
    const winnerId = auditRow['surviving_entity_id'] as string;
    const snapshotJson = auditRow['pre_merge_snapshot'] as string | null;

    if (!snapshotJson) {
      throw new Error(`No pre-merge snapshot available for audit ${mergeAuditId}`);
    }

    const snapshot = JSON.parse(snapshotJson) as EntitySnapshot;
    const now = Date.now();

    const doUnmerge = this.db.transaction(() => {
      // Restore the loser entity
      this.db
        .prepare(
          `UPDATE entities SET
             canonical_name = ?,
             name_alt = ?,
             aliases = ?,
             attributes = ?,
             confidence = ?,
             status = 'active',
             merged_into = NULL,
             first_seen_at = ?,
             last_seen_at = ?,
             updated_at = ?
           WHERE id = ?`,
        )
        .run(
          snapshot.canonicalName,
          snapshot.nameAlt,
          JSON.stringify(snapshot.aliases),
          JSON.stringify(snapshot.attributes),
          snapshot.confidence,
          snapshot.firstSeenAt,
          snapshot.lastSeenAt,
          now,
          loserId,
        );

      // Re-point relationships that were redirected to winner back to loser.
      // We use source_item_ids stored on each relationship to identify which
      // relationships "belonged" to the loser. Since we cannot know this precisely
      // after the fact, we restore based on entity_episodes: any episode pointing
      // to the winner that originally was the loser's gets flipped back.
      //
      // Simpler safe approach: restore episodes for loser's original raw items,
      // then re-point relationships that exclusively involve those items' entities.
      //
      // This implementation restores episodes for known loser raw items via
      // snapshot, then does a best-effort relationship re-point.
      if (snapshot.episodeRawItemIds.length > 0) {
        const placeholders = snapshot.episodeRawItemIds.map(() => '?').join(', ');

        // Restore entity_episodes
        this.db
          .prepare(
            `UPDATE entity_episodes
             SET entity_id = ?
             WHERE raw_item_id IN (${placeholders}) AND entity_id = ?`,
          )
          .run(loserId, ...snapshot.episodeRawItemIds, winnerId);

        // Re-point relationships: for each restored episode's raw_item,
        // flip relationships whose source_item_ids contain those items and
        // currently point to winner, back to loser. This is a best-effort heuristic.
        for (const itemId of snapshot.episodeRawItemIds) {
          this.db
            .prepare(
              `UPDATE relationships
               SET from_entity_id = ?
               WHERE from_entity_id = ?
                 AND (source_item_ids LIKE ?)`,
            )
            .run(loserId, winnerId, `%"${itemId}"%`);

          this.db
            .prepare(
              `UPDATE relationships
               SET to_entity_id = ?
               WHERE to_entity_id = ?
                 AND (source_item_ids LIKE ?)`,
            )
            .run(loserId, winnerId, `%"${itemId}"%`);
        }
      }

      // Restore aliases that belong to the loser
      if (snapshot.aliasIds.length > 0) {
        const placeholders = snapshot.aliasIds.map(() => '?').join(', ');
        this.db
          .prepare(
            `UPDATE entity_aliases SET entity_id = ? WHERE id IN (${placeholders})`,
          )
          .run(loserId, ...snapshot.aliasIds);
      }

      // Mark audit as undone
      this.mergeAuditRepo.markUndone(mergeAuditId, now);
    });

    doUnmerge();
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private buildSnapshot(entity: Entity): EntitySnapshot {
    // Capture episode raw item IDs for this entity
    const episodeRows = this.db
      .prepare('SELECT raw_item_id FROM entity_episodes WHERE entity_id = ?')
      .all(entity.id) as Array<{ raw_item_id: string }>;

    // Capture alias IDs for this entity
    const aliasRows = this.db
      .prepare('SELECT id FROM entity_aliases WHERE entity_id = ?')
      .all(entity.id) as Array<{ id: string }>;

    return {
      id: entity.id,
      type: entity.type,
      canonicalName: entity.canonicalName,
      nameAlt: entity.nameAlt,
      aliases: entity.aliases,
      attributes: entity.attributes,
      confidence: entity.confidence,
      status: entity.status,
      firstSeenAt: entity.firstSeenAt,
      lastSeenAt: entity.lastSeenAt,
      episodeRawItemIds: episodeRows.map((r) => r.raw_item_id),
      aliasIds: aliasRows.map((r) => r.id),
    };
  }
}

// ----------------------------------------------------------------------------
// Internal snapshot type (stored in merge_audit.pre_merge_snapshot)
// ----------------------------------------------------------------------------

interface EntitySnapshot {
  id: string;
  type: string;
  canonicalName: string;
  nameAlt: string | null;
  aliases: string[];
  attributes: Record<string, unknown>;
  confidence: number;
  status: string;
  firstSeenAt: number;
  lastSeenAt: number;
  episodeRawItemIds: string[];
  aliasIds: string[];
}
