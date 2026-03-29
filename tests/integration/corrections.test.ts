import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MindFlowDatabase } from '../../src/storage/database.js';
import {
  EntityAliasRepository,
  EntityRepository,
  MergeAuditRepository,
  UserCorrectionRepository,
} from '../../src/storage/repositories.js';
import {
  CorrectionType,
  EntityStatus,
  EntityType,
} from '../../src/types/index.js';
import type { Entity } from '../../src/types/index.js';
import { ulid } from '../../src/utils/ulid.js';
import { EventBus } from '../../src/core/events.js';
import { UserCorrectionManager } from '../../src/graph/corrections.js';

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
    aliases: [],
    attributes: {},
    confidence: 0.9,
    status: EntityStatus.Active,
    mergedInto: null,
    firstSeenAt: now,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let mfdb: MindFlowDatabase;
let entityRepo: EntityRepository;
let aliasRepo: EntityAliasRepository;
let mergeAuditRepo: MergeAuditRepository;
let correctionRepo: UserCorrectionRepository;
let eventBus: EventBus;
let manager: UserCorrectionManager;

beforeEach(() => {
  mfdb = new MindFlowDatabase(':memory:');
  entityRepo = new EntityRepository(mfdb.db);
  aliasRepo = new EntityAliasRepository(mfdb.db);
  mergeAuditRepo = new MergeAuditRepository(mfdb.db);
  correctionRepo = new UserCorrectionRepository(mfdb.db);
  eventBus = new EventBus();
  manager = new UserCorrectionManager(
    mfdb.db,
    entityRepo,
    aliasRepo,
    mergeAuditRepo,
    correctionRepo,
    eventBus,
  );
});

afterEach(() => {
  mfdb.close();
});

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------

describe('rename (topic_rename / entity_update)', () => {
  it('updates canonicalName and records a correction', () => {
    const entity = makeEntity({ canonicalName: 'Old Name' });
    entityRepo.insert(entity);

    manager.rename(entity.id, { canonicalName: 'New Name' });

    const updated = entityRepo.findById(entity.id);
    expect(updated?.canonicalName).toBe('New Name');

    const corrections = correctionRepo.findByEntity(entity.id);
    expect(corrections).toHaveLength(1);
    expect(corrections[0]?.correctionData).toMatchObject({
      previousName: 'Old Name',
      canonicalName: 'New Name',
    });
  });

  it('updates nameAlt independently', () => {
    const entity = makeEntity({ canonicalName: 'Alice', nameAlt: null });
    entityRepo.insert(entity);

    manager.rename(entity.id, { nameAlt: 'Alice W.' });

    const updated = entityRepo.findById(entity.id);
    expect(updated?.nameAlt).toBe('Alice W.');
    expect(updated?.canonicalName).toBe('Alice'); // unchanged
  });

  it('uses topic_rename correction type for topic entities', () => {
    const topic = makeEntity({ type: EntityType.Topic, canonicalName: 'Project Alpha' });
    entityRepo.insert(topic);

    manager.rename(topic.id, { canonicalName: 'Project Beta' });

    const corrections = correctionRepo.findByEntity(topic.id);
    expect(corrections[0]?.correctionType).toBe(CorrectionType.TopicRename);
  });

  it('emits entity:updated event', () => {
    const entity = makeEntity({ canonicalName: 'Before' });
    entityRepo.insert(entity);

    const events: unknown[] = [];
    eventBus.on('entity:updated', (e) => events.push(e));

    manager.rename(entity.id, { canonicalName: 'After' });

    expect(events).toHaveLength(1);
    expect((events[0] as { entity: Entity }).entity.canonicalName).toBe('After');
  });

  it('throws for unknown entity', () => {
    expect(() => manager.rename('nonexistent', { canonicalName: 'X' })).toThrow();
  });

  it('throws for a merged entity', () => {
    const surviving = makeEntity({ canonicalName: 'Survivor' });
    const merged = makeEntity({ canonicalName: 'Merged', status: EntityStatus.Merged });
    entityRepo.insert(surviving);
    entityRepo.insert(merged);

    expect(() => manager.rename(merged.id, { canonicalName: 'X' })).toThrow(/merged/i);
  });
});

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

describe('merge (entity_merge)', () => {
  it('merges two entities and records a correction', () => {
    const alice = makeEntity({ canonicalName: 'Alice Wang' });
    const aliceW = makeEntity({ canonicalName: 'Alice W.' });
    entityRepo.insert(alice);
    entityRepo.insert(aliceW);

    manager.merge(alice.id, aliceW.id);

    const loser = entityRepo.findById(aliceW.id);
    expect(loser?.status).toBe(EntityStatus.Merged);
    expect(loser?.mergedInto).toBe(alice.id);

    const corrections = correctionRepo.findByEntity(alice.id);
    expect(corrections).toHaveLength(1);
    expect(corrections[0]?.correctionType).toBe(CorrectionType.EntityMerge);
    expect(corrections[0]?.correctionData).toMatchObject({
      survivingEntityId: alice.id,
      mergedEntityId: aliceW.id,
    });
  });

  it('uses topic_merge correction type when both entities are topics', () => {
    const t1 = makeEntity({ type: EntityType.Topic, canonicalName: 'Topic A' });
    const t2 = makeEntity({ type: EntityType.Topic, canonicalName: 'Topic B' });
    entityRepo.insert(t1);
    entityRepo.insert(t2);

    manager.merge(t1.id, t2.id);

    const corrections = correctionRepo.findByEntity(t1.id);
    expect(corrections[0]?.correctionType).toBe(CorrectionType.TopicMerge);
  });

  it('emits entity:merged and entity:updated events', () => {
    const a = makeEntity({ canonicalName: 'A' });
    const b = makeEntity({ canonicalName: 'B' });
    entityRepo.insert(a);
    entityRepo.insert(b);

    const mergedEvents: unknown[] = [];
    const updatedEvents: unknown[] = [];
    eventBus.on('entity:merged', (e) => mergedEvents.push(e));
    eventBus.on('entity:updated', (e) => updatedEvents.push(e));

    manager.merge(a.id, b.id);

    expect(mergedEvents).toHaveLength(1);
    expect(mergedEvents[0]).toMatchObject({ survivingId: a.id, mergedId: b.id });
    expect(updatedEvents).toHaveLength(1);
  });

  it('returns the merge audit ID', () => {
    const a = makeEntity();
    const b = makeEntity();
    entityRepo.insert(a);
    entityRepo.insert(b);

    const auditId = manager.merge(a.id, b.id);
    expect(typeof auditId).toBe('string');
    expect(auditId.length).toBeGreaterThan(0);
  });

  it('throws when trying to merge an already-merged entity', () => {
    const a = makeEntity();
    const b = makeEntity();
    entityRepo.insert(a);
    entityRepo.insert(b);

    manager.merge(a.id, b.id);

    // b is now merged — trying to merge it again should throw
    const c = makeEntity();
    entityRepo.insert(c);
    expect(() => manager.merge(a.id, b.id)).toThrow(/already merged/i);
  });
});

// ---------------------------------------------------------------------------
// Split (unmerge)
// ---------------------------------------------------------------------------

describe('split (entity_split)', () => {
  it('restores a merged entity to active and records a correction', () => {
    const alice = makeEntity({ canonicalName: 'Alice Wang' });
    const aliceW = makeEntity({ canonicalName: 'Alice W.' });
    entityRepo.insert(alice);
    entityRepo.insert(aliceW);

    manager.merge(alice.id, aliceW.id);

    // Confirm merged
    expect(entityRepo.findById(aliceW.id)?.status).toBe(EntityStatus.Merged);

    // Now split
    manager.split(aliceW.id);

    const restored = entityRepo.findById(aliceW.id);
    expect(restored?.status).toBe(EntityStatus.Active);
    expect(restored?.mergedInto).toBeNull();
    expect(restored?.canonicalName).toBe('Alice W.');

    const corrections = correctionRepo.findByEntity(aliceW.id);
    const splitCorrection = corrections.find(
      (c) => c.correctionType === CorrectionType.EntitySplit,
    );
    expect(splitCorrection).toBeDefined();
  });

  it('emits entity:updated event after split', () => {
    const a = makeEntity({ canonicalName: 'Survivor' });
    const b = makeEntity({ canonicalName: 'To Split' });
    entityRepo.insert(a);
    entityRepo.insert(b);

    manager.merge(a.id, b.id);

    const events: unknown[] = [];
    eventBus.on('entity:updated', (e) => events.push(e));

    manager.split(b.id);

    expect(events).toHaveLength(1);
    expect((events[0] as { entity: Entity }).entity.id).toBe(b.id);
  });

  it('throws when no undoable merge exists for the entity', () => {
    const entity = makeEntity();
    entityRepo.insert(entity);

    expect(() => manager.split(entity.id)).toThrow(/No undoable merge/i);
  });
});

// ---------------------------------------------------------------------------
// Attribute update
// ---------------------------------------------------------------------------

describe('updateAttributes (entity_update)', () => {
  it('merges new attributes into existing ones and records correction', () => {
    const entity = makeEntity({ attributes: { priority: 'low', tag: 'old' } });
    entityRepo.insert(entity);

    manager.updateAttributes(entity.id, { attributes: { priority: 'high', extra: 'new' } });

    const updated = entityRepo.findById(entity.id);
    expect(updated?.attributes).toMatchObject({ priority: 'high', tag: 'old', extra: 'new' });

    const corrections = correctionRepo.findByEntity(entity.id);
    expect(corrections[0]?.correctionType).toBe(CorrectionType.EntityUpdate);
  });

  it('emits entity:updated event', () => {
    const entity = makeEntity();
    entityRepo.insert(entity);

    const events: unknown[] = [];
    eventBus.on('entity:updated', (e) => events.push(e));

    manager.updateAttributes(entity.id, { attributes: { foo: 'bar' } });

    expect(events).toHaveLength(1);
  });
});
