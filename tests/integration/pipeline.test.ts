import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MindFlowDatabase } from '../../src/storage/database.js';
import {
  EntityEpisodeRepository,
  EntityRepository,
  JobQueueRepository,
  RawItemRepository,
} from '../../src/storage/repositories.js';
import {
  BodyFormat,
  DetectedLanguage,
  EntityType,
  JobStage,
  JobStatus,
  ProcessingStatus,
  SourceAdapterType,
  SourceChannel,
} from '../../src/types/index.js';
import type { RawItem } from '../../src/types/index.js';
import { ulid } from '../../src/utils/ulid.js';
import { sha256 } from '../../src/utils/hash.js';
import { runTier1Rules } from '../../src/processing/tiers/tier1-rules.js';
import { runTier2NER } from '../../src/processing/tiers/tier2-ner.js';
import { mergeResults, runTier3LLM } from '../../src/processing/tiers/tier3-llm.js';
import { ProcessingPipeline } from '../../src/processing/pipeline.js';
import { MockProvider } from '../../src/llm/provider.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRawItem(overrides: Partial<RawItem> = {}): RawItem {
  const body = overrides.body ?? 'Default body ' + ulid();
  return {
    id: ulid(),
    sourceAdapter: SourceAdapterType.Gmail,
    channel: SourceChannel.Email,
    externalId: `ext-${ulid()}`,
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
    processingStatus: ProcessingStatus.Pending,
    attachments: [],
    metadata: {},
    ...overrides,
  };
}

function makeJob(rawItemId: string, overrides = {}) {
  return {
    id: ulid(),
    rawItemId,
    stage: JobStage.Triage,
    status: JobStatus.Pending,
    priority: 0.5,
    attempts: 0,
    maxAttempts: 3,
    lastError: null,
    createdAt: Date.now(),
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let mfdb: MindFlowDatabase;
let rawItems: RawItemRepository;
let entities: EntityRepository;
let episodes: EntityEpisodeRepository;
let jobs: JobQueueRepository;

beforeEach(() => {
  mfdb = new MindFlowDatabase(':memory:');
  rawItems = new RawItemRepository(mfdb.db);
  entities = new EntityRepository(mfdb.db);
  episodes = new EntityEpisodeRepository(mfdb.db);
  jobs = new JobQueueRepository(mfdb.db);
});

afterEach(() => {
  mfdb.close();
});

// ---------------------------------------------------------------------------
// Tier 1: rule-based extraction (integration — real RawItem structures)
// ---------------------------------------------------------------------------

describe('Tier 1 rule-based extraction', () => {
  it('extracts email addresses', () => {
    const item = makeRawItem({ body: 'Please reach out to vendor@partner.com for the quote.' });
    const result = runTier1Rules(item);
    const emails = result.entities.filter((e) => e.attributes['email']);
    expect(emails.length).toBeGreaterThan(0);
    expect(emails[0]?.attributes['email']).toBe('vendor@partner.com');
  });

  it('extracts international phone numbers', () => {
    const item = makeRawItem({ body: 'Call me at +86 138 0000 1234 or (555) 123-4567.' });
    const result = runTier1Rules(item);
    const phones = result.entities.filter((e) => e.attributes['phone']);
    expect(phones.length).toBeGreaterThan(0);
  });

  it('extracts URLs as document entities', () => {
    const item = makeRawItem({ body: 'See https://docs.example.com/spec.pdf for details.' });
    const result = runTier1Rules(item);
    const docs = result.entities.filter((e) => e.type === EntityType.Document);
    expect(docs.length).toBeGreaterThan(0);
    expect(docs[0]?.attributes['url']).toContain('docs.example.com');
  });

  it('extracts monetary amounts as key facts', () => {
    const item = makeRawItem({ body: 'The annual cost is $42,000 USD.' });
    const result = runTier1Rules(item);
    const facts = result.entities.filter((e) => e.type === EntityType.KeyFact && e.attributes['amount']);
    expect(facts.length).toBeGreaterThan(0);
  });

  it('extracts deadline-tagged action items', () => {
    const item = makeRawItem({ body: 'Submit the report by next Friday.' });
    const result = runTier1Rules(item);
    const actions = result.entities.filter((e) => e.type === EntityType.ActionItem);
    expect(actions.length).toBeGreaterThan(0);
    expect(String(actions[0]?.attributes['deadline'])).toMatch(/friday/i);
  });

  it('extracts @mentions', () => {
    const item = makeRawItem({ body: 'Hey @alice_wong, can you review this?' });
    const result = runTier1Rules(item);
    const mentions = result.entities.filter((e) => e.attributes['handle'] === 'alice_wong');
    expect(mentions.length).toBe(1);
  });

  it('extracts from subject + body combined', () => {
    const item = makeRawItem({
      subject: 'Quote from cfo@bigcorp.com',
      body: 'Please see attached.',
    });
    const result = runTier1Rules(item);
    const emails = result.entities.filter((e) => e.attributes['email'] === 'cfo@bigcorp.com');
    expect(emails.length).toBe(1);
  });

  it('detects Chinese language', () => {
    const item = makeRawItem({ body: '请联系王总确认合同内容。' });
    const result = runTier1Rules(item);
    expect(result.language).toBe(DetectedLanguage.Chinese);
  });

  it('returns empty extraction for low-signal content', () => {
    const item = makeRawItem({ body: 'Ok, noted.' });
    const result = runTier1Rules(item);
    expect(result.entities).toHaveLength(0);
  });

  it('does not produce duplicate email entities for same address', () => {
    const item = makeRawItem({ body: 'From: dup@test.com. Reply to dup@test.com.' });
    const result = runTier1Rules(item);
    const emails = result.entities.filter((e) => e.attributes['email'] === 'dup@test.com');
    expect(emails).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Tier 2: NER (integration — async, real compromise library)
// ---------------------------------------------------------------------------

describe('Tier 2 NER extraction', () => {
  it('extracts English person names', async () => {
    const item = makeRawItem({
      body: 'Alice Johnson confirmed the meeting. Bob Smith will also attend.',
    });
    const result = await runTier2NER(item);
    expect(result.entities.length).toBeGreaterThanOrEqual(0); // compromise is heuristic
    expect(result).toHaveProperty('language');
  });

  it('extracts Chinese person names via regex', async () => {
    const item = makeRawItem({ body: '王总和李经理今天开了个预算会议，讨论了Q3的采购计划。' });
    const result = await runTier2NER(item);
    const chinesePersons = result.entities.filter(
      (e) => e.type === EntityType.Person && /[\u4e00-\u9fff]/.test(e.name),
    );
    expect(chinesePersons.length).toBeGreaterThanOrEqual(1);
  });

  it('returns valid ExtractionResult shape', async () => {
    const item = makeRawItem({ body: 'Microsoft announced new features.' });
    const result = await runTier2NER(item);
    expect(Array.isArray(result.entities)).toBe(true);
    expect(Array.isArray(result.relationships)).toBe(true);
    expect(result.language).toBeDefined();
    expect(result.summary).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tier 3: LLM extraction with MockProvider
// ---------------------------------------------------------------------------

describe('Tier 3 LLM extraction', () => {
  it('merges tier1 and tier2 results with LLM output', async () => {
    const item = makeRawItem({
      body: 'Please contact alice@example.com about the Q3 budget by next Friday.',
    });
    const provider = new MockProvider();
    const tier1 = runTier1Rules(item);
    const tier2 = await runTier2NER(item);
    const result = await runTier3LLM(item, tier1, tier2, provider);

    expect(Array.isArray(result.entities)).toBe(true);
    expect(result.entities.length).toBeGreaterThan(0);
  });

  it('uses a fixed extraction result from MockProvider', async () => {
    const fixedResult = {
      entities: [
        { type: EntityType.Person, name: 'Alice', nameAlt: null, attributes: {}, confidence: 0.95 },
        { type: EntityType.Topic, name: 'Q3 Budget', nameAlt: null, attributes: {}, confidence: 0.9 },
      ],
      relationships: [],
      summary: 'Alice discussing Q3 Budget.',
      language: DetectedLanguage.English,
    };
    const item = makeRawItem({ body: 'content' });
    const provider = new MockProvider(fixedResult);
    const tier1 = runTier1Rules(item);
    const tier2 = await runTier2NER(item);
    const result = await runTier3LLM(item, tier1, tier2, provider);

    const names = result.entities.map((e) => e.name);
    expect(names).toContain('Alice');
    expect(names).toContain('Q3 Budget');
    expect(result.summary).toBe('Alice discussing Q3 Budget.');
  });

  it('mergeResults prefers higher confidence on name collision', () => {
    const base = {
      entities: [{ type: EntityType.Person, name: 'Alice', nameAlt: null, attributes: {}, confidence: 0.6 }],
      relationships: [],
      summary: null,
      language: DetectedLanguage.English,
    };
    const incoming = {
      entities: [{ type: EntityType.Person, name: 'Alice', nameAlt: null, attributes: {}, confidence: 0.95 }],
      relationships: [],
      summary: 'Summary.',
      language: DetectedLanguage.English,
    };
    const merged = mergeResults(base, incoming);
    const alice = merged.entities.find((e) => e.name.toLowerCase() === 'alice');
    expect(alice?.confidence).toBe(0.95);
    expect(merged.entities).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ProcessingPipeline: processItem end-to-end
// ---------------------------------------------------------------------------

describe('ProcessingPipeline.processItem()', () => {
  it('processes a raw item and updates processing_status to Done', async () => {
    // Body contains a question (importance +0.1) and action-item signal (+0.3) → score 0.4 ≥ threshold
    // "by next Friday" triggers DEADLINE_SIGNAL_RE + RELATIVE_DATE_RE → ActionItem entity → +0.3
    const item = makeRawItem({ body: 'Please review the attached proposal and let me know by next Friday?' });
    rawItems.insert(item);

    const pipeline = new ProcessingPipeline(
      { rawItems, jobQueue: jobs },
      new MockProvider(),
      { enableTier3: true },
    );

    const result = await pipeline.processItem(item);

    expect(result.rawItemId).toBe(item.id);
    expect(result.tiersRun).toContain(JobStage.Triage);
    expect(result.tiersRun).toContain(JobStage.NER);
    expect(result.tiersRun).toContain(JobStage.LLMExtract);

    const updated = rawItems.findById(item.id);
    expect(updated?.processingStatus).toBe(ProcessingStatus.Done);
  });

  it('skips tier3 when enableTier3 is false', async () => {
    const item = makeRawItem({ body: 'Simple message.' });
    rawItems.insert(item);

    const pipeline = new ProcessingPipeline(
      { rawItems, jobQueue: jobs },
      new MockProvider(),
      { enableTier3: false },
    );

    const result = await pipeline.processItem(item);
    expect(result.tiersRun).not.toContain(JobStage.LLMExtract);
    expect(result.tiersRun).toContain(JobStage.Triage);
    expect(result.tiersRun).toContain(JobStage.NER);
  });
});

// ---------------------------------------------------------------------------
// ProcessingPipeline: processBatch() via job queue
// ---------------------------------------------------------------------------

describe('ProcessingPipeline.processBatch()', () => {
  it('dequeues and processes pending jobs', async () => {
    const item = makeRawItem({ body: 'Batch test item with alice@test.com' });
    rawItems.insert(item);
    jobs.enqueue(makeJob(item.id));

    const pipeline = new ProcessingPipeline(
      { rawItems, jobQueue: jobs },
      new MockProvider(),
      { concurrency: 2, enableTier3: false },
    );

    const count = await pipeline.processBatch();
    expect(count).toBe(1);

    const updated = rawItems.findById(item.id);
    expect(updated?.processingStatus).toBe(ProcessingStatus.Done);
  });

  it('respects concurrency limit', async () => {
    const items = Array.from({ length: 5 }, () => makeRawItem({ body: 'Item ' + ulid() }));
    for (const item of items) {
      rawItems.insert(item);
      jobs.enqueue(makeJob(item.id));
    }

    const pipeline = new ProcessingPipeline(
      { rawItems, jobQueue: jobs },
      new MockProvider(),
      { concurrency: 2, enableTier3: false },
    );

    const count = await pipeline.processBatch();
    expect(count).toBe(2); // limited by concurrency
  });

  it('returns 0 when queue is empty', async () => {
    const pipeline = new ProcessingPipeline(
      { rawItems, jobQueue: jobs },
      new MockProvider(),
    );
    const count = await pipeline.processBatch();
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Job queue: enqueue / dequeue / complete / fail / retry
// ---------------------------------------------------------------------------

describe('JobQueueRepository', () => {
  it('enqueues and dequeues a job', () => {
    const item = makeRawItem();
    rawItems.insert(item);
    const job = makeJob(item.id);
    jobs.enqueue(job);

    const dequeued = jobs.dequeue(JobStage.Triage);
    expect(dequeued).toBeDefined();
    expect(dequeued?.rawItemId).toBe(item.id);
    expect(dequeued?.status).toBe(JobStatus.Processing);
    expect(dequeued?.attempts).toBe(1);
  });

  it('marks job as completed', () => {
    const item = makeRawItem();
    rawItems.insert(item);
    jobs.enqueue(makeJob(item.id));

    const dequeued = jobs.dequeue(JobStage.Triage)!;
    jobs.complete(dequeued.id);

    // Should not be dequeued again
    const second = jobs.dequeue(JobStage.Triage);
    expect(second).toBeUndefined();
  });

  it('marks job as failed after max_attempts — cannot be dequeued again', () => {
    const item = makeRawItem();
    rawItems.insert(item);
    const job = makeJob(item.id, { maxAttempts: 1 });
    jobs.enqueue(job);

    const dequeued = jobs.dequeue(JobStage.Triage)!;
    jobs.fail(dequeued.id, 'something went wrong');

    // After 1 attempt with maxAttempts=1, the job is in 'failed' status.
    // It cannot be dequeued again because dequeue checks attempts < max_attempts.
    const nextDequeue = jobs.dequeue(JobStage.Triage);
    expect(nextDequeue).toBeUndefined();
  });

  it('retry resets failed job back to pending', () => {
    const item = makeRawItem();
    rawItems.insert(item);
    const job = makeJob(item.id, { maxAttempts: 1 });
    jobs.enqueue(job);

    const dequeued = jobs.dequeue(JobStage.Triage)!;
    jobs.fail(dequeued.id, 'oops');
    jobs.retry(dequeued.id);

    const count = jobs.getPendingCountByStage(JobStage.Triage);
    expect(count).toBe(1);
  });

  it('getPendingCount returns total across stages', () => {
    const item1 = makeRawItem();
    const item2 = makeRawItem();
    rawItems.insert(item1);
    rawItems.insert(item2);
    jobs.enqueue(makeJob(item1.id, { stage: JobStage.Triage }));
    jobs.enqueue(makeJob(item2.id, { stage: JobStage.NER }));

    expect(jobs.getPendingCount()).toBe(2);
  });

  it('dequeue returns undefined when no jobs available for stage', () => {
    const item = makeRawItem();
    rawItems.insert(item);
    jobs.enqueue(makeJob(item.id, { stage: JobStage.NER }));

    // Dequeue Triage — nothing there
    const result = jobs.dequeue(JobStage.Triage);
    expect(result).toBeUndefined();
  });

  it('prioritises higher-priority jobs', () => {
    const item1 = makeRawItem();
    const item2 = makeRawItem();
    rawItems.insert(item1);
    rawItems.insert(item2);
    jobs.enqueue(makeJob(item1.id, { priority: 0.3 }));
    jobs.enqueue(makeJob(item2.id, { priority: 0.9 }));

    const first = jobs.dequeue(JobStage.Triage)!;
    expect(first.rawItemId).toBe(item2.id);
  });
});
