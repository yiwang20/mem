import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MindFlowDatabase } from '../../src/storage/database.js';
import {
  JobQueueRepository,
  RawItemRepository,
  SyncStateRepository,
} from '../../src/storage/repositories.js';
import {
  BodyFormat,
  JobStage,
  JobStatus,
  SourceAdapterType,
} from '../../src/types/index.js';
import type { IngestionBatch, SourceAdapter, SyncState } from '../../src/types/index.js';
import { sha256 } from '../../src/utils/hash.js';
import { ulid } from '../../src/utils/ulid.js';
import { IngestionManager } from '../../src/ingestion/manager.js';
import { EventBus } from '../../src/core/events.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIngestedItem(body: string, externalId?: string) {
  return {
    externalId: externalId ?? ulid(),
    threadId: null,
    sender: { name: 'Alice', email: 'alice@example.com', phone: null, handle: null },
    recipients: [],
    subject: 'Test Subject',
    body,
    bodyFormat: BodyFormat.Plaintext,
    eventTime: Date.now(),
    attachments: [],
    metadata: {},
  };
}

function makeBatch(items: ReturnType<typeof makeIngestedItem>[], checkpoint = {}, hasMore = false): IngestionBatch {
  return { items, checkpoint, hasMore };
}

function makeAdapter(name: SourceAdapterType, batch: IngestionBatch): SourceAdapter {
  return {
    name,
    initialize: vi.fn(),
    fetchSince: vi.fn(async () => batch),
    getCurrentCheckpoint: vi.fn(async () => ({})),
    shutdown: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let mfdb: MindFlowDatabase;
let rawItems: RawItemRepository;
let syncState: SyncStateRepository;
let jobs: JobQueueRepository;
let eventBus: EventBus;
let manager: IngestionManager;

beforeEach(() => {
  mfdb = new MindFlowDatabase(':memory:');
  rawItems = new RawItemRepository(mfdb.db);
  syncState = new SyncStateRepository(mfdb.db);
  jobs = new JobQueueRepository(mfdb.db);
  eventBus = new EventBus();
  manager = new IngestionManager(rawItems, syncState, jobs, eventBus);
});

afterEach(() => {
  manager.stop();
  mfdb.close();
});

// ---------------------------------------------------------------------------
// Content-hash deduplication
// ---------------------------------------------------------------------------

describe('Content-hash deduplication', () => {
  it('inserts a new item when content hash is not seen before', async () => {
    const item = makeIngestedItem('Unique message body ' + ulid());
    const adapter = makeAdapter(SourceAdapterType.Gmail, makeBatch([item]));
    manager.register(adapter);

    await manager.runCycle();

    expect(rawItems.findByHash(sha256(item.body))).toBeDefined();
  });

  it('skips duplicate items with the same body (same content hash)', async () => {
    const body = 'Duplicate body content';
    const item1 = makeIngestedItem(body, 'ext-001');
    const item2 = makeIngestedItem(body, 'ext-002'); // same body, different externalId

    const adapter = makeAdapter(
      SourceAdapterType.Gmail,
      makeBatch([item1, item2]),
    );
    manager.register(adapter);

    await manager.runCycle();

    // Only one item should be inserted
    const found = rawItems.findByHash(sha256(body));
    expect(found).toBeDefined();
    expect(jobs.getPendingCountByStage(JobStage.Triage)).toBe(1);
  });

  it('inserting same adapter twice in a cycle deduplicates', async () => {
    const body = 'Same message ' + ulid();
    const item = makeIngestedItem(body);

    // Two adapters with same content (edge case)
    const batchA = makeBatch([item]);
    const batchB = makeBatch([makeIngestedItem(body)]); // same body

    const adapterA = makeAdapter(SourceAdapterType.Gmail, batchA);
    manager.register(adapterA);
    await manager.runCycle();

    const before = jobs.getPendingCountByStage(JobStage.Triage);

    // Simulate a second run (checkpoint is saved; adapter returns same item again)
    const adapterA2 = makeAdapter(SourceAdapterType.Gmail, batchB);
    manager.register(adapterA2); // re-register replaces adapter
    await manager.runCycle();

    const after = jobs.getPendingCountByStage(JobStage.Triage);
    // Job count should not increase for the duplicate
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Checkpoint persistence and incremental sync
// ---------------------------------------------------------------------------

describe('Checkpoint persistence', () => {
  it('saves checkpoint after a successful sync', async () => {
    const checkpoint = { lastId: 'abc-123', page: 2 };
    const adapter = makeAdapter(SourceAdapterType.Gmail, makeBatch([], checkpoint));
    manager.register(adapter);

    await manager.runCycle();

    const state = syncState.get(SourceAdapterType.Gmail);
    expect(state).toBeDefined();
    expect(state?.lastCheckpoint).toEqual(checkpoint);
    expect(state?.status).toBe('ok');
  });

  it('passes last checkpoint to fetchSince on subsequent cycle', async () => {
    const firstCheckpoint = { lastId: 'first' };
    const adapter: SourceAdapter = {
      name: SourceAdapterType.Gmail,
      initialize: vi.fn(),
      fetchSince: vi.fn()
        .mockResolvedValueOnce(makeBatch([], firstCheckpoint))
        .mockResolvedValueOnce(makeBatch([], { lastId: 'second' })),
      getCurrentCheckpoint: vi.fn(async () => ({})),
      shutdown: vi.fn(),
    };
    manager.register(adapter);

    await manager.runCycle(); // first cycle
    await manager.runCycle(); // second cycle

    const calls = (adapter.fetchSince as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]?.[0]).toBeNull(); // first call — no prior checkpoint
    expect(calls[1]?.[0]).toEqual(firstCheckpoint); // second call uses saved checkpoint
  });

  it('follows hasMore pagination', async () => {
    const item1 = makeIngestedItem('Page 1 item ' + ulid());
    const item2 = makeIngestedItem('Page 2 item ' + ulid());

    const adapter: SourceAdapter = {
      name: SourceAdapterType.Gmail,
      initialize: vi.fn(),
      fetchSince: vi.fn()
        .mockResolvedValueOnce(makeBatch([item1], { page: 1 }, true)) // hasMore=true
        .mockResolvedValueOnce(makeBatch([item2], { page: 2 }, false)), // hasMore=false
      getCurrentCheckpoint: vi.fn(async () => ({})),
      shutdown: vi.fn(),
    };
    manager.register(adapter);

    await manager.runCycle();

    // Both items from both pages should be inserted
    expect(rawItems.findByHash(sha256(item1.body))).toBeDefined();
    expect(rawItems.findByHash(sha256(item2.body))).toBeDefined();
    expect(jobs.getPendingCountByStage(JobStage.Triage)).toBe(2);
  });

  it('persists itemsProcessed count across cycles', async () => {
    const items = [makeIngestedItem('msg1 ' + ulid()), makeIngestedItem('msg2 ' + ulid())];
    const adapter = makeAdapter(SourceAdapterType.Gmail, makeBatch(items));
    manager.register(adapter);

    await manager.runCycle();

    const state = syncState.get(SourceAdapterType.Gmail);
    expect(state?.itemsProcessed).toBe(2);
  });

  it('records error status on adapter failure', async () => {
    const adapter: SourceAdapter = {
      name: SourceAdapterType.Gmail,
      initialize: vi.fn(),
      fetchSince: vi.fn().mockRejectedValue(new Error('Network failure')),
      getCurrentCheckpoint: vi.fn(async () => ({})),
      shutdown: vi.fn(),
    };
    manager.register(adapter);

    await manager.runCycle();

    const state = syncState.get(SourceAdapterType.Gmail);
    expect(state?.status).toBe('error');
    expect(state?.errorMessage).toContain('Network failure');
  });
});

// ---------------------------------------------------------------------------
// Event emission on ingestion
// ---------------------------------------------------------------------------

describe('Event emission', () => {
  it('emits sync:started and sync:completed on successful cycle', async () => {
    const started: SourceAdapterType[] = [];
    const completed: Array<{ sourceAdapter: SourceAdapterType; itemCount: number }> = [];

    eventBus.on('sync:started', (e) => started.push(e.sourceAdapter));
    eventBus.on('sync:completed', (e) => completed.push(e));

    const item = makeIngestedItem('hello ' + ulid());
    const adapter = makeAdapter(SourceAdapterType.Gmail, makeBatch([item]));
    manager.register(adapter);

    await manager.runCycle();

    expect(started).toContain(SourceAdapterType.Gmail);
    expect(completed[0]?.sourceAdapter).toBe(SourceAdapterType.Gmail);
    expect(completed[0]?.itemCount).toBe(1);
  });

  it('emits items:ingested only when new items are inserted', async () => {
    const ingested: number[] = [];
    eventBus.on('items:ingested', (e) => ingested.push(e.count));

    // First cycle with one item
    const body = 'event test body ' + ulid();
    const adapter = makeAdapter(SourceAdapterType.Gmail, makeBatch([makeIngestedItem(body)]));
    manager.register(adapter);
    await manager.runCycle();
    expect(ingested).toEqual([1]);

    // Second cycle with same item — dedup → no items:ingested
    await manager.runCycle();
    expect(ingested).toHaveLength(1); // still only one event
  });

  it('emits sync:error on adapter failure', async () => {
    const errors: string[] = [];
    eventBus.on('sync:error', (e) => errors.push(e.error));

    const adapter: SourceAdapter = {
      name: SourceAdapterType.Gmail,
      initialize: vi.fn(),
      fetchSince: vi.fn().mockRejectedValue(new Error('Timeout')),
      getCurrentCheckpoint: vi.fn(async () => ({})),
      shutdown: vi.fn(),
    };
    manager.register(adapter);

    await manager.runCycle();

    expect(errors[0]).toContain('Timeout');
  });

  it('enqueues a Triage job for each new item', async () => {
    const items = [
      makeIngestedItem('msg a ' + ulid()),
      makeIngestedItem('msg b ' + ulid()),
    ];
    const adapter = makeAdapter(SourceAdapterType.Gmail, makeBatch(items));
    manager.register(adapter);

    await manager.runCycle();

    const job1 = jobs.dequeue(JobStage.Triage);
    const job2 = jobs.dequeue(JobStage.Triage);
    const job3 = jobs.dequeue(JobStage.Triage);

    expect(job1).toBeDefined();
    expect(job2).toBeDefined();
    expect(job3).toBeUndefined(); // only 2 items
    expect(job1?.status).toBe(JobStatus.Processing);
  });

  it('supports multiple registered adapters independently', async () => {
    const gmailItem = makeIngestedItem('gmail message ' + ulid());
    const imessageItem = makeIngestedItem('imessage message ' + ulid());

    const gmailAdapter = makeAdapter(SourceAdapterType.Gmail, makeBatch([gmailItem]));
    const imessageAdapter = makeAdapter(SourceAdapterType.IMessage, makeBatch([imessageItem]));

    manager.register(gmailAdapter);
    manager.register(imessageAdapter);

    await manager.runCycle();

    expect(rawItems.findByHash(sha256(gmailItem.body))).toBeDefined();
    expect(rawItems.findByHash(sha256(imessageItem.body))).toBeDefined();
    expect(jobs.getPendingCountByStage(JobStage.Triage)).toBe(2);
  });
});
