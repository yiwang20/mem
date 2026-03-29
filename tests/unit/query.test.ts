import { describe, expect, it } from 'vitest';
import {
  BodyFormat,
  DetectedLanguage,
  EntityStatus,
  EntityType,
  ProcessingStatus,
  SourceAdapterType,
  SourceChannel,
} from '../../src/types/index.js';
import type { Entity, RawItem } from '../../src/types/index.js';
import { classifyIntent } from '../../src/query/intent.js';
import { rrf, extractItems } from '../../src/query/fusion.js';
import { ftsSearch, entitySearch } from '../../src/query/search.js';
import type { ScoredItem } from '../../src/query/search.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(id: string, body: string, eventTime = Date.now()): RawItem {
  return {
    id,
    sourceAdapter: SourceAdapterType.Gmail,
    channel: SourceChannel.Email,
    externalId: id,
    threadId: null,
    senderEntityId: null,
    recipientEntityIds: [],
    subject: null,
    body,
    bodyFormat: BodyFormat.Plaintext,
    contentHash: id,
    language: DetectedLanguage.English,
    eventTime,
    ingestedAt: Date.now(),
    processingStatus: ProcessingStatus.Done,
    attachments: [],
    metadata: {},
  };
}

function makeEntity(id: string, name: string, type = EntityType.Person): Entity {
  const now = Date.now();
  return {
    id,
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

// ---------------------------------------------------------------------------
// Intent classifier
// ---------------------------------------------------------------------------

describe('classifyIntent', () => {
  it('classifies pending keywords as pending_items', () => {
    expect(classifyIntent('what is pending').intent).toBe('pending_items');
    expect(classifyIntent('anything waiting for a response?').intent).toBe('pending_items');
    expect(classifyIntent('show me action items').intent).toBe('pending_items');
    expect(classifyIntent('忘了什么').intent).toBe('pending_items');
    expect(classifyIntent('待办事项').intent).toBe('pending_items');
  });

  it('classifies two person names as cross_ref', () => {
    const result = classifyIntent('What did Alice Johnson and Bob Smith discuss?');
    expect(result.intent).toBe('cross_ref');
    expect(result.detectedNames).toHaveLength(2);
    expect(result.detectedNames).toContain('Alice Johnson');
    expect(result.detectedNames).toContain('Bob Smith');
  });

  it('classifies one person name as person_context', () => {
    const result = classifyIntent('What has Alice Johnson been working on?');
    expect(result.intent).toBe('person_context');
    expect(result.detectedNames).toContain('Alice Johnson');
  });

  it('classifies relationship keywords as relationship', () => {
    expect(classifyIntent('How is Alice related to the project?').intent).toBe('relationship');
    expect(classifyIntent('who works with the team').intent).toBe('relationship');
  });

  it('defaults to factual_recall for generic questions', () => {
    expect(classifyIntent('What is the budget for Q3?').intent).toBe('factual_recall');
    expect(classifyIntent('when is the deadline').intent).toBe('factual_recall');
  });

  it('detects Chinese queries', () => {
    const result = classifyIntent('王总最近在做什么');
    expect(result.isChinese).toBe(true);
  });

  it('detects Chinese person names', () => {
    const result = classifyIntent('王总和李经理开会了吗');
    expect(result.detectedNames.length).toBeGreaterThanOrEqual(1);
  });

  it('marks English queries as non-Chinese', () => {
    const result = classifyIntent('what are the pending tasks?');
    expect(result.isChinese).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RRF fusion
// ---------------------------------------------------------------------------

describe('rrf', () => {
  it('assigns higher scores to items appearing in more lists', () => {
    const item1 = makeItem('item-1', 'foo');
    const item2 = makeItem('item-2', 'bar');
    const item3 = makeItem('item-3', 'baz');

    const listA: ScoredItem[] = [
      { item: item1, score: 1.0, source: 'fts' },
      { item: item2, score: 0.8, source: 'fts' },
    ];
    const listB: ScoredItem[] = [
      { item: item1, score: 0.9, source: 'graph' },
      { item: item3, score: 0.7, source: 'graph' },
    ];

    const fused = rrf([listA, listB]);
    // item1 appears in both lists → highest score
    expect(fused[0]?.item.id).toBe('item-1');
  });

  it('deduplicates items across lists', () => {
    const item = makeItem('dup-1', 'content');
    const listA: ScoredItem[] = [{ item, score: 1.0, source: 'fts' }];
    const listB: ScoredItem[] = [{ item, score: 0.9, source: 'graph' }];

    const fused = rrf([listA, listB]);
    // Should only appear once
    const count = fused.filter((f) => f.item.id === 'dup-1').length;
    expect(count).toBe(1);
  });

  it('returns empty array for empty input', () => {
    expect(rrf([])).toEqual([]);
    expect(rrf([[]])).toEqual([]);
  });

  it('uses k=60 by default (RRF constant)', () => {
    const item = makeItem('solo', 'x');
    const list: ScoredItem[] = [{ item, score: 1.0, source: 'fts' }];
    const fused = rrf([list]);
    // Only one item at rank 1: score should be 1/(60+1) ≈ 0.01639
    expect(fused[0]?.rrfScore).toBeCloseTo(1 / 61, 5);
  });

  it('respects custom k parameter', () => {
    const item = makeItem('solo', 'x');
    const list: ScoredItem[] = [{ item, score: 1.0, source: 'fts' }];
    const fused = rrf([list], 10);
    expect(fused[0]?.rrfScore).toBeCloseTo(1 / 11, 5);
  });
});

describe('extractItems', () => {
  it('returns sliced items up to limit', () => {
    const items = ['a', 'b', 'c', 'd'].map((id) => makeItem(id, id));
    const lists: ScoredItem[][] = [
      items.map((item, i) => ({ item, score: 1 - i * 0.1, source: 'fts' as const })),
    ];
    const fused = rrf([lists[0] ?? []]);
    const result = extractItems(fused, 2);
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Search strategy stubs (unit tests with stub repos)
// ---------------------------------------------------------------------------

describe('ftsSearch', () => {
  it('returns scored items from the repository', () => {
    const items = [makeItem('i1', 'budget'), makeItem('i2', 'budget discussion')];
    const stubRepo = { search: (_q: string, _l: number) => items };

    const results = ftsSearch('budget', stubRepo as Parameters<typeof ftsSearch>[1]);
    expect(results).toHaveLength(2);
    expect(results[0]?.source).toBe('fts');
    // First item should have higher score than second
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  it('returns empty array when repository returns nothing', () => {
    const stubRepo = { search: () => [] };
    expect(ftsSearch('nothing', stubRepo as Parameters<typeof ftsSearch>[1])).toEqual([]);
  });
});

describe('entitySearch', () => {
  it('returns scored entities from the repository', () => {
    const entities = [makeEntity('e1', 'Alice'), makeEntity('e2', 'Alice Smith')];
    const stubRepo = { search: (_q: string, _l: number) => entities };

    const results = entitySearch('Alice', stubRepo as Parameters<typeof entitySearch>[1]);
    expect(results).toHaveLength(2);
    expect(results[0]?.source).toBe('entity_search');
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  it('deduplicates entities by ID', () => {
    const entity = makeEntity('e1', 'Alice');
    const stubRepo = { search: () => [entity, entity] };

    const results = entitySearch('Alice', stubRepo as Parameters<typeof entitySearch>[1]);
    expect(results).toHaveLength(1);
  });
});
