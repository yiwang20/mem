import type {
  AttentionItem,
  Entity,
  ExtractedEntity,
  GraphFragment,
  LLMProvider,
  MindFlowConfig,
  QueryRequest,
  QueryResult,
  Relationship,
  SourceAdapter,
  Thread,
} from '../types/index.js';
import {
  EntityStatus,
  EntityType,
  JobStage,
  RelationshipType,
  SourceChannel,
  SourceAdapterType,
} from '../types/index.js';
import {
  AttentionItemRepository,
  EntityAliasRepository,
  EntityEpisodeRepository,
  EntityRepository,
  JobQueueRepository,
  MergeAuditRepository,
  MindFlowDatabase,
  RawItemRepository,
  RelationshipRepository,
  SyncStateRepository,
  ThreadRepository,
  UserCorrectionRepository,
} from '../storage/index.js';
import { ConfigManager, MindFlowConfigSchema } from './config.js';
import { EventBus } from './events.js';
import { IngestionManager } from '../ingestion/manager.js';
import { ProcessingPipeline } from '../processing/pipeline.js';
import { EntityResolver } from '../graph/entity-resolver.js';
import { GraphOperations } from '../graph/operations.js';
import { TopicLifecycleManager } from '../graph/topic-lifecycle.js';
import { TopicClusterer } from '../graph/clustering.js';
import { UserCorrectionManager } from '../graph/corrections.js';
import { CrossChannelLinker } from '../graph/cross-channel.js';
import { CommunityDetector } from '../graph/community.js';
import { AttentionEngine } from '../attention/engine.js';
import { QueryEngine } from '../query/engine.js';
import { MockProvider } from '../llm/provider.js';
import { detectOpenClawCredentials } from '../llm/openclaw-provider.js';
import { AzureProvider } from '../llm/azure-provider.js';
import { ulid } from '../utils/ulid.js';

export interface SystemStats {
  rawItemCount: number;
  entityCount: number;
  relationshipCount: number;
  pendingJobCount: number;
  attentionItemCount: number;
  lastSyncAt: number | null;
}

export class MindFlowEngine {
  readonly db: MindFlowDatabase;
  readonly eventBus: EventBus;
  readonly configManager: ConfigManager;

  // Repositories — exposed so other modules can use them directly
  readonly rawItems: RawItemRepository;
  readonly entities: EntityRepository;
  readonly relationships: RelationshipRepository;
  readonly threads: ThreadRepository;
  readonly attentionItems: AttentionItemRepository;
  readonly jobs: JobQueueRepository;
  readonly syncState: SyncStateRepository;
  readonly entityAliases: EntityAliasRepository;
  readonly entityEpisodes: EntityEpisodeRepository;
  readonly mergeAudit: MergeAuditRepository;
  readonly userCorrections: UserCorrectionRepository;

  // Subsystem instances — exposed for direct use by adapters and tests
  readonly ingestionManager: IngestionManager;
  // pipeline, entityResolver, and queryEngine may be re-wired in init() when
  // an LLM provider is auto-detected after construction.
  pipeline: ProcessingPipeline;
  entityResolver: EntityResolver;
  readonly graphOps: GraphOperations;
  readonly attentionEngine: AttentionEngine;
  readonly topicLifecycleManager: TopicLifecycleManager;
  readonly topicClusterer: TopicClusterer;
  readonly correctionManager: UserCorrectionManager;
  readonly crossChannelLinker: CrossChannelLinker;
  readonly communityDetector: CommunityDetector;
  queryEngine: QueryEngine;

  private config: MindFlowConfig;
  private initialized = false;
  private llmProvider: LLMProvider;
  /** True when the caller supplied an explicit provider; auto-detection is skipped. */
  private readonly explicitProvider: boolean;

  constructor(config: Partial<MindFlowConfig> = {}, llmProvider?: LLMProvider) {
    // Validate and apply defaults
    this.config = MindFlowConfigSchema.parse(config);

    this.db = new MindFlowDatabase(this.config.dbPath);
    this.eventBus = new EventBus();
    this.configManager = new ConfigManager(this.db.db);

    this.rawItems = new RawItemRepository(this.db.db);
    this.entities = new EntityRepository(this.db.db);
    this.relationships = new RelationshipRepository(this.db.db);
    this.threads = new ThreadRepository(this.db.db);
    this.attentionItems = new AttentionItemRepository(this.db.db);
    this.jobs = new JobQueueRepository(this.db.db);
    this.syncState = new SyncStateRepository(this.db.db);
    this.entityAliases = new EntityAliasRepository(this.db.db);
    this.entityEpisodes = new EntityEpisodeRepository(this.db.db);
    this.mergeAudit = new MergeAuditRepository(this.db.db);
    this.userCorrections = new UserCorrectionRepository(this.db.db);

    // Use provided LLM provider or fall back to MockProvider (safe no-op for local use)
    this.explicitProvider = llmProvider !== undefined;
    this.llmProvider = llmProvider ?? new MockProvider();

    this.ingestionManager = new IngestionManager(
      this.rawItems,
      this.syncState,
      this.jobs,
      this.eventBus,
      this.config.ingestionIntervalMs,
    );

    this.pipeline = new ProcessingPipeline(
      { rawItems: this.rawItems, jobQueue: this.jobs },
      this.llmProvider,
      { enableTier3: false }, // Tier 3 off by default; enabled once a real LLM is configured
    );

    this.entityResolver = new EntityResolver(
      this.db.db,
      this.entities,
      this.entityAliases,
      this.llmProvider,
    );

    this.graphOps = new GraphOperations(this.db.db);

    this.topicLifecycleManager = new TopicLifecycleManager(this.db.db);
    this.topicClusterer = new TopicClusterer(this.db.db, this.llmProvider);

    this.crossChannelLinker = new CrossChannelLinker(this.db.db);
    this.communityDetector = new CommunityDetector(this.db.db);

    this.correctionManager = new UserCorrectionManager(
      this.db.db,
      this.entities,
      this.entityAliases,
      this.mergeAudit,
      this.userCorrections,
      this.eventBus,
    );

    this.attentionEngine = new AttentionEngine(
      this.db.db,
      this.attentionItems,
      this.entities,
      this.rawItems,
    );

    this.queryEngine = new QueryEngine(
      {
        rawItems: this.rawItems,
        entities: this.entities,
        attentionItems: this.attentionItems,
      },
      this.graphOps,
      this.llmProvider,
    );
  }

  /**
   * Initialize the engine: merge persisted config, mark as ready.
   * Must be called before using the engine in production; safe to skip in tests.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // Merge persisted config overrides on top of constructor config
    const persisted = this.configManager.load();
    this.config = MindFlowConfigSchema.parse({ ...this.config, ...persisted });

    // Auto-wire an LLM provider when none was explicitly supplied
    if (!this.explicitProvider) {
      const detectedProvider = this.detectProvider();
      if (detectedProvider !== null) {
        this.rewireProvider(detectedProvider);
      }
    }

    this.initialized = true;
  }

  /**
   * Register a source adapter for ingestion.
   * Must be called before ingest() for the adapter to be used.
   */
  registerAdapter(adapter: SourceAdapter): void {
    this.ingestionManager.register(adapter);
  }

  /**
   * Trigger one ingestion cycle across all registered source adapters,
   * run the processing pipeline, resolve/persist entities, and refresh the
   * attention surface. Emits typed events after each stage.
   */
  async ingest(): Promise<void> {
    // 1. Fetch new items from all registered adapters
    await this.ingestionManager.runCycle();

    // 2. Drain the processing queue item-by-item so we can act on each result
    let totalProcessed = 0;
    let batchCount: number;
    do {
      batchCount = 0;

      // Dequeue up to concurrency=3 triage jobs at a time
      for (let i = 0; i < 3; i++) {
        const job = this.jobs.dequeue(JobStage.Triage);
        if (!job) break;

        const item = this.rawItems.findById(job.rawItemId);
        if (!item) {
          this.jobs.fail(job.id, `RawItem ${job.rawItemId} not found`);
          continue;
        }

        try {
          // 2a. Run tier extraction
          const result = await this.pipeline.processItem(item);
          this.jobs.complete(job.id);
          batchCount++;
          totalProcessed++;

          // Emit item:processed event
          this.eventBus.emit('item:processed', {
            itemId: item.id,
            stage: result.tiersRun[result.tiersRun.length - 1] ?? JobStage.Triage,
          });

          // 2b. Resolve extracted entities and persist new ones.
          // Build a name→entityId map for relationship resolution below.
          const nameToEntityId = new Map<string, string>();

          if (result.extraction.entities.length > 0) {
            const resolutions = await this.entityResolver.resolve(
              result.extraction.entities,
              item,
            );

            for (const resolution of resolutions) {
              if (resolution.decision.kind === 'new') {
                const entity = this.buildEntityFromExtracted(
                  resolution.extractedEntity,
                  item.eventTime,
                );
                this.entities.insert(entity);
                this.entityEpisodes.insert({
                  entityId: entity.id,
                  rawItemId: item.id,
                  extractionMethod: 'pipeline',
                  confidence: resolution.extractedEntity.confidence,
                });
                this.eventBus.emit('entity:created', { entity });
                nameToEntityId.set(resolution.extractedEntity.name, entity.id);
                if (resolution.extractedEntity.nameAlt) {
                  nameToEntityId.set(resolution.extractedEntity.nameAlt, entity.id);
                }
              } else if (
                resolution.decision.kind === 'matched' ||
                resolution.decision.kind === 'suggest'
              ) {
                // Update last_seen_at on the matched entity
                const existing = this.entities.findById(resolution.decision.entityId);
                if (existing && existing.status !== EntityStatus.Merged) {
                  const updated: Entity = {
                    ...existing,
                    lastSeenAt: Math.max(existing.lastSeenAt, item.eventTime),
                    updatedAt: Date.now(),
                  };
                  this.entities.update(updated);
                  this.entityEpisodes.insert({
                    entityId: existing.id,
                    rawItemId: item.id,
                    extractionMethod: 'pipeline',
                    confidence: resolution.extractedEntity.confidence,
                  });
                  this.eventBus.emit('entity:updated', { entity: updated });
                  nameToEntityId.set(resolution.extractedEntity.name, existing.id);
                  if (resolution.extractedEntity.nameAlt) {
                    nameToEntityId.set(resolution.extractedEntity.nameAlt, existing.id);
                  }
                }
              }
            }
          }

          // 2c. Persist extracted relationships now that we have resolved entity IDs.
          if (result.extraction.relationships.length > 0) {
            const now = Date.now();
            for (const extRel of result.extraction.relationships) {
              const fromEntityId = nameToEntityId.get(extRel.fromEntityName);
              const toEntityId = nameToEntityId.get(extRel.toEntityName);
              // Only persist when both sides resolved to known entities
              if (!fromEntityId || !toEntityId) continue;

              const rel: Relationship = {
                id: ulid(),
                fromEntityId,
                toEntityId,
                type: extRel.type,
                strength: extRel.strength,
                eventTime: item.eventTime,
                ingestionTime: now,
                validFrom: item.eventTime,
                validUntil: null,
                occurrenceCount: 1,
                sourceItemIds: [item.id],
                metadata: extRel.metadata ?? {},
              };
              try {
                this.relationships.insert(rel);
              } catch (err) {
                // Swallow duplicate/constraint errors — relationships may be re-encountered
                const msg = err instanceof Error ? err.message : String(err);
                if (!msg.includes('UNIQUE constraint')) {
                  console.error('[engine] relationship insert error:', msg);
                }
              }
            }
          }

          // 2d. Populate thread entities for items that belong to a thread.
          if (item.threadId) {
            this.upsertThreadEntity(item);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.jobs.fail(job.id, message);
        }
      }
    } while (batchCount > 0);

    // 3. Detect cross-channel continuations and link thread entities
    try {
      this.crossChannelLinker.detectContinuations();
    } catch (err) {
      console.error('[engine] cross-channel linking failed:', err);
    }

    // 4. Run attention detection on newly processed data
    const newAttentionItems = this.attentionEngine.detectAll();
    for (const attItem of newAttentionItems) {
      this.eventBus.emit('attention:created', { item: attItem });
    }

    // 5. Update topic lifecycle statuses (active → dormant → archived)
    this.topicLifecycleManager.updateLifecycles();

    // 6. Run topic clustering based on entity co-occurrence
    try {
      this.topicClusterer.clusterTopics();
    } catch (err) {
      console.error('[engine] topic clustering failed:', err);
    }

    // 7. Run community detection over person entities
    try {
      const communities = this.communityDetector.detectCommunities();
      for (const { community } of communities) {
        this.eventBus.emit('community:updated', { community });
      }
    } catch (err) {
      console.error('[engine] community detection failed:', err);
    }

    // 8. Run sub-topic discovery on topics that have accumulated enough messages
    try {
      await this.topicClusterer.discoverSubTopics();
    } catch (err) {
      console.error('[engine] sub-topic discovery failed:', err);
    }

    // 9. Emit pipeline progress summary
    if (totalProcessed > 0) {
      this.eventBus.emit('pipeline:progress', {
        stage: JobStage.Triage,
        processed: totalProcessed,
        total: totalProcessed,
      });
    }
  }

  /**
   * Create or update a Thread record and its corresponding Thread entity for
   * a raw item that belongs to a thread.
   *
   * - Looks up the Thread row by external_thread_id (raw SQL, no dedicated repo method).
   * - Creates the Thread entity (EntityType.Thread) if it doesn't exist yet.
   * - Links every participant (sender + recipients) to the thread entity via
   *   participates_in relationships and entity_episodes.
   */
  private upsertThreadEntity(item: {
    id: string;
    threadId: string | null;
    sourceAdapter: SourceAdapterType;
    channel: SourceChannel;
    subject: string | null;
    senderEntityId: string | null;
    recipientEntityIds: string[];
    eventTime: number;
  }): void {
    if (!item.threadId) return;

    const now = Date.now();

    // ---- 1. Look up or create the Thread record --------------------------------
    const existingThreadRow = this.db.db
      .prepare('SELECT * FROM threads WHERE external_thread_id = ?')
      .get(item.threadId) as Record<string, unknown> | undefined;

    let thread: Thread;
    if (existingThreadRow) {
      thread = {
        id: existingThreadRow['id'] as string,
        sourceAdapter: existingThreadRow['source_adapter'] as SourceAdapterType,
        channel: existingThreadRow['channel'] as SourceChannel,
        externalThreadId: existingThreadRow['external_thread_id'] as string | null,
        subject: (existingThreadRow['subject'] as string | null) ?? item.subject,
        participantEntityIds: (() => {
          try {
            return JSON.parse(existingThreadRow['participant_entity_ids'] as string) as string[];
          } catch {
            return [];
          }
        })(),
        firstMessageAt: existingThreadRow['first_message_at'] as number,
        lastMessageAt: existingThreadRow['last_message_at'] as number,
        messageCount: existingThreadRow['message_count'] as number,
        summary: existingThreadRow['summary'] as string | null,
        status: existingThreadRow['status'] as string,
      };

      // Merge new participants and update timestamps
      const participantSet = new Set(thread.participantEntityIds);
      if (item.senderEntityId) participantSet.add(item.senderEntityId);
      for (const r of item.recipientEntityIds) participantSet.add(r);

      thread = {
        ...thread,
        subject: thread.subject ?? item.subject,
        participantEntityIds: Array.from(participantSet),
        lastMessageAt: Math.max(thread.lastMessageAt, item.eventTime),
        messageCount: thread.messageCount + 1,
      };
      this.threads.update(thread);
    } else {
      // New thread
      const participantSet = new Set<string>();
      if (item.senderEntityId) participantSet.add(item.senderEntityId);
      for (const r of item.recipientEntityIds) participantSet.add(r);

      thread = {
        id: ulid(),
        sourceAdapter: item.sourceAdapter,
        channel: item.channel,
        externalThreadId: item.threadId,
        subject: item.subject,
        participantEntityIds: Array.from(participantSet),
        firstMessageAt: item.eventTime,
        lastMessageAt: item.eventTime,
        messageCount: 1,
        summary: null,
        status: 'active',
      };
      this.threads.insert(thread);
    }

    // ---- 2. Look up or create the Thread entity --------------------------------
    const threadEntityName = item.subject ?? `Thread ${item.threadId.slice(0, 8)}`;
    const existingEntityRow = this.db.db
      .prepare(
        `SELECT * FROM entities WHERE type = ? AND canonical_name = ? AND status != 'merged' LIMIT 1`,
      )
      .get(EntityType.Thread, threadEntityName) as Record<string, unknown> | undefined;

    let threadEntityId: string;
    if (existingEntityRow) {
      threadEntityId = existingEntityRow['id'] as string;
      // Update last_seen_at
      this.db.db
        .prepare(
          `UPDATE entities SET last_seen_at = MAX(last_seen_at, ?), updated_at = ? WHERE id = ?`,
        )
        .run(item.eventTime, now, threadEntityId);
    } else {
      threadEntityId = ulid();
      const threadEntity: Entity = {
        id: threadEntityId,
        type: EntityType.Thread,
        canonicalName: threadEntityName,
        nameAlt: null,
        aliases: [],
        attributes: { externalThreadId: item.threadId },
        confidence: 1.0,
        status: EntityStatus.Active,
        mergedInto: null,
        parentEntityId: null,
        firstSeenAt: item.eventTime,
        lastSeenAt: item.eventTime,
        createdAt: now,
        updatedAt: now,
      };
      this.entities.insert(threadEntity);
      this.eventBus.emit('entity:created', { entity: threadEntity });
    }

    // ---- 3. Link item to thread entity via entity_episode ----------------------
    try {
      this.entityEpisodes.insert({
        entityId: threadEntityId,
        rawItemId: item.id,
        extractionMethod: 'thread',
        confidence: 1.0,
      });
    } catch {
      // Episode may already exist for this raw_item + entity pair
    }

    // ---- 4. Create participates_in relationships for each participant ----------
    for (const participantId of thread.participantEntityIds) {
      const rel: Relationship = {
        id: ulid(),
        fromEntityId: participantId,
        toEntityId: threadEntityId,
        type: RelationshipType.ParticipatesIn,
        strength: 0.8,
        eventTime: item.eventTime,
        ingestionTime: now,
        validFrom: item.eventTime,
        validUntil: null,
        occurrenceCount: 1,
        sourceItemIds: [item.id],
        metadata: {},
      };
      try {
        this.relationships.insert(rel);
      } catch {
        // Duplicate participant→thread relationship is fine; skip silently
      }
    }
  }

  /**
   * Build a new Entity record from an ExtractedEntity.
   */
  private buildEntityFromExtracted(
    extracted: ExtractedEntity,
    eventTime: number,
  ): Entity {
    const now = Date.now();
    return {
      id: ulid(),
      type: extracted.type,
      canonicalName: extracted.name,
      nameAlt: extracted.nameAlt,
      aliases: [],
      attributes: extracted.attributes,
      confidence: extracted.confidence,
      status: EntityStatus.Active,
      mergedInto: null,
      parentEntityId: null,
      firstSeenAt: eventTime,
      lastSeenAt: eventTime,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Execute a natural-language query against the knowledge base.
   */
  async query(request: QueryRequest): Promise<QueryResult> {
    return this.queryEngine.query(request);
  }

  /** Retrieve a single entity by ID. Returns null if not found or merged. */
  getEntity(id: string): Entity | null {
    const entity = this.entities.findById(id);
    if (!entity || entity.status === 'merged') return null;
    return entity;
  }

  /**
   * Return a graph fragment centered on the given entity.
   * Delegates to GraphOperations.getSubgraph().
   */
  getGraph(centerId: string, depth = 2): GraphFragment {
    return this.graphOps.getSubgraph(centerId, depth);
  }

  /**
   * Return all currently pending attention items (not resolved, dismissed,
   * or actively snoozed).
   */
  getAttentionItems(): AttentionItem[] {
    return this.attentionItems.findPending();
  }

  /** Return basic system statistics. */
  getStats(): SystemStats {
    const db = this.db.db;

    const rawItemCount = (
      db.prepare('SELECT COUNT(*) as n FROM raw_items').get() as { n: number }
    ).n;

    const entityCount = (
      db
        .prepare(`SELECT COUNT(*) as n FROM entities WHERE status != 'merged'`)
        .get() as { n: number }
    ).n;

    const relationshipCount = (
      db
        .prepare('SELECT COUNT(*) as n FROM relationships WHERE valid_until IS NULL')
        .get() as { n: number }
    ).n;

    const pendingJobCount = this.jobs.getPendingCount();

    const attentionItemCount = (
      db
        .prepare(
          `SELECT COUNT(*) as n FROM attention_items
           WHERE resolved_at IS NULL AND dismissed_at IS NULL`,
        )
        .get() as { n: number }
    ).n;

    const lastSyncRow = db
      .prepare('SELECT MAX(last_sync_at) as t FROM sync_state')
      .get() as { t: number | null };
    const lastSyncAt = lastSyncRow.t ?? null;

    return {
      rawItemCount,
      entityCount,
      relationshipCount,
      pendingJobCount,
      attentionItemCount,
      lastSyncAt,
    };
  }

  /** The active configuration. */
  getConfig(): MindFlowConfig {
    return this.config;
  }

  /** Persist config updates to the database and update in-memory config. */
  updateConfig(updates: Partial<MindFlowConfig>): void {
    this.config = MindFlowConfigSchema.parse({ ...this.config, ...updates });
    this.configManager.save(updates);
  }

  /** Shut down the engine and release all resources. */
  close(): void {
    this.ingestionManager.stop();
    this.pipeline.stop();
    this.db.close();
  }

  // --------------------------------------------------------------------------
  // Private: provider auto-detection and re-wiring
  // --------------------------------------------------------------------------

  /**
   * Resolve the best available LLM provider from config and environment.
   * Priority: Azure config → OpenClaw credentials → null (keep MockProvider).
   */
  private detectProvider(): LLMProvider | null {
    // 1. Azure — explicit config takes priority over ambient credentials
    const azureCfg = this.config.llm.providers['azure'] as Record<string, unknown> | undefined;
    if (
      azureCfg &&
      typeof azureCfg['endpoint'] === 'string' &&
      typeof azureCfg['deploymentName'] === 'string' &&
      typeof azureCfg['apiKey'] === 'string'
    ) {
      return new AzureProvider({
        endpoint: azureCfg['endpoint'],
        deploymentName: azureCfg['deploymentName'],
        apiKey: azureCfg['apiKey'],
        apiVersion: typeof azureCfg['apiVersion'] === 'string' ? azureCfg['apiVersion'] : undefined,
        embeddingDeployment: typeof azureCfg['embeddingDeployment'] === 'string' ? azureCfg['embeddingDeployment'] : undefined,
      });
    }

    // 2. OpenClaw — read Anthropic token from ~/.openclaw credentials file
    return detectOpenClawCredentials();
  }

  /** Swap in a new LLM provider and re-wire the three subsystems that use it. */
  private rewireProvider(provider: LLMProvider): void {
    this.llmProvider = provider;
    this.pipeline = new ProcessingPipeline(
      { rawItems: this.rawItems, jobQueue: this.jobs },
      this.llmProvider,
      { enableTier3: true },
    );
    this.entityResolver = new EntityResolver(
      this.db.db,
      this.entities,
      this.entityAliases,
      this.llmProvider,
    );
    this.queryEngine = new QueryEngine(
      {
        rawItems: this.rawItems,
        entities: this.entities,
        attentionItems: this.attentionItems,
      },
      this.graphOps,
      this.llmProvider,
    );
  }
}
