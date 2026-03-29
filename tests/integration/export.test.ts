import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MindFlowDatabase } from '../../src/storage/database.js';
import {
  EntityEpisodeRepository,
  EntityRepository,
  RawItemRepository,
  RelationshipRepository,
} from '../../src/storage/repositories.js';
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
import type { Entity, RawItem, Relationship } from '../../src/types/index.js';
import { ulid } from '../../src/utils/ulid.js';
import { sha256 } from '../../src/utils/hash.js';
import { DataExporter } from '../../src/core/export.js';

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

function makeRawItem(overrides: Partial<RawItem> = {}): RawItem {
  const body = 'body ' + ulid();
  const now = Date.now();
  return {
    id: ulid(),
    sourceAdapter: SourceAdapterType.Gmail,
    channel: SourceChannel.Email,
    externalId: 'ext-' + ulid(),
    threadId: null,
    senderEntityId: null,
    recipientEntityIds: [],
    subject: 'Test Subject',
    body,
    bodyFormat: BodyFormat.Plaintext,
    contentHash: sha256(body),
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
  fromEntityId: string,
  toEntityId: string,
  overrides: Partial<Relationship> = {},
): Relationship {
  const now = Date.now();
  return {
    id: ulid(),
    fromEntityId,
    toEntityId,
    type: RelationshipType.Discusses,
    strength: 0.7,
    eventTime: now,
    ingestionTime: now,
    validFrom: now,
    validUntil: null,
    occurrenceCount: 1,
    sourceItemIds: [],
    metadata: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let mfdb: MindFlowDatabase;
let entityRepo: EntityRepository;
let rawItemRepo: RawItemRepository;
let relRepo: RelationshipRepository;
let episodeRepo: EntityEpisodeRepository;
let exporter: DataExporter;

beforeEach(() => {
  mfdb = new MindFlowDatabase(':memory:');
  entityRepo = new EntityRepository(mfdb.db);
  rawItemRepo = new RawItemRepository(mfdb.db);
  relRepo = new RelationshipRepository(mfdb.db);
  episodeRepo = new EntityEpisodeRepository(mfdb.db);
  exporter = new DataExporter(mfdb.db);
});

afterEach(() => {
  mfdb.close();
});

// ---------------------------------------------------------------------------
// DataExporter.exportJsonLd()
// ---------------------------------------------------------------------------

describe('DataExporter.exportJsonLd()', () => {
  it('returns a valid JSON-LD document with @context and @graph', async () => {
    const doc = await exporter.exportJsonLd();
    expect(doc['@context']).toBeDefined();
    expect(Array.isArray(doc['@graph'])).toBe(true);
  });

  it('includes entities in the @graph', async () => {
    const entity = makeEntity({ canonicalName: 'Alice', type: EntityType.Person });
    entityRepo.insert(entity);

    const doc = await exporter.exportJsonLd();
    const graph = doc['@graph'] as Array<Record<string, unknown>>;

    const node = graph.find((n) => n['@id'] === `mf:entity/${entity.id}`);
    expect(node).toBeDefined();
    expect(node!['@type']).toBe('schema:Person');
    expect(node!['schema:name']).toBe('Alice');
  });

  it('maps entity types to schema.org types correctly', async () => {
    const cases: Array<[EntityType, string]> = [
      [EntityType.Person, 'schema:Person'],
      [EntityType.Topic, 'schema:Thing'],
      [EntityType.ActionItem, 'schema:Action'],
      [EntityType.Document, 'schema:DigitalDocument'],
    ];

    for (const [type, expectedSchema] of cases) {
      const e = makeEntity({ type, canonicalName: String(type) });
      entityRepo.insert(e);

      const doc = await exporter.exportJsonLd();
      const graph = doc['@graph'] as Array<Record<string, unknown>>;
      const node = graph.find((n) => n['@id'] === `mf:entity/${e.id}`);
      expect(node!['@type']).toBe(expectedSchema);
    }
  });

  it('excludes merged entities', async () => {
    const merged = makeEntity({ status: EntityStatus.Merged });
    entityRepo.insert(merged);

    const doc = await exporter.exportJsonLd();
    const graph = doc['@graph'] as Array<Record<string, unknown>>;
    const node = graph.find((n) => n['@id'] === `mf:entity/${merged.id}`);
    expect(node).toBeUndefined();
  });

  it('includes relationships in the @graph', async () => {
    const e1 = makeEntity({ canonicalName: 'Alice' });
    const e2 = makeEntity({ canonicalName: 'Budget' });
    entityRepo.insert(e1);
    entityRepo.insert(e2);
    const rel = makeRelationship(e1.id, e2.id, { type: RelationshipType.Discusses });
    relRepo.insert(rel);

    const doc = await exporter.exportJsonLd();
    const graph = doc['@graph'] as Array<Record<string, unknown>>;

    const relNode = graph.find((n) => n['@id'] === `mf:relationship/${rel.id}`);
    expect(relNode).toBeDefined();
    expect(relNode!['@type']).toBe('mf:Relationship');
    expect(relNode!['mf:from']).toEqual({ '@id': `mf:entity/${e1.id}` });
  });

  it('includes raw items in the @graph', async () => {
    const item = makeRawItem({ subject: 'Hello' });
    rawItemRepo.insert(item);

    const doc = await exporter.exportJsonLd();
    const graph = doc['@graph'] as Array<Record<string, unknown>>;

    const itemNode = graph.find((n) => n['@id'] === `mf:item/${item.id}`);
    expect(itemNode).toBeDefined();
    expect(itemNode!['mf:channel']).toBe('email');
    expect(itemNode!['schema:name']).toBe('Hello');
  });

  it('returns empty @graph for a fresh database', async () => {
    const doc = await exporter.exportJsonLd();
    const graph = doc['@graph'] as unknown[];
    expect(graph).toHaveLength(0);
  });

  it('includes nameAlt as schema:alternateName when present', async () => {
    const entity = makeEntity({ canonicalName: '王总', nameAlt: 'Wang Zong' });
    entityRepo.insert(entity);

    const doc = await exporter.exportJsonLd();
    const graph = doc['@graph'] as Array<Record<string, unknown>>;
    const node = graph.find((n) => n['@id'] === `mf:entity/${entity.id}`);
    expect(node!['schema:alternateName']).toBe('Wang Zong');
  });
});

// ---------------------------------------------------------------------------
// DataExporter.deleteEntity()
// ---------------------------------------------------------------------------

describe('DataExporter.deleteEntity()', () => {
  it('removes the entity row', () => {
    const entity = makeEntity();
    entityRepo.insert(entity);

    exporter.deleteEntity(entity.id);

    expect(entityRepo.findById(entity.id)).toBeUndefined();
  });

  it('removes associated relationships in both directions', () => {
    const e1 = makeEntity({ canonicalName: 'Alice' });
    const e2 = makeEntity({ canonicalName: 'Bob' });
    entityRepo.insert(e1);
    entityRepo.insert(e2);
    relRepo.insert(makeRelationship(e1.id, e2.id));
    relRepo.insert(makeRelationship(e2.id, e1.id));

    exporter.deleteEntity(e1.id);

    const remaining = mfdb.db
      .prepare(
        'SELECT * FROM relationships WHERE from_entity_id = ? OR to_entity_id = ?',
      )
      .all(e1.id, e1.id);
    expect(remaining).toHaveLength(0);
  });

  it('removes entity_episodes', () => {
    const entity = makeEntity();
    entityRepo.insert(entity);
    const item = makeRawItem();
    rawItemRepo.insert(item);
    episodeRepo.insert({ entityId: entity.id, rawItemId: item.id, extractionMethod: 'test', confidence: 1.0 });

    exporter.deleteEntity(entity.id);

    const episodes = mfdb.db
      .prepare('SELECT * FROM entity_episodes WHERE entity_id = ?')
      .all(entity.id);
    expect(episodes).toHaveLength(0);
  });

  it('removes entity_aliases', () => {
    const entity = makeEntity();
    entityRepo.insert(entity);
    mfdb.db
      .prepare('INSERT INTO entity_aliases (id, entity_id, alias, alias_type, confidence) VALUES (?, ?, ?, ?, ?)')
      .run(ulid(), entity.id, 'Ali', 'name', 1.0);

    exporter.deleteEntity(entity.id);

    const aliases = mfdb.db
      .prepare('SELECT * FROM entity_aliases WHERE entity_id = ?')
      .all(entity.id);
    expect(aliases).toHaveLength(0);
  });

  it('does not affect other entities', () => {
    const e1 = makeEntity({ canonicalName: 'Alice' });
    const e2 = makeEntity({ canonicalName: 'Bob' });
    entityRepo.insert(e1);
    entityRepo.insert(e2);

    exporter.deleteEntity(e1.id);

    expect(entityRepo.findById(e2.id)).toBeDefined();
  });

  it('is idempotent — deleting a non-existent entity does not throw', () => {
    expect(() => exporter.deleteEntity('non-existent-id')).not.toThrow();
  });
});
