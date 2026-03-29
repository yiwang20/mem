import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import type { LLMProvider, AnswerContext, ExtractionResult, AnswerResult } from '../../src/types/index.js';
import { ulid } from '../../src/utils/ulid.js';
import { sha256 } from '../../src/utils/hash.js';
import Fastify from 'fastify';
import { registerQueryRoutes } from '../../src/adapters/http/routes/query.js';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePersonEntity(canonicalName: string, overrides = {}) {
  const now = Date.now();
  return {
    id: ulid(),
    type: EntityType.Person,
    canonicalName,
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

function makeRawItem(overrides = {}) {
  const now = Date.now();
  const body = 'Meeting notes about project status ' + ulid();
  return {
    id: ulid(),
    sourceAdapter: SourceAdapterType.Gmail,
    channel: SourceChannel.Email,
    externalId: `ext-${ulid()}`,
    threadId: null,
    senderEntityId: null,
    recipientEntityIds: [],
    subject: 'Project Update',
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

class ErrorLLMProvider implements LLMProvider {
  readonly name = 'error-mock';
  async extract(): Promise<ExtractionResult> {
    throw new Error('LLM unavailable');
  }
  async answer(): Promise<AnswerResult> {
    throw new Error('LLM unavailable');
  }
  async embed(): Promise<Float64Array> { return new Float64Array(16); }
  async embedBatch(texts: string[]): Promise<Float64Array[]> {
    return texts.map(() => new Float64Array(16));
  }
  async isAvailable(): Promise<boolean> { throw new Error('LLM unavailable'); }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let engine: MindFlowEngine;
let app: FastifyInstance;

async function buildApp(llmProvider?: LLMProvider): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });
  await registerQueryRoutes(fastify, engine);
  return fastify;
}

beforeEach(async () => {
  engine = new MindFlowEngine({ dbPath: ':memory:' });
});

afterEach(async () => {
  if (app) {
    await app.close().catch(() => undefined);
  }
  engine.close();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/briefing', () => {
  it('resolves attendee and returns entity + timeline + pending items', async () => {
    app = await buildApp();

    const alice = makePersonEntity('Alice Chen');
    engine.entities.insert(alice);

    const item = makeRawItem({ senderEntityId: alice.id, subject: 'Q3 Review' });
    engine.rawItems.insert(item);

    // Create an episode so getTimeline can find it
    engine.entityEpisodes.insert({
      entityId: alice.id,
      rawItemId: item.id,
      extractionMethod: 'pipeline',
      confidence: 1.0,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/briefing',
      payload: { attendees: ['Alice Chen'] },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      attendees: Array<{ name: string; entity: unknown; recentItems: unknown[]; pendingActions: unknown[] }>;
    };
    expect(body.attendees).toHaveLength(1);
    const ad = body.attendees[0]!;
    expect(ad.name).toBe('Alice Chen');
    expect(ad.entity).not.toBeNull();
    expect(ad.recentItems).toBeInstanceOf(Array);
    expect(ad.pendingActions).toBeInstanceOf(Array);
  });

  it('returns entity: null with empty arrays when attendee does not exist', async () => {
    app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/briefing',
      payload: { attendees: ['Nobody Known'] },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      attendees: Array<{ name: string; entity: unknown; recentItems: unknown[]; pendingActions: unknown[] }>;
    };
    expect(body.attendees).toHaveLength(1);
    const ad = body.attendees[0]!;
    expect(ad.entity).toBeNull();
    expect(ad.recentItems).toEqual([]);
    expect(ad.pendingActions).toEqual([]);
  });

  it('returns summary: null when LLM throws, other data still returned', async () => {
    // Engine with ErrorLLMProvider — isAvailable() throws
    engine.close();
    engine = new MindFlowEngine({ dbPath: ':memory:' }, new ErrorLLMProvider());
    app = await buildApp();

    const bob = makePersonEntity('Bob Smith');
    engine.entities.insert(bob);

    const res = await app.inject({
      method: 'POST',
      url: '/api/briefing',
      payload: { attendees: ['Bob Smith'] },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      summary: unknown;
      attendees: unknown[];
      relatedFacts: unknown[];
      relatedTopics: unknown[];
    };
    expect(body.summary).toBeNull();
    expect(body.attendees).toHaveLength(1);
    expect(body.relatedFacts).toBeInstanceOf(Array);
    expect(body.relatedTopics).toBeInstanceOf(Array);
  });

  it('returns relatedFacts: [] and relatedTopics: [] when topic search finds nothing', async () => {
    app = await buildApp();

    const alice = makePersonEntity('Alice Chen');
    engine.entities.insert(alice);

    const res = await app.inject({
      method: 'POST',
      url: '/api/briefing',
      payload: { attendees: ['Alice Chen'], topic: 'nonexistent-topic-xyz-12345' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      relatedFacts: unknown[];
      relatedTopics: unknown[];
    };
    expect(body.relatedFacts).toEqual([]);
    expect(body.relatedTopics).toEqual([]);
  });

  it('returns 400 when attendees array is empty', async () => {
    app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/briefing',
      payload: { attendees: [] },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when attendees field is missing', async () => {
    app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/briefing',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });
});
