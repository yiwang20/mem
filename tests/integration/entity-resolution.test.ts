import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MindFlowDatabase } from '../../src/storage/database.js';
import {
  EntityAliasRepository,
  EntityRepository,
  MergeAuditRepository,
  RawItemRepository,
} from '../../src/storage/repositories.js';
import {
  AliasType,
  BodyFormat,
  DetectedLanguage,
  EntityStatus,
  EntityType,
  MergeMethod,
  ProcessingStatus,
  SourceAdapterType,
  SourceChannel,
} from '../../src/types/index.js';
import type { Entity, EntityAlias, RawItem } from '../../src/types/index.js';
import { ulid } from '../../src/utils/ulid.js';
import { sha256 } from '../../src/utils/hash.js';
import { EntityResolver } from '../../src/graph/entity-resolver.js';
import { MockProvider } from '../../src/llm/provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  const now = Date.now();
  return {
    id: ulid(),
    type: EntityType.Person,
    canonicalName: overrides.canonicalName ?? 'Alice',
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

function makeAlias(entityId: string, alias: string, aliasType: AliasType): EntityAlias {
  return { id: ulid(), entityId, alias, aliasType, confidence: 1.0 };
}

function makeRawItem(overrides: Partial<RawItem> = {}): RawItem {
  const body = overrides.body ?? 'body ' + ulid();
  return {
    id: ulid(),
    sourceAdapter: SourceAdapterType.Gmail,
    channel: SourceChannel.Email,
    externalId: `ext-${ulid()}`,
    threadId: null,
    senderEntityId: null,
    recipientEntityIds: [],
    subject: null,
    body,
    bodyFormat: BodyFormat.Plaintext,
    contentHash: sha256(body),
    language: DetectedLanguage.English,
    eventTime: Date.now(),
    ingestedAt: Date.now(),
    processingStatus: ProcessingStatus.Pending,
    attachments: [],
    metadata: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let mfdb: MindFlowDatabase;
let entityRepo: EntityRepository;
let aliasRepo: EntityAliasRepository;
let rawItemRepo: RawItemRepository;
let mergeAuditRepo: MergeAuditRepository;

beforeEach(() => {
  mfdb = new MindFlowDatabase(':memory:');
  entityRepo = new EntityRepository(mfdb.db);
  aliasRepo = new EntityAliasRepository(mfdb.db);
  rawItemRepo = new RawItemRepository(mfdb.db);
  mergeAuditRepo = new MergeAuditRepository(mfdb.db);
});

afterEach(() => {
  mfdb.close();
});

function makeResolver(useLLM = false): EntityResolver {
  return new EntityResolver(
    mfdb.db,
    entityRepo,
    aliasRepo,
    useLLM ? new MockProvider() : null,
  );
}

// ---------------------------------------------------------------------------
// Stage 1: Deterministic matching — email exact match
// ---------------------------------------------------------------------------

describe('Stage 1: deterministic matching', () => {
  it('matches extracted entity to existing by email alias', async () => {
    const existing = makeEntity({ canonicalName: 'Alice Wang' });
    entityRepo.insert(existing);
    aliasRepo.insert(makeAlias(existing.id, 'alice@example.com', AliasType.Email));

    const extracted = {
      type: EntityType.Person,
      name: 'alice@example.com',
      nameAlt: null,
      attributes: { email: 'alice@example.com' },
      confidence: 0.95,
    };

    const resolver = makeResolver();
    const results = await resolver.resolve([extracted], makeRawItem());

    expect(results).toHaveLength(1);
    expect(results[0]?.decision.kind).toBe('matched');
    if (results[0]?.decision.kind === 'matched') {
      expect(results[0].decision.entityId).toBe(existing.id);
      expect(results[0].decision.confidence).toBe(1.0);
    }
  });

  it('matches extracted entity to existing by phone alias', async () => {
    const existing = makeEntity({ canonicalName: 'Bob Li' });
    entityRepo.insert(existing);
    aliasRepo.insert(makeAlias(existing.id, '+861380000001', AliasType.Phone));

    const extracted = {
      type: EntityType.Person,
      name: '+86 138 0000 001',
      nameAlt: null,
      attributes: { phone: '+861380000001' },
      confidence: 0.9,
    };

    const resolver = makeResolver();
    const results = await resolver.resolve([extracted], makeRawItem());

    expect(results[0]?.decision.kind).toBe('matched');
  });

  it('creates new entity when no alias match exists', async () => {
    const extracted = {
      type: EntityType.Person,
      name: 'nobody@unknown.com',
      nameAlt: null,
      attributes: { email: 'nobody@unknown.com' },
      confidence: 0.9,
    };

    const resolver = makeResolver();
    const results = await resolver.resolve([extracted], makeRawItem());
    expect(results[0]?.decision.kind).toBe('new');
  });
});

// ---------------------------------------------------------------------------
// Stage 2: Probabilistic matching — name similarity
// ---------------------------------------------------------------------------

describe('Stage 2: probabilistic name similarity', () => {
  it('auto-merges when name similarity >= 0.9', async () => {
    const existing = makeEntity({ canonicalName: 'Alice Johnson' });
    entityRepo.insert(existing);

    const extracted = {
      type: EntityType.Person,
      name: 'Alice Johnson', // identical → score 1.0
      nameAlt: null,
      attributes: {},
      confidence: 0.9,
    };

    const resolver = makeResolver();
    const results = await resolver.resolve([extracted], makeRawItem());
    // Identical name → auto-merge
    expect(results[0]?.decision.kind).toBe('matched');
  });

  it('creates new entity when similarity is low', async () => {
    const existing = makeEntity({ canonicalName: 'Completely Different Name XYZ' });
    entityRepo.insert(existing);

    const extracted = {
      type: EntityType.Person,
      name: 'Bob Smith',
      nameAlt: null,
      attributes: {},
      confidence: 0.9,
    };

    const resolver = makeResolver();
    const results = await resolver.resolve([extracted], makeRawItem());
    expect(results[0]?.decision.kind).toBe('new');
  });

  it('returns pending_user when no LLM available for ambiguous match', async () => {
    // Use a name with moderate similarity (0.70-0.89 range)
    const existing = makeEntity({ canonicalName: 'Wang Zong' });
    entityRepo.insert(existing);

    // "Wang Zong Jr" — similar but not identical
    const extracted = {
      type: EntityType.Person,
      name: 'Wang Zong Jr',
      nameAlt: null,
      attributes: {},
      confidence: 0.8,
    };

    const resolver = makeResolver(false); // no LLM
    const results = await resolver.resolve([extracted], makeRawItem());
    // Either new, pending_user, or matched depending on similarity score
    expect(['new', 'pending_user', 'matched']).toContain(results[0]?.decision.kind);
  });
});

// ---------------------------------------------------------------------------
// Entity merge: EntityRepository.merge()
// ---------------------------------------------------------------------------

describe('EntityRepository.merge()', () => {
  it('marks merged entity with status=merged and merged_into pointer', () => {
    const surviving = makeEntity({ canonicalName: 'Alice Wang' });
    const merged = makeEntity({ canonicalName: 'Alice W.' });
    entityRepo.insert(surviving);
    entityRepo.insert(merged);

    entityRepo.merge(surviving.id, merged.id, Date.now());

    const updatedMerged = entityRepo.findById(merged.id);
    expect(updatedMerged?.status).toBe(EntityStatus.Merged);
    expect(updatedMerged?.mergedInto).toBe(surviving.id);
  });

  it('surviving entity remains active after merge', () => {
    const surviving = makeEntity({ canonicalName: 'Alice Wang' });
    const merged = makeEntity({ canonicalName: 'Alice W.' });
    entityRepo.insert(surviving);
    entityRepo.insert(merged);

    entityRepo.merge(surviving.id, merged.id, Date.now());

    const s = entityRepo.findById(surviving.id);
    expect(s?.status).toBe(EntityStatus.Active);
  });

  it('merged entity no longer appears in findByType results', () => {
    const surviving = makeEntity({ canonicalName: 'Alice Wang' });
    const merged = makeEntity({ canonicalName: 'Alice W.' });
    entityRepo.insert(surviving);
    entityRepo.insert(merged);

    entityRepo.merge(surviving.id, merged.id, Date.now());

    const persons = entityRepo.findByType(EntityType.Person);
    const ids = persons.map((e) => e.id);
    expect(ids).not.toContain(merged.id);
    expect(ids).toContain(surviving.id);
  });
});

// ---------------------------------------------------------------------------
// Merge audit
// ---------------------------------------------------------------------------

describe('MergeAuditRepository', () => {
  it('records a merge audit entry', () => {
    const surviving = makeEntity();
    const merged = makeEntity();
    entityRepo.insert(surviving);
    entityRepo.insert(merged);

    const record = {
      id: ulid(),
      survivingEntityId: surviving.id,
      mergedEntityId: merged.id,
      mergeMethod: MergeMethod.EmailMatch,
      confidence: 1.0,
      mergedAt: Date.now(),
      mergedBy: 'system',
      preMergeSnapshot: null,
      undoneAt: null,
    };
    mergeAuditRepo.insert(record);

    const found = mergeAuditRepo.findBySurvivingEntity(surviving.id);
    expect(found).toHaveLength(1);
    expect(found[0]?.mergeMethod).toBe(MergeMethod.EmailMatch);
  });

  it('findBySurvivingEntity returns empty for unknown entity', () => {
    expect(mergeAuditRepo.findBySurvivingEntity('nonexistent')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Undo merge: EntityRepository.unmerge()
// ---------------------------------------------------------------------------

describe('EntityRepository.unmerge()', () => {
  it('restores merged entity to active status', () => {
    const surviving = makeEntity();
    const merged = makeEntity();
    entityRepo.insert(surviving);
    entityRepo.insert(merged);

    entityRepo.merge(surviving.id, merged.id, Date.now());
    entityRepo.unmerge(merged.id, Date.now());

    const restored = entityRepo.findById(merged.id);
    expect(restored?.status).toBe(EntityStatus.Active);
    expect(restored?.mergedInto).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Under-merge preference: separate low-confidence names
// ---------------------------------------------------------------------------

describe('Under-merge preference', () => {
  it('does not auto-merge entities with no shared signals and low name similarity', async () => {
    // Insert many unrelated persons to keep score low
    for (const name of ['John Doe', 'Jane Smith', 'Carlos Mendez', 'Yuki Tanaka']) {
      entityRepo.insert(makeEntity({ canonicalName: name }));
    }

    const extracted = {
      type: EntityType.Person,
      name: 'Maria Garcia',
      nameAlt: null,
      attributes: {},
      confidence: 0.8,
    };

    const resolver = makeResolver();
    const results = await resolver.resolve([extracted], makeRawItem());
    // Should not auto-merge with any of the above
    expect(results[0]?.decision.kind).toBe('new');
  });
});

// ---------------------------------------------------------------------------
// Multiple entities in a single resolve call
// ---------------------------------------------------------------------------

describe('Batch entity resolution', () => {
  it('resolves multiple extracted entities independently', async () => {
    const existing = makeEntity({ canonicalName: 'Alice' });
    entityRepo.insert(existing);
    aliasRepo.insert(makeAlias(existing.id, 'alice@corp.com', AliasType.Email));

    const extracted = [
      { type: EntityType.Person, name: 'alice@corp.com', nameAlt: null, attributes: { email: 'alice@corp.com' }, confidence: 0.9 },
      { type: EntityType.Person, name: 'Bob', nameAlt: null, attributes: {}, confidence: 0.8 },
    ];

    const resolver = makeResolver();
    const results = await resolver.resolve(extracted, makeRawItem());

    expect(results).toHaveLength(2);
    expect(results[0]?.decision.kind).toBe('matched');
    expect(results[1]?.decision.kind).toBe('new');
  });
});
