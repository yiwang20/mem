import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { MindFlowEngine } from '../../src/core/engine.js';
import { EntityStatus, EntityType } from '../../src/types/index.js';
import type { Entity } from '../../src/types/index.js';
import { ulid } from '../../src/utils/ulid.js';
import { registerTopicsRoutes } from '../../src/adapters/http/routes/topics.js';
import { BodyFormat, DetectedLanguage, ProcessingStatus, SourceAdapterType, SourceChannel } from '../../src/types/index.js';
import { sha256 } from '../../src/utils/hash.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTopic(
  canonicalName: string,
  parentEntityId: string | null = null,
): Entity {
  const now = Date.now();
  return {
    id: ulid(),
    type: EntityType.Topic,
    canonicalName,
    nameAlt: null,
    aliases: [],
    attributes: {},
    confidence: 1.0,
    status: EntityStatus.Active,
    mergedInto: null,
    parentEntityId,
    firstSeenAt: now,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let engine: MindFlowEngine;
let app: FastifyInstance;

async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });
  await registerTopicsRoutes(fastify, engine);
  return fastify;
}

beforeEach(() => {
  engine = new MindFlowEngine({ dbPath: ':memory:' });
});

afterEach(async () => {
  if (app) await app.close().catch(() => undefined);
  engine.close();
});

// ---------------------------------------------------------------------------
// GET /api/topics/:id/ancestors
// ---------------------------------------------------------------------------

describe('GET /api/topics/:id/ancestors', () => {
  it('returns 404 for unknown topic id', async () => {
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/api/topics/${ulid()}/ancestors` });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for non-topic entity', async () => {
    app = await buildApp();
    const person: Entity = {
      ...makeTopic('Alice'),
      type: EntityType.Person,
    };
    engine.entities.insert(person);
    const res = await app.inject({ method: 'GET', url: `/api/topics/${person.id}/ancestors` });
    expect(res.statusCode).toBe(404);
  });

  it('top-level topic: path is [root, self] and children are empty when no children', async () => {
    app = await buildApp();
    const topic = makeTopic('Q3 Budget');
    engine.entities.insert(topic);

    const res = await app.inject({ method: 'GET', url: `/api/topics/${topic.id}/ancestors` });
    expect(res.statusCode).toBe(200);

    const body = res.json() as { path: Array<{ id: string; label: string; type: string }>; children: unknown[] };
    expect(body.path).toHaveLength(2);
    expect(body.path[0]).toEqual({ id: 'root', label: 'Topics', type: 'topic' });
    expect(body.path[1]).toMatchObject({ id: topic.id, label: 'Q3 Budget', type: 'topic' });
    expect(body.children).toHaveLength(0);
  });

  it('nested topic: path contains full chain root → grandparent → parent → self', async () => {
    app = await buildApp();
    const root = makeTopic('Q3 Budget', null);
    const parent = makeTopic('Marketing Budget', root.id);
    const self = makeTopic('Social Media Budget', parent.id);
    engine.entities.insert(root);
    engine.entities.insert(parent);
    engine.entities.insert(self);

    const res = await app.inject({ method: 'GET', url: `/api/topics/${self.id}/ancestors` });
    expect(res.statusCode).toBe(200);

    const body = res.json() as { path: Array<{ id: string; label: string }>; children: unknown[] };
    expect(body.path).toHaveLength(4); // root virtual + Q3 Budget + Marketing Budget + Social Media Budget
    expect(body.path[0]).toEqual({ id: 'root', label: 'Topics', type: 'topic' });
    expect(body.path[1]).toMatchObject({ id: root.id, label: 'Q3 Budget' });
    expect(body.path[2]).toMatchObject({ id: parent.id, label: 'Marketing Budget' });
    expect(body.path[3]).toMatchObject({ id: self.id, label: 'Social Media Budget' });
  });

  it('returns direct children with messageCount', async () => {
    app = await buildApp();
    const parent = makeTopic('Q3 Budget', null);
    const child1 = makeTopic('Marketing Budget', parent.id);
    const child2 = makeTopic('R&D Budget', parent.id);
    engine.entities.insert(parent);
    engine.entities.insert(child1);
    engine.entities.insert(child2);

    const res = await app.inject({ method: 'GET', url: `/api/topics/${parent.id}/ancestors` });
    expect(res.statusCode).toBe(200);

    const body = res.json() as { path: unknown[]; children: Array<{ id: string; label: string; status: string; messageCount: number }> };
    expect(body.children).toHaveLength(2);
    const labels = body.children.map((c) => c.label).sort();
    expect(labels).toEqual(['Marketing Budget', 'R&D Budget']);
    expect(body.children.every((c) => c.messageCount === 0)).toBe(true);
    expect(body.children.every((c) => c.status === 'active')).toBe(true);
  });

  it('children messageCount reflects actual episode count', async () => {
    app = await buildApp();
    const parent = makeTopic('Planning', null);
    const child = makeTopic('Budget Planning', parent.id);
    engine.entities.insert(parent);
    engine.entities.insert(child);

    // Insert 3 raw items + episodes for child
    for (let i = 0; i < 3; i++) {
      const body = `episode body ${i} ${ulid()}`;
      const rawItemId = ulid();
      engine.db.db
        .prepare(
          `INSERT INTO raw_items
             (id, source_adapter, channel, external_id, body, body_format,
              content_hash, event_time, ingested_at, processing_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(rawItemId, SourceAdapterType.Gmail, SourceChannel.Email, `ext-${rawItemId}`,
          body, BodyFormat.Plaintext, sha256(body), Date.now(), Date.now(), ProcessingStatus.Done);
      engine.db.db
        .prepare(
          `INSERT INTO entity_episodes (entity_id, raw_item_id, extraction_method, confidence)
           VALUES (?, ?, 'test', 1.0)`,
        )
        .run(child.id, rawItemId);
    }

    const res = await app.inject({ method: 'GET', url: `/api/topics/${parent.id}/ancestors` });
    const body = res.json() as { children: Array<{ id: string; messageCount: number }> };
    const childInResponse = body.children.find((c) => c.id === child.id)!;
    expect(childInResponse.messageCount).toBe(3);
  });

  it('merged topics are excluded from children', async () => {
    app = await buildApp();
    const parent = makeTopic('Budget', null);
    const active = makeTopic('Active Child', parent.id);
    const merged = makeTopic('Merged Child', parent.id);
    engine.entities.insert(parent);
    engine.entities.insert(active);
    engine.entities.insert({ ...merged, status: EntityStatus.Merged, mergedInto: active.id });

    const res = await app.inject({ method: 'GET', url: `/api/topics/${parent.id}/ancestors` });
    const body = res.json() as { children: Array<{ id: string }> };
    expect(body.children).toHaveLength(1);
    expect(body.children[0]!.id).toBe(active.id);
  });

  it('children are sorted alphabetically', async () => {
    app = await buildApp();
    const parent = makeTopic('Planning', null);
    engine.entities.insert(parent);
    for (const name of ['Zebra Topic', 'Alpha Topic', 'Middle Topic']) {
      engine.entities.insert(makeTopic(name, parent.id));
    }

    const res = await app.inject({ method: 'GET', url: `/api/topics/${parent.id}/ancestors` });
    const body = res.json() as { children: Array<{ label: string }> };
    const labels = body.children.map((c) => c.label);
    expect(labels).toEqual(['Alpha Topic', 'Middle Topic', 'Zebra Topic']);
  });
});
