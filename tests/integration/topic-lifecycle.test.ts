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
import { TopicLifecycleManager } from '../../src/graph/topic-lifecycle.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ONE_DAY = 24 * 60 * 60 * 1000;

function makeTopic(overrides: Partial<Entity> = {}): Entity {
  const now = Date.now();
  return {
    id: ulid(),
    type: EntityType.Topic,
    canonicalName: 'Test Topic',
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

function makeRawItem(eventTime: number): RawItem {
  const body = 'body ' + ulid();
  return {
    id: ulid(),
    sourceAdapter: SourceAdapterType.Gmail,
    channel: SourceChannel.Email,
    externalId: 'ext-' + ulid(),
    threadId: null,
    senderEntityId: null,
    recipientEntityIds: [],
    subject: null,
    body,
    bodyFormat: BodyFormat.Plaintext,
    contentHash: sha256(body),
    language: DetectedLanguage.English,
    eventTime,
    ingestedAt: eventTime,
    processingStatus: ProcessingStatus.Done,
    attachments: [],
    metadata: {},
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let mfdb: MindFlowDatabase;
let entityRepo: EntityRepository;
let rawItemRepo: RawItemRepository;
let episodeRepo: EntityEpisodeRepository;
let manager: TopicLifecycleManager;

beforeEach(() => {
  mfdb = new MindFlowDatabase(':memory:');
  entityRepo = new EntityRepository(mfdb.db);
  rawItemRepo = new RawItemRepository(mfdb.db);
  episodeRepo = new EntityEpisodeRepository(mfdb.db);
  manager = new TopicLifecycleManager(mfdb.db);
});

afterEach(() => {
  mfdb.close();
});

// Helper: link a raw item to a topic entity via entity_episodes
function linkEpisode(entityId: string, eventTime: number): void {
  const item = makeRawItem(eventTime);
  rawItemRepo.insert(item);
  episodeRepo.insert({ entityId, rawItemId: item.id, extractionMethod: 'test', confidence: 1.0 });
}

// ---------------------------------------------------------------------------
// Active → Dormant (15 days idle)
// ---------------------------------------------------------------------------

describe('Active → Dormant transition', () => {
  it('marks an active topic as dormant when last episode is 15 days ago', () => {
    const now = Date.now();
    const topic = makeTopic({ canonicalName: 'Stale Topic', status: EntityStatus.Active });
    entityRepo.insert(topic);
    linkEpisode(topic.id, now - 15 * ONE_DAY);

    manager.updateLifecycles(now);

    const updated = entityRepo.findById(topic.id);
    expect(updated?.status).toBe(EntityStatus.Dormant);
  });

  it('does not change an active topic with recent activity (2 days ago)', () => {
    const now = Date.now();
    const topic = makeTopic({ canonicalName: 'Active Topic', status: EntityStatus.Active });
    entityRepo.insert(topic);
    linkEpisode(topic.id, now - 2 * ONE_DAY);

    manager.updateLifecycles(now);

    const updated = entityRepo.findById(topic.id);
    expect(updated?.status).toBe(EntityStatus.Active);
  });

  it('returns the count of updated entities', () => {
    const now = Date.now();
    const t1 = makeTopic({ canonicalName: 'T1' });
    const t2 = makeTopic({ canonicalName: 'T2' });
    entityRepo.insert(t1);
    entityRepo.insert(t2);
    linkEpisode(t1.id, now - 15 * ONE_DAY);
    linkEpisode(t2.id, now - 15 * ONE_DAY);

    const count = manager.updateLifecycles(now);
    expect(count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Active/Dormant → Archived (61 days idle)
// ---------------------------------------------------------------------------

describe('→ Archived transition', () => {
  it('marks a topic as archived when last episode is 61 days ago', () => {
    const now = Date.now();
    const topic = makeTopic({ canonicalName: 'Ancient Topic', status: EntityStatus.Active });
    entityRepo.insert(topic);
    linkEpisode(topic.id, now - 61 * ONE_DAY);

    manager.updateLifecycles(now);

    const updated = entityRepo.findById(topic.id);
    expect(updated?.status).toBe(EntityStatus.Archived);
  });

  it('marks a dormant topic as archived when it crosses 60 days', () => {
    const now = Date.now();
    const topic = makeTopic({ canonicalName: 'Old Dormant Topic', status: EntityStatus.Dormant });
    entityRepo.insert(topic);
    linkEpisode(topic.id, now - 61 * ONE_DAY);

    manager.updateLifecycles(now);

    const updated = entityRepo.findById(topic.id);
    expect(updated?.status).toBe(EntityStatus.Archived);
  });

  it('does not archive a topic that is only 20 days idle', () => {
    const now = Date.now();
    const topic = makeTopic({ canonicalName: 'Recent Dormant', status: EntityStatus.Dormant });
    entityRepo.insert(topic);
    linkEpisode(topic.id, now - 20 * ONE_DAY);

    manager.updateLifecycles(now);

    const updated = entityRepo.findById(topic.id);
    expect(updated?.status).toBe(EntityStatus.Dormant);
  });
});

// ---------------------------------------------------------------------------
// Dormant/Archived → Active (re-activation)
// ---------------------------------------------------------------------------

describe('Re-activation transition', () => {
  it('reactivates a dormant topic when a new episode is added', () => {
    const now = Date.now();
    const topic = makeTopic({ canonicalName: 'Revived Topic', status: EntityStatus.Dormant });
    entityRepo.insert(topic);
    // Old episode that made it dormant, plus a fresh one
    linkEpisode(topic.id, now - 20 * ONE_DAY);
    linkEpisode(topic.id, now - 1 * ONE_DAY); // recent episode

    manager.updateLifecycles(now);

    const updated = entityRepo.findById(topic.id);
    expect(updated?.status).toBe(EntityStatus.Active);
  });

  it('reactivates an archived topic when a new episode is added', () => {
    const now = Date.now();
    const topic = makeTopic({ canonicalName: 'Archived Revived', status: EntityStatus.Archived });
    entityRepo.insert(topic);
    linkEpisode(topic.id, now - 70 * ONE_DAY);
    linkEpisode(topic.id, now - 3 * ONE_DAY); // new activity

    manager.updateLifecycles(now);

    const updated = entityRepo.findById(topic.id);
    expect(updated?.status).toBe(EntityStatus.Active);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('Edge cases', () => {
  it('does not touch merged topics', () => {
    const now = Date.now();
    const topic = makeTopic({ status: EntityStatus.Merged });
    entityRepo.insert(topic);
    // No episode — would trigger archived if the entity weren't merged
    manager.updateLifecycles(now);
    const updated = entityRepo.findById(topic.id);
    expect(updated?.status).toBe(EntityStatus.Merged);
  });

  it('does not touch non-topic entities', () => {
    const now = Date.now();
    const person: Entity = {
      ...makeTopic({ canonicalName: 'Alice', status: EntityStatus.Active }),
      type: EntityType.Person,
    };
    entityRepo.insert(person);
    // No episodes — if treated as topic would become dormant/archived

    manager.updateLifecycles(now);

    const updated = entityRepo.findById(person.id);
    expect(updated?.status).toBe(EntityStatus.Active);
  });

  it('topic with no episodes at all becomes archived (idle since epoch)', () => {
    const now = Date.now();
    const topic = makeTopic({ canonicalName: 'No Episodes', status: EntityStatus.Active });
    entityRepo.insert(topic);
    // No episodes linked at all

    manager.updateLifecycles(now);

    // idle since 0 (epoch) >> 60 days → archived
    const updated = entityRepo.findById(topic.id);
    expect(updated?.status).toBe(EntityStatus.Archived);
  });

  it('updates updatedAt on transition', () => {
    const now = Date.now();
    const topic = makeTopic({ canonicalName: 'Timestamp Check', status: EntityStatus.Active });
    entityRepo.insert(topic);
    linkEpisode(topic.id, now - 15 * ONE_DAY);

    manager.updateLifecycles(now);

    const updated = entityRepo.findById(topic.id);
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(now);
  });
});
