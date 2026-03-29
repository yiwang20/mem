import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CrossChannelLinker } from '../../src/graph/cross-channel.js';
import { MindFlowEngine } from '../../src/core/engine.js';
import {
  BodyFormat,
  DetectedLanguage,
  EntityStatus,
  EntityType,
  ProcessingStatus,
  RelationshipType,
  SourceAdapterType,
  SourceChannel,
} from '../../src/types/index.js';
import { ulid } from '../../src/utils/ulid.js';
import { sha256 } from '../../src/utils/hash.js';

let engine: MindFlowEngine;
let linker: CrossChannelLinker;

const NOW = 1_700_000_000_000; // fixed reference time

beforeEach(() => {
  engine = new MindFlowEngine({ dbPath: ':memory:' });
  linker = engine.crossChannelLinker;
});

afterEach(() => {
  engine.close();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePersonEntity(name: string) {
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
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeThreadEntity(name: string, externalThreadId: string, eventTime = NOW) {
  return {
    id: ulid(),
    type: EntityType.Thread,
    canonicalName: name,
    nameAlt: null,
    aliases: [],
    attributes: { externalThreadId },
    confidence: 1.0,
    status: EntityStatus.Active,
    mergedInto: null,
    firstSeenAt: eventTime,
    lastSeenAt: eventTime,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeRawItem(overrides: Partial<{
  channel: SourceChannel;
  sourceAdapter: SourceAdapterType;
  threadId: string | null;
  senderEntityId: string | null;
  eventTime: number;
  body: string;
}> = {}) {
  const body = overrides.body ?? ('body-' + ulid());
  return {
    id: ulid(),
    sourceAdapter: overrides.sourceAdapter ?? SourceAdapterType.Gmail,
    channel: overrides.channel ?? SourceChannel.Email,
    externalId: 'ext-' + ulid(),
    threadId: overrides.threadId ?? null,
    senderEntityId: overrides.senderEntityId ?? null,
    recipientEntityIds: [],
    subject: null,
    body,
    bodyFormat: BodyFormat.Plaintext,
    contentHash: sha256(body),
    language: DetectedLanguage.English,
    eventTime: overrides.eventTime ?? NOW,
    ingestedAt: NOW,
    processingStatus: ProcessingStatus.Done,
    attachments: [],
    metadata: {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CrossChannelLinker.detectContinuations()', () => {
  it('returns 0 when there are no items', () => {
    const count = linker.detectContinuations({ now: NOW });
    expect(count).toBe(0);
  });

  it('returns 0 when all items are on the same channel', () => {
    const person = makePersonEntity('Alice');
    engine.entities.insert(person);

    const threadEntity = makeThreadEntity('Email thread', 'thread-1');
    engine.entities.insert(threadEntity);

    const item = makeRawItem({ channel: SourceChannel.Email, threadId: 'thread-1', eventTime: NOW });
    engine.rawItems.insert(item);
    engine.entityEpisodes.insert({ entityId: person.id, rawItemId: item.id, extractionMethod: 'test', confidence: 1 });
    engine.entityEpisodes.insert({ entityId: threadEntity.id, rawItemId: item.id, extractionMethod: 'thread', confidence: 1 });

    const item2 = makeRawItem({ channel: SourceChannel.Email, threadId: 'thread-1', eventTime: NOW + 1000 });
    engine.rawItems.insert(item2);
    engine.entityEpisodes.insert({ entityId: person.id, rawItemId: item2.id, extractionMethod: 'test', confidence: 1 });

    const count = linker.detectContinuations({ now: NOW + 2000 });
    expect(count).toBe(0);
  });

  it('creates a ContinuesIn relationship when same person appears in email then iMessage within 24h', () => {
    const person = makePersonEntity('Bob');
    engine.entities.insert(person);

    // Email thread entity
    const emailThread = makeThreadEntity('Email: project update', 'email-thread-1', NOW);
    engine.entities.insert(emailThread);

    // iMessage thread entity
    const imsgThread = makeThreadEntity('iMessage: project update', 'imsg-thread-1', NOW + 3600_000);
    engine.entities.insert(imsgThread);

    // Email item — person appears
    const emailItem = makeRawItem({
      channel: SourceChannel.Email,
      sourceAdapter: SourceAdapterType.Gmail,
      threadId: 'email-thread-1',
      eventTime: NOW,
    });
    engine.rawItems.insert(emailItem);
    engine.entityEpisodes.insert({ entityId: person.id, rawItemId: emailItem.id, extractionMethod: 'test', confidence: 1 });
    engine.entityEpisodes.insert({ entityId: emailThread.id, rawItemId: emailItem.id, extractionMethod: 'thread', confidence: 1 });

    // iMessage item — same person, 1 hour later
    const imsgItem = makeRawItem({
      channel: SourceChannel.IMessage,
      sourceAdapter: SourceAdapterType.IMessage,
      threadId: 'imsg-thread-1',
      eventTime: NOW + 3600_000,
    });
    engine.rawItems.insert(imsgItem);
    engine.entityEpisodes.insert({ entityId: person.id, rawItemId: imsgItem.id, extractionMethod: 'test', confidence: 1 });
    engine.entityEpisodes.insert({ entityId: imsgThread.id, rawItemId: imsgItem.id, extractionMethod: 'thread', confidence: 1 });

    const count = linker.detectContinuations({ now: NOW + 7200_000 });
    expect(count).toBe(1);

    // Verify the relationship
    const rels = engine.relationships.findByEntity(emailThread.id);
    const continuesIn = rels.find((r) => r.type === RelationshipType.ContinuesIn);
    expect(continuesIn).toBeDefined();
    expect(continuesIn!.fromEntityId).toBe(emailThread.id);
    expect(continuesIn!.toEntityId).toBe(imsgThread.id);
    expect(continuesIn!.metadata['fromChannel']).toBe(SourceChannel.Email);
    expect(continuesIn!.metadata['toChannel']).toBe(SourceChannel.IMessage);
    expect(continuesIn!.metadata['bridgingEntityId']).toBe(person.id);
  });

  it('does not create duplicate relationships on repeated calls', () => {
    const person = makePersonEntity('Carol');
    engine.entities.insert(person);

    const emailThread = makeThreadEntity('Email thread', 'email-t', NOW);
    engine.entities.insert(emailThread);
    const imsgThread = makeThreadEntity('iMessage thread', 'imsg-t', NOW + 3600_000);
    engine.entities.insert(imsgThread);

    const emailItem = makeRawItem({ channel: SourceChannel.Email, threadId: 'email-t', eventTime: NOW });
    engine.rawItems.insert(emailItem);
    engine.entityEpisodes.insert({ entityId: person.id, rawItemId: emailItem.id, extractionMethod: 'test', confidence: 1 });
    engine.entityEpisodes.insert({ entityId: emailThread.id, rawItemId: emailItem.id, extractionMethod: 'thread', confidence: 1 });

    const imsgItem = makeRawItem({ channel: SourceChannel.IMessage, threadId: 'imsg-t', eventTime: NOW + 3600_000 });
    engine.rawItems.insert(imsgItem);
    engine.entityEpisodes.insert({ entityId: person.id, rawItemId: imsgItem.id, extractionMethod: 'test', confidence: 1 });
    engine.entityEpisodes.insert({ entityId: imsgThread.id, rawItemId: imsgItem.id, extractionMethod: 'thread', confidence: 1 });

    const n = NOW + 7200_000;
    const first = linker.detectContinuations({ now: n });
    const second = linker.detectContinuations({ now: n });

    expect(first).toBe(1);
    expect(second).toBe(0); // already exists — no duplicate
  });

  it('ignores items outside the 24-hour window', () => {
    const person = makePersonEntity('Dave');
    engine.entities.insert(person);

    const emailThread = makeThreadEntity('Email thread', 'email-old', NOW - 30 * 3600_000);
    engine.entities.insert(emailThread);
    const imsgThread = makeThreadEntity('iMessage thread', 'imsg-new', NOW);
    engine.entities.insert(imsgThread);

    // Email item is 30 hours before NOW — outside the 24h window
    const emailItem = makeRawItem({ channel: SourceChannel.Email, threadId: 'email-old', eventTime: NOW - 30 * 3600_000 });
    engine.rawItems.insert(emailItem);
    engine.entityEpisodes.insert({ entityId: person.id, rawItemId: emailItem.id, extractionMethod: 'test', confidence: 1 });
    engine.entityEpisodes.insert({ entityId: emailThread.id, rawItemId: emailItem.id, extractionMethod: 'thread', confidence: 1 });

    const imsgItem = makeRawItem({ channel: SourceChannel.IMessage, threadId: 'imsg-new', eventTime: NOW });
    engine.rawItems.insert(imsgItem);
    engine.entityEpisodes.insert({ entityId: person.id, rawItemId: imsgItem.id, extractionMethod: 'test', confidence: 1 });
    engine.entityEpisodes.insert({ entityId: imsgThread.id, rawItemId: imsgItem.id, extractionMethod: 'thread', confidence: 1 });

    const count = linker.detectContinuations({ now: NOW + 3600_000 });
    expect(count).toBe(0);
  });

  it('links via topic entity as well as person entity', () => {
    const topic = {
      id: ulid(),
      type: EntityType.Topic,
      canonicalName: 'Q4 planning',
      nameAlt: null,
      aliases: [],
      attributes: {},
      confidence: 1.0,
      status: EntityStatus.Active,
      mergedInto: null,
      firstSeenAt: NOW,
      lastSeenAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    };
    engine.entities.insert(topic);

    const emailThread = makeThreadEntity('Email: Q4', 'email-q4', NOW);
    engine.entities.insert(emailThread);
    const imsgThread = makeThreadEntity('iMsg: Q4', 'imsg-q4', NOW + 1800_000);
    engine.entities.insert(imsgThread);

    const emailItem = makeRawItem({ channel: SourceChannel.Email, threadId: 'email-q4', eventTime: NOW });
    engine.rawItems.insert(emailItem);
    engine.entityEpisodes.insert({ entityId: topic.id, rawItemId: emailItem.id, extractionMethod: 'test', confidence: 1 });
    engine.entityEpisodes.insert({ entityId: emailThread.id, rawItemId: emailItem.id, extractionMethod: 'thread', confidence: 1 });

    const imsgItem = makeRawItem({ channel: SourceChannel.IMessage, threadId: 'imsg-q4', eventTime: NOW + 1800_000 });
    engine.rawItems.insert(imsgItem);
    engine.entityEpisodes.insert({ entityId: topic.id, rawItemId: imsgItem.id, extractionMethod: 'test', confidence: 1 });
    engine.entityEpisodes.insert({ entityId: imsgThread.id, rawItemId: imsgItem.id, extractionMethod: 'thread', confidence: 1 });

    const count = linker.detectContinuations({ now: NOW + 3600_000 });
    expect(count).toBe(1);

    const rels = engine.relationships.findByEntity(emailThread.id);
    const link = rels.find((r) => r.type === RelationshipType.ContinuesIn);
    expect(link).toBeDefined();
    expect(link!.metadata['bridgingEntityId']).toBe(topic.id);
  });
});
