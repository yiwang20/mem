import { describe, expect, it, vi, beforeEach } from 'vitest';
import { IngestionManager } from '../../src/ingestion/manager.js';
import { extractTextFromAttributedBody } from '../../src/ingestion/adapters/imessage.js';
import { EventBus } from '../../src/core/events.js';
import type {
  IngestionBatch,
  RawItem,
  SourceAdapter,
  SyncState,
} from '../../src/types/index.js';
import {
  BodyFormat,
  JobStage,
  JobStatus,
  ProcessingStatus,
  SourceAdapterType,
  SourceChannel,
} from '../../src/types/index.js';

// ----------------------------------------------------------------------------
// Mocks
// ----------------------------------------------------------------------------

function makeRawItemRepo() {
  const items = new Map<string, RawItem>();
  return {
    insert: vi.fn((item: RawItem) => { items.set(item.contentHash, item); }),
    findByHash: vi.fn((hash: string) => items.get(hash)),
    _items: items,
  };
}

function makeSyncStateRepo() {
  const states = new Map<SourceAdapterType, SyncState>();
  return {
    get: vi.fn((type: SourceAdapterType) => states.get(type)),
    upsert: vi.fn((state: SyncState) => { states.set(state.sourceAdapter, state); }),
    _states: states,
  };
}

function makeJobRepo() {
  const jobs: unknown[] = [];
  return {
    enqueue: vi.fn((job: unknown) => { jobs.push(job); }),
    _jobs: jobs,
  };
}

function makeAdapter(
  name: SourceAdapterType,
  batch: IngestionBatch,
): SourceAdapter {
  return {
    name,
    initialize: vi.fn(),
    fetchSince: vi.fn(async () => batch),
    getCurrentCheckpoint: vi.fn(async () => ({})),
    shutdown: vi.fn(),
  };
}

// ----------------------------------------------------------------------------
// IngestionManager
// ----------------------------------------------------------------------------

describe('IngestionManager', () => {
  let rawItems: ReturnType<typeof makeRawItemRepo>;
  let syncState: ReturnType<typeof makeSyncStateRepo>;
  let jobs: ReturnType<typeof makeJobRepo>;
  let eventBus: EventBus;
  let manager: IngestionManager;

  beforeEach(() => {
    rawItems = makeRawItemRepo();
    syncState = makeSyncStateRepo();
    jobs = makeJobRepo();
    eventBus = new EventBus();
    manager = new IngestionManager(
      rawItems as never,
      syncState as never,
      jobs as never,
      eventBus,
      60_000,
    );
  });

  it('inserts new items and enqueues triage jobs', async () => {
    const batch: IngestionBatch = {
      items: [
        {
          externalId: 'msg-1',
          threadId: null,
          sender: { name: 'Alice', email: 'alice@example.com', phone: null, handle: null },
          recipients: [],
          subject: 'Hello',
          body: 'Hello world',
          bodyFormat: BodyFormat.Plaintext,
          eventTime: Date.now(),
          attachments: [],
          metadata: {},
        },
      ],
      checkpoint: { lastRowId: 1 },
      hasMore: false,
    };

    const adapter = makeAdapter(SourceAdapterType.IMessage, batch);
    manager.register(adapter);

    await manager.runCycle();

    expect(rawItems.insert).toHaveBeenCalledOnce();
    expect(jobs.enqueue).toHaveBeenCalledOnce();

    const job = jobs._jobs[0] as { stage: string; status: string; rawItemId: string };
    expect(job.stage).toBe(JobStage.Triage);
    expect(job.status).toBe(JobStatus.Pending);
  });

  it('deduplicates items with the same content hash', async () => {
    const item = {
      externalId: 'msg-1',
      threadId: null,
      sender: { name: null, email: null, phone: null, handle: null },
      recipients: [],
      subject: null,
      body: 'Duplicate body',
      bodyFormat: BodyFormat.Plaintext,
      eventTime: Date.now(),
      attachments: [],
      metadata: {},
    };

    const batch: IngestionBatch = {
      items: [item, { ...item, externalId: 'msg-2' }],
      checkpoint: {},
      hasMore: false,
    };

    const adapter = makeAdapter(SourceAdapterType.Gmail, batch);
    manager.register(adapter);

    await manager.runCycle();

    // Only first item inserted; second has same hash
    expect(rawItems.insert).toHaveBeenCalledOnce();
    expect(jobs.enqueue).toHaveBeenCalledOnce();
  });

  it('emits items:ingested event after successful cycle', async () => {
    const handler = vi.fn();
    eventBus.on('items:ingested', handler);

    const batch: IngestionBatch = {
      items: [
        {
          externalId: 'x',
          threadId: null,
          sender: { name: null, email: null, phone: null, handle: null },
          recipients: [],
          subject: null,
          body: 'Some content',
          bodyFormat: BodyFormat.Plaintext,
          eventTime: Date.now(),
          attachments: [],
          metadata: {},
        },
      ],
      checkpoint: {},
      hasMore: false,
    };

    manager.register(makeAdapter(SourceAdapterType.Filesystem, batch));
    await manager.runCycle();

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      count: 1,
      sourceAdapter: SourceAdapterType.Filesystem,
    });
  });

  it('emits sync:error and persists error state when adapter throws', async () => {
    const errorHandler = vi.fn();
    eventBus.on('sync:error', errorHandler);

    const brokenAdapter: SourceAdapter = {
      name: SourceAdapterType.Gmail,
      initialize: vi.fn(),
      fetchSince: vi.fn(async () => { throw new Error('connection refused'); }),
      getCurrentCheckpoint: vi.fn(async () => ({})),
      shutdown: vi.fn(),
    };

    manager.register(brokenAdapter);
    await manager.runCycle();

    expect(errorHandler).toHaveBeenCalledOnce();
    const state = syncState._states.get(SourceAdapterType.Gmail);
    expect(state?.status).toBe('error');
    expect(state?.errorMessage).toBe('connection refused');
  });

  it('persists updated checkpoint after successful cycle', async () => {
    const batch: IngestionBatch = {
      items: [],
      checkpoint: { lastRowId: 42 },
      hasMore: false,
    };

    manager.register(makeAdapter(SourceAdapterType.IMessage, batch));
    await manager.runCycle();

    const state = syncState._states.get(SourceAdapterType.IMessage);
    expect(state?.lastCheckpoint).toEqual({ lastRowId: 42 });
    expect(state?.status).toBe('ok');
  });

  it('does not emit items:ingested when no new items', async () => {
    const handler = vi.fn();
    eventBus.on('items:ingested', handler);

    const batch: IngestionBatch = { items: [], checkpoint: {}, hasMore: false };
    manager.register(makeAdapter(SourceAdapterType.Gmail, batch));
    await manager.runCycle();

    expect(handler).not.toHaveBeenCalled();
  });

  it('skips concurrent cycle if already running', async () => {
    let resolveFirst!: () => void;
    const firstCallDone = new Promise<void>((res) => { resolveFirst = res; });

    const adapter: SourceAdapter = {
      name: SourceAdapterType.Gmail,
      initialize: vi.fn(),
      fetchSince: vi.fn(async () => {
        await firstCallDone;
        return { items: [], checkpoint: {}, hasMore: false } as IngestionBatch;
      }),
      getCurrentCheckpoint: vi.fn(async () => ({})),
      shutdown: vi.fn(),
    };

    manager.register(adapter);

    const p1 = manager.runCycle();
    const p2 = manager.runCycle(); // should be skipped

    resolveFirst();
    await Promise.all([p1, p2]);

    // fetchSince only called once since second cycle was skipped
    expect(adapter.fetchSince).toHaveBeenCalledOnce();
  });
});

// ----------------------------------------------------------------------------
// extractTextFromAttributedBody
// ----------------------------------------------------------------------------

describe('extractTextFromAttributedBody', () => {
  it('returns empty string for non-bplist buffers', () => {
    const buf = Buffer.from('not a bplist');
    expect(extractTextFromAttributedBody(buf)).toBe('');
  });

  it('returns empty string for empty buffer', () => {
    expect(extractTextFromAttributedBody(Buffer.alloc(0))).toBe('');
  });

  it('returns empty string for very short bplist magic', () => {
    const buf = Buffer.from('bplist0');
    expect(extractTextFromAttributedBody(buf)).toBe('');
  });

  it('handles buffers that are too short for trailer gracefully', () => {
    const buf = Buffer.from('bplist00' + '\x00'.repeat(10));
    // Should not throw
    expect(() => extractTextFromAttributedBody(buf)).not.toThrow();
  });
});
