import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MindFlowEngine } from '../../src/core/engine.js';
import {
  BodyFormat,
  DetectedLanguage,
  EntityStatus,
  EntityType,
  ProcessingStatus,
  SourceAdapterType,
  SourceChannel,
} from '../../src/types/index.js';
import { ulid } from '../../src/utils/ulid.js';
import { sha256 } from '../../src/utils/hash.js';

let engine: MindFlowEngine;

const BASE_TIME = 1_700_000_000_000;

beforeEach(() => {
  engine = new MindFlowEngine({ dbPath: ':memory:' });
});

afterEach(() => {
  engine.close();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntity(name: string) {
  const now = Date.now();
  return {
    id: ulid(),
    type: EntityType.Person,
    canonicalName: name,
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
  };
}

function makeRawItem(overrides: {
  body?: string;
  channel?: SourceChannel;
  sourceAdapter?: SourceAdapterType;
  eventTime?: number;
} = {}) {
  const body = overrides.body ?? ('body-' + ulid());
  return {
    id: ulid(),
    sourceAdapter: overrides.sourceAdapter ?? SourceAdapterType.Gmail,
    channel: overrides.channel ?? SourceChannel.Email,
    externalId: 'ext-' + ulid(),
    threadId: null,
    senderEntityId: null,
    recipientEntityIds: [],
    subject: null,
    body,
    bodyFormat: BodyFormat.Plaintext,
    contentHash: sha256(body),
    language: DetectedLanguage.English,
    eventTime: overrides.eventTime ?? BASE_TIME,
    ingestedAt: BASE_TIME,
    processingStatus: ProcessingStatus.Done,
    attachments: [],
    metadata: {},
  };
}

// Insert a raw item and link it to an entity via entity_episodes
function insertLinked(entity: { id: string }, overrides: Parameters<typeof makeRawItem>[0] = {}) {
  const item = makeRawItem(overrides);
  engine.rawItems.insert(item);
  engine.entityEpisodes.insert({
    entityId: entity.id,
    rawItemId: item.id,
    extractionMethod: 'test',
    confidence: 1.0,
  });
  return item;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GraphOperations.getTimeline() — filtering', () => {
  it('returns empty page for entity with no items', () => {
    const entity = makeEntity('Alice');
    engine.entities.insert(entity);
    const page = engine.graphOps.getTimeline(entity.id);
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.hasMore).toBe(false);
  });

  it('returns all items when no filters applied', () => {
    const entity = makeEntity('Bob');
    engine.entities.insert(entity);
    insertLinked(entity, { eventTime: BASE_TIME });
    insertLinked(entity, { eventTime: BASE_TIME + 1000 });
    insertLinked(entity, { eventTime: BASE_TIME + 2000 });

    const page = engine.graphOps.getTimeline(entity.id);
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(3);
    expect(page.hasMore).toBe(false);
  });

  it('filters by channel', () => {
    const entity = makeEntity('Carol');
    engine.entities.insert(entity);
    insertLinked(entity, { channel: SourceChannel.Email });
    insertLinked(entity, { channel: SourceChannel.IMessage });
    insertLinked(entity, { channel: SourceChannel.Email });

    const emailPage = engine.graphOps.getTimeline(entity.id, { channel: 'email' });
    expect(emailPage.total).toBe(2);
    expect(emailPage.items.every((i) => i.channel === SourceChannel.Email)).toBe(true);

    const imsgPage = engine.graphOps.getTimeline(entity.id, { channel: 'imessage' });
    expect(imsgPage.total).toBe(1);
    expect(imsgPage.items[0]!.channel).toBe(SourceChannel.IMessage);
  });

  it('filters by after timestamp', () => {
    const entity = makeEntity('Dave');
    engine.entities.insert(entity);
    insertLinked(entity, { eventTime: BASE_TIME });
    insertLinked(entity, { eventTime: BASE_TIME + 5000 });
    insertLinked(entity, { eventTime: BASE_TIME + 10000 });

    const page = engine.graphOps.getTimeline(entity.id, { after: BASE_TIME + 3000 });
    expect(page.total).toBe(2);
    expect(page.items.every((i) => i.eventTime > BASE_TIME + 3000)).toBe(true);
  });

  it('filters by before timestamp', () => {
    const entity = makeEntity('Eve');
    engine.entities.insert(entity);
    insertLinked(entity, { eventTime: BASE_TIME });
    insertLinked(entity, { eventTime: BASE_TIME + 5000 });
    insertLinked(entity, { eventTime: BASE_TIME + 10000 });

    const page = engine.graphOps.getTimeline(entity.id, { before: BASE_TIME + 7000 });
    expect(page.total).toBe(2);
    expect(page.items.every((i) => i.eventTime < BASE_TIME + 7000)).toBe(true);
  });

  it('combines channel and time filters', () => {
    const entity = makeEntity('Frank');
    engine.entities.insert(entity);
    insertLinked(entity, { channel: SourceChannel.Email, eventTime: BASE_TIME });
    insertLinked(entity, { channel: SourceChannel.Email, eventTime: BASE_TIME + 10000 });
    insertLinked(entity, { channel: SourceChannel.IMessage, eventTime: BASE_TIME + 5000 });

    const page = engine.graphOps.getTimeline(entity.id, {
      channel: 'email',
      after: BASE_TIME + 1000,
    });
    expect(page.total).toBe(1);
    expect(page.items[0]!.channel).toBe(SourceChannel.Email);
    expect(page.items[0]!.eventTime).toBe(BASE_TIME + 10000);
  });

  it('filters by keyword search (q) matching body', () => {
    const entity = makeEntity('Grace');
    engine.entities.insert(entity);
    insertLinked(entity, { body: 'quarterly budget review for Q4' });
    insertLinked(entity, { body: 'team lunch next Friday' });
    insertLinked(entity, { body: 'please review the budget proposal' });

    const page = engine.graphOps.getTimeline(entity.id, { q: 'budget' });
    expect(page.total).toBe(2);
    expect(page.items.every((i) => i.body.toLowerCase().includes('budget'))).toBe(true);
  });

  it('q filter returns empty when no match', () => {
    const entity = makeEntity('Hank');
    engine.entities.insert(entity);
    insertLinked(entity, { body: 'hello world' });

    const page = engine.graphOps.getTimeline(entity.id, { q: 'zyxwvuts' });
    expect(page.total).toBe(0);
    expect(page.items).toHaveLength(0);
  });
});

describe('GraphOperations.getTimeline() — pagination', () => {
  it('respects limit', () => {
    const entity = makeEntity('Iris');
    engine.entities.insert(entity);
    for (let i = 0; i < 10; i++) {
      insertLinked(entity, { eventTime: BASE_TIME + i * 1000 });
    }

    const page = engine.graphOps.getTimeline(entity.id, { limit: 3 });
    expect(page.items).toHaveLength(3);
    expect(page.total).toBe(10);
    expect(page.hasMore).toBe(true);
  });

  it('respects offset', () => {
    const entity = makeEntity('Jake');
    engine.entities.insert(entity);
    const inserted: string[] = [];
    for (let i = 0; i < 5; i++) {
      const item = insertLinked(entity, { eventTime: BASE_TIME + i * 1000 });
      inserted.push(item.id);
    }

    const page1 = engine.graphOps.getTimeline(entity.id, { limit: 2, offset: 0 });
    const page2 = engine.graphOps.getTimeline(entity.id, { limit: 2, offset: 2 });
    const page3 = engine.graphOps.getTimeline(entity.id, { limit: 2, offset: 4 });

    // Pages must not overlap
    const ids1 = new Set(page1.items.map((i) => i.id));
    const ids2 = new Set(page2.items.map((i) => i.id));
    expect([...ids1].some((id) => ids2.has(id))).toBe(false);

    expect(page1.items).toHaveLength(2);
    expect(page2.items).toHaveLength(2);
    expect(page3.items).toHaveLength(1); // last page
    expect(page3.hasMore).toBe(false);
  });

  it('hasMore is false on last page', () => {
    const entity = makeEntity('Kate');
    engine.entities.insert(entity);
    insertLinked(entity);
    insertLinked(entity);

    const page = engine.graphOps.getTimeline(entity.id, { limit: 5 });
    expect(page.hasMore).toBe(false);
  });

  it('hasMore is true when more items exist beyond limit', () => {
    const entity = makeEntity('Leo');
    engine.entities.insert(entity);
    for (let i = 0; i < 5; i++) insertLinked(entity);

    const page = engine.graphOps.getTimeline(entity.id, { limit: 3 });
    expect(page.hasMore).toBe(true);
    expect(page.total).toBe(5);
  });

  it('items are ordered by event_time ascending', () => {
    const entity = makeEntity('Mia');
    engine.entities.insert(entity);
    // Insert in reverse order
    insertLinked(entity, { eventTime: BASE_TIME + 2000 });
    insertLinked(entity, { eventTime: BASE_TIME });
    insertLinked(entity, { eventTime: BASE_TIME + 1000 });

    const page = engine.graphOps.getTimeline(entity.id);
    const times = page.items.map((i) => i.eventTime);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});
