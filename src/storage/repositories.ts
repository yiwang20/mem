import type Database from 'better-sqlite3';
import type {
  AttentionItem,
  AttentionItemType,
  Community,
  Entity,
  EntityAlias,
  EntityEpisode,
  EntityStatus,
  EntityType,
  GraphEdge,
  GraphNode,
  Job,
  JobStage,
  JobStatus,
  MergeAuditRecord,
  RawItem,
  Relationship,
  RelationshipType,
  ResolutionType,
  SourceAdapterType,
  SyncState,
  Thread,
  UserCorrection,
} from '../types/index.js';

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Sanitize a user-supplied string for use as an FTS5 MATCH query.
 * Wraps the input in double-quotes to force phrase matching, escaping any
 * embedded double-quotes. This prevents FTS5 from interpreting hyphens as
 * NOT operators or reserved words (AND, OR, NOT) as boolean operators.
 */
function sanitizeFts5Query(query: string): string {
  const escaped = query.replace(/"/g, '""');
  return `"${escaped}"`;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toJson(value: unknown): string {
  return JSON.stringify(value);
}

// ----------------------------------------------------------------------------
// Row → Domain type mappers
// ----------------------------------------------------------------------------

function rowToRawItem(row: Record<string, unknown>): RawItem {
  return {
    id: row['id'] as string,
    sourceAdapter: row['source_adapter'] as RawItem['sourceAdapter'],
    channel: row['channel'] as RawItem['channel'],
    externalId: row['external_id'] as string,
    threadId: (row['thread_id'] as string | null) ?? null,
    senderEntityId: (row['sender_entity_id'] as string | null) ?? null,
    recipientEntityIds: parseJson<string[]>(
      row['recipient_entity_ids'] as string | null,
      [],
    ),
    subject: (row['subject'] as string | null) ?? null,
    body: row['body'] as string,
    bodyFormat: row['body_format'] as RawItem['bodyFormat'],
    contentHash: row['content_hash'] as string,
    language: (row['language'] as RawItem['language']) ?? null,
    eventTime: row['event_time'] as number,
    ingestedAt: row['ingested_at'] as number,
    processingStatus: row['processing_status'] as RawItem['processingStatus'],
    attachments: parseJson(row['attachments'] as string | null, []),
    metadata: parseJson(row['metadata'] as string | null, {}),
  };
}

function rowToEntity(row: Record<string, unknown>): Entity {
  return {
    id: row['id'] as string,
    type: row['type'] as EntityType,
    canonicalName: row['canonical_name'] as string,
    nameAlt: (row['name_alt'] as string | null) ?? null,
    aliases: parseJson<string[]>(row['aliases'] as string | null, []),
    attributes: parseJson(row['attributes'] as string | null, {}),
    confidence: row['confidence'] as number,
    status: row['status'] as EntityStatus,
    mergedInto: (row['merged_into'] as string | null) ?? null,
    parentEntityId: (row['parent_entity_id'] as string | null) ?? null,
    firstSeenAt: row['first_seen_at'] as number,
    lastSeenAt: row['last_seen_at'] as number,
    createdAt: row['created_at'] as number,
    updatedAt: row['updated_at'] as number,
  };
}

function rowToRelationship(row: Record<string, unknown>): Relationship {
  return {
    id: row['id'] as string,
    fromEntityId: row['from_entity_id'] as string,
    toEntityId: row['to_entity_id'] as string,
    type: row['type'] as RelationshipType,
    strength: row['strength'] as number,
    eventTime: (row['event_time'] as number | null) ?? null,
    ingestionTime: row['ingestion_time'] as number,
    validFrom: (row['valid_from'] as number | null) ?? null,
    validUntil: (row['valid_until'] as number | null) ?? null,
    occurrenceCount: row['occurrence_count'] as number,
    sourceItemIds: parseJson<string[]>(
      row['source_item_ids'] as string | null,
      [],
    ),
    metadata: parseJson(row['metadata'] as string | null, {}),
  };
}

function rowToThread(row: Record<string, unknown>): Thread {
  return {
    id: row['id'] as string,
    sourceAdapter: row['source_adapter'] as SourceAdapterType,
    channel: row['channel'] as Thread['channel'],
    externalThreadId: (row['external_thread_id'] as string | null) ?? null,
    subject: (row['subject'] as string | null) ?? null,
    participantEntityIds: parseJson<string[]>(
      row['participant_entity_ids'] as string | null,
      [],
    ),
    firstMessageAt: row['first_message_at'] as number,
    lastMessageAt: row['last_message_at'] as number,
    messageCount: row['message_count'] as number,
    summary: (row['summary'] as string | null) ?? null,
    status: row['status'] as string,
  };
}

function rowToAttentionItem(row: Record<string, unknown>): AttentionItem {
  return {
    id: row['id'] as string,
    type: row['type'] as AttentionItemType,
    entityId: (row['entity_id'] as string | null) ?? null,
    rawItemId: (row['raw_item_id'] as string | null) ?? null,
    urgencyScore: row['urgency_score'] as number,
    title: row['title'] as string,
    description: (row['description'] as string | null) ?? null,
    detectedAt: row['detected_at'] as number,
    resolvedAt: (row['resolved_at'] as number | null) ?? null,
    dismissedAt: (row['dismissed_at'] as number | null) ?? null,
    snoozedUntil: (row['snoozed_until'] as number | null) ?? null,
    resolutionType:
      (row['resolution_type'] as ResolutionType | null) ?? null,
  };
}

function rowToJob(row: Record<string, unknown>): Job {
  return {
    id: row['id'] as string,
    rawItemId: row['raw_item_id'] as string,
    stage: row['stage'] as JobStage,
    status: row['status'] as JobStatus,
    priority: row['priority'] as number,
    attempts: row['attempts'] as number,
    maxAttempts: row['max_attempts'] as number,
    lastError: (row['last_error'] as string | null) ?? null,
    createdAt: row['created_at'] as number,
    startedAt: (row['started_at'] as number | null) ?? null,
    completedAt: (row['completed_at'] as number | null) ?? null,
  };
}

function rowToSyncState(row: Record<string, unknown>): SyncState {
  return {
    sourceAdapter: row['source_adapter'] as SourceAdapterType,
    lastCheckpoint: parseJson(row['last_checkpoint'] as string | null, {}),
    lastSyncAt: row['last_sync_at'] as number,
    itemsProcessed: row['items_processed'] as number,
    status: row['status'] as string,
    errorMessage: (row['error_message'] as string | null) ?? null,
    config: parseJson(row['config'] as string | null, {}),
  };
}

// ----------------------------------------------------------------------------
// RawItemRepository
// ----------------------------------------------------------------------------

export class RawItemRepository {
  private readonly stmtInsert: Database.Statement;
  private readonly stmtFindByHash: Database.Statement;
  private readonly stmtFindById: Database.Statement;
  private readonly stmtFindByThread: Database.Statement;
  private readonly stmtUpdateStatus: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.stmtInsert = db.prepare(`
      INSERT INTO raw_items (
        id, source_adapter, channel, external_id, thread_id,
        sender_entity_id, recipient_entity_ids, subject, body, body_format,
        content_hash, language, event_time, ingested_at, processing_status,
        attachments, metadata
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?
      )
    `);

    this.stmtFindByHash = db.prepare(
      'SELECT * FROM raw_items WHERE content_hash = ?',
    );

    this.stmtFindById = db.prepare(
      'SELECT * FROM raw_items WHERE id = ?',
    );

    this.stmtFindByThread = db.prepare(
      'SELECT * FROM raw_items WHERE thread_id = ? ORDER BY event_time ASC',
    );

    this.stmtUpdateStatus = db.prepare(
      'UPDATE raw_items SET processing_status = ? WHERE id = ?',
    );
  }

  insert(item: RawItem): void {
    this.stmtInsert.run(
      item.id,
      item.sourceAdapter,
      item.channel,
      item.externalId,
      item.threadId,
      item.senderEntityId,
      toJson(item.recipientEntityIds),
      item.subject,
      item.body,
      item.bodyFormat,
      item.contentHash,
      item.language,
      item.eventTime,
      item.ingestedAt,
      item.processingStatus,
      toJson(item.attachments),
      toJson(item.metadata),
    );
  }

  findByHash(hash: string): RawItem | undefined {
    const row = this.stmtFindByHash.get(hash) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToRawItem(row) : undefined;
  }

  findById(id: string): RawItem | undefined {
    const row = this.stmtFindById.get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToRawItem(row) : undefined;
  }

  findByThread(threadId: string): RawItem[] {
    return (
      this.stmtFindByThread.all(threadId) as Array<Record<string, unknown>>
    ).map(rowToRawItem);
  }

  updateStatus(id: string, status: RawItem['processingStatus']): void {
    this.stmtUpdateStatus.run(status, id);
  }

  deleteById(id: string): void {
    this.db.prepare('DELETE FROM jobs WHERE raw_item_id = ?').run(id);
    this.db.prepare('DELETE FROM raw_items WHERE id = ?').run(id);
  }

  search(query: string, limit = 20): RawItem[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT ri.*
           FROM raw_items_fts fts
           JOIN raw_items ri ON ri.rowid = fts.rowid
           WHERE raw_items_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(sanitizeFts5Query(query), limit) as Array<Record<string, unknown>>;
      return rows.map(rowToRawItem);
    } catch {
      return [];
    }
  }
}

// ----------------------------------------------------------------------------
// EntityRepository
// ----------------------------------------------------------------------------

export class EntityRepository {
  private readonly stmtInsert: Database.Statement;
  private readonly stmtUpdate: Database.Statement;
  private readonly stmtFindById: Database.Statement;
  private readonly stmtFindByType: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.stmtInsert = db.prepare(`
      INSERT INTO entities (
        id, type, canonical_name, name_alt, aliases, attributes,
        confidence, status, merged_into, parent_entity_id,
        first_seen_at, last_seen_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtUpdate = db.prepare(`
      UPDATE entities SET
        canonical_name = ?,
        name_alt = ?,
        aliases = ?,
        attributes = ?,
        confidence = ?,
        status = ?,
        merged_into = ?,
        parent_entity_id = ?,
        last_seen_at = ?,
        updated_at = ?
      WHERE id = ?
    `);

    this.stmtFindById = db.prepare('SELECT * FROM entities WHERE id = ?');

    this.stmtFindByType = db.prepare(
      `SELECT * FROM entities WHERE type = ? AND status != 'merged' ORDER BY last_seen_at DESC`,
    );
  }

  insert(entity: Entity): void {
    this.stmtInsert.run(
      entity.id,
      entity.type,
      entity.canonicalName,
      entity.nameAlt,
      toJson(entity.aliases),
      toJson(entity.attributes),
      entity.confidence,
      entity.status,
      entity.mergedInto,
      entity.parentEntityId ?? null,
      entity.firstSeenAt,
      entity.lastSeenAt,
      entity.createdAt,
      entity.updatedAt,
    );
  }

  update(entity: Entity): void {
    this.stmtUpdate.run(
      entity.canonicalName,
      entity.nameAlt,
      toJson(entity.aliases),
      toJson(entity.attributes),
      entity.confidence,
      entity.status,
      entity.mergedInto,
      entity.parentEntityId ?? null,
      entity.lastSeenAt,
      entity.updatedAt,
      entity.id,
    );
  }

  findById(id: string): Entity | undefined {
    const row = this.stmtFindById.get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToEntity(row) : undefined;
  }

  findByType(type: EntityType): Entity[] {
    return (
      this.stmtFindByType.all(type) as Array<Record<string, unknown>>
    ).map(rowToEntity);
  }

  findByAlias(alias: string): Entity[] {
    const rows = this.db
      .prepare(
        `SELECT e.*
         FROM entity_aliases ea
         JOIN entities e ON e.id = ea.entity_id
         WHERE ea.alias = ? COLLATE NOCASE
           AND e.status != 'merged'`,
      )
      .all(alias) as Array<Record<string, unknown>>;
    return rows.map(rowToEntity);
  }

  search(query: string, limit = 20): Entity[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT e.*
           FROM entities_fts fts
           JOIN entities e ON e.rowid = fts.rowid
           WHERE entities_fts MATCH ?
             AND e.status != 'merged'
           ORDER BY rank
           LIMIT ?`,
        )
        .all(sanitizeFts5Query(query), limit) as Array<Record<string, unknown>>;
      return rows.map(rowToEntity);
    } catch {
      return [];
    }
  }

  /**
   * Merge survivedBy into survivingId: marks merged entity, re-points all
   * relationships and episodes to the surviving entity.
   */
  merge(
    survivingId: string,
    mergedId: string,
    now: number,
  ): void {
    const doMerge = this.db.transaction(() => {
      // Mark merged entity
      this.db
        .prepare(
          `UPDATE entities SET status = 'merged', merged_into = ?, updated_at = ? WHERE id = ?`,
        )
        .run(survivingId, now, mergedId);

      // Re-point outgoing relationships from merged entity
      this.db
        .prepare(
          `UPDATE relationships SET from_entity_id = ? WHERE from_entity_id = ?`,
        )
        .run(survivingId, mergedId);

      // Re-point incoming relationships to merged entity
      this.db
        .prepare(
          `UPDATE relationships SET to_entity_id = ? WHERE to_entity_id = ?`,
        )
        .run(survivingId, mergedId);

      // Re-point entity episodes
      this.db
        .prepare(
          `UPDATE OR IGNORE entity_episodes SET entity_id = ? WHERE entity_id = ?`,
        )
        .run(survivingId, mergedId);

      // Update surviving entity's last_seen_at and updated_at
      this.db
        .prepare(
          `UPDATE entities SET last_seen_at = MAX(last_seen_at, ?), updated_at = ? WHERE id = ?`,
        )
        .run(now, now, survivingId);
    });

    doMerge();
  }

  /**
   * Undo a merge by restoring the merged entity to active status.
   * Callers are responsible for re-linking relationships if needed.
   */
  unmerge(mergedId: string, now: number): void {
    this.db
      .prepare(
        `UPDATE entities SET status = 'active', merged_into = NULL, updated_at = ? WHERE id = ?`,
      )
      .run(now, mergedId);
  }
}

// ----------------------------------------------------------------------------
// RelationshipRepository
// ----------------------------------------------------------------------------

export class RelationshipRepository {
  private readonly stmtInsert: Database.Statement;
  private readonly stmtFindByFromEntity: Database.Statement;
  private readonly stmtFindByToEntity: Database.Statement;
  private readonly stmtFindBetween: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.stmtInsert = db.prepare(`
      INSERT INTO relationships (
        id, from_entity_id, to_entity_id, type, strength,
        event_time, ingestion_time, valid_from, valid_until,
        occurrence_count, source_item_ids, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtFindByFromEntity = db.prepare(
      `SELECT * FROM relationships WHERE from_entity_id = ? AND valid_until IS NULL ORDER BY strength DESC`,
    );

    this.stmtFindByToEntity = db.prepare(
      `SELECT * FROM relationships WHERE to_entity_id = ? AND valid_until IS NULL ORDER BY strength DESC`,
    );

    this.stmtFindBetween = db.prepare(
      `SELECT * FROM relationships
       WHERE from_entity_id = ? AND to_entity_id = ?
       ORDER BY ingestion_time DESC`,
    );
  }

  insert(rel: Relationship): void {
    this.stmtInsert.run(
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
      toJson(rel.sourceItemIds),
      toJson(rel.metadata),
    );
  }

  findByEntity(entityId: string): Relationship[] {
    const outgoing = this.stmtFindByFromEntity.all(entityId) as Array<
      Record<string, unknown>
    >;
    const incoming = this.stmtFindByToEntity.all(entityId) as Array<
      Record<string, unknown>
    >;
    return [...outgoing, ...incoming].map(rowToRelationship);
  }

  findBetween(fromId: string, toId: string): Relationship[] {
    return (
      this.stmtFindBetween.all(fromId, toId) as Array<
        Record<string, unknown>
      >
    ).map(rowToRelationship);
  }

  /**
   * Returns a subgraph centered on startId up to maxDepth hops.
   * Returns nodes and edges as GraphNode / GraphEdge arrays.
   */
  getGraph(
    startId: string,
    maxDepth = 2,
    limit = 50,
  ): { nodes: GraphNode[]; edges: GraphEdge[] } {
    // Collect edge rows via recursive CTE
    const edgeRows = this.db
      .prepare(
        `WITH RECURSIVE traversal(from_id, to_id, rel_id, depth) AS (
          SELECT from_entity_id, to_entity_id, id, 1
          FROM relationships
          WHERE from_entity_id = ? AND valid_until IS NULL
          UNION ALL
          SELECT r.from_entity_id, r.to_entity_id, r.id, t.depth + 1
          FROM relationships r
          JOIN traversal t ON r.from_entity_id = t.to_id
          WHERE t.depth < ? AND r.valid_until IS NULL
        )
        SELECT DISTINCT r.*
        FROM traversal tr
        JOIN relationships r ON r.id = tr.rel_id
        LIMIT ?`,
      )
      .all(startId, maxDepth, limit) as Array<Record<string, unknown>>;

    const relationships = edgeRows.map(rowToRelationship);

    // Collect unique entity IDs
    const entityIds = new Set<string>([startId]);
    for (const r of relationships) {
      entityIds.add(r.fromEntityId);
      entityIds.add(r.toEntityId);
    }

    // Fetch entity rows
    const placeholders = Array.from(entityIds)
      .map(() => '?')
      .join(',');
    const entityRows = this.db
      .prepare(
        `SELECT * FROM entities WHERE id IN (${placeholders}) AND status = 'active'`,
      )
      .all(...Array.from(entityIds)) as Array<Record<string, unknown>>;

    const nodes: GraphNode[] = entityRows.map((row) => {
      const e = rowToEntity(row);
      return {
        id: e.id,
        type: e.type,
        label: e.canonicalName,
        attributes: e.attributes,
      };
    });

    const edges: GraphEdge[] = relationships.map((r) => ({
      id: r.id,
      source: r.fromEntityId,
      target: r.toEntityId,
      type: r.type,
      strength: r.strength,
    }));

    return { nodes, edges };
  }
}

// ----------------------------------------------------------------------------
// ThreadRepository
// ----------------------------------------------------------------------------

export class ThreadRepository {
  private readonly stmtInsert: Database.Statement;
  private readonly stmtUpdate: Database.Statement;
  private readonly stmtFindById: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.stmtInsert = db.prepare(`
      INSERT INTO threads (
        id, source_adapter, channel, external_thread_id, subject,
        participant_entity_ids, first_message_at, last_message_at,
        message_count, summary, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtUpdate = db.prepare(`
      UPDATE threads SET
        subject = ?,
        participant_entity_ids = ?,
        last_message_at = ?,
        message_count = ?,
        summary = ?,
        status = ?
      WHERE id = ?
    `);

    this.stmtFindById = db.prepare('SELECT * FROM threads WHERE id = ?');
  }

  insert(thread: Thread): void {
    this.stmtInsert.run(
      thread.id,
      thread.sourceAdapter,
      thread.channel,
      thread.externalThreadId,
      thread.subject,
      toJson(thread.participantEntityIds),
      thread.firstMessageAt,
      thread.lastMessageAt,
      thread.messageCount,
      thread.summary,
      thread.status,
    );
  }

  update(thread: Thread): void {
    this.stmtUpdate.run(
      thread.subject,
      toJson(thread.participantEntityIds),
      thread.lastMessageAt,
      thread.messageCount,
      thread.summary,
      thread.status,
      thread.id,
    );
  }

  findById(id: string): Thread | undefined {
    const row = this.stmtFindById.get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToThread(row) : undefined;
  }

  findByParticipant(entityId: string): Thread[] {
    // participant_entity_ids is a JSON array; use json_each for exact matching
    const rows = this.db
      .prepare(
        `SELECT t.*
         FROM threads t, json_each(t.participant_entity_ids) pe
         WHERE pe.value = ?
         ORDER BY t.last_message_at DESC`,
      )
      .all(entityId) as Array<Record<string, unknown>>;
    return rows.map(rowToThread);
  }
}

// ----------------------------------------------------------------------------
// AttentionItemRepository
// ----------------------------------------------------------------------------

export class AttentionItemRepository {
  private readonly stmtInsert: Database.Statement;
  private readonly stmtFindPending: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.stmtInsert = db.prepare(`
      INSERT INTO attention_items (
        id, type, entity_id, raw_item_id, urgency_score, title, description,
        detected_at, resolved_at, dismissed_at, snoozed_until, resolution_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtFindPending = db.prepare(
      `SELECT * FROM attention_items
       WHERE resolved_at IS NULL
         AND dismissed_at IS NULL
         AND (snoozed_until IS NULL OR snoozed_until < ?)
       ORDER BY urgency_score DESC`,
    );
  }

  insert(item: AttentionItem): void {
    this.stmtInsert.run(
      item.id,
      item.type,
      item.entityId,
      item.rawItemId,
      item.urgencyScore,
      item.title,
      item.description,
      item.detectedAt,
      item.resolvedAt,
      item.dismissedAt,
      item.snoozedUntil,
      item.resolutionType,
    );
  }

  findPending(now = Date.now()): AttentionItem[] {
    return (
      this.stmtFindPending.all(now) as Array<Record<string, unknown>>
    ).map(rowToAttentionItem);
  }

  dismiss(id: string, now = Date.now()): void {
    this.db
      .prepare(
        `UPDATE attention_items SET dismissed_at = ?, resolution_type = 'dismissed' WHERE id = ?`,
      )
      .run(now, id);
  }

  resolve(id: string, resolutionType: ResolutionType, now = Date.now()): void {
    this.db
      .prepare(
        `UPDATE attention_items SET resolved_at = ?, resolution_type = ? WHERE id = ?`,
      )
      .run(now, resolutionType, id);
  }

  snooze(id: string, until: number): void {
    this.db
      .prepare(`UPDATE attention_items SET snoozed_until = ? WHERE id = ?`)
      .run(until, id);
  }
}

// ----------------------------------------------------------------------------
// JobQueueRepository
// ----------------------------------------------------------------------------

export class JobQueueRepository {
  private readonly stmtEnqueue: Database.Statement;
  private readonly stmtGetPendingCount: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.stmtEnqueue = db.prepare(`
      INSERT INTO job_queue (
        id, raw_item_id, stage, status, priority, attempts, max_attempts,
        last_error, created_at, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtGetPendingCount = db.prepare(
      `SELECT COUNT(*) as count FROM job_queue WHERE status IN ('pending', 'failed')`,
    );
  }

  enqueue(job: Job): void {
    this.stmtEnqueue.run(
      job.id,
      job.rawItemId,
      job.stage,
      job.status,
      job.priority,
      job.attempts,
      job.maxAttempts,
      job.lastError,
      job.createdAt,
      job.startedAt,
      job.completedAt,
    );
  }

  /**
   * Atomically dequeue the highest-priority pending job for a given stage.
   * Returns the job with status set to 'processing', or undefined if none available.
   */
  dequeue(stage: JobStage, now = Date.now()): Job | undefined {
    let result: Job | undefined;

    const doDequeue = this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT * FROM job_queue
           WHERE stage = ? AND status IN ('pending', 'failed') AND attempts < max_attempts
           ORDER BY priority DESC, created_at ASC
           LIMIT 1`,
        )
        .get(stage) as Record<string, unknown> | undefined;

      if (!row) return;

      this.db
        .prepare(
          `UPDATE job_queue SET status = 'processing', started_at = ?, attempts = attempts + 1 WHERE id = ?`,
        )
        .run(now, row['id']);

      result = rowToJob({
        ...row,
        status: 'processing',
        started_at: now,
        attempts: (row['attempts'] as number) + 1,
      });
    });

    doDequeue();
    return result;
  }

  complete(id: string, now = Date.now()): void {
    this.db
      .prepare(
        `UPDATE job_queue SET status = 'completed', completed_at = ? WHERE id = ?`,
      )
      .run(now, id);
  }

  fail(id: string, error: string, now = Date.now()): void {
    this.db
      .prepare(
        `UPDATE job_queue
         SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
             last_error = ?
         WHERE id = ?`,
      )
      .run(error, id);

    // Record the failure timestamp for retry ordering
    this.db
      .prepare(`UPDATE job_queue SET completed_at = ? WHERE id = ? AND status = 'failed'`)
      .run(now, id);
  }

  retry(id: string): void {
    this.db
      .prepare(
        `UPDATE job_queue SET status = 'pending', last_error = NULL WHERE id = ?`,
      )
      .run(id);
  }

  getPendingCount(): number {
    const row = this.stmtGetPendingCount.get() as { count: number };
    return row.count;
  }

  getPendingCountByStage(stage: JobStage): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM job_queue WHERE stage = ? AND status IN ('pending', 'failed')`,
      )
      .get(stage) as { count: number };
    return row.count;
  }
}

// ----------------------------------------------------------------------------
// SyncStateRepository
// ----------------------------------------------------------------------------

export class SyncStateRepository {
  constructor(private readonly db: Database.Database) {}

  get(sourceAdapter: SourceAdapterType): SyncState | undefined {
    const row = this.db
      .prepare('SELECT * FROM sync_state WHERE source_adapter = ?')
      .get(sourceAdapter) as Record<string, unknown> | undefined;
    return row ? rowToSyncState(row) : undefined;
  }

  upsert(state: SyncState): void {
    this.db
      .prepare(
        `INSERT INTO sync_state (
           source_adapter, last_checkpoint, last_sync_at, items_processed,
           status, error_message, config
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_adapter) DO UPDATE SET
           last_checkpoint = excluded.last_checkpoint,
           last_sync_at = excluded.last_sync_at,
           items_processed = excluded.items_processed,
           status = excluded.status,
           error_message = excluded.error_message,
           config = excluded.config`,
      )
      .run(
        state.sourceAdapter,
        toJson(state.lastCheckpoint),
        state.lastSyncAt,
        state.itemsProcessed,
        state.status,
        state.errorMessage,
        toJson(state.config),
      );
  }
}

// ----------------------------------------------------------------------------
// EntityAliasRepository
// ----------------------------------------------------------------------------

export class EntityAliasRepository {
  private readonly stmtInsert: Database.Statement;
  private readonly stmtFindByEntity: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.stmtInsert = db.prepare(`
      INSERT OR IGNORE INTO entity_aliases (id, entity_id, alias, alias_type, confidence)
      VALUES (?, ?, ?, ?, ?)
    `);

    this.stmtFindByEntity = db.prepare(
      'SELECT * FROM entity_aliases WHERE entity_id = ?',
    );
  }

  insert(alias: EntityAlias): void {
    this.stmtInsert.run(
      alias.id,
      alias.entityId,
      alias.alias,
      alias.aliasType,
      alias.confidence,
    );
  }

  findByEntity(entityId: string): EntityAlias[] {
    return (
      this.stmtFindByEntity.all(entityId) as Array<Record<string, unknown>>
    ).map((row) => ({
      id: row['id'] as string,
      entityId: row['entity_id'] as string,
      alias: row['alias'] as string,
      aliasType: row['alias_type'] as EntityAlias['aliasType'],
      confidence: row['confidence'] as number,
    }));
  }
}

// ----------------------------------------------------------------------------
// EntityEpisodeRepository
// ----------------------------------------------------------------------------

export class EntityEpisodeRepository {
  private readonly stmtInsert: Database.Statement;
  private readonly stmtFindByEntity: Database.Statement;
  private readonly stmtFindByRawItem: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.stmtInsert = db.prepare(`
      INSERT OR IGNORE INTO entity_episodes (entity_id, raw_item_id, extraction_method, confidence)
      VALUES (?, ?, ?, ?)
    `);

    this.stmtFindByEntity = db.prepare(
      'SELECT * FROM entity_episodes WHERE entity_id = ?',
    );

    this.stmtFindByRawItem = db.prepare(
      'SELECT * FROM entity_episodes WHERE raw_item_id = ?',
    );
  }

  insert(episode: EntityEpisode): void {
    this.stmtInsert.run(
      episode.entityId,
      episode.rawItemId,
      episode.extractionMethod,
      episode.confidence,
    );
  }

  findByEntity(entityId: string): EntityEpisode[] {
    return (
      this.stmtFindByEntity.all(entityId) as Array<Record<string, unknown>>
    ).map((row) => ({
      entityId: row['entity_id'] as string,
      rawItemId: row['raw_item_id'] as string,
      extractionMethod: row['extraction_method'] as string,
      confidence: row['confidence'] as number,
    }));
  }

  findByRawItem(rawItemId: string): EntityEpisode[] {
    return (
      this.stmtFindByRawItem.all(rawItemId) as Array<Record<string, unknown>>
    ).map((row) => ({
      entityId: row['entity_id'] as string,
      rawItemId: row['raw_item_id'] as string,
      extractionMethod: row['extraction_method'] as string,
      confidence: row['confidence'] as number,
    }));
  }
}

// ----------------------------------------------------------------------------
// MergeAuditRepository
// ----------------------------------------------------------------------------

export class MergeAuditRepository {
  private readonly stmtInsert: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.stmtInsert = db.prepare(`
      INSERT INTO merge_audit (
        id, surviving_entity_id, merged_entity_id, merge_method,
        confidence, merged_at, merged_by, pre_merge_snapshot, undone_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  insert(record: MergeAuditRecord): void {
    this.stmtInsert.run(
      record.id,
      record.survivingEntityId,
      record.mergedEntityId,
      record.mergeMethod,
      record.confidence,
      record.mergedAt,
      record.mergedBy,
      record.preMergeSnapshot ? toJson(record.preMergeSnapshot) : null,
      record.undoneAt,
    );
  }

  findBySurvivingEntity(survivingEntityId: string): MergeAuditRecord[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM merge_audit WHERE surviving_entity_id = ? ORDER BY merged_at DESC',
        )
        .all(survivingEntityId) as Array<Record<string, unknown>>
    ).map((row) => ({
      id: row['id'] as string,
      survivingEntityId: row['surviving_entity_id'] as string,
      mergedEntityId: row['merged_entity_id'] as string,
      mergeMethod: row['merge_method'] as MergeAuditRecord['mergeMethod'],
      confidence: (row['confidence'] as number | null) ?? null,
      mergedAt: row['merged_at'] as number,
      mergedBy: row['merged_by'] as string,
      preMergeSnapshot: parseJson(
        row['pre_merge_snapshot'] as string | null,
        null,
      ),
      undoneAt: (row['undone_at'] as number | null) ?? null,
    }));
  }

  markUndone(id: string, now = Date.now()): void {
    this.db
      .prepare('UPDATE merge_audit SET undone_at = ? WHERE id = ?')
      .run(now, id);
  }
}

// ----------------------------------------------------------------------------
// UserCorrectionRepository
// ----------------------------------------------------------------------------

export class UserCorrectionRepository {
  private readonly stmtInsert: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.stmtInsert = db.prepare(`
      INSERT INTO user_corrections (id, correction_type, target_entity_id, correction_data, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
  }

  insert(correction: UserCorrection): void {
    this.stmtInsert.run(
      correction.id,
      correction.correctionType,
      correction.targetEntityId,
      toJson(correction.correctionData),
      correction.createdAt,
    );
  }

  findByEntity(entityId: string): UserCorrection[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM user_corrections WHERE target_entity_id = ? ORDER BY created_at DESC',
        )
        .all(entityId) as Array<Record<string, unknown>>
    ).map((row) => ({
      id: row['id'] as string,
      correctionType: row['correction_type'] as UserCorrection['correctionType'],
      targetEntityId: (row['target_entity_id'] as string | null) ?? null,
      correctionData: parseJson(row['correction_data'] as string | null, {}),
      createdAt: row['created_at'] as number,
    }));
  }
}
