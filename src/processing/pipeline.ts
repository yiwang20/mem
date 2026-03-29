import type {
  ExtractionResult,
  Job,
  LLMProvider,
  RawItem,
} from '../types/index.js';
import {
  JobStage,
  JobStatus,
  PrivacyMode,
  ProcessingStatus,
} from '../types/index.js';
import type { JobQueueRepository, RawItemRepository } from '../storage/repositories.js';
import { runTier1Rules } from './tiers/tier1-rules.js';
import { runTier2NER } from './tiers/tier2-ner.js';
import { mergeResults, runTier3LLM } from './tiers/tier3-llm.js';
import { scoreImportance } from './importance.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineConfig {
  /** Maximum concurrent LLM calls (default: 3) */
  concurrency?: number;
  /** Whether to run tier 3 LLM extraction (disable for local-only mode) */
  enableTier3?: boolean;
  /** Polling interval in ms when queue is empty (default: 2000) */
  pollIntervalMs?: number;
  /**
   * Minimum importance score (0–1) required to trigger Tier 3 LLM extraction.
   * Items scoring below this threshold stop at Tier 2. Default: 0.3.
   */
  tier3ImportanceThreshold?: number;
  /** Privacy mode controls whether content goes to a cloud LLM. */
  privacyMode?: PrivacyMode;
  /** Fallback local provider for FullLocal / ContentAware routing. */
  localProvider?: LLMProvider;
}

export interface PipelineRepositories {
  rawItems: RawItemRepository;
  jobQueue: JobQueueRepository;
}

export interface ItemProcessingResult {
  rawItemId: string;
  extraction: ExtractionResult;
  tiersRun: JobStage[];
}

// ---------------------------------------------------------------------------
// ProcessingPipeline
// ---------------------------------------------------------------------------

export class ProcessingPipeline {
  private readonly concurrency: number;
  private readonly enableTier3: boolean;
  private readonly pollIntervalMs: number;
  private readonly tier3ImportanceThreshold: number;
  private readonly privacyMode: PrivacyMode;
  private readonly localProvider: LLMProvider | undefined;

  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private activeCount = 0;

  constructor(
    private readonly repos: PipelineRepositories,
    private readonly llmProvider: LLMProvider,
    config: PipelineConfig = {},
  ) {
    this.concurrency = config.concurrency ?? 3;
    this.enableTier3 = config.enableTier3 ?? true;
    this.pollIntervalMs = config.pollIntervalMs ?? 2000;
    this.tier3ImportanceThreshold = config.tier3ImportanceThreshold ?? 0.3;
    this.privacyMode = config.privacyMode ?? PrivacyMode.MinimalCloud;
    this.localProvider = config.localProvider;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /** Start continuous processing. Polls the queue until stop() is called. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedulePoll();
  }

  /** Stop continuous processing. Waits for in-flight items to finish. */
  stop(): void {
    this.running = false;
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Process a single raw item through all extraction tiers.
   * This is the core processing logic and can be called directly (e.g. in tests).
   */
  async processItem(item: RawItem): Promise<ItemProcessingResult> {
    const tiersRun: JobStage[] = [];

    // Tier 1: rule-based (synchronous)
    this.repos.rawItems.updateStatus(item.id, ProcessingStatus.Tier1);
    const tier1 = runTier1Rules(item);
    tiersRun.push(JobStage.Triage);

    // Tier 2: local NER (async but no API call)
    this.repos.rawItems.updateStatus(item.id, ProcessingStatus.Tier2);
    const tier2 = await runTier2NER(item);
    tiersRun.push(JobStage.NER);

    let finalResult: ExtractionResult;

    const importance = scoreImportance(item, tier1);
    const runTier3 =
      this.enableTier3 && importance >= this.tier3ImportanceThreshold;

    if (runTier3) {
      // Tier 3: LLM extraction (with privacy routing and PII redaction)
      this.repos.rawItems.updateStatus(item.id, ProcessingStatus.Tier3);
      finalResult = await runTier3LLM(item, tier1, tier2, this.llmProvider, {
        privacyMode: this.privacyMode,
        localProvider: this.localProvider,
      });
      tiersRun.push(JobStage.LLMExtract);
    } else {
      finalResult = mergeResults(tier1, tier2);
    }

    this.repos.rawItems.updateStatus(item.id, ProcessingStatus.Done);

    return {
      rawItemId: item.id,
      extraction: finalResult,
      tiersRun,
    };
  }

  /**
   * Dequeue up to `concurrency` pending triage jobs and process them.
   * Returns the number of items processed.
   */
  async processBatch(): Promise<number> {
    const slots = this.concurrency - this.activeCount;
    if (slots <= 0) return 0;

    const jobs: Job[] = [];
    for (let i = 0; i < slots; i++) {
      const job = this.repos.jobQueue.dequeue(JobStage.Triage);
      if (!job) break;
      jobs.push(job);
    }

    if (jobs.length === 0) return 0;

    const promises = jobs.map((job) => this.processJob(job));
    await Promise.allSettled(promises);
    return jobs.length;
  }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  private schedulePoll(): void {
    if (!this.running) return;
    this.pollTimer = setTimeout(() => {
      void this.tick();
    }, this.pollIntervalMs);
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    try {
      await this.processBatch();
    } catch (err) {
      console.error('[ProcessingPipeline] tick error:', err);
    } finally {
      this.schedulePoll();
    }
  }

  private async processJob(job: Job): Promise<void> {
    this.activeCount++;
    try {
      const item = this.repos.rawItems.findById(job.rawItemId);
      if (!item) {
        this.repos.jobQueue.fail(job.id, `RawItem ${job.rawItemId} not found`);
        return;
      }

      await this.processItem(item);
      this.repos.jobQueue.complete(job.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.repos.jobQueue.fail(job.id, message);
    } finally {
      this.activeCount--;
    }
  }
}
