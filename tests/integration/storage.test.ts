import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MindFlowDatabase } from '../../src/storage/database.js';
import {
  AttentionItemRepository,
  EntityAliasRepository,
  EntityEpisodeRepository,
  EntityRepository,
  JobQueueRepository,
  MergeAuditRepository,
  RawItemRepository,
  RelationshipRepository,
  SyncStateRepository,
  ThreadRepository,
} from '../../src/storage/repositories.js';
import {
  AliasType,
  AttentionItemType,
  BodyFormat,
  DetectedLanguage,
  EntityStatus,
  EntityType,
  JobStage,
  JobStatus,
  MergeMethod,
  ProcessingStatus,
  RelationshipType,
  ResolutionType,
  SourceAdapterType,
  SourceChannel,
} from '../../src/types/index.js';
import type {
  AttentionItem,
  Entity,
  Job,
  RawItem,
  Relationship,
  Thread,
} from '../../src/types/index.js';
import { ulid } from '../../src/utils/ulid.js';
import { sha256 } from '../../src/utils/hash.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  const now = Date.now();
  return {
    id: ulid(),
    type: EntityType.Person,
    canonicalName: 'Alice',
    nameAlt: null,
    aliases: ['alice@example.com'],
    attributes: { org: 'Acme' },
    confidence: 0.95,
    status: EntityStatus.Active,
    mergedInto: null,
    firstSeenAt: now,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeRawItem(overrides: Partial<RawItem> = {}): RawItem {
  const now = Date.now();
  const body = overrides.body ?? 'Hello world';
  return {
    id: ulid(),
    sourceAdapter: SourceAdapterType.Gmail,
    channel: SourceChannel.Email,
    externalId: `ext-${ulid()}`,
    threadId: null,
    senderEntityId: null,
    recipientEntityIds: [],
    subject: 'Test subject',
    body,
    bodyFormat: BodyFormat.Plaintext,
    contentHash: sha256(body + ulid()),
    language: DetectedLanguage.English,
    eventTime: now,
    ingestedAt: now,
    processingStatus: ProcessingStatus.Pending,
    attachments: [],
    metadata: {},
    ...overrides,
  };
}

function makeRelationship(
  fromId: string,
  toId: string,
  overrides: Partial<Relationship> = {},
): Relationship {
  return {
    id: ulid(),
    fromEntityId: fromId,
    toEntityId: toId,
    type: RelationshipType.Discusses,
    strength: 0.8,
    eventTime: Date.now(),
    ingestionTime: Date.now(),
    validFrom: null,
    validUntil: null,
    occurrenceCount: 1,
    sourceItemIds: [],
    metadata: {},
    ...overrides,
  };
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  const now = Date.now();
  return {
    id: ulid(),
    sourceAdapter: SourceAdapterType.Gmail,
    channel: SourceChannel.Email,
    externalThreadId: null,
    subject: 'Thread subject',
    participantEntityIds: [],
    firstMessageAt: now,
    lastMessageAt: now,
    messageCount: 1,
    summary: null,
    status: 'active',
    ...overrides,
  };
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: ulid(),
    rawItemId: ulid(),
    stage: JobStage.Triage,
    status: JobStatus.Pending,
    priority: 0.5,
    attempts: 0,
    maxAttempts: 3,
    lastError: null,
    createdAt: Date.now(),
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function makeAttentionItem(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: ulid(),
    type: AttentionItemType.UnansweredRequest,
    entityId: null,
    rawItemId: null,
    urgencyScore: 0.7,
    title: 'Follow up on request',
    description: null,
    detectedAt: Date.now(),
    resolvedAt: null,
    dismissedAt: null,
    snoozedUntil: null,
    resolutionType: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let mfdb: MindFlowDatabase;

beforeEach(() => {
  // Use in-memory SQLite for each test
  mfdb = new MindFlowDatabase(':memory:');
});

afterEach(() => {
  mfdb.close();
});

// ---------------------------------------------------------------------------
// RawItemRepository
// ---------------------------------------------------------------------------

describe('RawItemRepository', () => {
  it('inserts and retrieves by id', () => {
    const repo = new RawItemRepository(mfdb.db);
    const item = makeRawItem();
    repo.insert(item);

    const found = repo.findById(item.id);
    expect(found).toBeDefined();
    expect(found?.id).toBe(item.id);
    expect(found?.body).toBe(item.body);
    expect(found?.recipientEntityIds).toEqual([]);
    expect(found?.attachments).toEqual([]);
  });

  it('finds by content hash', () => {
    const repo = new RawItemRepository(mfdb.db);
    const item = makeRawItem();
    repo.insert(item);

    const found = repo.findByHash(item.contentHash);
    expect(found?.id).toBe(item.id);
  });

  it('returns undefined for unknown id', () => {
    const repo = new RawItemRepository(mfdb.db);
    expect(repo.findById('nonexistent')).toBeUndefined();
  });

  it('finds by thread id', () => {
    const repo = new RawItemRepository(mfdb.db);
    const threadId = ulid();
    const item1 = makeRawItem({ threadId });
    const item2 = makeRawItem({ threadId });
    const other = makeRawItem({ threadId: ulid() });
    repo.insert(item1);
    repo.insert(item2);
    repo.insert(other);

    const results = repo.findByThread(threadId);
    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.id);
    expect(ids).toContain(item1.id);
    expect(ids).toContain(item2.id);
  });

  it('updates processing status', () => {
    const repo = new RawItemRepository(mfdb.db);
    const item = makeRawItem();
    repo.insert(item);

    repo.updateStatus(item.id, ProcessingStatus.Done);

    const found = repo.findById(item.id);
    expect(found?.processingStatus).toBe(ProcessingStatus.Done);
  });

  it('FTS5 search returns matching items', () => {
    const repo = new RawItemRepository(mfdb.db);
    const item = makeRawItem({ body: 'quarterly budget review meeting' });
    const other = makeRawItem({ body: 'lunch plans tomorrow' });
    repo.insert(item);
    repo.insert(other);

    const results = repo.search('budget');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.id === item.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EntityRepository
// ---------------------------------------------------------------------------

describe('EntityRepository', () => {
  it('inserts and retrieves by id', () => {
    const repo = new EntityRepository(mfdb.db);
    const entity = makeEntity();
    repo.insert(entity);

    const found = repo.findById(entity.id);
    expect(found?.id).toBe(entity.id);
    expect(found?.canonicalName).toBe('Alice');
    expect(found?.aliases).toEqual(['alice@example.com']);
    expect(found?.attributes).toEqual({ org: 'Acme' });
  });

  it('updates entity fields', () => {
    const repo = new EntityRepository(mfdb.db);
    const entity = makeEntity();
    repo.insert(entity);

    const updated = { ...entity, canonicalName: 'Alice Smith', updatedAt: Date.now() };
    repo.update(updated);

    const found = repo.findById(entity.id);
    expect(found?.canonicalName).toBe('Alice Smith');
  });

  it('finds by type', () => {
    const repo = new EntityRepository(mfdb.db);
    const person = makeEntity({ type: EntityType.Person });
    const topic = makeEntity({ type: EntityType.Topic, canonicalName: 'Budget' });
    repo.insert(person);
    repo.insert(topic);

    const persons = repo.findByType(EntityType.Person);
    expect(persons.length).toBeGreaterThanOrEqual(1);
    expect(persons.every((e) => e.type === EntityType.Person)).toBe(true);
  });

  it('finds by alias via entity_aliases', () => {
    const repo = new EntityRepository(mfdb.db);
    const aliasRepo = new EntityAliasRepository(mfdb.db);
    const entity = makeEntity();
    repo.insert(entity);
    aliasRepo.insert({
      id: ulid(),
      entityId: entity.id,
      alias: 'alice@example.com',
      aliasType: AliasType.Email,
      confidence: 1.0,
    });

    const results = repo.findByAlias('alice@example.com');
    expect(results.some((e) => e.id === entity.id)).toBe(true);
  });

  it('FTS5 search returns matching entities', () => {
    const repo = new EntityRepository(mfdb.db);
    const entity = makeEntity({ canonicalName: 'Zhang Wei' });
    const other = makeEntity({ canonicalName: 'Bob Jones' });
    repo.insert(entity);
    repo.insert(other);

    const results = repo.search('Zhang');
    expect(results.some((e) => e.id === entity.id)).toBe(true);
  });

  it('merges entities: marks merged and re-points episodes', () => {
    const entityRepo = new EntityRepository(mfdb.db);
    const episodeRepo = new EntityEpisodeRepository(mfdb.db);
    const itemRepo = new RawItemRepository(mfdb.db);

    const alice = makeEntity({ canonicalName: 'Alice' });
    const aliceDup = makeEntity({ canonicalName: 'A. Smith' });
    const item = makeRawItem();

    entityRepo.insert(alice);
    entityRepo.insert(aliceDup);
    itemRepo.insert(item);
    episodeRepo.insert({
      entityId: aliceDup.id,
      rawItemId: item.id,
      extractionMethod: 'tier1_rules',
      confidence: 0.9,
    });

    entityRepo.merge(alice.id, aliceDup.id, Date.now());

    const merged = entityRepo.findById(aliceDup.id);
    expect(merged?.status).toBe(EntityStatus.Merged);
    expect(merged?.mergedInto).toBe(alice.id);
  });

  it('unmerge restores active status', () => {
    const repo = new EntityRepository(mfdb.db);
    const surviving = makeEntity();
    const merged = makeEntity();
    repo.insert(surviving);
    repo.insert(merged);
    repo.merge(surviving.id, merged.id, Date.now());

    repo.unmerge(merged.id, Date.now());

    const restored = repo.findById(merged.id);
    expect(restored?.status).toBe(EntityStatus.Active);
    expect(restored?.mergedInto).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RelationshipRepository
// ---------------------------------------------------------------------------

describe('RelationshipRepository', () => {
  it('inserts and finds by entity', () => {
    const entityRepo = new EntityRepository(mfdb.db);
    const relRepo = new RelationshipRepository(mfdb.db);

    const alice = makeEntity();
    const topic = makeEntity({ type: EntityType.Topic, canonicalName: 'Q3 Budget' });
    entityRepo.insert(alice);
    entityRepo.insert(topic);

    const rel = makeRelationship(alice.id, topic.id);
    relRepo.insert(rel);

    const rels = relRepo.findByEntity(alice.id);
    expect(rels.some((r) => r.id === rel.id)).toBe(true);
  });

  it('finds between two entities', () => {
    const entityRepo = new EntityRepository(mfdb.db);
    const relRepo = new RelationshipRepository(mfdb.db);

    const a = makeEntity();
    const b = makeEntity({ canonicalName: 'Bob' });
    entityRepo.insert(a);
    entityRepo.insert(b);

    const rel = makeRelationship(a.id, b.id);
    relRepo.insert(rel);

    const results = relRepo.findBetween(a.id, b.id);
    expect(results.some((r) => r.id === rel.id)).toBe(true);
  });

  it('getGraph returns nodes and edges for center node', () => {
    const entityRepo = new EntityRepository(mfdb.db);
    const relRepo = new RelationshipRepository(mfdb.db);

    const center = makeEntity({ canonicalName: 'Center' });
    const neighbor = makeEntity({ canonicalName: 'Neighbor' });
    entityRepo.insert(center);
    entityRepo.insert(neighbor);

    const rel = makeRelationship(center.id, neighbor.id);
    relRepo.insert(rel);

    const graph = relRepo.getGraph(center.id, 1);
    expect(graph.nodes.length).toBeGreaterThanOrEqual(1);
    expect(graph.edges.some((e) => e.id === rel.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ThreadRepository
// ---------------------------------------------------------------------------

describe('ThreadRepository', () => {
  it('inserts and retrieves by id', () => {
    const repo = new ThreadRepository(mfdb.db);
    const thread = makeThread();
    repo.insert(thread);

    const found = repo.findById(thread.id);
    expect(found?.id).toBe(thread.id);
    expect(found?.participantEntityIds).toEqual([]);
  });

  it('finds by participant', () => {
    const entityRepo = new EntityRepository(mfdb.db);
    const threadRepo = new ThreadRepository(mfdb.db);
    const alice = makeEntity();
    entityRepo.insert(alice);

    const thread = makeThread({ participantEntityIds: [alice.id] });
    threadRepo.insert(thread);

    const results = threadRepo.findByParticipant(alice.id);
    expect(results.some((t) => t.id === thread.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AttentionItemRepository
// ---------------------------------------------------------------------------

describe('AttentionItemRepository', () => {
  it('inserts and finds pending items', () => {
    const repo = new AttentionItemRepository(mfdb.db);
    const item = makeAttentionItem();
    repo.insert(item);

    const pending = repo.findPending();
    expect(pending.some((a) => a.id === item.id)).toBe(true);
  });

  it('dismiss removes from pending', () => {
    const repo = new AttentionItemRepository(mfdb.db);
    const item = makeAttentionItem();
    repo.insert(item);

    repo.dismiss(item.id);

    const pending = repo.findPending();
    expect(pending.some((a) => a.id === item.id)).toBe(false);
  });

  it('resolve marks item resolved', () => {
    const repo = new AttentionItemRepository(mfdb.db);
    const item = makeAttentionItem();
    repo.insert(item);

    repo.resolve(item.id, ResolutionType.Done);

    const pending = repo.findPending();
    expect(pending.some((a) => a.id === item.id)).toBe(false);
  });

  it('snoozed items are excluded from pending until snooze expires', () => {
    const repo = new AttentionItemRepository(mfdb.db);
    const item = makeAttentionItem();
    repo.insert(item);

    const futureTime = Date.now() + 60_000;
    repo.snooze(item.id, futureTime);

    const pending = repo.findPending(Date.now());
    expect(pending.some((a) => a.id === item.id)).toBe(false);

    // After snooze expires, appears again
    const pendingAfter = repo.findPending(futureTime + 1);
    expect(pendingAfter.some((a) => a.id === item.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// JobQueueRepository
// ---------------------------------------------------------------------------

describe('JobQueueRepository', () => {
  function makeJobWithRealItem(): Job {
    const itemRepo = new RawItemRepository(mfdb.db);
    const item = makeRawItem();
    itemRepo.insert(item);
    return makeJob({ rawItemId: item.id });
  }

  it('enqueues and dequeues a job', () => {
    const repo = new JobQueueRepository(mfdb.db);
    const job = makeJobWithRealItem();
    repo.enqueue(job);

    const dequeued = repo.dequeue(JobStage.Triage);
    expect(dequeued).toBeDefined();
    expect(dequeued?.id).toBe(job.id);
    expect(dequeued?.status).toBe(JobStatus.Processing);
    expect(dequeued?.attempts).toBe(1);
  });

  it('returns undefined when no pending jobs', () => {
    const repo = new JobQueueRepository(mfdb.db);
    const result = repo.dequeue(JobStage.Triage);
    expect(result).toBeUndefined();
  });

  it('complete marks job completed', () => {
    const repo = new JobQueueRepository(mfdb.db);
    const job = makeJobWithRealItem();
    repo.enqueue(job);
    repo.dequeue(JobStage.Triage);
    repo.complete(job.id);

    const count = repo.getPendingCount();
    expect(count).toBe(0);
  });

  it('getPendingCount returns correct count', () => {
    const repo = new JobQueueRepository(mfdb.db);
    repo.enqueue(makeJobWithRealItem());
    repo.enqueue(makeJobWithRealItem());

    expect(repo.getPendingCount()).toBe(2);
  });

  it('dequeues highest priority job first', () => {
    const repo = new JobQueueRepository(mfdb.db);
    const itemRepo = new RawItemRepository(mfdb.db);
    const item1 = makeRawItem();
    const item2 = makeRawItem();
    itemRepo.insert(item1);
    itemRepo.insert(item2);
    const low = makeJob({ priority: 0.1, rawItemId: item1.id });
    const high = makeJob({ priority: 0.9, rawItemId: item2.id });
    repo.enqueue(low);
    repo.enqueue(high);

    const first = repo.dequeue(JobStage.Triage);
    expect(first?.id).toBe(high.id);
  });
});

// ---------------------------------------------------------------------------
// SyncStateRepository
// ---------------------------------------------------------------------------

describe('SyncStateRepository', () => {
  it('returns undefined for unknown adapter', () => {
    const repo = new SyncStateRepository(mfdb.db);
    expect(repo.get(SourceAdapterType.Gmail)).toBeUndefined();
  });

  it('upserts and retrieves sync state', () => {
    const repo = new SyncStateRepository(mfdb.db);
    const state = {
      sourceAdapter: SourceAdapterType.Gmail,
      lastCheckpoint: { historyId: '12345' },
      lastSyncAt: Date.now(),
      itemsProcessed: 42,
      status: 'idle',
      errorMessage: null,
      config: { folders: ['INBOX'] },
    };

    repo.upsert(state);

    const found = repo.get(SourceAdapterType.Gmail);
    expect(found?.sourceAdapter).toBe(SourceAdapterType.Gmail);
    expect(found?.lastCheckpoint).toEqual({ historyId: '12345' });
    expect(found?.itemsProcessed).toBe(42);
  });

  it('upsert overwrites existing state', () => {
    const repo = new SyncStateRepository(mfdb.db);
    const initial = {
      sourceAdapter: SourceAdapterType.Gmail,
      lastCheckpoint: { historyId: '1' },
      lastSyncAt: Date.now(),
      itemsProcessed: 10,
      status: 'idle',
      errorMessage: null,
      config: {},
    };
    repo.upsert(initial);
    repo.upsert({ ...initial, itemsProcessed: 99 });

    const found = repo.get(SourceAdapterType.Gmail);
    expect(found?.itemsProcessed).toBe(99);
  });
});

// ---------------------------------------------------------------------------
// MergeAuditRepository
// ---------------------------------------------------------------------------

describe('MergeAuditRepository', () => {
  it('inserts and retrieves by surviving entity', () => {
    const entityRepo = new EntityRepository(mfdb.db);
    const auditRepo = new MergeAuditRepository(mfdb.db);

    const surviving = makeEntity();
    const merged = makeEntity({ canonicalName: 'Alice Dupe' });
    entityRepo.insert(surviving);
    entityRepo.insert(merged);

    const record = {
      id: ulid(),
      survivingEntityId: surviving.id,
      mergedEntityId: merged.id,
      mergeMethod: MergeMethod.EmailMatch,
      confidence: 0.99,
      mergedAt: Date.now(),
      mergedBy: 'system',
      preMergeSnapshot: { status: 'active' },
      undoneAt: null,
    };

    auditRepo.insert(record);

    const results = auditRepo.findBySurvivingEntity(surviving.id);
    expect(results.some((r) => r.id === record.id)).toBe(true);
    expect(results[0]?.preMergeSnapshot).toEqual({ status: 'active' });
  });
});

// ---------------------------------------------------------------------------
// ULID / Hash utilities
// ---------------------------------------------------------------------------

describe('ulid utility', () => {
  it('generates unique IDs', () => {
    const a = ulid();
    const b = ulid();
    expect(a).not.toBe(b);
    expect(a).toHaveLength(26);
  });
});

describe('sha256 utility', () => {
  it('produces a 64-char hex digest', () => {
    const hash = sha256('hello world');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic', () => {
    expect(sha256('test')).toBe(sha256('test'));
  });

  it('differs for different inputs', () => {
    expect(sha256('a')).not.toBe(sha256('b'));
  });
});
