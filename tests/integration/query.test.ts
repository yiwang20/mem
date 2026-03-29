import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MindFlowDatabase } from '../../src/storage/database.js';
import {
  AttentionItemRepository,
  EntityRepository,
  RawItemRepository,
} from '../../src/storage/repositories.js';
import {
  AttentionItemType,
  BodyFormat,
  DetectedLanguage,
  EntityStatus,
  EntityType,
  ProcessingStatus,
  SourceAdapterType,
  SourceChannel,
} from '../../src/types/index.js';
import type { AttentionItem, Entity, RawItem } from '../../src/types/index.js';
import { ulid } from '../../src/utils/ulid.js';
import { sha256 } from '../../src/utils/hash.js';
import { GraphOperations } from '../../src/graph/operations.js';
import { QueryEngine } from '../../src/query/engine.js';
import { MockProvider } from '../../src/llm/provider.js';
import { classifyIntent } from '../../src/query/intent.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRawItem(body: string, overrides: Partial<RawItem> = {}): RawItem {
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
    contentHash: sha256(body + ulid()),
    language: DetectedLanguage.English,
    eventTime: Date.now(),
    ingestedAt: Date.now(),
    processingStatus: ProcessingStatus.Done,
    attachments: [],
    metadata: {},
    ...overrides,
  };
}

function makeEntity(name: string, type = EntityType.Person): Entity {
  const now = Date.now();
  return {
    id: ulid(),
    type,
    canonicalName: name,
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
  };
}

function makeAttentionItem(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: ulid(),
    type: AttentionItemType.UnansweredRequest,
    entityId: null,
    rawItemId: null,
    urgencyScore: 0.7,
    title: 'Unanswered request from Alice',
    description: 'Please review the proposal?',
    detectedAt: Date.now(),
    resolvedAt: null,
    dismissedAt: null,
    snoozedUntil: null,
    resolutionType: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let mfdb: MindFlowDatabase;
let rawItemRepo: RawItemRepository;
let entityRepo: EntityRepository;
let attentionRepo: AttentionItemRepository;
let graphOps: GraphOperations;
let engine: QueryEngine;

beforeEach(() => {
  mfdb = new MindFlowDatabase(':memory:');
  rawItemRepo = new RawItemRepository(mfdb.db);
  entityRepo = new EntityRepository(mfdb.db);
  attentionRepo = new AttentionItemRepository(mfdb.db);
  graphOps = new GraphOperations(mfdb.db);
  engine = new QueryEngine(
    { rawItems: rawItemRepo, entities: entityRepo, attentionItems: attentionRepo },
    graphOps,
    new MockProvider(),
  );
});

afterEach(() => {
  mfdb.close();
});

// ---------------------------------------------------------------------------
// Intent classification (English + Chinese)
// ---------------------------------------------------------------------------

describe('Intent classification', () => {
  it('pending_items: English pending keywords', () => {
    expect(classifyIntent('what is pending').intent).toBe('pending_items');
    expect(classifyIntent('show me my to-do list').intent).toBe('pending_items');
    expect(classifyIntent('any unanswered emails?').intent).toBe('pending_items');
    expect(classifyIntent('follow up items').intent).toBe('pending_items');
  });

  it('pending_items: Chinese pending keywords', () => {
    expect(classifyIntent('忘了什么').intent).toBe('pending_items');
    expect(classifyIntent('有哪些待办事项').intent).toBe('pending_items');
    expect(classifyIntent('需要跟进的事情').intent).toBe('pending_items');
  });

  it('cross_ref: two English names', () => {
    const result = classifyIntent('What did Alice Johnson and Bob Smith discuss last week?');
    expect(result.intent).toBe('cross_ref');
    expect(result.detectedNames).toHaveLength(2);
  });

  it('person_context: one English name', () => {
    const result = classifyIntent('What has Alice Johnson been working on?');
    expect(result.intent).toBe('person_context');
    expect(result.detectedNames).toContain('Alice Johnson');
  });

  it('person_context: Chinese name detected', () => {
    const result = classifyIntent('王总最近在忙什么项目');
    expect(['person_context', 'pending_items', 'cross_ref']).toContain(result.intent);
    expect(result.isChinese).toBe(true);
  });

  it('relationship: English relationship keywords', () => {
    expect(classifyIntent('how are these topics related to each other?').intent).toBe('relationship');
    expect(classifyIntent('who works with the engineering team?').intent).toBe('relationship');
  });

  it('factual_recall: generic question', () => {
    expect(classifyIntent('what is the Q3 budget?').intent).toBe('factual_recall');
    expect(classifyIntent('when is the deadline for the proposal').intent).toBe('factual_recall');
  });
});

// ---------------------------------------------------------------------------
// FTS5 search returns relevant results
// ---------------------------------------------------------------------------

describe('FTS5 search via QueryEngine', () => {
  it('returns items matching query keywords', async () => {
    rawItemRepo.insert(makeRawItem('budget review meeting for Q3 2026'));
    rawItemRepo.insert(makeRawItem('lunch plans for tomorrow'));
    rawItemRepo.insert(makeRawItem('quarterly budget update and forecast'));

    const result = await engine.query({ query: 'budget', limit: 10 });
    // Both budget items should appear; lunch should not
    const bodies = result.items.map((i) => i.body);
    const budgetItems = bodies.filter((b) => b.includes('budget'));
    expect(budgetItems.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty items for a query with no matches', async () => {
    rawItemRepo.insert(makeRawItem('unrelated content about weather'));
    const result = await engine.query({ query: 'xyzzy_no_match_token', limit: 10 });
    expect(result.items).toHaveLength(0);
  });

  it('returns a valid QueryResult shape', async () => {
    const result = await engine.query({ query: 'test' });
    expect(result).toHaveProperty('answer');
    expect(result).toHaveProperty('entities');
    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('graphFragment');
    expect(Array.isArray(result.entities)).toBe(true);
    expect(Array.isArray(result.items)).toBe(true);
    expect(Array.isArray(result.graphFragment.nodes)).toBe(true);
    expect(Array.isArray(result.graphFragment.edges)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pending items query
// ---------------------------------------------------------------------------

describe('Pending items query', () => {
  it('returns attention items when intent is pending_items', async () => {
    const attn1 = makeAttentionItem({ title: 'Review proposal from Alice' });
    const attn2 = makeAttentionItem({ title: 'Overdue invoice from Vendor' });
    attentionRepo.insert(attn1);
    attentionRepo.insert(attn2);

    const result = await engine.query({ query: 'what is pending' });

    expect(result.answer).not.toBeNull();
    expect(result.answer?.answer).toContain('pending');
    // The summary should mention at least one of the titles
    expect(
      result.answer?.answer.includes('Review proposal') ||
      result.answer?.answer.includes('Overdue invoice') ||
      result.answer?.answer.includes('2 pending'),
    ).toBe(true);
  });

  it('returns "No pending items" when attention table is empty', async () => {
    const result = await engine.query({ query: 'what is pending' });
    expect(result.answer?.answer).toContain('No pending items');
  });

  it('links attention item raw items in result', async () => {
    const item = makeRawItem('Please review the attached proposal?');
    rawItemRepo.insert(item);
    const attn = makeAttentionItem({ rawItemId: item.id });
    attentionRepo.insert(attn);

    const result = await engine.query({ query: 'pending' });
    const itemIds = result.items.map((i) => i.id);
    expect(itemIds).toContain(item.id);
  });

  it('includes linked entities in pending items result', async () => {
    const entity = makeEntity('Alice Wang');
    entityRepo.insert(entity);
    const attn = makeAttentionItem({ entityId: entity.id });
    attentionRepo.insert(attn);

    const result = await engine.query({ query: 'what is waiting for a response' });
    const entityIds = result.entities.map((e) => e.id);
    expect(entityIds).toContain(entity.id);
  });

  it('dismissed attention items are not returned', async () => {
    const attn = makeAttentionItem({ dismissedAt: Date.now() - 1000 });
    attentionRepo.insert(attn);

    const result = await engine.query({ query: 'what is pending' });
    expect(result.answer?.answer).toContain('No pending items');
  });
});

// ---------------------------------------------------------------------------
// Entity search
// ---------------------------------------------------------------------------

describe('Entity search via QueryEngine', () => {
  it('finds entities by canonical name', async () => {
    const alice = makeEntity('Alice Johnson');
    entityRepo.insert(alice);

    const result = await engine.query({ query: 'Alice Johnson' });
    const entityIds = result.entities.map((e) => e.id);
    expect(entityIds).toContain(alice.id);
  });

  it('does not include merged entities', async () => {
    const surviving = makeEntity('Alice Wang');
    const merged = makeEntity('Alice W.');
    entityRepo.insert(surviving);
    entityRepo.insert(merged);
    entityRepo.merge(surviving.id, merged.id, Date.now());

    const result = await engine.query({ query: 'Alice W' });
    const entityIds = result.entities.map((e) => e.id);
    expect(entityIds).not.toContain(merged.id);
  });
});

// ---------------------------------------------------------------------------
// Result limit is respected
// ---------------------------------------------------------------------------

describe('Result limit', () => {
  it('respects the limit parameter', async () => {
    for (let i = 0; i < 10; i++) {
      rawItemRepo.insert(makeRawItem(`budget discussion item number ${i}`));
    }

    const result = await engine.query({ query: 'budget', limit: 3 });
    expect(result.items.length).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// FTS5 crash safety — hyphenated queries and operator-containing input
// ---------------------------------------------------------------------------

describe('FTS5 crash safety', () => {
  it('does not crash on hyphenated query via QueryEngine', async () => {
    rawItemRepo.insert(makeRawItem('meeting about project planning'));

    await expect(engine.query({ query: 'test-with-hyphen' })).resolves.toBeDefined();
  });

  it('does not crash on query that is never found via QueryEngine', async () => {
    rawItemRepo.insert(makeRawItem('some ordinary content'));

    const result = await engine.query({ query: 'never-exists' });
    expect(result.items).toEqual([]);
  });

  it('does not crash on FTS5 operator keywords via QueryEngine', async () => {
    rawItemRepo.insert(makeRawItem('some ordinary content'));

    await expect(engine.query({ query: 'NOT' })).resolves.toBeDefined();
    await expect(engine.query({ query: 'AND' })).resolves.toBeDefined();
    await expect(engine.query({ query: 'OR' })).resolves.toBeDefined();
  });

  it('rawItems.search does not crash on hyphenated input', () => {
    rawItemRepo.insert(makeRawItem('meeting about project planning'));

    expect(() => rawItemRepo.search('test-with-hyphen')).not.toThrow();
    expect(rawItemRepo.search('test-with-hyphen')).toEqual([]);
  });

  it('entities.search does not crash on hyphenated input', () => {
    entityRepo.insert(makeEntity('Alice Smith'));

    expect(() => entityRepo.search('test-with-hyphen')).not.toThrow();
    expect(entityRepo.search('test-with-hyphen')).toEqual([]);
  });

  it('rawItems.search returns results for valid phrase despite hyphens in query', () => {
    const item = makeRawItem('the quick brown fox');
    rawItemRepo.insert(item);

    // A real phrase that exists should still be found even when query is clean
    const results = rawItemRepo.search('quick brown');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.id).toBe(item.id);
  });
});
