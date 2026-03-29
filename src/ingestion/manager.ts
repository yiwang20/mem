import type { EventBus } from '../core/events.js';
import type {
  JobQueueRepository,
  RawItemRepository,
  SyncStateRepository,
} from '../storage/repositories.js';
import type {
  IngestionBatch,
  IngestedItem,
  RawItem,
  SourceAdapter,
  SyncState,
} from '../types/index.js';
import {
  JobStage,
  JobStatus,
  ProcessingStatus,
  SourceAdapterType,
  SourceChannel,
} from '../types/index.js';
import { sha256 } from '../utils/hash.js';
import { ulid } from '../utils/ulid.js';

// ----------------------------------------------------------------------------
// IngestionManager
// ----------------------------------------------------------------------------

export class IngestionManager {
  private readonly adapters = new Map<SourceAdapterType, SourceAdapter>();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly rawItems: RawItemRepository,
    private readonly syncState: SyncStateRepository,
    private readonly jobs: JobQueueRepository,
    private readonly eventBus: EventBus,
    private readonly intervalMs = 900_000,
  ) {}

  register(adapter: SourceAdapter): void {
    this.adapters.set(adapter.name, adapter);
  }

  start(): void {
    if (this.intervalId !== null) return;
    // Run immediately on start, then on interval
    void this.runCycle();
    this.intervalId = setInterval(() => void this.runCycle(), this.intervalMs);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async runCycle(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      for (const [adapterType, adapter] of this.adapters) {
        await this.runAdapter(adapterType, adapter);
      }
    } finally {
      this.running = false;
    }
  }

  private async runAdapter(
    adapterType: SourceAdapterType,
    adapter: SourceAdapter,
  ): Promise<void> {
    this.eventBus.emit('sync:started', { sourceAdapter: adapterType });

    const existingState = this.syncState.get(adapterType);
    const checkpoint = existingState?.lastCheckpoint ?? null;

    let totalIngested = 0;

    try {
      let batch: IngestionBatch;
      let currentCheckpoint = checkpoint;

      do {
        batch = await adapter.fetchSince(currentCheckpoint);
        const newItems = this.processBatch(adapterType, batch);
        totalIngested += newItems.length;
        currentCheckpoint = batch.checkpoint;
      } while (batch.hasMore);

      const updatedState: SyncState = {
        sourceAdapter: adapterType,
        lastCheckpoint: currentCheckpoint ?? {},
        lastSyncAt: Date.now(),
        itemsProcessed: (existingState?.itemsProcessed ?? 0) + totalIngested,
        status: 'ok',
        errorMessage: null,
        config: existingState?.config ?? {},
      };
      this.syncState.upsert(updatedState);

      this.eventBus.emit('sync:completed', {
        sourceAdapter: adapterType,
        itemCount: totalIngested,
      });

      if (totalIngested > 0) {
        this.eventBus.emit('items:ingested', {
          count: totalIngested,
          sourceAdapter: adapterType,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errorState: SyncState = {
        sourceAdapter: adapterType,
        lastCheckpoint: checkpoint ?? {},
        lastSyncAt: Date.now(),
        itemsProcessed: existingState?.itemsProcessed ?? 0,
        status: 'error',
        errorMessage: message,
        config: existingState?.config ?? {},
      };
      this.syncState.upsert(errorState);

      this.eventBus.emit('sync:error', {
        sourceAdapter: adapterType,
        error: message,
      });
    }
  }

  private processBatch(
    adapterType: SourceAdapterType,
    batch: IngestionBatch,
  ): RawItem[] {
    const inserted: RawItem[] = [];

    for (const item of batch.items) {
      const contentHash = sha256(item.body);

      // Deduplicate by content hash
      if (this.rawItems.findByHash(contentHash)) continue;

      const rawItem = this.buildRawItem(adapterType, item, contentHash);
      this.rawItems.insert(rawItem);

      this.jobs.enqueue({
        id: ulid(),
        rawItemId: rawItem.id,
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

      inserted.push(rawItem);
    }

    return inserted;
  }

  private buildRawItem(
    adapterType: SourceAdapterType,
    item: IngestedItem,
    contentHash: string,
  ): RawItem {
    return {
      id: ulid(),
      sourceAdapter: adapterType,
      channel: ADAPTER_CHANNEL_MAP[adapterType],
      externalId: item.externalId,
      threadId: item.threadId,
      senderEntityId: null,
      recipientEntityIds: [],
      subject: item.subject,
      body: item.body,
      bodyFormat: item.bodyFormat,
      contentHash,
      language: null,
      eventTime: item.eventTime,
      ingestedAt: Date.now(),
      processingStatus: ProcessingStatus.Pending,
      attachments: item.attachments,
      metadata: item.metadata,
    };
  }
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const ADAPTER_CHANNEL_MAP: Record<SourceAdapterType, SourceChannel> = {
  [SourceAdapterType.Gmail]: SourceChannel.Email,
  [SourceAdapterType.IMessage]: SourceChannel.IMessage,
  [SourceAdapterType.Filesystem]: SourceChannel.File,
};
