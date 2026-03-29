# MindFlow Design Proposal — Researcher 3

## Independent Analysis & Platform-Agnostic Architecture

Version 1.0 | March 28, 2026

---

## 1. PRD Analysis

### 1.1 Strengths

- **Clear problem framing**: The information fragmentation problem is well-articulated and genuinely painful for knowledge workers. The competitive landscape analysis correctly identifies that no existing tool covers automated ingestion + entity extraction + visual exploration + local-first privacy.
- **Progressive disclosure UI model**: The center-and-ring layered navigation is a strong UX concept. It avoids the "hairball graph" problem that plagues most knowledge graph UIs.
- **Bilingual-first design**: Building Chinese/English support as a core requirement rather than an afterthought is the right call for the target user base.
- **Person-centric navigation**: Anchoring on "Who told me?" matches how human memory actually works — episodic memory is heavily tied to social context.
- **Proactive attention surface**: The "Pending" detection rules (unanswered requests, approaching deadlines, stale conversations) transform the tool from passive search into an active assistant.

### 1.2 Gaps and Concerns

**Architecture Gaps:**

1. **Tight OpenClaw coupling**: The PRD describes MindFlow as "an OpenClaw plugin" with OpenClaw-specific constructs (cron skills, MCP Apps, `~/.openclaw/mindflow/`). This creates a hard dependency on a single platform. The core value — unified communication indexing — has nothing to do with OpenClaw specifically. The system should be designed as a standalone engine with an OpenClaw integration layer.

2. **No processing queue or backpressure**: The PRD says "new items queued for LLM processing" but doesn't define the queue. For a full historical scan of 10K emails + 50K iMessages, the system needs a robust job queue with retry logic, rate limiting (LLM API quotas), progress tracking, and graceful interruption/resumption.

3. **Embedding model deployment unclear**: The PRD mentions `Transformers.js` for local embeddings but doesn't address the cold-start cost (downloading a 500MB+ model), inference speed on CPU, or whether GPU acceleration is available/needed. On an M-series Mac, Core ML or Metal-backed inference would be significantly faster.

4. **No conflict resolution for entity merges**: When the system incorrectly merges two entities (or fails to merge duplicates), the PRD mentions "manual override UI" but doesn't specify how undo/split operations propagate through the graph. This is critical — a bad merge corrupts downstream relationships.

5. **Graph storage scalability**: SQLite is excellent for local-first, but storing a knowledge graph as relational tables (entities + relationships) means graph traversal queries become expensive multi-join operations. The PRD doesn't address query optimization for 2+ hop traversals.

**Privacy Gaps:**

6. **LLM API data exposure understated**: The PRD says "only message content is sent" — but message content IS the sensitive data. There's no discussion of content chunking strategies, PII redaction before API calls, or how to handle messages containing passwords, financial data, or health information.

7. **No data retention/deletion policy**: Users should be able to purge specific conversations, contacts, or time ranges from the index. GDPR-like "right to be forgotten" even for local data — what if a contact asks you to delete all records of your communication?

**UX Gaps:**

8. **No onboarding for large backlogs**: First-run processes 10K+ emails. What does the user see during those 4 hours? There's no specification for incremental graph availability — can the user start exploring while indexing continues?

9. **Graph navigation scalability**: "Maximum 20 nodes visible at once" is a reasonable default, but the PRD doesn't address how to handle power users with 500+ contacts or 100+ active topics. The sorting/filtering/search within a layer needs specification.

10. **No keyboard-driven navigation**: For power users comfortable with CLI (the target persona), the graph should support keyboard shortcuts for traversal, not just mouse clicks.

### 1.3 Open Questions (My Positions)

| PRD Question | My Position | Rationale |
|---|---|---|
| Graph layout: radial vs. card? | **Radial for exploration, card-list for detail** | Radial layout maps naturally to the center-ring mental model. But once you drill into L3 (cross-ref timeline), a card/list view is more practical for scanning messages. Hybrid approach. |
| LLM provider default? | **Configurable, default Claude Sonnet** | Better Chinese performance is critical for the bilingual use case. Cost is secondary to accuracy for entity extraction. Offer Ollama as zero-cost local fallback. |
| Notification channel? | **Push to configured channel + in-graph** | Silent attention surface is easily ignored. A daily digest push (morning, configurable) to Telegram/email ensures actionability. |
| Team/shared mode? | **Defer to V2** | Privacy implications are enormous. Focus on single-user excellence first. |
| Offline LLM in MVP? | **Yes, as degraded-mode fallback** | Ollama with a 7B model can handle basic entity extraction. Users without API keys should still get value. Makes the "local-first" promise real. |
| iMessage attachments? | **Index metadata only in MVP, OCR in V1.1** | Text extraction from images/PDFs is computationally expensive and error-prone. Index the fact that an attachment exists, its filename/type, and the surrounding message context. |

---

## 2. Proposed System Architecture

### 2.1 Design Philosophy

**Core principle: MindFlow is a standalone knowledge engine with a platform integration layer.**

The system is structured as three concentric layers:

```
+---------------------------------------------------+
|            Platform Integrations                    |
|  (OpenClaw plugin, CLI, REST API, Telegram bot)    |
+---------------------------------------------------+
|            MindFlow Core Engine                     |
|  (Ingestion, Processing, Graph, Query, Attention)  |
+---------------------------------------------------+
|            Storage & Runtime Layer                  |
|  (SQLite/libSQL, Embeddings, Local LLM, FS)       |
+---------------------------------------------------+
```

This means:
- The Core Engine has ZERO knowledge of OpenClaw, Telegram, or any specific platform
- Platform integrations are thin adapters that translate platform-specific calls into Core Engine API calls
- The Core Engine exposes a clean TypeScript/JavaScript API and an optional local HTTP API
- Any new platform (VS Code extension, Raycast plugin, Electron app, web app) can integrate by writing an adapter

### 2.2 Component Architecture

```
                    +-----------------------+
                    |   Platform Adapters   |
                    |  +-------+ +-------+  |
                    |  |OpenClaw| |  CLI  |  |
                    |  +-------+ +-------+  |
                    |  +-------+ +-------+  |
                    |  |Telegram| | HTTP  |  |
                    |  +-------+ +-------+  |
                    +-----------+-----------+
                                |
                    +-----------v-----------+
                    |     API Gateway        |
                    |  (TypeScript API)      |
                    +-----------+-----------+
                                |
          +----------+----------+----------+---------+
          |          |          |          |          |
    +-----v----+ +--v---+ +---v---+ +----v---+ +---v----+
    | Ingestion| |Process| | Graph | | Query  | |Attention|
    | Manager  | |Pipeline| | Store | | Engine | | Engine |
    +-----+----+ +--+---+ +---+---+ +----+---+ +---+----+
          |          |          |          |          |
    +-----v----------v----------v----------v----------v---+
    |              Storage Layer (libSQL/SQLite)           |
    |   +----------+ +-----------+ +------------------+   |
    |   | raw_items | | kg_tables | | embedding_index  |   |
    |   +----------+ +-----------+ +------------------+   |
    +-----------------------------------------------------+
```

### 2.3 Component Descriptions

#### 2.3.1 Ingestion Manager

**Responsibility**: Orchestrate data source adapters, manage sync state, handle scheduling.

**Key Design Decisions:**

- **Adapter pattern**: Each data source (Gmail, iMessage, local files) is a self-contained adapter implementing a common `SourceAdapter` interface:

```typescript
interface SourceAdapter {
  id: string;
  name: string;

  // Check if this source is available on the current platform
  isAvailable(): Promise<boolean>;

  // Configure the adapter (credentials, filters, etc.)
  configure(config: AdapterConfig): Promise<void>;

  // Fetch new items since last checkpoint
  fetchSince(checkpoint: Checkpoint): AsyncIterable<RawItem>;

  // Get adapter health/status
  status(): Promise<AdapterStatus>;
}
```

- **Platform-agnostic scheduling**: The Ingestion Manager does NOT use OpenClaw cron. It runs its own lightweight scheduler (e.g., `node-cron` or a simple `setInterval` with drift correction). OpenClaw's cron can trigger it, but the manager owns its own scheduling logic.

- **Job queue with backpressure**: Uses a persistent SQLite-backed job queue. Each raw item enters the queue with status `pending`. The processing pipeline pulls from the queue with configurable concurrency (default: 5 concurrent LLM calls). Failed items are retried with exponential backoff (max 3 retries). This handles API rate limits, network failures, and system interruptions gracefully.

- **Incremental availability**: As items are ingested and processed, they become immediately queryable. The user doesn't have to wait for the full historical scan to complete.

#### 2.3.2 Processing Pipeline

**Responsibility**: Transform raw items into structured knowledge (entities, relationships, embeddings).

**Pipeline stages:**

```
RawItem → Preprocess → Extract → Resolve → Embed → Link → Store
```

1. **Preprocess**: Normalize text (encoding, whitespace), detect language (Chinese/English/mixed), extract metadata (headers, timestamps, thread IDs).

2. **Extract (LLM)**: Send preprocessed content to LLM for entity extraction. Uses structured output (JSON schema) to ensure consistent extraction:

```typescript
interface ExtractionResult {
  people: Array<{
    name: string;
    aliases: string[];       // e.g., ["王总", "Wang Zong"]
    role?: string;
    org?: string;
  }>;
  topics: Array<{
    title: string;
    title_alt?: string;      // Cross-lingual alternative
    status: "active" | "mentioned";
  }>;
  action_items: Array<{
    description: string;
    owner?: string;
    due_date?: string;
    direction: "inbound" | "outbound"; // requested of me, or I requested
  }>;
  key_facts: Array<{
    statement: string;
    confidence: number;      // 0-1
  }>;
  sentiment?: "positive" | "neutral" | "negative";
  summary: string;           // 1-2 sentence summary
}
```

3. **Resolve (Entity Resolution)**: Match extracted entities against existing graph entities. This is the critical step — detailed in section 3.

4. **Embed**: Generate multilingual embeddings for semantic search. Uses ONNX Runtime (not Transformers.js) for better performance on Apple Silicon via Core ML backend.

5. **Link**: Create/update relationship edges in the graph. Compute relationship strength scores based on frequency, recency, and co-occurrence.

6. **Store**: Persist all results atomically in a single SQLite transaction.

**LLM Strategy (Tiered):**

| Tier | Model | Use Case | Cost |
|------|-------|----------|------|
| Local (Ollama) | Qwen2.5-7B or Llama 3.1-8B | Basic entity extraction, language detection | Free |
| Cloud Fast | Claude Haiku 4.5 / GPT-4o-mini | Bulk extraction during historical scan | Low |
| Cloud Quality | Claude Sonnet 4.6 | Complex entity resolution, relationship inference | Medium |

The system defaults to Cloud Fast for batch processing and Cloud Quality for ambiguous cases. Local Ollama serves as a fallback when API keys are not configured or for privacy-sensitive content the user flags as "never send to cloud."

#### 2.3.3 Graph Store

**Responsibility**: Persist and query the knowledge graph efficiently.

**Key Design Decision: libSQL over plain SQLite**

libSQL (the fork behind Turso) extends SQLite with native vector search (`vector_distance_cos()`), which eliminates the need for a separate FAISS index. It's wire-compatible with SQLite and can be used as a drop-in replacement.

**Schema Design:**

The schema uses a property graph model in relational tables, optimized for the specific query patterns MindFlow needs:

```sql
-- Core entity table with type discrimination
CREATE TABLE entities (
  id TEXT PRIMARY KEY,         -- ULID for time-sortable IDs
  type TEXT NOT NULL,          -- person | topic | action_item | key_fact | document
  name TEXT NOT NULL,          -- Primary display name
  name_alt TEXT,               -- Alternative name (cross-lingual)
  attributes TEXT,             -- JSON blob for type-specific attributes
  embedding F32_BLOB(384),     -- libSQL native vector (384-dim for MiniLM)
  created_at INTEGER NOT NULL, -- Unix timestamp
  updated_at INTEGER NOT NULL,
  status TEXT DEFAULT 'active' -- active | dormant | archived | merged
);

-- Relationship edges with temporal metadata
CREATE TABLE edges (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES entities(id),
  target_id TEXT NOT NULL REFERENCES entities(id),
  type TEXT NOT NULL,          -- discusses | owns | assigned_to | related_to | etc.
  strength REAL DEFAULT 1.0,  -- Computed relationship strength
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  occurrence_count INTEGER DEFAULT 1,
  source_items TEXT            -- JSON array of raw_item IDs that evidence this edge
);

-- Raw ingested items
CREATE TABLE raw_items (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,        -- gmail | imessage | document | meeting
  channel TEXT,                -- email address, phone number, file path
  sender TEXT,
  recipients TEXT,             -- JSON array
  subject TEXT,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,  -- For deduplication
  embedding F32_BLOB(384),
  timestamp INTEGER NOT NULL,
  processed_at INTEGER,
  metadata TEXT                -- JSON: thread_id, labels, attachments, etc.
);

-- Entity aliases for resolution
CREATE TABLE entity_aliases (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  alias TEXT NOT NULL,         -- "王总", "wang.zong@partner.com", "+1234567890"
  alias_type TEXT NOT NULL,    -- name | email | phone | handle
  confidence REAL DEFAULT 1.0
);

-- Attention/pending items
CREATE TABLE attention_items (
  id TEXT PRIMARY KEY,
  entity_id TEXT REFERENCES entities(id),
  raw_item_id TEXT REFERENCES raw_items(id),
  type TEXT NOT NULL,          -- unanswered | overdue | stale | urgent
  urgency_score REAL NOT NULL,
  description TEXT,
  detected_at INTEGER NOT NULL,
  resolved_at INTEGER,
  dismissed_at INTEGER         -- User explicitly dismissed
);

-- Processing job queue
CREATE TABLE job_queue (
  id TEXT PRIMARY KEY,
  raw_item_id TEXT REFERENCES raw_items(id),
  stage TEXT NOT NULL,         -- extract | resolve | embed | link
  status TEXT DEFAULT 'pending', -- pending | processing | completed | failed
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER
);

-- Sync state per source
CREATE TABLE sync_state (
  source TEXT PRIMARY KEY,
  last_checkpoint TEXT,        -- Source-specific checkpoint (timestamp, message ID, etc.)
  last_sync_at INTEGER,
  items_synced INTEGER DEFAULT 0,
  config TEXT                  -- JSON: adapter-specific configuration
);

-- Indexes for common query patterns
CREATE INDEX idx_entities_type ON entities(type, updated_at DESC);
CREATE INDEX idx_entities_name ON entities(name COLLATE NOCASE);
CREATE INDEX idx_edges_source ON edges(source_id, type);
CREATE INDEX idx_edges_target ON edges(target_id, type);
CREATE INDEX idx_edges_temporal ON edges(last_seen DESC);
CREATE INDEX idx_raw_items_timestamp ON raw_items(timestamp DESC);
CREATE INDEX idx_raw_items_hash ON raw_items(content_hash);
CREATE INDEX idx_raw_items_source ON raw_items(source, timestamp DESC);
CREATE INDEX idx_aliases_alias ON entity_aliases(alias COLLATE NOCASE);
CREATE INDEX idx_attention_active ON attention_items(resolved_at, urgency_score DESC)
  WHERE resolved_at IS NULL AND dismissed_at IS NULL;
CREATE INDEX idx_jobs_pending ON job_queue(status, created_at)
  WHERE status IN ('pending', 'failed');

-- FTS5 for full-text search
CREATE VIRTUAL TABLE raw_items_fts USING fts5(
  subject, content, sender,
  content=raw_items, content_rowid=rowid,
  tokenize='unicode61'
);

CREATE VIRTUAL TABLE entities_fts USING fts5(
  name, name_alt, attributes,
  content=entities, content_rowid=rowid,
  tokenize='unicode61'
);
```

**Graph Traversal Optimization:**

For multi-hop traversals (e.g., "find all people connected to Topic X through any path"), use recursive CTEs:

```sql
WITH RECURSIVE connected AS (
  SELECT target_id AS entity_id, 1 AS depth
  FROM edges WHERE source_id = :start_id
  UNION
  SELECT e.target_id, c.depth + 1
  FROM edges e JOIN connected c ON e.source_id = c.entity_id
  WHERE c.depth < :max_depth
)
SELECT DISTINCT entity_id FROM connected;
```

For the typical MindFlow use case (1-2 hop traversals with <100K entities), SQLite with proper indexes handles this in <50ms. If the graph grows beyond 1M entities, a migration path to DuckDB or an embedded graph engine (e.g., Kuzu) is available.

#### 2.3.4 Query Engine

**Responsibility**: Translate natural language queries into graph traversals + semantic search, then synthesize answers.

**Query Pipeline:**

```
User Query → Intent Classification → Query Plan → Execute → Synthesize → Response
```

1. **Intent Classification** (LLM or local classifier):
   - `factual_recall`: "What was the Vendor B quote?" → search key_facts
   - `person_context`: "What have I discussed with Lisa?" → person timeline
   - `cross_reference`: "Who mentioned the Q3 deadline?" → cross-entity search
   - `pending_items`: "What am I forgetting?" → attention surface
   - `relationship`: "How do I know Zhang San?" → relationship trace

2. **Query Plan**: Based on intent, generate a hybrid query combining:
   - FTS5 keyword search (fast, high precision for exact matches)
   - Vector similarity search (semantic, handles paraphrasing and cross-lingual)
   - Graph traversal (relationship-based, e.g., "all topics discussed with Person X")

3. **Execute**: Run the plan against the graph store. Return ranked results with source attribution.

4. **Synthesize** (LLM): Generate a natural language answer from the results, with inline source citations.

**Hybrid Search Scoring:**

```
final_score = α * fts_score + β * vector_similarity + γ * recency_decay + δ * relationship_strength
```

Where α, β, γ, δ are tunable weights (defaults: 0.3, 0.35, 0.2, 0.15). Recency decay uses exponential decay with a half-life of 30 days.

#### 2.3.5 Attention Engine

**Responsibility**: Proactively identify items requiring user attention.

**Detection pipeline** (runs after each ingestion cycle):

1. **Unanswered requests**: Scan recent inbound messages for question marks, request patterns ("can you", "please", "could you", "能不能", "请"). Check if a reply exists within the configured window. Use LLM to confirm (reduce false positives from rhetorical questions).

2. **Overdue action items**: Query action_items with `due_date < now AND status != 'done'`.

3. **Stale conversations**: Topics with `last_seen > 7 days ago AND status = 'active'` and high relationship strength.

4. **Urgency signals**: Same entity mentioned 3+ times across different channels within 48 hours.

**Scoring**: Each attention item gets a urgency score (0-10) based on:
- Time elapsed since detection
- Importance of the related person (based on communication frequency)
- Explicitness of the request/deadline
- Number of channels involved

#### 2.3.6 API Gateway (Core API)

**Responsibility**: Expose the Core Engine as a clean, platform-agnostic API.

**API Design**: The Core Engine exposes a TypeScript API (for in-process integrations) and an optional HTTP API (for out-of-process integrations like CLI, web UI, or remote clients).

```typescript
interface MindFlowEngine {
  // Lifecycle
  initialize(config: MindFlowConfig): Promise<void>;
  shutdown(): Promise<void>;

  // Ingestion
  registerSource(adapter: SourceAdapter): void;
  triggerSync(sourceId?: string): Promise<SyncResult>;
  getSyncStatus(): Promise<SyncStatus[]>;

  // Query
  query(question: string, options?: QueryOptions): Promise<QueryResult>;
  search(params: SearchParams): Promise<SearchResult[]>;

  // Graph navigation (powers the UI)
  getNode(entityId: string): Promise<GraphNode>;
  getNeighbors(entityId: string, options?: NeighborOptions): Promise<GraphNode[]>;
  getTimeline(entityId: string, options?: TimelineOptions): Promise<TimelineEntry[]>;
  getCrossRef(entityA: string, entityB: string): Promise<CrossRefResult>;

  // Attention
  getAttentionItems(options?: AttentionOptions): Promise<AttentionItem[]>;
  dismissAttention(itemId: string): Promise<void>;
  resolveAttention(itemId: string): Promise<void>;

  // Entity management
  mergeEntities(sourceId: string, targetId: string): Promise<void>;
  splitEntity(entityId: string, splitConfig: SplitConfig): Promise<[string, string]>;
  updateEntity(entityId: string, updates: Partial<Entity>): Promise<void>;

  // Configuration
  getConfig(): MindFlowConfig;
  updateConfig(updates: Partial<MindFlowConfig>): Promise<void>;

  // Events (for real-time UI updates)
  on(event: MindFlowEvent, handler: EventHandler): void;
  off(event: MindFlowEvent, handler: EventHandler): void;
}
```

**Event system**: The engine emits events for:
- `items:ingested` — new items added to the queue
- `items:processed` — entities extracted from items
- `entity:created` / `entity:updated` / `entity:merged`
- `attention:new` — new attention item detected
- `sync:started` / `sync:completed` / `sync:error`

Platform adapters subscribe to these events to update their UIs or send notifications.

#### 2.3.7 Platform Adapters

Each adapter is a thin translation layer:

**OpenClaw Adapter:**
- Registers as an OpenClaw plugin
- Maps OpenClaw cron to `triggerSync()`
- Maps OpenClaw tool calls to `query()` / `search()`
- Serves the visual graph via MCP Apps
- Stores data in `~/.openclaw/mindflow/` (OpenClaw convention)

**CLI Adapter:**
- Standalone `mindflow` binary (or `npx mindflow`)
- Commands: `mindflow sync`, `mindflow query "..."`, `mindflow status`, `mindflow serve` (starts HTTP API + web UI)
- Stores data in `~/.mindflow/`

**HTTP API Adapter:**
- Express/Fastify server exposing REST endpoints
- WebSocket for real-time events (graph updates, new attention items)
- Serves the web-based graph UI as static files
- CORS-restricted to localhost by default

**Telegram Adapter:**
- Bot that forwards queries to `query()`
- Sends daily attention digest
- Supports inline commands

### 2.4 Directory Structure

```
mindflow/
  core/                     # Platform-agnostic engine
    engine.ts               # MindFlowEngine implementation
    ingestion/
      manager.ts            # Ingestion orchestration
      adapters/
        gmail.ts
        imessage.ts
        filesystem.ts
        meeting-notes.ts
      adapter-interface.ts  # SourceAdapter interface
    processing/
      pipeline.ts           # Processing pipeline orchestration
      extractor.ts          # LLM entity extraction
      resolver.ts           # Entity resolution
      embedder.ts           # Embedding generation
      linker.ts             # Relationship linking
    graph/
      store.ts              # Graph store (libSQL)
      schema.sql            # Database schema
      migrations/           # Schema migrations
      traversal.ts          # Graph traversal utilities
    query/
      engine.ts             # Query engine
      intent.ts             # Intent classification
      planner.ts            # Query plan generation
      hybrid-search.ts      # FTS + vector + graph hybrid
      synthesizer.ts        # LLM answer synthesis
    attention/
      engine.ts             # Attention detection
      rules/                # Individual detection rules
        unanswered.ts
        overdue.ts
        stale.ts
        urgency.ts
      scorer.ts             # Urgency scoring
    llm/
      provider.ts           # LLM provider abstraction
      providers/
        claude.ts
        openai.ts
        ollama.ts
      structured-output.ts  # JSON schema extraction
    config.ts               # Configuration management
    events.ts               # Event system

  integrations/             # Platform-specific adapters
    openclaw/
      plugin.ts             # OpenClaw plugin entry
      cron-skill.ts
      tool-skill.ts
      mcp-app.ts
    cli/
      index.ts              # CLI entry point
      commands/
    http/
      server.ts             # HTTP API server
      routes/
      websocket.ts
    telegram/
      bot.ts

  ui/                       # Web-based graph UI
    src/
      components/
        GraphCanvas.tsx      # Main graph visualization
        DetailPanel.tsx      # Entity detail/timeline
        SearchBar.tsx        # NL query input
        AttentionBadge.tsx
      graph/
        layout.ts            # Radial/concentric layout engine
        animation.ts         # Transition animations
        interaction.ts       # Click, keyboard, touch handlers
      api/
        client.ts            # HTTP/WebSocket client
      stores/
        navigation.ts        # Breadcrumb/history state
      App.tsx
    index.html

  package.json
  tsconfig.json
```

---

## 3. Key Design Decisions and Rationale

### 3.1 Entity Resolution Strategy

This is the hardest problem in MindFlow and deserves special attention.

**Multi-signal approach:**

```
Score = w1*email_match + w2*phone_match + w3*name_similarity + w4*context_cooccurrence
```

| Signal | Weight | Method |
|--------|--------|--------|
| Email match | 0.95 (near-certain) | Exact string match after normalization |
| Phone match | 0.90 | Normalize to E.164 format, exact match |
| Name similarity (same language) | 0.3-0.7 | Jaro-Winkler distance, threshold 0.85 |
| Name similarity (cross-lingual) | 0.2-0.5 | Pinyin conversion + Jaro-Winkler; embedding cosine similarity |
| Context co-occurrence | 0.1-0.4 | Same thread/conversation, same org, mutual contacts |

**Merge thresholds:**
- Score >= 0.90: Auto-merge (high confidence)
- Score 0.70-0.89: Suggest merge, require user confirmation
- Score < 0.70: Keep separate

**Chinese-English name resolution:**

This is a specific challenge. "王总" (Wang Zong / Boss Wang) and "wang.zong@partner.com" need to be linked. The approach:

1. Extract pinyin from Chinese characters using `pinyin` npm package
2. Compare pinyin against Latin name components (Jaro-Winkler, threshold 0.80)
3. Use the email local-part as a strong signal (`wang.zong` maps well to `王总` via pinyin)
4. Use the LLM as a tiebreaker for ambiguous cases — provide both names + context and ask "are these the same person?"

**Undo/Split mechanism:**

When entities are merged, the system records the merge operation in a `merge_history` table:

```sql
CREATE TABLE merge_history (
  id TEXT PRIMARY KEY,
  surviving_id TEXT NOT NULL,
  merged_id TEXT NOT NULL,
  merged_at INTEGER NOT NULL,
  merged_by TEXT,              -- 'auto' or 'user'
  pre_merge_snapshot TEXT      -- JSON snapshot of the merged entity's state
);
```

Splitting reverses the merge by restoring the snapshot and re-assigning edges based on source_item timestamps.

### 3.2 Embedding Model Selection

**Recommended: `BAAI/bge-m3`** (via ONNX Runtime)

| Model | Dimensions | Languages | Size | Speed (M1) | Quality |
|-------|-----------|-----------|------|-------------|---------|
| paraphrase-multilingual-MiniLM-L12-v2 | 384 | 50+ | 470MB | ~15ms/item | Good |
| BAAI/bge-m3 | 1024 | 100+ | 2.2GB | ~40ms/item | Excellent |
| nomic-embed-text-v1.5 | 768 | English-focused | 550MB | ~20ms/item | Good (EN) |

**Decision**: Use `bge-m3` as the primary model for its superior cross-lingual performance, especially Chinese-English. Fall back to `MiniLM-L12-v2` on machines with <8GB RAM. The larger embedding dimension (1024 vs 384) costs ~3x storage but significantly improves cross-lingual retrieval accuracy.

**ONNX Runtime over Transformers.js**: ONNX Runtime supports Core ML on macOS, which provides 2-5x speedup on Apple Silicon compared to CPU-only Transformers.js inference. This matters when embedding 60K+ items during initial indexing.

### 3.3 Graph Visualization Technology

**Recommended: Cytoscape.js with custom concentric layout**

Rationale:
- Built-in concentric/radial layout matches the center-ring model
- Supports compound nodes (useful for grouping related topics)
- Tap events and viewport manipulation are first-class features
- Extension ecosystem (CiSE layout, edge editing, context menus)
- Handles up to 10K elements smoothly, well within MindFlow's "20 nodes per layer" requirement
- Better out-of-the-box interactivity than D3.js (which requires building everything from scratch)

D3.js would be used only for the timeline visualization in the detail panel (D3's time scales and axis handling are superior).

**Layout algorithm:**

```typescript
const concentricLayout = {
  name: 'concentric',
  concentric: (node) => node.data('rank'),     // Rank by relationship strength
  levelWidth: () => 1,                          // One ring per level
  minNodeSpacing: 60,
  startAngle: -Math.PI / 2,                     // Start from top
  sweep: 2 * Math.PI,                           // Full circle
  animate: true,
  animationDuration: 300,
  animationEasing: 'ease-out-cubic',
};
```

**Animation for drill-down transitions:**
1. User clicks a ring node
2. Fade out current ring nodes (200ms)
3. Move clicked node to center (300ms, ease-out)
4. Fetch neighbors via `getNeighbors()`
5. Fade in new ring nodes from center outward (300ms staggered)
6. Update breadcrumb trail

### 3.4 LLM Provider Abstraction

The system should NOT hard-code any LLM provider. Instead, use a provider interface:

```typescript
interface LLMProvider {
  id: string;
  name: string;

  // Structured extraction (primary use case)
  extract<T>(
    prompt: string,
    schema: JSONSchema,
    options?: { temperature?: number; maxTokens?: number }
  ): Promise<T>;

  // Free-form generation (query synthesis)
  generate(
    prompt: string,
    options?: { temperature?: number; maxTokens?: number }
  ): Promise<string>;

  // Check availability and cost
  isAvailable(): Promise<boolean>;
  estimateCost(tokenCount: number): number;
}
```

This allows:
- Swapping providers without code changes
- Using different providers for different tasks (e.g., Ollama for extraction, Claude for synthesis)
- A/B testing provider quality
- Graceful degradation when a provider is unavailable

### 3.5 Privacy Architecture

**Tiered privacy model:**

| Level | Description | LLM Usage | Trade-off |
|-------|-------------|-----------|-----------|
| **Full Local** | All processing via Ollama | Local only | Lower extraction quality, no API costs |
| **Minimal Cloud** | Entity extraction via API, raw content stays local | Sends message content, strips metadata | Good quality, moderate privacy |
| **Content-aware** | User marks sensitive contacts/topics as local-only | Hybrid per-item routing | Best balance |

**Default: Content-aware** — the system sends content to cloud LLMs by default but respects a user-configured "sensitive" list. Any message from a sensitive contact or matching a sensitive topic pattern is processed locally only.

**PII redaction layer** (optional, on by default):
Before sending content to cloud LLMs, a fast local regex + NER pass strips:
- Phone numbers (replace with `[PHONE]`)
- Credit card numbers
- SSNs / government IDs
- Email addresses of third parties not involved in the conversation

This reduces risk without eliminating cloud LLM utility.

---

## 4. Platform-Agnostic Design

### 4.1 Abstraction Principles

1. **No platform imports in core/**: The `core/` directory has zero imports from `openclaw`, `telegram`, or any platform SDK. It depends only on Node.js builtins, SQLite, and the LLM/embedding libraries.

2. **Configuration over convention**: Instead of hardcoding `~/.openclaw/mindflow/`, the data directory is configurable:
   ```typescript
   const config = {
     dataDir: process.env.MINDFLOW_DATA_DIR || path.join(os.homedir(), '.mindflow'),
     // ...
   };
   ```
   The OpenClaw adapter overrides this to `~/.openclaw/mindflow/`.

3. **Event-driven integration**: Platform adapters don't poll the engine — they subscribe to events. This makes the integration point clean and testable.

4. **HTTP API as the universal adapter**: Any platform that can make HTTP calls can integrate with MindFlow. The HTTP API is the "lowest common denominator" integration point.

### 4.2 Cross-Platform Considerations

| Concern | Solution |
|---------|----------|
| iMessage only on macOS | iMessage adapter's `isAvailable()` returns false on non-macOS. System works fine without it. |
| OpenClaw dependency | OpenClaw adapter is one of many. CLI + HTTP work independently. |
| Node.js requirement | Core engine targets Node.js 20+. Could be compiled to a single binary via `pkg` or `bun build --compile` for zero-dependency distribution. |
| Web UI | Served as static files by the HTTP adapter. Works in any modern browser. |
| Mobile | No native mobile app in scope, but the HTTP API + web UI works on mobile browsers. A future React Native wrapper could use the HTTP API. |

### 4.3 Packaging Strategy

```
@mindflow/core          # Core engine (npm package)
@mindflow/cli           # CLI adapter (npm package with bin)
@mindflow/server        # HTTP API + Web UI (npm package)
@mindflow/openclaw      # OpenClaw plugin adapter
@mindflow/telegram      # Telegram bot adapter
@mindflow/adapter-gmail # Gmail source adapter
@mindflow/adapter-imessage # iMessage source adapter
```

Each package is independently publishable. The core has zero platform dependencies. Adapters depend on core + their platform SDK.

---

## 5. Technology Recommendations Summary

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Language | TypeScript | Target runtime is Node.js; type safety for complex graph/entity code |
| Database | libSQL (SQLite fork) | Local-first, native vector search, zero-ops, battle-tested |
| Embedding | BAAI/bge-m3 via ONNX Runtime | Best cross-lingual quality; Core ML acceleration on macOS |
| Graph viz | Cytoscape.js | Built-in concentric layout, interactive navigation, extension ecosystem |
| Timeline viz | D3.js (time axis only) | Best-in-class temporal visualization |
| UI framework | React (Vite) | Fast dev, good ecosystem, works well with Cytoscape.js React wrapper |
| LLM (cloud) | Claude Sonnet 4.6 (default) | Superior Chinese; structured output |
| LLM (local) | Qwen2.5-7B via Ollama | Best open-source Chinese/English balance at 7B |
| Job queue | SQLite-backed custom | No external dependencies; crash-resistant |
| HTTP API | Fastify | Fast, schema validation, WebSocket support |
| CLI | Commander.js | Standard, well-maintained |
| Testing | Vitest | Fast, TypeScript-native |
| Packaging | Monorepo (pnpm workspaces) | Clean separation of core/adapters/UI |

---

## 6. Implementation Priorities

### Phase 0 (Foundation, Week 0-1)
- Set up monorepo structure
- Implement libSQL schema + migrations
- Implement LLM provider abstraction (Claude + Ollama)
- Implement embedding pipeline (ONNX Runtime + bge-m3)
- Basic entity storage CRUD

### Phase 1 (MVP, Weeks 1-6)
- Per PRD, but with platform-agnostic core
- CLI adapter as the primary dev interface (faster iteration than building OpenClaw plugin)
- Web UI with Cytoscape.js graph
- HTTP API for UI communication

### Phase 2 (Integrations, Weeks 7-10)
- OpenClaw plugin adapter
- Telegram bot adapter
- Document ingestion
- Improved entity resolution with user feedback

### Phase 3 (Polish, Weeks 11-16)
- Keyboard navigation in graph UI
- Daily digest notifications
- Performance optimization for large graphs
- Multi-device sync (encrypted, peer-to-peer via libSQL replication)

---

## 7. Risks Specific to This Architecture

| Risk | Severity | Mitigation |
|------|----------|------------|
| libSQL adoption risk (less battle-tested than SQLite) | Medium | libSQL is a superset of SQLite; can fall back to plain SQLite + separate FAISS for vectors |
| ONNX Runtime Core ML issues on some Macs | Low | Fall back to CPU inference; still viable, just slower |
| Monorepo complexity | Low | pnpm workspaces are well-understood; clear boundaries between packages |
| Entity resolution accuracy | High | Conservative auto-merge thresholds; user feedback loop; merge undo capability |
| LLM cost during initial scan | Medium | Tiered model strategy; batch API calls; aggressive caching of extraction prompts |

---

## 8. Differentiating Positions (For Team Discussion)

These are positions I hold that the other researchers may disagree on. I flag them explicitly for productive discussion:

1. **libSQL over plain SQLite**: I believe native vector search in the database is worth the adoption risk. Having embeddings, FTS, and relational data in one transaction boundary eliminates an entire class of consistency bugs.

2. **ONNX Runtime over Transformers.js**: The performance difference on Apple Silicon is significant enough to justify the additional complexity. MindFlow's target users are on macOS with M-series chips — we should leverage the hardware.

3. **CLI-first development**: Building the CLI adapter before the OpenClaw plugin means faster iteration and forces clean separation of concerns. The OpenClaw plugin becomes "just another adapter."

4. **Qwen2.5 for local LLM**: For the Chinese/English bilingual use case, Qwen2.5-7B outperforms Llama 3.1-8B and Mistral-7B on Chinese tasks while being competitive on English. This is the right local model for MindFlow's target users.

5. **Content-aware privacy as default**: Rather than forcing users to choose between "all local" or "all cloud," the system should intelligently route based on content sensitivity. This is more work but delivers the right privacy/quality trade-off.

6. **Event-driven architecture**: The Core Engine should emit events, not be polled. This makes real-time UI updates, notifications, and multi-adapter support natural rather than bolted on.
