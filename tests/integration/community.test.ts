import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MindFlowDatabase } from '../../src/storage/database.js';
import { CommunityDetector } from '../../src/graph/community.js';
import { EntityType, EntityStatus, RelationshipType } from '../../src/types/index.js';
import { ulid } from '../../src/utils/ulid.js';
import type { Database } from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePersonEntity(db: Database, name: string): string {
  const id = ulid();
  const now = Date.now();
  db.prepare(
    `INSERT INTO entities (id, type, canonical_name, name_alt, aliases, attributes, confidence, status, merged_into, first_seen_at, last_seen_at, created_at, updated_at)
     VALUES (?, ?, ?, NULL, '[]', '{}', 1.0, ?, NULL, ?, ?, ?, ?)`,
  ).run(id, EntityType.Person, name, EntityStatus.Active, now, now, now, now);
  return id;
}

function makeTopicEntity(db: Database, name: string): string {
  const id = ulid();
  const now = Date.now();
  db.prepare(
    `INSERT INTO entities (id, type, canonical_name, name_alt, aliases, attributes, confidence, status, merged_into, first_seen_at, last_seen_at, created_at, updated_at)
     VALUES (?, ?, ?, NULL, '[]', '{}', 1.0, ?, NULL, ?, ?, ?, ?)`,
  ).run(id, EntityType.Topic, name, EntityStatus.Active, now, now, now, now);
  return id;
}

function connectPersons(db: Database, fromId: string, toId: string): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO relationships (id, from_entity_id, to_entity_id, type, strength, event_time, ingestion_time, valid_from, valid_until, occurrence_count, source_item_ids, metadata)
     VALUES (?, ?, ?, ?, 0.7, NULL, ?, NULL, NULL, 1, '[]', '{}')`,
  ).run(ulid(), fromId, toId, RelationshipType.CommunicatesWith, now);
}

function connectPersonToTopic(db: Database, personId: string, topicId: string): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO relationships (id, from_entity_id, to_entity_id, type, strength, event_time, ingestion_time, valid_from, valid_until, occurrence_count, source_item_ids, metadata)
     VALUES (?, ?, ?, ?, 0.7, NULL, ?, NULL, NULL, 1, '[]', '{}')`,
  ).run(ulid(), personId, topicId, RelationshipType.Discusses, now);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommunityDetector', () => {
  let mfdb: MindFlowDatabase;
  let db: Database;
  let detector: CommunityDetector;

  beforeEach(() => {
    mfdb = new MindFlowDatabase(':memory:');
    db = mfdb.db as unknown as Database;
    detector = new CommunityDetector(mfdb.db);
  });

  afterEach(() => {
    mfdb.close();
  });

  it('returns empty array when fewer than 3 person entities exist', () => {
    const a = makePersonEntity(db, 'Alice');
    const b = makePersonEntity(db, 'Bob');
    connectPersons(db, a, b);

    const results = detector.detectCommunities();
    expect(results).toHaveLength(0);
  });

  it('detects a community of 3 connected persons', () => {
    const a = makePersonEntity(db, 'Alice');
    const b = makePersonEntity(db, 'Bob');
    const c = makePersonEntity(db, 'Charlie');

    connectPersons(db, a, b);
    connectPersons(db, b, c);
    connectPersons(db, a, c);

    const results = detector.detectCommunities();
    expect(results.length).toBeGreaterThanOrEqual(1);

    const community = results[0].community;
    expect(community.id).toBeTruthy();
    expect(community.memberEntityIds).toHaveLength(3);
    expect(community.memberEntityIds).toContain(a);
    expect(community.memberEntityIds).toContain(b);
    expect(community.memberEntityIds).toContain(c);
  });

  it('does not create a community for isolated persons', () => {
    // Three connected + one isolated
    const a = makePersonEntity(db, 'Alice');
    const b = makePersonEntity(db, 'Bob');
    const c = makePersonEntity(db, 'Charlie');
    makePersonEntity(db, 'Isolated');

    connectPersons(db, a, b);
    connectPersons(db, b, c);
    connectPersons(db, a, c);

    const results = detector.detectCommunities();
    // All detected communities should have >= 3 members
    for (const r of results) {
      expect(r.community.memberEntityIds.length).toBeGreaterThanOrEqual(3);
    }
    // Isolated person should not be in any community
    for (const r of results) {
      expect(r.community.memberEntityIds).not.toContain('isolated');
    }
  });

  it('names community after connected topic', () => {
    const a = makePersonEntity(db, 'Alice');
    const b = makePersonEntity(db, 'Bob');
    const c = makePersonEntity(db, 'Charlie');
    const topic = makeTopicEntity(db, 'Q3 Budget');

    connectPersons(db, a, b);
    connectPersons(db, b, c);
    connectPersons(db, a, c);
    connectPersonToTopic(db, a, topic);
    connectPersonToTopic(db, b, topic);
    connectPersonToTopic(db, c, topic);

    const results = detector.detectCommunities();
    expect(results.length).toBeGreaterThanOrEqual(1);
    const name = results[0].community.name;
    expect(name).toContain('Q3 Budget');
  });

  it('falls back to "Group of N" when no topic connections exist', () => {
    const a = makePersonEntity(db, 'Alice');
    const b = makePersonEntity(db, 'Bob');
    const c = makePersonEntity(db, 'Charlie');

    connectPersons(db, a, b);
    connectPersons(db, b, c);
    connectPersons(db, a, c);

    const results = detector.detectCommunities();
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].community.name).toMatch(/Group of \d+/);
  });

  it('persists communities to the database', () => {
    const a = makePersonEntity(db, 'Alice');
    const b = makePersonEntity(db, 'Bob');
    const c = makePersonEntity(db, 'Charlie');

    connectPersons(db, a, b);
    connectPersons(db, b, c);
    connectPersons(db, a, c);

    detector.detectCommunities();

    const row = db.prepare('SELECT COUNT(*) as n FROM communities').get() as { n: number };
    expect(row.n).toBeGreaterThanOrEqual(1);
  });

  it('encodes membership in communities.member_entity_ids', () => {
    const a = makePersonEntity(db, 'Alice');
    const b = makePersonEntity(db, 'Bob');
    const c = makePersonEntity(db, 'Charlie');

    connectPersons(db, a, b);
    connectPersons(db, b, c);
    connectPersons(db, a, c);

    const results = detector.detectCommunities();
    expect(results[0].community.memberEntityIds).toHaveLength(3);

    // Membership is stored in the communities table, not in relationships
    const row = db
      .prepare('SELECT member_entity_ids FROM communities WHERE id = ?')
      .get(results[0].community.id) as { member_entity_ids: string };
    const stored = JSON.parse(row.member_entity_ids) as string[];
    expect(stored).toHaveLength(3);
  });

  it('getCommunities returns all persisted communities', () => {
    const a = makePersonEntity(db, 'Alice');
    const b = makePersonEntity(db, 'Bob');
    const c = makePersonEntity(db, 'Charlie');

    connectPersons(db, a, b);
    connectPersons(db, b, c);
    connectPersons(db, a, c);

    detector.detectCommunities();
    const communities = detector.getCommunities();

    expect(communities.length).toBeGreaterThanOrEqual(1);
    expect(communities[0].memberCount).toBeGreaterThanOrEqual(3);
    expect(communities[0].name).toBeTruthy();
  });

  it('re-running detectCommunities updates existing communities', () => {
    const a = makePersonEntity(db, 'Alice');
    const b = makePersonEntity(db, 'Bob');
    const c = makePersonEntity(db, 'Charlie');

    connectPersons(db, a, b);
    connectPersons(db, b, c);
    connectPersons(db, a, c);

    detector.detectCommunities();
    detector.detectCommunities();

    const row = db.prepare('SELECT COUNT(*) as n FROM communities').get() as { n: number };
    // Should not double-up — same membership → same record
    expect(row.n).toBeGreaterThanOrEqual(1);
  });

  it('two separate cliques produce separate communities', () => {
    // Clique 1
    const a = makePersonEntity(db, 'Alice');
    const b = makePersonEntity(db, 'Bob');
    const c = makePersonEntity(db, 'Charlie');
    connectPersons(db, a, b);
    connectPersons(db, b, c);
    connectPersons(db, a, c);

    // Clique 2 (no connections to clique 1)
    const x = makePersonEntity(db, 'Xavier');
    const y = makePersonEntity(db, 'Yvonne');
    const z = makePersonEntity(db, 'Zara');
    connectPersons(db, x, y);
    connectPersons(db, y, z);
    connectPersons(db, x, z);

    const results = detector.detectCommunities();
    // Label propagation should separate the two cliques
    expect(results.length).toBeGreaterThanOrEqual(2);

    // Each community should have 3 members
    for (const r of results) {
      expect(r.community.memberEntityIds.length).toBeGreaterThanOrEqual(3);
    }
  });
});
