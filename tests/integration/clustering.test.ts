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
    firstSeenAt: now,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeRawItem(): RawItem {
  const body = 'raw item body ' + ulid();
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
    eventTime: Date.now(),
    ingestedAt: Date.now(),
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
let clusterer: TopicClusterer;

beforeEach(() => {
  mfdb = new MindFlowDatabase(':memory:');
  entityRepo = new EntityRepository(mfdb.db);
  rawItemRepo = new RawItemRepository(mfdb.db);
  episodeRepo = new EntityEpisodeRepository(mfdb.db);
  clusterer = new TopicClusterer(mfdb.db);
});

afterEach(() => {
  mfdb.close();
});

/**
 * Link `entityIds` to a single raw_item, establishing co-occurrence.
 */
function linkCooccurrence(entityIds: string[]): void {
  const item = makeRawItem();
  rawItemRepo.insert(item);
  for (const entityId of entityIds) {
    episodeRepo.insert({ entityId, rawItemId: item.id, extractionMethod: 'test', confidence: 1.0 });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TopicClusterer.clusterTopics()', () => {
  it('returns empty stats when there are no entities', () => {
    const stats = clusterer.clusterTopics();
    expect(stats.clusters).toHaveLength(0);
    expect(stats.topicsCreated).toBe(0);
  });

  it('creates a topic entity for a cluster of 3+ co-occurring entities', () => {
    const e1 = makeEntity({ canonicalName: 'Alice' });
    const e2 = makeEntity({ canonicalName: 'Bob' });
    const e3 = makeEntity({ canonicalName: 'Carol' });
    entityRepo.insert(e1);
    entityRepo.insert(e2);
    entityRepo.insert(e3);

    // All three co-occur in the same item
    linkCooccurrence([e1.id, e2.id, e3.id]);

    const stats = clusterer.clusterTopics();

    expect(stats.topicsCreated).toBeGreaterThanOrEqual(1);
    expect(stats.clusters.length).toBeGreaterThanOrEqual(1);

    // Verify Topic entity was actually inserted
    const topics = mfdb.db
      .prepare(`SELECT * FROM entities WHERE type = 'topic'`)
      .all() as Array<{ canonical_name: string; type: string }>;
    expect(topics.length).toBeGreaterThanOrEqual(1);
  });

  it('creates a community record for each qualifying cluster', () => {
    const entities = Array.from({ length: 4 }, () => {
      const e = makeEntity();
      entityRepo.insert(e);
      return e;
    });

    linkCooccurrence(entities.map((e) => e.id));

    clusterer.clusterTopics();

    const communities = mfdb.db
      .prepare('SELECT * FROM communities')
      .all() as Array<{ member_entity_ids: string }>;
    expect(communities.length).toBeGreaterThanOrEqual(1);

    const members = JSON.parse(communities[0]!.member_entity_ids) as string[];
    expect(members.length).toBeGreaterThanOrEqual(3);
  });

  it('does not create a topic for a cluster of fewer than 3 entities', () => {
    const e1 = makeEntity();
    const e2 = makeEntity();
    entityRepo.insert(e1);
    entityRepo.insert(e2);
    linkCooccurrence([e1.id, e2.id]);

    const stats = clusterer.clusterTopics();
    expect(stats.topicsCreated).toBe(0);
  });

  it('idempotent: second run updates topics rather than creating duplicates', () => {
    const entities = Array.from({ length: 3 }, () => {
      const e = makeEntity();
      entityRepo.insert(e);
      return e;
    });
    linkCooccurrence(entities.map((e) => e.id));

    clusterer.clusterTopics();
    const statsFirst = mfdb.db
      .prepare(`SELECT COUNT(*) as n FROM entities WHERE type = 'topic'`)
      .get() as { n: number };

    clusterer.clusterTopics();
    const statsSecond = mfdb.db
      .prepare(`SELECT COUNT(*) as n FROM entities WHERE type = 'topic'`)
      .get() as { n: number };

    // Same number of topics — no duplicates created
    expect(statsSecond.n).toBe(statsFirst.n);
  });

  it('creates part_of relationships from cluster members to topic entity', () => {
    const entities = Array.from({ length: 3 }, () => {
      const e = makeEntity();
      entityRepo.insert(e);
      return e;
    });
    linkCooccurrence(entities.map((e) => e.id));

    clusterer.clusterTopics();

    const topicRow = mfdb.db
      .prepare(`SELECT id FROM entities WHERE type = 'topic' LIMIT 1`)
      .get() as { id: string } | undefined;

    expect(topicRow).toBeDefined();

    const rels = mfdb.db
      .prepare(`SELECT * FROM relationships WHERE to_entity_id = ? AND type = 'part_of'`)
      .all(topicRow!.id) as unknown[];
    expect(rels.length).toBeGreaterThanOrEqual(3);
  });

  it('ignores merged entities when building co-occurrence', () => {
    const active = Array.from({ length: 3 }, () => {
      const e = makeEntity({ status: EntityStatus.Active });
      entityRepo.insert(e);
      return e;
    });
    const merged = makeEntity({ status: EntityStatus.Merged });
    entityRepo.insert(merged);

    // All 4 co-occur in same item, but merged entity should be excluded
    linkCooccurrence([...active.map((e) => e.id), merged.id]);

    // Should still cluster the 3 active entities
    const stats = clusterer.clusterTopics();
    expect(stats.topicsCreated).toBeGreaterThanOrEqual(1);

    // Merged entity should not appear in any cluster
    for (const cluster of stats.clusters) {
      expect(cluster.entityIds).not.toContain(merged.id);
    }
  });

  it('handles multiple disjoint groups, each forming a cluster', () => {
    // Group A: 3 entities co-occurring only with each other
    const groupA = Array.from({ length: 3 }, () => {
      const e = makeEntity({ canonicalName: 'GroupA-' + ulid().slice(-4) });
      entityRepo.insert(e);
      return e;
    });
    linkCooccurrence(groupA.map((e) => e.id));
    // Add more co-occurrences to reinforce cluster A
    linkCooccurrence(groupA.map((e) => e.id));
    linkCooccurrence(groupA.map((e) => e.id));

    // Group B: 3 different entities
    const groupB = Array.from({ length: 3 }, () => {
      const e = makeEntity({ canonicalName: 'GroupB-' + ulid().slice(-4) });
      entityRepo.insert(e);
      return e;
    });
    linkCooccurrence(groupB.map((e) => e.id));
    linkCooccurrence(groupB.map((e) => e.id));
    linkCooccurrence(groupB.map((e) => e.id));

    const stats = clusterer.clusterTopics();
    expect(stats.topicsCreated).toBeGreaterThanOrEqual(1);
  });
});

describe('TopicClusterer.detectDrift()', () => {
  it('returns false when no communities exist', () => {
    const drifted = clusterer.detectDrift(['ent-1', 'ent-2', 'ent-3']);
    expect(drifted).toBe(false);
  });

  it('returns false when the new cluster matches stored community well (>50% overlap)', () => {
    const entityIds = ['a', 'b', 'c', 'd'];
    // Store a community with the same members
    mfdb.db
      .prepare(
        `INSERT INTO communities (id, name, member_entity_ids, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(ulid(), 'Test Community', JSON.stringify(entityIds), Date.now(), Date.now());

    const drifted = clusterer.detectDrift(entityIds);
    expect(drifted).toBe(false);
  });

  it('returns true when overlap with stored community is below threshold', () => {
    const storedIds = ['a', 'b', 'c', 'd', 'e', 'f'];
    mfdb.db
      .prepare(
        `INSERT INTO communities (id, name, member_entity_ids, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(ulid(), 'Old Community', JSON.stringify(storedIds), Date.now(), Date.now());

    // New cluster has only 1 of the 6 stored members — well below 50%
    const drifted = clusterer.detectDrift(['a', 'x', 'y', 'z', 'w', 'v']);
    expect(drifted).toBe(true);
  });

  it('returns false for empty entityIds input', () => {
    expect(clusterer.detectDrift([])).toBe(false);
  });
});
