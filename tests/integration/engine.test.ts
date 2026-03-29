import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MindFlowEngine } from '../../src/core/engine.js';
import {
  BodyFormat,
  DetectedLanguage,
  EntityStatus,
  EntityType,
  JobStage,
  JobStatus,
  ProcessingStatus,
  SourceAdapterType,
  SourceChannel,
} from '../../src/types/index.js';
import type {
  IngestionBatch,
  LLMProvider,
  SourceAdapter,
} from '../../src/types/index.js';
import { ulid } from '../../src/utils/ulid.js';
import { sha256 } from '../../src/utils/hash.js';

let engine: MindFlowEngine;

beforeEach(() => {
  engine = new MindFlowEngine({ dbPath: ':memory:' });
});

afterEach(() => {
  engine.close();
});

function makeEntity(overrides = {}) {
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

function makeRawItem(overrides = {}) {
  const now = Date.now();
  const body = 'Test body ' + ulid();
  return {
    id: ulid(),
    sourceAdapter: SourceAdapterType.Gmail,
    channel: SourceChannel.Email,
    externalId: `ext-${ulid()}`,
    threadId: null,
    senderEntityId: null,
    recipientEntityIds: [],
    subject: 'Test',
    body,
    bodyFormat: BodyFormat.Plaintext,
    contentHash: sha256(body),
    language: DetectedLanguage.English,
    eventTime: now,
    ingestedAt: now,
    processingStatus: ProcessingStatus.Pending,
    attachments: [],
    metadata: {},
    ...overrides,
  };
}

describe('MindFlowEngine', () => {
  it('constructs and can be closed without error', () => {
    expect(() => engine.close()).not.toThrow();
  });

  it('init() resolves without error', async () => {
    await expect(engine.init()).resolves.toBeUndefined();
  });

  it('init() is idempotent', async () => {
    await engine.init();
    await expect(engine.init()).resolves.toBeUndefined();
  });

  it('getEntity returns null for unknown id', () => {
    expect(engine.getEntity('no-such-id')).toBeNull();
  });

  it('getEntity returns entity after insert', () => {
    const entity = makeEntity();
    engine.entities.insert(entity);

    const found = engine.getEntity(entity.id);
    expect(found?.id).toBe(entity.id);
  });

  it('getEntity returns null for merged entity', () => {
    const surviving = makeEntity();
    const merged = makeEntity({ canonicalName: 'Alice Dupe' });
    engine.entities.insert(surviving);
    engine.entities.insert(merged);
    engine.entities.merge(surviving.id, merged.id, Date.now());

    expect(engine.getEntity(merged.id)).toBeNull();
  });

  it('getGraph returns empty graph for unknown center', () => {
    const result = engine.getGraph('no-such-id');
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('getAttentionItems returns empty array when none exist', () => {
    expect(engine.getAttentionItems()).toEqual([]);
  });

  it('getStats returns zeroed counts on empty database', () => {
    const stats = engine.getStats();
    expect(stats.rawItemCount).toBe(0);
    expect(stats.entityCount).toBe(0);
    expect(stats.relationshipCount).toBe(0);
    expect(stats.pendingJobCount).toBe(0);
    expect(stats.attentionItemCount).toBe(0);
  });

  it('getStats reflects inserted data', () => {
    const item = makeRawItem();
    engine.rawItems.insert(item);

    const entity = makeEntity();
    engine.entities.insert(entity);

    const stats = engine.getStats();
    expect(stats.rawItemCount).toBe(1);
    expect(stats.entityCount).toBe(1);
  });

  it('getConfig returns config with applied defaults', () => {
    const config = engine.getConfig();
    expect(config.dbPath).toBe(':memory:');
    expect(config.ingestionIntervalMs).toBe(900_000);
  });

  it('updateConfig persists and updates in-memory config', () => {
    engine.updateConfig({ ingestionBatchSize: 42 });
    expect(engine.getConfig().ingestionBatchSize).toBe(42);

    // Verify it was written to the config table
    const stored = engine.configManager.get('ingestionBatchSize');
    expect(stored).toBe(42);
  });

  it('ingest() completes without error when no adapters are registered', async () => {
    // No adapters registered — cycle runs over an empty adapter set, drains the
    // (empty) job queue, and runs attention detection. Should resolve cleanly.
    await expect(engine.ingest()).resolves.toBeUndefined();
  });

  it('query() returns a QueryResult', async () => {
    const result = await engine.query({ query: 'test query' });
    expect(result).toHaveProperty('entities');
    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('graphFragment');
    expect(Array.isArray(result.entities)).toBe(true);
    expect(Array.isArray(result.items)).toBe(true);
  });

  it('eventBus is accessible and functional', () => {
    let fired = false;
    engine.eventBus.on('entity:created', () => {
      fired = true;
    });
    engine.eventBus.emit('entity:created', { entity: makeEntity() });
    expect(fired).toBe(true);
  });
});

describe('ConfigManager', () => {
  it('get returns undefined for missing key', () => {
    expect(engine.configManager.get('ingestionBatchSize')).toBeUndefined();
  });

  it('set and get round-trips a value', () => {
    engine.configManager.set('ingestionBatchSize', 77);
    expect(engine.configManager.get('ingestionBatchSize')).toBe(77);
  });

  it('save persists multiple keys', () => {
    engine.configManager.save({ ingestionBatchSize: 10, ingestionIntervalMs: 120_000 });
    expect(engine.configManager.get('ingestionBatchSize')).toBe(10);
    expect(engine.configManager.get('ingestionIntervalMs')).toBe(120_000);
  });

  it('load returns full config with stored overrides', () => {
    engine.configManager.set('ingestionBatchSize', 55);
    const loaded = engine.configManager.load();
    expect(loaded.ingestionBatchSize).toBe(55);
    // Other keys fall back to defaults
    expect(loaded.ingestionIntervalMs).toBe(900_000);
  });
});

// ---------------------------------------------------------------------------
// Error-path tests
// ---------------------------------------------------------------------------

describe('ingest() error isolation', () => {
  function makeIngestedBatchItem() {
    const body = 'body-' + ulid();
    return {
      externalId: ulid(),
      threadId: null,
      sender: { name: 'Sender', email: 'sender@example.com', phone: null, handle: null },
      recipients: [],
      subject: 'Subject',
      body,
      bodyFormat: BodyFormat.Plaintext,
      eventTime: Date.now(),
      attachments: [],
      metadata: {},
    };
  }

  function makeBatch(items: ReturnType<typeof makeIngestedBatchItem>[]): IngestionBatch {
    return { items, checkpoint: {}, hasMore: false };
  }

  it('adapter throwing fetchSince does not prevent other adapters from running', async () => {
    const failingAdapter: SourceAdapter = {
      name: SourceAdapterType.Gmail,
      initialize: vi.fn(),
      fetchSince: vi.fn(async () => { throw new Error('gmail down'); }),
      getCurrentCheckpoint: vi.fn(async () => ({})),
      shutdown: vi.fn(),
    };

    const successAdapter: SourceAdapter = {
      name: SourceAdapterType.IMessage,
      initialize: vi.fn(),
      fetchSince: vi.fn(async () => makeBatch([makeIngestedBatchItem()])),
      getCurrentCheckpoint: vi.fn(async () => ({})),
      shutdown: vi.fn(),
    };

    engine.registerAdapter(failingAdapter);
    engine.registerAdapter(successAdapter);

    // Should not throw
    await expect(engine.ingest()).resolves.toBeUndefined();

    // iMessage item should have been ingested despite Gmail failing
    const stats = engine.getStats();
    expect(stats.rawItemCount).toBe(1);
  });

  it('LLM extraction throwing marks job as failed without crashing ingest', async () => {
    const throwingLLM: LLMProvider = {
      name: 'throwing',
      extract: async () => { throw new Error('LLM extraction failed'); },
      answer: async () => ({ answer: 'mock', sourceItemIds: [], confidence: 1.0 }),
      embed: async () => new Float64Array(16),
      embedBatch: async (ts) => ts.map(() => new Float64Array(16)),
      isAvailable: async () => true,
    };

    // Rebuild engine with throwing LLM and tier3 enabled
    engine.close();
    engine = new MindFlowEngine({ dbPath: ':memory:' }, throwingLLM);
    // Enable tier3 by rewiring the pipeline via reflection
    (engine as unknown as Record<string, unknown>)['pipeline'] =
      new (await import('../../src/processing/pipeline.js')).ProcessingPipeline(
        { rawItems: engine.rawItems, jobQueue: engine.jobs },
        throwingLLM,
        { enableTier3: true, tier3ImportanceThreshold: 0 },
      );

    const body = 'LLM failure test body ' + ulid();
    const item = makeRawItem({ body, contentHash: sha256(body) });
    engine.rawItems.insert(item);

    // Manually enqueue a triage job for this item
    engine.jobs.enqueue({
      id: ulid(),
      rawItemId: item.id,
      stage: JobStage.Triage,
      status: JobStatus.Pending,
      priority: 0,
      attempts: 0,
      maxAttempts: 3,
      lastError: null,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
    });

    // ingest() runs the job queue
    await expect(engine.ingest()).resolves.toBeUndefined();

    // The job was dequeued, extraction threw, and the engine caught it and called fail().
    // The failed job is still counted by getPendingCount (failed = eligible for retry),
    // so we verify via the DB that it has a recorded error rather than still being 'processing'.
    const failedRow = engine.db.db
      .prepare(`SELECT status, last_error FROM job_queue WHERE raw_item_id = ?`)
      .get(item.id) as { status: string; last_error: string | null } | undefined;

    // Job must not be stuck in 'processing' — it was handled and marked failed
    expect(failedRow?.status).toBe('failed');
    expect(failedRow?.last_error).toBeTruthy();
  });

  it('query() returns answer: null when LLM answer throws, other fields still present', async () => {
    const throwingLLM: LLMProvider = {
      name: 'throwing-answer',
      extract: async () => ({
        entities: [], relationships: [], summary: null,
        language: DetectedLanguage.English,
      }),
      answer: async () => { throw new Error('answer service unavailable'); },
      embed: async () => new Float64Array(16),
      embedBatch: async (ts) => ts.map(() => new Float64Array(16)),
      isAvailable: async () => true,
    };

    engine.close();
    engine = new MindFlowEngine({ dbPath: ':memory:' }, throwingLLM);

    const result = await engine.query({ query: 'anything' });

    expect(result.answer).toBeNull();
    expect(Array.isArray(result.entities)).toBe(true);
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.graphFragment).toBeDefined();
  });
});
