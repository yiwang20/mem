// ============================================================================
// UserCorrectionManager — applies user corrections to the knowledge graph
// ============================================================================

import type { EventBus } from '../core/events.js';
import type {
  EntityRepository,
  EntityAliasRepository,
  MergeAuditRepository,
  UserCorrectionRepository,
} from '../storage/repositories.js';
import {
  CorrectionType,
  EntityStatus,
  EntityType,
  MergeMethod,
} from '../types/index.js';
import type { UserCorrection } from '../types/index.js';
import { EntityMerger } from './merger.js';
import { ulid } from '../utils/ulid.js';
import type Database from 'better-sqlite3';

export interface RenamePayload {
  canonicalName?: string;
  nameAlt?: string | null;
}

export interface MergePayload {
  /** The entity to keep (winner). */
  survivingEntityId: string;
  /** The entity to absorb (loser). */
  mergedEntityId: string;
}

export interface SplitPayload {
  /** The entity that was previously merged into another. */
  mergedEntityId: string;
}

export interface AttributeUpdatePayload {
  attributes: Record<string, unknown>;
}

export class UserCorrectionManager {
  private readonly merger: EntityMerger;

  constructor(
    private readonly db: Database.Database,
    private readonly entityRepo: EntityRepository,
    private readonly aliasRepo: EntityAliasRepository,
    private readonly mergeAuditRepo: MergeAuditRepository,
    private readonly correctionRepo: UserCorrectionRepository,
    private readonly eventBus: EventBus,
  ) {
    this.merger = new EntityMerger(db, entityRepo, aliasRepo, mergeAuditRepo);
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Rename an entity (topic_rename correction type, also used for any entity).
   * Updates canonicalName and/or nameAlt, then records the correction.
   */
  rename(entityId: string, payload: RenamePayload): void {
    const entity = this._requireActive(entityId);

    const now = Date.now();
    const updated = {
      ...entity,
      canonicalName: payload.canonicalName ?? entity.canonicalName,
      nameAlt: payload.nameAlt !== undefined ? payload.nameAlt : entity.nameAlt,
      updatedAt: now,
    };

    this.entityRepo.update(updated);

    this._record({
      correctionType: entity.type === EntityType.Topic
        ? CorrectionType.TopicRename
        : CorrectionType.EntityUpdate,
      targetEntityId: entityId,
      correctionData: {
        previousName: entity.canonicalName,
        previousNameAlt: entity.nameAlt,
        ...payload,
      },
    });

    this.eventBus.emit('entity:updated', { entity: updated });
  }

  /**
   * Merge two entities (entity_merge or topic_merge correction).
   * The surviving entity absorbs the merged entity.
   */
  merge(survivingId: string, mergedId: string): string {
    const surviving = this._requireActive(survivingId);
    const merged = this.entityRepo.findById(mergedId);
    if (!merged) throw new Error(`Entity not found: ${mergedId}`);
    if (merged.status === EntityStatus.Merged) {
      throw new Error(`Entity ${mergedId} is already merged`);
    }

    const auditId = this.merger.merge(
      survivingId,
      mergedId,
      MergeMethod.UserManual,
      1.0,
      'user',
    );

    const correctionType =
      surviving.type === EntityType.Topic && merged.type === EntityType.Topic
        ? CorrectionType.TopicMerge
        : CorrectionType.EntityMerge;

    this._record({
      correctionType,
      targetEntityId: survivingId,
      correctionData: { survivingEntityId: survivingId, mergedEntityId: mergedId, auditId },
    });

    const updatedSurviving = this.entityRepo.findById(survivingId);
    if (updatedSurviving) {
      this.eventBus.emit('entity:updated', { entity: updatedSurviving });
    }
    this.eventBus.emit('entity:merged', { survivingId, mergedId });

    return auditId;
  }

  /**
   * Undo the most recent un-undone merge for the given entity (entity_split).
   * `entityId` should be the entity that was merged INTO another (the loser).
   */
  split(entityId: string): void {
    // Find the most recent undone=null audit record for this entity as the loser
    const auditRows = this.db
      .prepare(
        `SELECT id FROM merge_audit
         WHERE merged_entity_id = ?
           AND undone_at IS NULL
         ORDER BY merged_at DESC
         LIMIT 1`,
      )
      .all(entityId) as Array<{ id: string }>;

    if (auditRows.length === 0) {
      throw new Error(`No undoable merge found for entity: ${entityId}`);
    }

    const auditId = auditRows[0]!.id;
    this.merger.unmerge(auditId);

    this._record({
      correctionType: CorrectionType.EntitySplit,
      targetEntityId: entityId,
      correctionData: { auditId },
    });

    const restored = this.entityRepo.findById(entityId);
    if (restored) {
      this.eventBus.emit('entity:updated', { entity: restored });
    }
  }

  /**
   * Update entity attributes (entity_update correction type).
   * Merges the provided attributes into the entity's existing attributes.
   */
  updateAttributes(entityId: string, payload: AttributeUpdatePayload): void {
    const entity = this._requireActive(entityId);
    const now = Date.now();

    const updated = {
      ...entity,
      attributes: { ...entity.attributes, ...payload.attributes },
      updatedAt: now,
    };

    this.entityRepo.update(updated);

    this._record({
      correctionType: CorrectionType.EntityUpdate,
      targetEntityId: entityId,
      correctionData: { previousAttributes: entity.attributes, newAttributes: payload.attributes },
    });

    this.eventBus.emit('entity:updated', { entity: updated });
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private _requireActive(entityId: string) {
    const entity = this.entityRepo.findById(entityId);
    if (!entity) throw new Error(`Entity not found: ${entityId}`);
    if (entity.status === EntityStatus.Merged) {
      throw new Error(`Entity ${entityId} is merged and cannot be modified directly`);
    }
    return entity;
  }

  private _record(
    opts: Omit<UserCorrection, 'id' | 'createdAt'>,
  ): void {
    this.correctionRepo.insert({
      id: ulid(),
      createdAt: Date.now(),
      ...opts,
    });
  }
}
