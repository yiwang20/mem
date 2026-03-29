import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MindFlowDatabase } from '../../src/storage/database.js';
import {
  EntityEpisodeRepository,
  EntityRepository,
  RawItemRepository,
} from '../../src/storage/repositories.js';
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
import { ulid } from '../../src/utils/ulid.js';
import { sha256 } from '../../src/utils/hash.js';
import { GraphOperations } from '../../src/graph/operations.js';
import { TopicClusterer } from '../../src/graph/clustering.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  const now = Date.now();
  return {
    id: ulid(),
    type: EntityType.Person,
    canonicalName: 'Entity ' + ulid().slice(-4),
    nameAlt: null,
    aliases: [],
    attributes: {},
    confidence: 1.0,
    status: EntityStatus.Active,
    mergedInto: null,
    parentEntityId: null,
    firstSeenAt: now,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeRawItem(body?: string): RawItem {
  const b = body ?? 'raw item body ' + ulid();
  return {
    id: ulid(),
    sourceAdapter: SourceAdapterType.Gmail,
    channel: SourceChannel.Email,
    externalId: 'ext-' + ulid(),
    threadId: null,
    senderEntityId: null,
    recipientEntityIds: [],
    subject: null,
    body: b,
    bodyFormat: BodyFormat.Plaintext,
    contentHash: sha256(b),
    language: DetectedLanguage.English,
    eventTime: Date.now(),
    ingestedAt: Date.now(),
    processingStatus: ProcessingStatus.Done,
    attachments: [],
    metadata: {},
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let db: MindFlowDatabase;
let entities: EntityRepository;
let rawItems: RawItemRepository;
let episodes: EntityEpisodeRepository;
let graphOps: GraphOperations;

beforeEach(() => {
  db = new MindFlowDatabase(':memory:');
  entities = new EntityRepository(db.db);
  rawItems = new RawItemRepository(db.db);
  episodes = new EntityEpisodeRepository(db.db);
  graphOps = new GraphOperations(db.db);
});

afterEach(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// Entity.parentEntityId persistence
// ---------------------------------------------------------------------------

describe('Entity parentEntityId', () => {
  it('defaults to null when not set', () => {
    const e = makeEntity({ type: EntityType.Topic, canonicalName: 'Root Topic' });
    entities.insert(e);
    const found = entities.findById(e.id);
    expect(found?.parentEntityId).toBeNull();
  });

  it('persists and retrieves parentEntityId', () => {
    const parent = makeEntity({ type: EntityType.Topic, canonicalName: 'Parent Topic' });
    const child = makeEntity({
      type: EntityType.Topic,
      canonicalName: 'Child Topic',
      parentEntityId: parent.id,
    });
    entities.insert(parent);
    entities.insert(child);

    const found = entities.findById(child.id);
    expect(found?.parentEntityId).toBe(parent.id);
  });

  it('can update parentEntityId', () => {
    const parent1 = makeEntity({ type: EntityType.Topic, canonicalName: 'Parent 1' });
    const parent2 = makeEntity({ type: EntityType.Topic, canonicalName: 'Parent 2' });
    const child = makeEntity({ type: EntityType.Topic, canonicalName: 'Child', parentEntityId: parent1.id });

    entities.insert(parent1);
    entities.insert(parent2);
    entities.insert(child);

    entities.update({ ...child, parentEntityId: parent2.id, updatedAt: Date.now() });
    const found = entities.findById(child.id);
    expect(found?.parentEntityId).toBe(parent2.id);
  });
});

// ---------------------------------------------------------------------------
// GraphOperations.getLayerData — root layer
// ---------------------------------------------------------------------------

describe('getLayerData root', () => {
  it('returns 5 fixed category nodes', () => {
    const layer = graphOps.getLayerData('root');
    expect(layer.center.id).toBe('root');
    expect(layer.center.type).toBe('root');
    expect(layer.children).toHaveLength(5);
    const ids = layer.children.map((n) => n.id);
    expect(ids).toContain('category:people');
    expect(ids).toContain('category:topics');
    expect(ids).toContain('category:documents');
    expect(ids).toContain('category:pending');
    expect(ids).toContain('category:groups');
  });

  it('topics badge counts only top-level topics', () => {
    const parent = makeEntity({ type: EntityType.Topic, canonicalName: 'Parent', parentEntityId: null });
    const child = makeEntity({ type: EntityType.Topic, canonicalName: 'Child', parentEntityId: parent.id });
    entities.insert(parent);
    entities.insert(child);

    const layer = graphOps.getLayerData('root');
    const topicsNode = layer.children.find((n) => n.id === 'category:topics');
    // Only the top-level parent topic counts
    expect(topicsNode?.badge).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// GraphOperations.getLayerData — category layer
// ---------------------------------------------------------------------------

describe('getLayerData category:topics', () => {
  it('returns only top-level topics (parent_entity_id IS NULL)', () => {
    const top = makeEntity({ type: EntityType.Topic, canonicalName: 'Top-Level Topic', parentEntityId: null });
    const nested = makeEntity({ type: EntityType.Topic, canonicalName: 'Nested Topic', parentEntityId: top.id });
    entities.insert(top);
    entities.insert(nested);

    const layer = graphOps.getLayerData('category:topics');
    const ids = layer.children.map((n) => n.id);
    expect(ids).toContain(top.id);
    expect(ids).not.toContain(nested.id);
    expect(layer.totalAvailable).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// GraphOperations.getLayerData — entity layer (topic center)
// ---------------------------------------------------------------------------

describe('getLayerData topic entity', () => {
  it('includes child topics in ring', () => {
    const parent = makeEntity({ type: EntityType.Topic, canonicalName: 'Budget', parentEntityId: null });
    const child1 = makeEntity({ type: EntityType.Topic, canonicalName: 'Marketing Budget', parentEntityId: parent.id });
    const child2 = makeEntity({ type: EntityType.Topic, canonicalName: 'R&D Budget', parentEntityId: parent.id });
    entities.insert(parent);
    entities.insert(child1);
    entities.insert(child2);

    const layer = graphOps.getLayerData(parent.id);
    expect(layer.center.id).toBe(parent.id);
    expect(layer.hasChildren).toBe(true);
    const ringIds = layer.children.map((n) => n.id);
    expect(ringIds).toContain(child1.id);
    expect(ringIds).toContain(child2.id);
  });
});

// ---------------------------------------------------------------------------
// TopicClusterer.createSubTopicEntity (via discoverSubTopics)
// ---------------------------------------------------------------------------

describe('TopicClusterer discoverSubTopics', () => {
  it('returns empty stats without LLM provider', async () => {
    const clusterer = new TopicClusterer(db.db); // no LLM
    const stats = await clusterer.discoverSubTopics();
    expect(stats.topicsAnalyzed).toBe(0);
    expect(stats.subTopicsCreated).toBe(0);
  });

  it('skips topics with fewer than 8 messages', async () => {
    const clusterer = new TopicClusterer(db.db); // no LLM — shouldn't matter
    const topic = makeEntity({ type: EntityType.Topic, canonicalName: 'Small Topic', parentEntityId: null });
    entities.insert(topic);

    // Add 5 messages — below the threshold
    for (let i = 0; i < 5; i++) {
      const item = makeRawItem();
      rawItems.insert(item);
      episodes.insert({ entityId: topic.id, rawItemId: item.id, extractionMethod: 'test', confidence: 1 });
    }

    const stats = await clusterer.discoverSubTopics();
    expect(stats.topicsAnalyzed).toBe(0);
  });

  it('analyzes topics with 8+ messages when LLM returns no sub-themes', async () => {
    // LLM mock that returns empty array
    const mockLlm = {
      name: 'mock',
      extract: async () => ({ entities: [], relationships: [], summary: null, language: 'en' as const }),
      answer: async () => ({ answer: '[]', sourceItemIds: [], confidence: 0 }),
      embed: async () => new Float64Array(1536),
      embedBatch: async (texts: string[]) => texts.map(() => new Float64Array(1536)),
      isAvailable: async () => true,
    };

    const clusterer = new TopicClusterer(db.db, mockLlm);
    const topic = makeEntity({ type: EntityType.Topic, canonicalName: 'Large Topic', parentEntityId: null });
    entities.insert(topic);

    // Add 10 messages
    for (let i = 0; i < 10; i++) {
      const item = makeRawItem(`Message about large topic number ${i}`);
      rawItems.insert(item);
      episodes.insert({ entityId: topic.id, rawItemId: item.id, extractionMethod: 'test', confidence: 1 });
    }

    const stats = await clusterer.discoverSubTopics();
    expect(stats.topicsAnalyzed).toBe(1);
    expect(stats.subTopicsCreated).toBe(0); // LLM returned empty
  });
});

// ---------------------------------------------------------------------------
// TopicClusterer.enforceLayerWidth
// ---------------------------------------------------------------------------

describe('TopicClusterer enforceLayerWidth', () => {
  it('does nothing when children count <= maxChildren', async () => {
    const clusterer = new TopicClusterer(db.db); // no LLM
    const parent = makeEntity({ type: EntityType.Topic, canonicalName: 'Parent' });
    entities.insert(parent);

    for (let i = 0; i < 5; i++) {
      entities.insert(makeEntity({ type: EntityType.Topic, canonicalName: `Child ${i}`, parentEntityId: parent.id }));
    }

    const created = await clusterer.enforceLayerWidth(parent.id, 12);
    expect(created).toBe(0);
  });

  it('does nothing without LLM provider even when overflow', async () => {
    const clusterer = new TopicClusterer(db.db); // no LLM
    const parent = makeEntity({ type: EntityType.Topic, canonicalName: 'Parent' });
    entities.insert(parent);

    for (let i = 0; i < 15; i++) {
      entities.insert(makeEntity({ type: EntityType.Topic, canonicalName: `Child ${i}`, parentEntityId: parent.id }));
    }

    const created = await clusterer.enforceLayerWidth(parent.id, 12);
    expect(created).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getLayerData category:pending — urgency group virtual nodes
// ---------------------------------------------------------------------------

function insertAttentionItem(
  db: MindFlowDatabase,
  title: string,
  urgencyScore: number,
  entityId: string | null = null,
): void {
  db.db
    .prepare(
      `INSERT INTO attention_items
         (id, type, entity_id, raw_item_id, urgency_score, title, description,
          detected_at, resolved_at, dismissed_at, snoozed_until, resolution_type)
       VALUES (?, 'unanswered_request', ?, NULL, ?, ?, NULL, ?, NULL, NULL, NULL, NULL)`,
    )
    .run(ulid(), entityId, urgencyScore, title, Date.now());
}

describe('getLayerData category:pending — urgency groups', () => {
  it('returns 4 urgency group nodes', () => {
    const layer = graphOps.getLayerData('category:pending');
    expect(layer.center.id).toBe('category:pending');
    expect(layer.center.label).toBe('Pending');
    expect(layer.children).toHaveLength(4);
    const ids = layer.children.map((n) => n.id);
    expect(ids).toContain('urgency:overdue');
    expect(ids).toContain('urgency:this_week');
    expect(ids).toContain('urgency:upcoming');
    expect(ids).toContain('urgency:no_date');
  });

  it('counts items into correct urgency buckets', () => {
    insertAttentionItem(db, 'Overdue task', 1.0);
    insertAttentionItem(db, 'Due today', 0.9);
    insertAttentionItem(db, 'Due this week', 0.75);
    insertAttentionItem(db, 'Due next week', 0.6);
    insertAttentionItem(db, 'Low priority', 0.3);

    const layer = graphOps.getLayerData('category:pending');
    const overdue = layer.children.find((n) => n.id === 'urgency:overdue')!;
    const thisWeek = layer.children.find((n) => n.id === 'urgency:this_week')!;
    const upcoming = layer.children.find((n) => n.id === 'urgency:upcoming')!;
    const noDate = layer.children.find((n) => n.id === 'urgency:no_date')!;

    expect(overdue.badge).toBe(1);   // score = 1.0
    expect(thisWeek.badge).toBe(2);  // score = 0.9, 0.75
    expect(upcoming.badge).toBe(1);  // score = 0.6
    expect(noDate.badge).toBe(1);    // score = 0.3
  });

  it('all badges are 0 when no attention items', () => {
    const layer = graphOps.getLayerData('category:pending');
    for (const node of layer.children) {
      expect(node.badge).toBe(0);
    }
  });

  it('does not include resolved items in counts', () => {
    // Insert one resolved item that would be overdue
    db.db
      .prepare(
        `INSERT INTO attention_items
           (id, type, entity_id, raw_item_id, urgency_score, title, description,
            detected_at, resolved_at, dismissed_at, snoozed_until, resolution_type)
         VALUES (?, 'unanswered_request', NULL, NULL, 1.0, 'Resolved overdue', NULL,
                 ?, ?, NULL, NULL, 'done')`,
      )
      .run(ulid(), Date.now(), Date.now());

    const layer = graphOps.getLayerData('category:pending');
    const overdue = layer.children.find((n) => n.id === 'urgency:overdue')!;
    expect(overdue.badge).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getLayerData urgency:* — drill-in to urgency group
// ---------------------------------------------------------------------------

describe('getLayerData urgency group drill-in', () => {
  it('returns center with urgency_group type and correct label', () => {
    const layer = graphOps.getLayerData('urgency:overdue');
    expect(layer.center.id).toBe('urgency:overdue');
    expect(layer.center.type).toBe('urgency_group');
    expect(layer.center.label).toBe('Overdue 逾期');
  });

  it('returns only items in the matching urgency bucket', () => {
    insertAttentionItem(db, 'Overdue A', 1.0);
    insertAttentionItem(db, 'Overdue B', 1.0);
    insertAttentionItem(db, 'This week item', 0.8);

    const layer = graphOps.getLayerData('urgency:overdue');
    expect(layer.children).toHaveLength(2);
    expect(layer.children.every((n) => n.type === 'attention_item')).toBe(true);
    const labels = layer.children.map((n) => n.label);
    expect(labels).toContain('Overdue A');
    expect(labels).toContain('Overdue B');
  });

  it('includes entity name in alsoIn when entity linked', () => {
    const entity = makeEntity({ type: EntityType.Person, canonicalName: 'Alice' });
    entities.insert(entity);
    insertAttentionItem(db, 'Follow up with Alice', 1.0, entity.id);

    const layer = graphOps.getLayerData('urgency:overdue');
    const item = layer.children.find((n) => n.label === 'Follow up with Alice');
    expect(item?.alsoIn).toHaveLength(1);
    expect(item?.alsoIn[0]?.label).toBe('Alice');
  });

  it('returns empty ring for unknown urgency group', () => {
    const layer = graphOps.getLayerData('urgency:bogus');
    expect(layer.children).toHaveLength(0);
    expect(layer.totalAvailable).toBe(0);
  });

  it('this_week group label is correct', () => {
    const layer = graphOps.getLayerData('urgency:this_week');
    expect(layer.center.label).toBe('This Week 本周');
  });

  it('upcoming group label is correct', () => {
    const layer = graphOps.getLayerData('urgency:upcoming');
    expect(layer.center.label).toBe('Upcoming 即将');
  });

  it('no_date group label is correct', () => {
    const layer = graphOps.getLayerData('urgency:no_date');
    expect(layer.center.label).toBe('No Date 无日期');
  });

  it('totalAvailable reflects count in bucket', () => {
    for (let i = 0; i < 5; i++) {
      insertAttentionItem(db, `Low priority ${i}`, 0.2);
    }
    const layer = graphOps.getLayerData('urgency:no_date');
    expect(layer.totalAvailable).toBe(5);
    expect(layer.hasChildren).toBe(true);
  });
});
