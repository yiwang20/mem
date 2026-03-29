/**
 * End-to-end smoke test: instantiates MindFlowEngine, inserts mock data,
 * runs a query, and verifies the graph API works.
 *
 * This test exercises the full wired stack:
 *   Engine → Repositories → QueryEngine → GraphOperations → AttentionEngine
 *
 * It deliberately avoids real LLM calls (MockProvider is used).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MindFlowEngine } from '../../src/core/engine.js';
import {
  AttentionItemType,
  BodyFormat,
  DetectedLanguage,
  EntityStatus,
  EntityType,
  ProcessingStatus,
  RelationshipType,
  SourceAdapterType,
  SourceChannel,
} from '../../src/types/index.js';
import type { AttentionItem, Entity, RawItem, Relationship } from '../../src/types/index.js';
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
    aliases: [],
    attributes: {},
    confidence: 1.0,
    status: EntityStatus.Active,
    mergedInto: null,
    firstSeenAt: now,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeRawItem(body = 'Test body', overrides: Partial<RawItem> = {}): RawItem {
  const now = Date.now();
  return {
    id: ulid(),
    sourceAdapter: SourceAdapterType.Gmail,
    channel: SourceChannel.Email,
    externalId: `ext-${ulid()}`,
    threadId: null,
    senderEntityId: null,
    recipientEntityIds: [],
    subject: 'Meeting about Q3 budget',
    body,
    bodyFormat: BodyFormat.Plaintext,
    contentHash: sha256(body + ulid()),
    language: DetectedLanguage.English,
    eventTime: now,
    ingestedAt: now,
    processingStatus: ProcessingStatus.Done,
    attachments: [],
    metadata: {},
    ...overrides,
  };
}

function makeRelationship(
  fromId: string,
  toId: string,
  type = RelationshipType.Discusses,
): Relationship {
  return {
    id: ulid(),
    fromEntityId: fromId,
    toEntityId: toId,
    type,
    strength: 0.8,
    eventTime: Date.now(),
    ingestionTime: Date.now(),
    validFrom: null,
    validUntil: null,
    occurrenceCount: 1,
    sourceItemIds: [],
    metadata: {},
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let engine: MindFlowEngine;
let alice: Entity;
let bob: Entity;
let budgetTopic: Entity;
let item1: RawItem;
let item2: RawItem;
let relAliceBudget: Relationship;
let relBobBudget: Relationship;
let relAliceBob: Relationship;

beforeEach(() => {
  engine = new MindFlowEngine({ dbPath: ':memory:' });

  alice = makeEntity({ canonicalName: 'Alice Chen', type: EntityType.Person });
  bob = makeEntity({ canonicalName: 'Bob Wang', type: EntityType.Person });
  budgetTopic = makeEntity({
    canonicalName: 'Q3 Budget',
    type: EntityType.Topic,
    attributes: { status: 'active' },
  });

  engine.entities.insert(alice);
  engine.entities.insert(bob);
  engine.entities.insert(budgetTopic);

  item1 = makeRawItem('Alice and Bob discussed the Q3 budget in detail.', {
    senderEntityId: alice.id,
    recipientEntityIds: [bob.id],
    subject: 'Q3 Budget Discussion',
  });
  item2 = makeRawItem('Follow up on Q3 budget — please review the numbers.', {
    senderEntityId: bob.id,
    recipientEntityIds: [alice.id],
    subject: 'Re: Q3 Budget Discussion',
  });

  engine.rawItems.insert(item1);
  engine.rawItems.insert(item2);

  // Entity episodes
  engine.entityEpisodes.insert({ entityId: alice.id, rawItemId: item1.id, extractionMethod: 'tier1_rules', confidence: 1.0 });
  engine.entityEpisodes.insert({ entityId: bob.id, rawItemId: item1.id, extractionMethod: 'tier1_rules', confidence: 1.0 });
  engine.entityEpisodes.insert({ entityId: budgetTopic.id, rawItemId: item1.id, extractionMethod: 'tier1_rules', confidence: 1.0 });
  engine.entityEpisodes.insert({ entityId: bob.id, rawItemId: item2.id, extractionMethod: 'tier1_rules', confidence: 1.0 });
  engine.entityEpisodes.insert({ entityId: budgetTopic.id, rawItemId: item2.id, extractionMethod: 'tier1_rules', confidence: 1.0 });

  // Relationships
  relAliceBudget = makeRelationship(alice.id, budgetTopic.id, RelationshipType.Discusses);
  relBobBudget = makeRelationship(bob.id, budgetTopic.id, RelationshipType.Discusses);
  relAliceBob = makeRelationship(alice.id, bob.id, RelationshipType.CommunicatesWith);

  engine.relationships.insert(relAliceBudget);
  engine.relationships.insert(relBobBudget);
  engine.relationships.insert(relAliceBob);
});

afterEach(() => {
  engine.close();
});

// ---------------------------------------------------------------------------
// Smoke tests
// ---------------------------------------------------------------------------

describe('Engine smoke test', () => {
  it('getStats reflects all inserted data', () => {
    const stats = engine.getStats();
    expect(stats.rawItemCount).toBe(2);
    expect(stats.entityCount).toBe(3);
    expect(stats.relationshipCount).toBe(3);
    expect(stats.pendingJobCount).toBe(0);
  });

  it('getEntity retrieves Alice by ID', () => {
    const found = engine.getEntity(alice.id);
    expect(found).not.toBeNull();
    expect(found?.canonicalName).toBe('Alice Chen');
  });

  it('getEntity returns null for unknown ID', () => {
    expect(engine.getEntity('no-such-entity')).toBeNull();
  });

  it('getEntity returns null for merged entity', () => {
    engine.entities.merge(alice.id, bob.id, Date.now());
    expect(engine.getEntity(bob.id)).toBeNull();
  });
});

describe('Graph API smoke test', () => {
  it('getGraph returns nodes and edges for Alice (1 hop)', () => {
    const graph = engine.getGraph(alice.id, 1);
    expect(graph.nodes.length).toBeGreaterThanOrEqual(1);
    expect(graph.edges.length).toBeGreaterThanOrEqual(2); // alice→budget, alice→bob

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain(alice.id);

    const edgeIds = graph.edges.map((e) => e.id);
    expect(edgeIds).toContain(relAliceBudget.id);
    expect(edgeIds).toContain(relAliceBob.id);
  });

  it('getGraph returns empty graph for unknown center', () => {
    const graph = engine.getGraph('no-such-id');
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  it('graphOps.getSubgraph matches getGraph output', () => {
    const fromGetGraph = engine.getGraph(alice.id, 1);
    const fromGraphOps = engine.graphOps.getSubgraph(alice.id, 1);
    expect(fromGetGraph.edges.length).toBe(fromGraphOps.edges.length);
    expect(fromGetGraph.nodes.length).toBe(fromGraphOps.nodes.length);
  });

  it('graphOps.getTimeline returns items mentioning Alice', () => {
    const { items, total, hasMore } = engine.graphOps.getTimeline(alice.id);
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.some((i) => i.id === item1.id)).toBe(true);
    expect(total).toBeGreaterThanOrEqual(1);
    expect(typeof hasMore).toBe('boolean');
  });

  it('graphOps.getCrossReference returns items with both Alice and Bob', () => {
    const items = engine.graphOps.getCrossReference(alice.id, bob.id);
    expect(items.some((i) => i.id === item1.id)).toBe(true);
  });

  it('graphOps.getEntityStats returns correct counts', () => {
    const stats = engine.graphOps.getEntityStats(alice.id);
    expect(stats.entityId).toBe(alice.id);
    expect(stats.messageCount).toBeGreaterThanOrEqual(1);
    expect(stats.relationshipCount).toBeGreaterThanOrEqual(2);
  });
});

describe('Query engine smoke test', () => {
  it('query returns a valid QueryResult shape', async () => {
    const result = await engine.query({ query: 'Q3 budget discussion' });
    expect(result).toHaveProperty('answer');
    expect(result).toHaveProperty('entities');
    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('graphFragment');
    expect(Array.isArray(result.entities)).toBe(true);
    expect(Array.isArray(result.items)).toBe(true);
  });

  it('FTS5 query for "budget" finds relevant items', async () => {
    const result = await engine.query({ query: 'budget' });
    // Items containing "budget" should be returned
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    expect(result.items.some((i) => i.id === item1.id || i.id === item2.id)).toBe(true);
  });

  it('entity search finds Alice by name', async () => {
    const result = await engine.query({ query: 'Alice' });
    expect(result.entities.some((e) => e.id === alice.id)).toBe(true);
  });

  it('pending_items intent returns attention item summary', async () => {
    // Insert an attention item first
    const attItem: AttentionItem = {
      id: ulid(),
      type: AttentionItemType.UnansweredRequest,
      entityId: alice.id,
      rawItemId: item1.id,
      urgencyScore: 0.8,
      title: 'Alice needs a budget response',
      description: null,
      detectedAt: Date.now(),
      resolvedAt: null,
      dismissedAt: null,
      snoozedUntil: null,
      resolutionType: null,
    };
    engine.attentionItems.insert(attItem);

    const result = await engine.query({ query: 'what are my pending items' });
    expect(result.answer).not.toBeNull();
    expect(result.answer?.answer).toContain('pending item');
  });
});

describe('Attention engine smoke test', () => {
  it('getAttentionItems returns empty list with no items', () => {
    expect(engine.getAttentionItems()).toEqual([]);
  });

  it('detectAll runs without error on test data', () => {
    expect(() => engine.attentionEngine.detectAll()).not.toThrow();
  });

  it('manually inserted attention item appears in getAttentionItems', () => {
    const attItem: AttentionItem = {
      id: ulid(),
      type: AttentionItemType.StaleConversation,
      entityId: alice.id,
      rawItemId: null,
      urgencyScore: 0.5,
      title: 'Stale thread with Alice',
      description: null,
      detectedAt: Date.now(),
      resolvedAt: null,
      dismissedAt: null,
      snoozedUntil: null,
      resolutionType: null,
    };
    engine.attentionItems.insert(attItem);

    const items = engine.getAttentionItems();
    expect(items.some((i) => i.id === attItem.id)).toBe(true);
  });
});

describe('Ingestion wiring smoke test', () => {
  it('ingest() with no adapters completes cleanly', async () => {
    await expect(engine.ingest()).resolves.toBeUndefined();
  });

  it('registerAdapter + ingest() calls adapter.fetchSince', async () => {
    let fetchCalled = false;

    const mockAdapter = {
      name: SourceAdapterType.Gmail,
      async initialize() {},
      async fetchSince() {
        fetchCalled = true;
        return { items: [], checkpoint: {}, hasMore: false };
      },
      async getCurrentCheckpoint() { return {}; },
      async shutdown() {},
    };

    engine.registerAdapter(mockAdapter);
    await engine.ingest();

    expect(fetchCalled).toBe(true);
  });
});
