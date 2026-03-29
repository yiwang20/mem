// ============================================================================
// MindFlow Core Type Definitions
// ============================================================================

// ----------------------------------------------------------------------------
// Enums
// ----------------------------------------------------------------------------

export enum EntityType {
  Person = 'person',
  Topic = 'topic',
  ActionItem = 'action_item',
  KeyFact = 'key_fact',
  Document = 'document',
  Thread = 'thread',
}

export enum RelationshipType {
  Discusses = 'discusses',
  CommunicatesWith = 'communicates_with',
  AssignedTo = 'assigned_to',
  RequestedBy = 'requested_by',
  RelatedTo = 'related_to',
  PartOf = 'part_of',
  ParticipatesIn = 'participates_in',
  ContinuesIn = 'continues_in',
  MemberOf = 'member_of',
}

export enum SourceChannel {
  Email = 'email',
  IMessage = 'imessage',
  File = 'file',
}

export enum SourceAdapterType {
  Gmail = 'gmail',
  IMessage = 'imessage',
  Filesystem = 'filesystem',
}

export enum ProcessingStatus {
  Pending = 'pending',
  Tier1 = 'tier1',
  Tier2 = 'tier2',
  Tier3 = 'tier3',
  Done = 'done',
}

export enum EntityStatus {
  Active = 'active',
  Dormant = 'dormant',
  Archived = 'archived',
  Merged = 'merged',
}

export enum JobStage {
  Triage = 'triage',
  NER = 'ner',
  LLMExtract = 'llm_extract',
  Resolve = 'resolve',
  Embed = 'embed',
  Link = 'link',
}

export enum JobStatus {
  Pending = 'pending',
  Processing = 'processing',
  Completed = 'completed',
  Failed = 'failed',
  Skipped = 'skipped',
}

export enum AttentionItemType {
  UnansweredRequest = 'unanswered_request',
  ApproachingDeadline = 'approaching_deadline',
  UnreviewedDocument = 'unreviewed_document',
  StaleConversation = 'stale_conversation',
  RepeatedMentions = 'repeated_mentions',
}

export enum ResolutionType {
  Responded = 'responded',
  Done = 'done',
  Dismissed = 'dismissed',
  Expired = 'expired',
}

export enum MergeMethod {
  EmailMatch = 'email_match',
  PhoneMatch = 'phone_match',
  NameSimilarity = 'name_similarity',
  LLMResolution = 'llm_resolution',
  UserManual = 'user_manual',
}

export enum CorrectionType {
  EntityMerge = 'entity_merge',
  EntitySplit = 'entity_split',
  TopicRename = 'topic_rename',
  TopicMerge = 'topic_merge',
  EntityUpdate = 'entity_update',
}

export enum BodyFormat {
  Plaintext = 'plaintext',
  HTML = 'html',
  Markdown = 'markdown',
}

export enum DetectedLanguage {
  English = 'en',
  Chinese = 'zh',
  Mixed = 'mixed',
}

export enum AliasType {
  Name = 'name',
  Email = 'email',
  Phone = 'phone',
  Handle = 'handle',
}

export enum PrivacyMode {
  FullLocal = 'full_local',
  ContentAware = 'content_aware',
  MinimalCloud = 'minimal_cloud',
}

// ----------------------------------------------------------------------------
// Core Data Types
// ----------------------------------------------------------------------------

export interface RawItem {
  id: string;
  sourceAdapter: SourceAdapterType;
  channel: SourceChannel;
  externalId: string;
  threadId: string | null;
  senderEntityId: string | null;
  recipientEntityIds: string[];
  subject: string | null;
  body: string;
  bodyFormat: BodyFormat;
  contentHash: string;
  language: DetectedLanguage | null;
  eventTime: number;
  ingestedAt: number;
  processingStatus: ProcessingStatus;
  attachments: Attachment[];
  metadata: Record<string, unknown>;
}

export interface Attachment {
  filename: string;
  type: string;
  size: number;
  path: string;
}

export interface Entity {
  id: string;
  type: EntityType;
  canonicalName: string;
  nameAlt: string | null;
  aliases: string[];
  attributes: Record<string, unknown>;
  confidence: number;
  status: EntityStatus;
  mergedInto: string | null;
  parentEntityId: string | null;
  firstSeenAt: number;
  lastSeenAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface Relationship {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  type: RelationshipType;
  strength: number;
  eventTime: number | null;
  ingestionTime: number;
  validFrom: number | null;
  validUntil: number | null;
  occurrenceCount: number;
  sourceItemIds: string[];
  metadata: Record<string, unknown>;
}

export interface Thread {
  id: string;
  sourceAdapter: SourceAdapterType;
  channel: SourceChannel;
  externalThreadId: string | null;
  subject: string | null;
  participantEntityIds: string[];
  firstMessageAt: number;
  lastMessageAt: number;
  messageCount: number;
  summary: string | null;
  status: string;
}

export interface EntityAlias {
  id: string;
  entityId: string;
  alias: string;
  aliasType: AliasType;
  confidence: number;
}

export interface EntityEpisode {
  entityId: string;
  rawItemId: string;
  extractionMethod: string;
  confidence: number;
}

export interface Community {
  id: string;
  name: string;
  description: string | null;
  memberEntityIds: string[];
  centroidEmbedding: Buffer | null;
  createdAt: number;
  updatedAt: number;
}

export interface AttentionItem {
  id: string;
  type: AttentionItemType;
  entityId: string | null;
  rawItemId: string | null;
  urgencyScore: number;
  title: string;
  description: string | null;
  detectedAt: number;
  resolvedAt: number | null;
  dismissedAt: number | null;
  snoozedUntil: number | null;
  resolutionType: ResolutionType | null;
}

export interface MergeAuditRecord {
  id: string;
  survivingEntityId: string;
  mergedEntityId: string;
  mergeMethod: MergeMethod;
  confidence: number | null;
  mergedAt: number;
  mergedBy: string;
  preMergeSnapshot: Record<string, unknown> | null;
  undoneAt: number | null;
}

export interface UserCorrection {
  id: string;
  correctionType: CorrectionType;
  targetEntityId: string | null;
  correctionData: Record<string, unknown>;
  createdAt: number;
}

export interface Job {
  id: string;
  rawItemId: string;
  stage: JobStage;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface SyncState {
  sourceAdapter: SourceAdapterType;
  lastCheckpoint: Record<string, unknown>;
  lastSyncAt: number;
  itemsProcessed: number;
  status: string;
  errorMessage: string | null;
  config: Record<string, unknown>;
}

// ----------------------------------------------------------------------------
// LLM Types
// ----------------------------------------------------------------------------

export interface ExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  summary: string | null;
  language: DetectedLanguage;
}

export interface ExtractedEntity {
  type: EntityType;
  name: string;
  nameAlt: string | null;
  attributes: Record<string, unknown>;
  confidence: number;
}

export interface ExtractedRelationship {
  fromEntityName: string;
  toEntityName: string;
  type: RelationshipType;
  strength: number;
  metadata: Record<string, unknown>;
}

export interface LLMProvider {
  /** Unique identifier for this provider (e.g., "claude", "openai", "ollama") */
  readonly name: string;

  /** Extract entities and relationships from text content */
  extract(content: string, context?: ExtractionContext): Promise<ExtractionResult>;

  /** Generate a natural-language answer from a query and retrieved context */
  answer(query: string, context: AnswerContext): Promise<AnswerResult>;

  /** Generate an embedding vector for the given text */
  embed(text: string): Promise<Float64Array>;

  /** Batch embed multiple texts (providers may optimize for batching) */
  embedBatch(texts: string[]): Promise<Float64Array[]>;

  /** Check if the provider is available and configured */
  isAvailable(): Promise<boolean>;
}

export interface ExtractionContext {
  sourceChannel: SourceChannel;
  senderName: string | null;
  existingEntities: Array<{ name: string; type: EntityType }>;
}

export interface AnswerContext {
  relevantItems: RawItem[];
  relevantEntities: Entity[];
  relevantRelationships: Relationship[];
}

export interface AnswerResult {
  answer: string;
  sourceItemIds: string[];
  confidence: number;
}

// ----------------------------------------------------------------------------
// Source Adapter Interface
// ----------------------------------------------------------------------------

export interface SourceAdapter {
  /** Unique identifier for this adapter (matches SourceAdapterType) */
  readonly name: SourceAdapterType;

  /** Initialize the adapter (open connections, verify access) */
  initialize(config: Record<string, unknown>): Promise<void>;

  /** Fetch new items since the given checkpoint */
  fetchSince(checkpoint: Record<string, unknown> | null): Promise<IngestionBatch>;

  /** Get a checkpoint representing the current position */
  getCurrentCheckpoint(): Promise<Record<string, unknown>>;

  /** Clean up resources */
  shutdown(): Promise<void>;
}

export interface IngestionBatch {
  items: IngestedItem[];
  checkpoint: Record<string, unknown>;
  hasMore: boolean;
}

export interface IngestedItem {
  externalId: string;
  threadId: string | null;
  sender: ContactInfo;
  recipients: ContactInfo[];
  subject: string | null;
  body: string;
  bodyFormat: BodyFormat;
  eventTime: number;
  attachments: Attachment[];
  metadata: Record<string, unknown>;
}

export interface ContactInfo {
  name: string | null;
  email: string | null;
  phone: string | null;
  handle: string | null;
}

// ----------------------------------------------------------------------------
// Query Types
// ----------------------------------------------------------------------------

export interface QueryRequest {
  query: string;
  filters?: QueryFilters;
  limit?: number;
}

export interface QueryFilters {
  entityTypes?: EntityType[];
  channels?: SourceChannel[];
  dateRange?: { start: number; end: number };
  people?: string[];
}

export interface QueryResult {
  answer: AnswerResult | null;
  entities: Entity[];
  items: RawItem[];
  graphFragment: GraphFragment;
}

export interface GraphFragment {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphNode {
  id: string;
  type: EntityType;
  label: string;
  attributes: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: RelationshipType;
  strength: number;
}

// ----------------------------------------------------------------------------
// Event Bus Types
// ----------------------------------------------------------------------------

export interface MindFlowEvents {
  'items:ingested': { count: number; sourceAdapter: SourceAdapterType };
  'item:processed': { itemId: string; stage: JobStage };
  'entity:created': { entity: Entity };
  'entity:updated': { entity: Entity };
  'entity:merged': { survivingId: string; mergedId: string };
  'relationship:created': { relationship: Relationship };
  'thread:created': { thread: Thread };
  'thread:updated': { thread: Thread };
  'attention:created': { item: AttentionItem };
  'attention:resolved': { itemId: string; resolutionType: ResolutionType };
  'community:updated': { community: Community };
  'sync:started': { sourceAdapter: SourceAdapterType };
  'sync:completed': { sourceAdapter: SourceAdapterType; itemCount: number };
  'sync:error': { sourceAdapter: SourceAdapterType; error: string };
  'pipeline:progress': { stage: JobStage; processed: number; total: number };
}

export type MindFlowEventName = keyof MindFlowEvents;

export interface EventHandler<T = unknown> {
  (data: T): void | Promise<void>;
}

// ----------------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------------

export interface MindFlowConfig {
  /** Path to the data directory (default: ~/.mindflow) */
  dataDir: string;

  /** Path to the SQLite database file */
  dbPath: string;

  /** Ingestion interval in milliseconds (default: 900000 = 15 min) */
  ingestionIntervalMs: number;

  /** Maximum number of items to process per ingestion cycle */
  ingestionBatchSize: number;

  /** Privacy mode for LLM routing */
  privacyMode: PrivacyMode;

  /** LLM provider configuration */
  llm: LLMConfig;

  /** Source adapter configurations */
  sources: SourceConfigs;

  /** Contacts or patterns to exclude from indexing */
  exclusions: ExclusionConfig;

  /** Initial scan depth for first run */
  initialScanDepth: 'month' | '6months' | 'year' | 'all';
}

export interface LLMConfig {
  /** Default provider for extraction */
  extractionProvider: string;

  /** Default provider for query answering */
  answerProvider: string;

  /** Monthly budget cap in USD (0 = unlimited) */
  monthlyBudgetCap: number;

  /** Provider-specific configurations */
  providers: Record<string, Record<string, unknown>>;
}

export interface SourceConfigs {
  gmail?: GmailSourceConfig;
  imessage?: IMessageSourceConfig;
  filesystem?: FilesystemSourceConfig;
}

export interface GmailSourceConfig {
  enabled: boolean;
  auth: {
    type: 'imap';
    host: string;
    port: number;
    user: string;
    password: string;
    tls: boolean;
  };
  folders: string[];
  excludeLabels: string[];
}

export interface IMessageSourceConfig {
  enabled: boolean;
  dbPath: string;
  excludeHandles: string[];
}

export interface FilesystemSourceConfig {
  enabled: boolean;
  watchPaths: string[];
  extensions: string[];
  ignorePatterns: string[];
}

export interface ExclusionConfig {
  contacts: string[];
  emailLabels: string[];
  patterns: string[];
}
