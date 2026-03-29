import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { MindFlowEngine } from '../../src/core/engine.js';
import { EntityStatus, EntityType } from '../../src/types/index.js';
import type { Entity, LLMProvider } from '../../src/types/index.js';
import { ulid } from '../../src/utils/ulid.js';
import { registerTopicsRoutes } from '../../src/adapters/http/routes/topics.js';
import {
  BodyFormat,
  DetectedLanguage,
  ProcessingStatus,
  SourceAdapterType,
  SourceChannel,
} from '../../src/types/index.js';
import { sha256 } from '../../src/utils/hash.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTopic(
  canonicalName: string,
  parentEntityId: string | null = null,
  status: EntityStatus = EntityStatus.Active,
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
    status,
    mergedInto: null,
    parentEntityId,
    firstSeenAt: now,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function insertEpisode(engine: MindFlowEngine, topicId: string): string {
  const rawItemId = ulid();
  const body = `episode body ${rawItemId}`;
  engine.db.db
    .prepare(
      `INSERT INTO raw_items
         (id, source_adapter, channel, external_id, body, body_format,
          content_hash, event_time, ingested_at, processing_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rawItemId,
      SourceAdapterType.Gmail,
      SourceChannel.Email,
      `ext-${rawItemId}`,
      body,
      BodyFormat.Plaintext,
      sha256(body),
      Date.now(),
      Date.now(),
      ProcessingStatus.Done,
    );
  engine.db.db
    .prepare(
      `INSERT INTO entity_episodes (entity_id, raw_item_id, extraction_method, confidence)
       VALUES (?, ?, 'test', 1.0)`,
    )
    .run(topicId, rawItemId);
  return rawItemId;
}

function makeMockLLMProvider(options: { isAvailable?: boolean } = {}): LLMProvider {
  const available = options.isAvailable ?? true;
  return {
    name: 'mock',
    isAvailable: vi.fn().mockResolvedValue(available),
    answer: vi.fn().mockResolvedValue({ answer: 'mock overview text', sourceItemIds: [], confidence: 1.0 }),
    extract: vi.fn().mockResolvedValue({ entities: [], relationships: [] }),
    embed: vi.fn().mockResolvedValue(new Float64Array([])),
    embedBatch: vi.fn().mockResolvedValue([]),
  } as unknown as LLMProvider;
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
  (engine as any).llmProvider = makeMockLLMProvider();
});

afterEach(async () => {
  if (app) await app.close().catch(() => undefined);
  engine.close();
});

// ---------------------------------------------------------------------------
// GET /api/topics/:id/overview
// ---------------------------------------------------------------------------

describe('GET /api/topics/:id/overview', () => {
  // -------------------------------------------------------------------------
  // 404 scenarios
  // -------------------------------------------------------------------------

  describe('404 scenarios', () => {
    it('returns 404 for unknown topic id', async () => {
      app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: `/api/topics/${ulid()}/overview`,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: expect.any(String) });
    });

    it('returns 404 for non-topic entity', async () => {
      app = await buildApp();
      const person: Entity = {
        ...makeTopic('Alice'),
        type: EntityType.Person,
      };
      engine.entities.insert(person);
      const res = await app.inject({
        method: 'GET',
        url: `/api/topics/${person.id}/overview`,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // 204 scenarios
  // -------------------------------------------------------------------------

  describe('204 scenarios', () => {
    it('returns 204 for archived topic', async () => {
      app = await buildApp();
      const topic = makeTopic('Archived Topic', null, EntityStatus.Archived);
      engine.entities.insert(topic);
      const res = await app.inject({
        method: 'GET',
        url: `/api/topics/${topic.id}/overview`,
      });
      expect(res.statusCode).toBe(204);
    });

    it('returns 204 when LLM is unavailable', async () => {
      (engine as any).llmProvider = makeMockLLMProvider({ isAvailable: false });
      app = await buildApp();
      const topic = makeTopic('Active Topic');
      engine.entities.insert(topic);
      insertEpisode(engine, topic.id);
      const res = await app.inject({
        method: 'GET',
        url: `/api/topics/${topic.id}/overview`,
      });
      expect(res.statusCode).toBe(204);
    });

    it('returns 204 for topic with no episodes', async () => {
      app = await buildApp();
      const topic = makeTopic('Empty Topic');
      engine.entities.insert(topic);
      const res = await app.inject({
        method: 'GET',
        url: `/api/topics/${topic.id}/overview`,
      });
      expect(res.statusCode).toBe(204);
    });
  });

  // -------------------------------------------------------------------------
  // Cache behavior
  // -------------------------------------------------------------------------

  describe('cache behavior', () => {
    it('first request calls LLM and caches the result', async () => {
      const mockProvider = makeMockLLMProvider();
      (engine as any).llmProvider = mockProvider;
      app = await buildApp();

      const topic = makeTopic('Cache Test Topic');
      engine.entities.insert(topic);
      insertEpisode(engine, topic.id);

      const res = await app.inject({
        method: 'GET',
        url: `/api/topics/${topic.id}/overview`,
      });

      expect(res.statusCode).toBe(200);
      expect((mockProvider.answer as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);

      const body = res.json() as { overview: { content: string; generatedAt: number; topicStatus: string } };
      expect(body.overview.content).toBe('mock overview text');
    });

    it('second request returns cached result without calling LLM again', async () => {
      const mockProvider = makeMockLLMProvider();
      (engine as any).llmProvider = mockProvider;
      app = await buildApp();

      const topic = makeTopic('Cache Hit Topic');
      engine.entities.insert(topic);
      insertEpisode(engine, topic.id);

      // First request — generates and caches
      const first = await app.inject({
        method: 'GET',
        url: `/api/topics/${topic.id}/overview`,
      });
      expect(first.statusCode).toBe(200);

      // Second request — should return cached
      const second = await app.inject({
        method: 'GET',
        url: `/api/topics/${topic.id}/overview`,
      });
      expect(second.statusCode).toBe(200);

      // LLM called exactly once across both requests
      expect((mockProvider.answer as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);

      const firstBody = first.json() as { overview: { content: string } };
      const secondBody = second.json() as { overview: { content: string } };
      expect(firstBody.overview.content).toBe(secondBody.overview.content);
    });

    it('cache is invalidated when a new episode is added', async () => {
      const mockProvider = makeMockLLMProvider();
      (engine as any).llmProvider = mockProvider;
      app = await buildApp();

      const topic = makeTopic('Invalidation Topic');
      engine.entities.insert(topic);
      insertEpisode(engine, topic.id);

      // First request — generates and caches (episode_count = 1)
      const first = await app.inject({
        method: 'GET',
        url: `/api/topics/${topic.id}/overview`,
      });
      expect(first.statusCode).toBe(200);
      expect((mockProvider.answer as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);

      // Add a new episode — episode_count is now 2
      insertEpisode(engine, topic.id);

      // Third request — cache miss because episode_count changed, LLM called again
      const second = await app.inject({
        method: 'GET',
        url: `/api/topics/${topic.id}/overview`,
      });
      expect(second.statusCode).toBe(200);
      expect((mockProvider.answer as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Response format
  // -------------------------------------------------------------------------

  describe('response format', () => {
    it('response contains content, generatedAt, and topicStatus fields', async () => {
      app = await buildApp();
      const topic = makeTopic('Format Test Topic');
      engine.entities.insert(topic);
      insertEpisode(engine, topic.id);

      const res = await app.inject({
        method: 'GET',
        url: `/api/topics/${topic.id}/overview`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { overview: unknown };
      expect(body).toHaveProperty('overview');

      const overview = body.overview as Record<string, unknown>;
      expect(overview).toHaveProperty('content');
      expect(overview).toHaveProperty('generatedAt');
      expect(overview).toHaveProperty('topicStatus');

      expect(typeof overview.content).toBe('string');
      expect(typeof overview.generatedAt).toBe('number');
      expect(typeof overview.topicStatus).toBe('string');
    });

    it('topicStatus reflects the actual topic status', async () => {
      app = await buildApp();
      const topic = makeTopic('Status Topic');
      engine.entities.insert(topic);
      insertEpisode(engine, topic.id);

      const res = await app.inject({
        method: 'GET',
        url: `/api/topics/${topic.id}/overview`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { overview: { topicStatus: string } };
      expect(body.overview.topicStatus).toBe('active');
    });

    it('generatedAt is a recent unix timestamp in milliseconds', async () => {
      app = await buildApp();
      const topic = makeTopic('Timestamp Topic');
      engine.entities.insert(topic);
      insertEpisode(engine, topic.id);

      const before = Date.now();
      const res = await app.inject({
        method: 'GET',
        url: `/api/topics/${topic.id}/overview`,
      });
      const after = Date.now();

      expect(res.statusCode).toBe(200);
      const body = res.json() as { overview: { generatedAt: number } };
      expect(body.overview.generatedAt).toBeGreaterThanOrEqual(before);
      expect(body.overview.generatedAt).toBeLessThanOrEqual(after);
    });
  });
});
