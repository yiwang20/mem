# MindFlow System Design Proposal — Researcher 2

## 1. PRD Analysis

### Strengths

- **Clear problem definition**: The information fragmentation problem is real and well-articulated. The competitive landscape analysis correctly identifies the gap — no existing tool combines automated ingestion from personal communications with AI-powered entity extraction and local-first privacy.
- **Person-centric design philosophy**: Anchoring navigation around people rather than channels is a strong UX insight that matches how humans actually recall information ("Who told me?" not "Which app was it in?").
- **Progressive disclosure UI model**: The layered center-and-ring pattern avoids the classic knowledge graph problem of visual overload. The 4-layer drilldown (Root -> Category -> Entity -> Cross-ref) is well-thought-out.
- **Bilingual Chinese/English focus**: This is a genuine differentiator and a hard technical problem that, if solved well, creates a real moat.
- **Privacy-first local architecture**: The local-first constraint is well-aligned with the target persona and creates trust.

### Gaps and Concerns

1. **Tight coupling to OpenClaw**: The PRD frames MindFlow entirely as an OpenClaw plugin. This creates unnecessary platform risk. If OpenClaw's API changes, user base shrinks, or a user wants MindFlow without OpenClaw, the system becomes unusable. The core knowledge engine should be platform-independent with OpenClaw as one integration target among many.

2. **Underspecified conflict resolution in entity merging**: The PRD mentions "conservative auto-merge thresholds" and "manual override" but doesn't address how to handle merge errors after they propagate. If Wang Zong and a different Wang are incorrectly merged, and downstream entities reference the merged node, unwinding that is hard. Need a proper undo/split mechanism.

3. **LLM dependency for core extraction is a cost and latency risk**: Processing 60,000+ historical items through an LLM API at ~$0.003/item means ~$180 for initial indexing alone. The PRD mentions "local model fallback" but doesn't specify what can run locally vs. what requires the API. Need a tiered extraction strategy.

4. **No offline-first story**: The PRD says "local-first" but entity extraction requires LLM API calls. If the user is offline or their API key expires, new messages queue up but the knowledge graph stops growing. Need a degraded-mode design.

5. **Missing data model for conversations/threads**: The PRD has `raw_items` (individual messages) and `entities` but no concept of a conversation thread. Email threads and iMessage conversation sequences are important grouping structures that should be first-class.

6. **Graph scaling strategy is vague**: "Automatic archiving of dormant entities" is mentioned but the criteria and mechanism aren't defined. After a year of use, a knowledge worker could have 500+ person nodes, 2000+ topic nodes, and 100K+ relationship edges. The graph needs tiered storage and lazy loading.

7. **No versioning or temporal queries**: The PRD mentions timestamps on edges but doesn't support temporal queries like "What did I know about X as of last month?" or "How has my relationship with Wang Zong evolved?" This is a natural extension of the knowledge graph.

8. **Visualization technology not specified**: The PRD describes the UI behavior in detail but doesn't address rendering technology. The center-and-ring layout with smooth animations, badges, and drill-down requires a specific technology choice (D3.js, Cytoscape, custom Canvas/WebGL).

9. **No consideration of attachment/media handling**: Beyond the open question about iMessage attachments, there's no strategy for email attachments (PDFs, spreadsheets, images with text). These are often where the most important information lives.

10. **Sync state recovery**: If the SQLite database corrupts or the user migrates machines, there's no recovery or re-indexing strategy.

---

## 2. Proposed System Architecture

### 2.1 Design Philosophy: Platform-Agnostic Core

The fundamental architectural principle is **separation of the knowledge engine from any platform integration**. MindFlow should be a standalone library/service that can be embedded in OpenClaw, a desktop app, a CLI tool, a web service, or any future platform.

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Integration Layer (Adapters)                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ OpenClaw │  │   CLI    │  │  Desktop │  │  HTTP API Server │   │
│  │  Plugin  │  │   App    │  │   App    │  │   (future)       │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───────┬──────────┘   │
│       └──────────────┴──────────────┴───────────────┘               │
│                              │                                      │
│                     ┌────────▼────────┐                             │
│                     │   MindFlow SDK  │  (TypeScript/Node.js)      │
│                     │  Public API     │                             │
│                     └────────┬────────┘                             │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                        MindFlow Core Engine                         │
│                                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────┐   │
│  │  Ingestion   │  │  Processing  │  │   Knowledge Graph       │   │
│  │  Framework   │  │  Pipeline    │  │   Manager                │   │
│  │             │  │              │  │                           │   │
│  │ SourceAdap- │  │ Extraction → │  │ Entity Store + Relations │   │
│  │ ter Registry│  │ Resolution → │  │ Embedding Index          │   │
│  │ Scheduler   │  │ Linking →    │  │ Attention Engine         │   │
│  │ Checkpoint  │  │ Embedding    │  │ Query Engine             │   │
│  └──────┬──────┘  └──────┬───────┘  └──────────┬──────────────┘   │
│         │                │                      │                   │
│  ┌──────▼────────────────▼──────────────────────▼──────────────┐   │
│  │                    Storage Layer                              │   │
│  │  ┌──────────┐  ┌──────────────┐  ┌────────────────────┐     │   │
│  │  │  SQLite  │  │  sqlite-vec  │  │   FTS5 Index       │     │   │
│  │  │  (core)  │  │  (vectors)   │  │   (full-text)      │     │   │
│  │  └──────────┘  └──────────────┘  └────────────────────┘     │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Component Breakdown

#### Component 1: Source Adapter Framework

Each data source is a pluggable adapter that implements a common interface:

```typescript
interface SourceAdapter {
  id: string;                          // e.g., "gmail", "imessage"
  name: string;
  platform: NodeJS.Platform[];         // which OS this adapter runs on

  configure(config: AdapterConfig): Promise<void>;
  checkHealth(): Promise<HealthStatus>;
  getCheckpoint(): Promise<Checkpoint>;
  fetchSince(checkpoint: Checkpoint): AsyncIterableIterator<RawItem>;
  testConnection(): Promise<boolean>;
}

interface RawItem {
  sourceId: string;
  externalId: string;                  // unique ID within source
  channel: ChannelType;
  sender: ContactRef;
  recipients: ContactRef[];
  subject?: string;
  body: string;
  timestamp: Date;
  threadId?: string;                   // conversation grouping
  attachments?: AttachmentRef[];
  metadata: Record<string, unknown>;   // source-specific data
  contentHash: string;                 // for deduplication
}
```

**MVP Adapters**: Gmail (IMAP), iMessage (SQLite reader), Local Documents (file watcher)
**V1.1 Adapters**: Slack, Calendar, Meeting Notes
**Future**: WeChat, Voice Memos, Notion, Linear

The adapter registry allows third parties to register new source adapters without modifying core code:

```typescript
const engine = new MindFlowEngine(config);
engine.sources.register(new GmailAdapter(gmailConfig));
engine.sources.register(new IMessageAdapter());
engine.sources.register(new CustomSlackAdapter(slackConfig));
```

#### Component 2: Processing Pipeline

The pipeline is a sequence of discrete, composable stages. Each stage is independently testable and can be swapped.

```
RawItem → [Normalize] → [Extract] → [Resolve] → [Link] → [Embed] → [Score] → KnowledgeGraph
```

**Stage 1 — Normalize**: Clean text, detect language, extract thread structure, handle encoding. Purely local, no LLM needed.

**Stage 2 — Extract (Tiered)**:
- **Tier 1 — Rule-based (local, free)**: Email address extraction, phone number parsing, date/deadline detection, @-mention parsing, URL extraction. Handles ~40% of entity extraction with zero cost.
- **Tier 2 — Local NER model (local, free)**: Run a small multilingual NER model (e.g., spaCy with `zh_core_web_sm` + `en_core_web_sm`) for person names, organization names, locations. Handles another ~30%.
- **Tier 3 — LLM extraction (API, costs money)**: For complex semantic extraction — action items, key facts, topic labeling, intent classification, relationship inference. Handles the remaining ~30% but captures the highest-value information.

This tiered approach means the system is useful even without an LLM API key — it just misses the semantic layer.

**Stage 3 — Resolve**: Entity resolution using a multi-signal approach:
- Deterministic signals: email match, phone match, exact name match
- Probabilistic signals: name similarity (Jaro-Winkler + pinyin conversion), embedding similarity, co-occurrence patterns
- LLM-assisted: batch disambiguation for ambiguous cases
- Output: canonical entity ID with confidence score and merge provenance (so merges can be undone)

**Stage 4 — Link**: Cross-channel linking. Find the same conversation/topic across sources. Uses temporal proximity + entity overlap + semantic similarity.

**Stage 5 — Embed**: Generate embeddings for semantic search. Model selection below.

**Stage 6 — Score**: Update attention/urgency scores for the proactive surface.

#### Component 3: Knowledge Graph Manager

This is the core data model and query engine. It does NOT require a dedicated graph database.

**Why SQLite over Neo4j/TypeDB for this use case:**

| Factor | SQLite | Neo4j | TypeDB |
|--------|--------|-------|--------|
| Deployment | Zero-config, single file | Requires JVM server process | Requires server process |
| Storage footprint | ~500MB for 100K items | 2-5GB+ with indices | Similar to Neo4j |
| Startup time | Instant | 5-15 seconds | 5-15 seconds |
| Local-first fit | Perfect | Awkward | Awkward |
| Graph traversal | Good enough with CTEs | Excellent | Excellent |
| Ecosystem | Universal | Java/JS drivers | Limited drivers |
| Backup/portability | Copy one file | Export/import process | Export/import process |

For a personal knowledge graph with <1M nodes and <10M edges, SQLite's recursive CTEs handle graph traversal efficiently. The PRD's performance requirement of sub-500ms queries is easily achievable. A dedicated graph database adds operational complexity that contradicts the "zero-effort" product vision.

**Enhanced Schema Design:**

```sql
-- Core entity table with type discrimination
CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('person','topic','action','fact','document','thread')),
  canonical_name TEXT NOT NULL,
  aliases TEXT,          -- JSON array of alternative names
  attributes TEXT,       -- JSON object, schema varies by type
  status TEXT DEFAULT 'active' CHECK(status IN ('active','dormant','archived')),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Relationship edges with temporal tracking
CREATE TABLE relationships (
  id TEXT PRIMARY KEY,
  from_entity_id TEXT NOT NULL REFERENCES entities(id),
  to_entity_id TEXT NOT NULL REFERENCES entities(id),
  type TEXT NOT NULL,      -- 'discusses', 'assigned_to', 'related_to', etc.
  strength REAL DEFAULT 1.0,
  first_occurrence TEXT NOT NULL,
  last_occurrence TEXT NOT NULL,
  occurrence_count INTEGER DEFAULT 1,
  source_items TEXT,       -- JSON array of raw_item IDs
  metadata TEXT            -- JSON for edge-specific data
);

-- Raw ingested items with thread grouping
CREATE TABLE raw_items (
  id TEXT PRIMARY KEY,
  source_adapter TEXT NOT NULL,
  external_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  thread_id TEXT,          -- conversation grouping
  sender_entity_id TEXT REFERENCES entities(id),
  recipient_entity_ids TEXT,  -- JSON array
  subject TEXT,
  body TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  language TEXT,           -- detected language code
  processed_at TEXT,
  metadata TEXT
);

-- Conversation threads as first-class objects
CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  source_adapter TEXT NOT NULL,
  channel TEXT NOT NULL,
  subject TEXT,
  participant_entity_ids TEXT,  -- JSON array
  first_message_at TEXT NOT NULL,
  last_message_at TEXT NOT NULL,
  message_count INTEGER DEFAULT 0,
  summary TEXT               -- LLM-generated thread summary
);

-- Entity merge history for undo support
CREATE TABLE entity_merges (
  id TEXT PRIMARY KEY,
  winner_entity_id TEXT NOT NULL,
  loser_entity_id TEXT NOT NULL,
  merge_reason TEXT,
  confidence REAL,
  merged_at TEXT NOT NULL DEFAULT (datetime('now')),
  undone_at TEXT             -- NULL unless merge was reversed
);

-- Attention/proactive items
CREATE TABLE attention_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN (
    'unanswered_request','approaching_deadline','unreviewed_document',
    'stale_conversation','repeated_mentions'
  )),
  entity_id TEXT REFERENCES entities(id),
  related_item_ids TEXT,     -- JSON array of raw_item IDs
  urgency_score REAL NOT NULL DEFAULT 0.5,
  description TEXT,
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  snoozed_until TEXT
);

-- Sync state per source adapter
CREATE TABLE sync_state (
  source_adapter TEXT PRIMARY KEY,
  last_checkpoint TEXT NOT NULL,  -- adapter-specific checkpoint data (JSON)
  last_sync_at TEXT NOT NULL,
  items_processed INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active'
);

-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE raw_items_fts USING fts5(
  subject, body, content='raw_items', content_rowid='rowid',
  tokenize='unicode61'
);

-- Indices for common graph traversal patterns
CREATE INDEX idx_relationships_from ON relationships(from_entity_id);
CREATE INDEX idx_relationships_to ON relationships(to_entity_id);
CREATE INDEX idx_relationships_type ON relationships(type);
CREATE INDEX idx_raw_items_thread ON raw_items(thread_id);
CREATE INDEX idx_raw_items_sender ON raw_items(sender_entity_id);
CREATE INDEX idx_raw_items_timestamp ON raw_items(timestamp);
CREATE INDEX idx_entities_type ON entities(type);
CREATE INDEX idx_entities_status ON entities(status);
CREATE INDEX idx_attention_resolved ON attention_items(resolved_at);
```

**Vector Storage**: Use `sqlite-vec` extension for embedding storage and search. This keeps everything in a single SQLite database file, which is critical for the local-first, zero-config promise. sqlite-vec supports brute-force KNN search which is fine for <1M vectors. For the expected scale (~100K-500K items), brute-force with 384-dimensional vectors is sub-100ms.

#### Component 4: Embedding Strategy

**Recommended model: Qwen3-Embedding-0.6B**

Rationale:
- Excellent Chinese + English performance (top scores on both MTEB and C-MTEB)
- 0.6B parameters — small enough to run locally on Apple Silicon via ONNX or llama.cpp
- Supports flexible output dimensions (can use 256-dim for storage efficiency)
- Instruction-aware — can be prompted for different retrieval tasks
- Multilingual across 100+ languages for future expansion

**Alternative: BGE-M3** (BAAI)
- Strong cross-lingual retrieval
- Supports dense, sparse, and multi-vector retrieval
- Slightly larger but well-established

**Inference setup**: Run locally via ONNX Runtime (Node.js bindings) or Transformers.js. No API calls needed for embeddings — this is entirely local and private.

**Embedding targets**:
- Each raw item body (for semantic search)
- Each entity canonical_name + attributes (for entity similarity matching)
- Thread summaries (for topic-level search)

#### Component 5: Query Engine

The query engine combines multiple retrieval strategies:

```
User Query
    │
    ├─→ [Intent Classifier] ─→ Determines query type
    │     (factual_recall | person_context | cross_ref | pending | relationship)
    │
    ├─→ [FTS5 Search] ─→ Keyword matches (fast, high precision)
    │
    ├─→ [Vector Search] ─→ Semantic matches (handles paraphrasing, cross-lingual)
    │
    ├─→ [Graph Traversal] ─→ Relationship-based results (person X's topics, etc.)
    │
    └─→ [Fusion Ranker] ─→ Combine and rank results
           │
           └─→ [LLM Synthesizer] ─→ Generate natural language answer with citations
```

**Intent classification** can be done with a simple rule-based system for MVP (keyword patterns + entity detection), upgraded to LLM classification in V1.1.

**Hybrid search** is critical: pure vector search misses exact matches (names, numbers), pure keyword search misses paraphrases and cross-lingual matches. The fusion ranker uses Reciprocal Rank Fusion (RRF) to combine results from FTS5 and vector search.

#### Component 6: Visualization Layer

**Technology choice: D3.js with a custom radial layout**

Rationale:
- D3.js is the most flexible visualization library for custom graph layouts
- The center-and-ring pattern is not a standard force-directed graph — it's a constrained radial layout
- D3's force simulation can be used with fixed center node + radial force for ring positioning
- Smooth transitions are built into D3's transition system
- Works in any browser context (iframe, standalone, webview)

**Architecture**: The visualization is a standalone single-page application (SPA) that communicates with the MindFlow core engine via a local HTTP API or direct in-process calls.

```
┌─────────────────────────────────────────┐
│        Visualization SPA (HTML/JS)       │
│  ┌──────────┐  ┌───────────┐            │
│  │  D3.js   │  │  Detail   │            │
│  │  Radial  │  │  Timeline │            │
│  │  Graph   │  │  Panel    │            │
│  └────┬─────┘  └─────┬─────┘            │
│       └───────┬───────┘                  │
│         ┌─────▼─────┐                    │
│         │ Graph API │ (fetch/WebSocket)  │
│         └─────┬─────┘                    │
└───────────────┼──────────────────────────┘
                │
        ┌───────▼───────┐
        │ MindFlow Core │
        │  Query Engine │
        └───────────────┘
```

**Rendering approach**:
- Canvas-based rendering for performance (not SVG DOM nodes for hundreds of entities)
- SVG overlay for interactive elements (tooltips, badges, labels)
- WebGL fallback for very large graphs (>1000 visible nodes)
- Precomputed layout positions stored in the database for instant load

#### Component 7: Attention Engine

The proactive attention surface is modeled as a continuous scoring system, not a batch rule evaluator.

Each attention rule is a scored function:

```typescript
interface AttentionRule {
  id: string;
  type: AttentionType;
  evaluate(context: AttentionContext): Promise<AttentionSignal[]>;
  defaultUrgencyWeight: number;
}

interface AttentionSignal {
  type: AttentionType;
  entityId: string;
  relatedItemIds: string[];
  urgencyScore: number;     // 0.0 - 1.0
  description: string;
  detectedAt: Date;
}
```

Rules run after each ingestion cycle. Signals are deduplicated and merged. The urgency score decays over time (so old unresolved items don't permanently dominate) unless they have hard deadlines.

**User feedback loop**: When a user dismisses an attention item, that's negative feedback. When they click through and act on it, that's positive feedback. Over time, the urgency weights per rule type can be calibrated to the user's behavior.

---

## 3. Key Design Decisions and Rationale

### Decision 1: SQLite as the only storage engine

**Choice**: Single SQLite database with sqlite-vec + FTS5 extensions.

**Rejected alternatives**:
- Neo4j: Requires a JVM server process. Contradicts local-first, zero-config philosophy. The graph traversal benefits don't justify the operational cost at personal scale.
- TypeDB: Powerful type system but overkill for this domain. Requires a server process. Limited Node.js ecosystem.
- DuckDB: Better for analytics than OLTP workloads. Not a natural fit for graph-like data.
- Separate FAISS index: Adds another dependency and file to manage. sqlite-vec keeps everything in one file.

**Rationale**: At personal scale (<1M entities), SQLite with recursive CTEs handles graph traversal in single-digit milliseconds. The single-file portability (backup = copy one file) is a massive UX advantage. SQLite is the most battle-tested embedded database in existence.

### Decision 2: Tiered extraction (rules -> local NER -> LLM)

**Choice**: Three-tier extraction where each tier adds cost but also value.

**Rationale**: The PRD treats LLM extraction as the only path, which makes the system expensive, slow for initial indexing, and non-functional offline. The tiered approach means:
- Tier 1 (rules) works offline, instantly, and free
- Tier 2 (local NER) works offline, sub-second, and free
- Tier 3 (LLM) adds semantic understanding at cost

Users without an LLM API key still get a useful system. Users with a key get the full semantic experience. This dramatically lowers the barrier to entry.

### Decision 3: Thread as a first-class entity

**Choice**: Add `thread` as an entity type alongside the PRD's five types.

**Rationale**: The PRD jumps from individual messages to topics, but conversations/threads are the natural intermediate grouping. An email thread about "Q3 Budget" is a distinct object from the topic "Q3 Budget" — the thread has participants, a temporal span, and a sequence. Topics may span multiple threads. Threads make cross-channel linking more precise: "the same conversation continued in iMessage" is a thread-level link, not a topic-level one.

### Decision 4: Entity merge provenance and undo

**Choice**: Every entity merge is recorded with the signals that triggered it and can be reversed.

**Rationale**: Entity resolution errors are the #1 trust-killer in knowledge graph systems. If the system merges two different people named "Zhang Wei," the user needs to be able to split them apart without losing data. The `entity_merges` table provides a full audit trail and makes undo a database operation rather than a graph surgery.

### Decision 5: Local embeddings, no API dependency

**Choice**: Run Qwen3-Embedding-0.6B locally via ONNX Runtime.

**Rationale**: Embeddings are generated frequently (every ingestion cycle) and must be consistent (model version changes invalidate old embeddings). Using a cloud embedding API creates a privacy leak (raw text sent to API), a cost center, and a consistency risk (model versions change without notice). A 0.6B parameter model runs comfortably on Apple Silicon M-series chips with sub-100ms per embedding.

### Decision 6: Visualization as a standalone SPA

**Choice**: The graph UI is a self-contained HTML/JS/CSS application served by a local HTTP server.

**Rationale**: This is the key to platform-agnosticism. The SPA can be:
- Embedded in an OpenClaw MCP Apps iframe
- Opened in any browser via localhost URL
- Wrapped in an Electron/Tauri shell for a desktop app
- Loaded in a Telegram WebApp view
- Embedded in a VS Code webview panel

The SPA communicates with the core engine via a REST API or WebSocket on localhost. The transport is the abstraction boundary.

---

## 4. Platform-Agnostic Design

### 4.1 Abstraction Layers

The system has three abstraction boundaries:

1. **Source Adapter Interface**: Any data source implements `SourceAdapter`. Platform-specific sources (iMessage on macOS) are just adapters that happen to only work on one platform. The core engine doesn't know or care.

2. **MindFlow SDK (Public API)**: A TypeScript library that exposes all core functionality:
   ```typescript
   // Core operations
   engine.ingest()                    // Run ingestion cycle
   engine.query("What did Lisa say?") // Natural language query
   engine.getEntity(id)               // Get entity by ID
   engine.getGraph(centerId, depth)   // Get subgraph for visualization
   engine.getAttentionItems()         // Get proactive items

   // Configuration
   engine.sources.register(adapter)
   engine.sources.configure(id, config)
   engine.setLLMProvider(provider)
   ```

3. **Integration Adapter Interface**: Platform integrations implement a thin adapter:
   ```typescript
   interface IntegrationAdapter {
     id: string;
     type: 'cli' | 'plugin' | 'http' | 'bot';
     initialize(engine: MindFlowEngine): Promise<void>;
     start(): Promise<void>;
     stop(): Promise<void>;
   }
   ```

### 4.2 LLM Provider Abstraction

The LLM dependency is abstracted behind a provider interface:

```typescript
interface LLMProvider {
  id: string;
  extract(items: RawItem[]): Promise<ExtractionResult[]>;
  classify(query: string): Promise<QueryIntent>;
  synthesize(query: string, context: RetrievedContext[]): Promise<Answer>;
  summarize(items: RawItem[]): Promise<string>;
}
```

Implementations: `ClaudeProvider`, `OpenAIProvider`, `OllamaProvider`, `MockProvider` (for testing).

This means the system can use Claude for extraction, GPT for synthesis, and Ollama for offline fallback — or any combination.

### 4.3 Cross-Platform Considerations

| Component | macOS | Linux | Windows |
|-----------|-------|-------|---------|
| Core engine | Yes | Yes | Yes |
| SQLite + extensions | Yes | Yes | Yes |
| Local embeddings (ONNX) | Yes | Yes | Yes |
| Gmail adapter | Yes | Yes | Yes |
| iMessage adapter | Yes (native) | No | No |
| Document watcher | Yes | Yes | Yes |
| Visualization SPA | Yes | Yes | Yes |
| OpenClaw plugin | Yes (if OpenClaw runs) | TBD | TBD |

The MVP targets macOS because of iMessage, but the architecture ensures that 90% of the system works on any platform. iMessage is just one adapter.

---

## 5. Technology Recommendations

### Core Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Language | TypeScript (Node.js 20+) | PRD specifies Node.js; TypeScript adds type safety for the complex data model |
| Database | SQLite 3.45+ via better-sqlite3 | Synchronous API (better perf), WAL mode, native Node.js binding |
| Vector search | sqlite-vec | Single-file, no external dependency, brute-force KNN sufficient at scale |
| Full-text search | SQLite FTS5 | Built into SQLite, supports unicode61 tokenizer for CJK |
| Embeddings | Qwen3-Embedding-0.6B via ONNX Runtime | Best Chinese+English, runs locally on Apple Silicon |
| Visualization | D3.js v7 + Canvas API | Flexible custom layouts, battle-tested, no framework dependency |
| Local HTTP server | Fastify | Lightweight, schema validation, WebSocket support |
| File watching | chokidar | Mature, cross-platform file system watching |
| NER (local) | compromise (English) + nodejieba (Chinese) | Lightweight NLP for tier-2 extraction |
| Encryption | SQLCipher | SQLite encryption at rest, transparent to application code |

### Development Tools

| Tool | Purpose |
|------|---------|
| Vitest | Unit and integration testing |
| Drizzle ORM | Type-safe SQLite schema management and migrations |
| tsup | Library bundling for the SDK |
| Zod | Runtime validation for adapter configs and API inputs |

---

## 6. Data Flow Sequence (Detailed)

### Ingestion Cycle (every 15 minutes)

```
1. Scheduler triggers ingestion cycle
2. For each registered source adapter:
   a. Load checkpoint from sync_state table
   b. Call adapter.fetchSince(checkpoint) — yields RawItems
   c. For each RawItem:
      i.   Check content_hash against raw_items table (dedup)
      ii.  If new: insert into raw_items, enqueue for processing
      iii. Update checkpoint in sync_state
3. Processing pipeline runs on enqueued items:
   a. Normalize: clean text, detect language, parse thread structure
   b. Tier-1 Extract: regex-based email, phone, date, URL extraction
   c. Tier-2 Extract: local NER for person/org names
   d. Tier-3 Extract: batch LLM call for action items, key facts, topics
   e. Resolve: match extracted entities against existing entities
      - Deterministic match → link immediately
      - Probabilistic match (>0.85 confidence) → auto-merge with provenance
      - Uncertain (0.5-0.85) → create candidate merge, surface to user
      - No match → create new entity
   f. Link: find cross-channel connections
      - Same entity across sources → add relationship edges
      - Same thread/topic across sources → link threads
   g. Embed: generate embeddings for new items and entities
      - Store in sqlite-vec virtual table
   h. Score: run attention rules, update urgency scores
4. Emit 'ingestion_complete' event with stats
```

### Query Flow

```
1. User submits natural language query
2. Intent classifier categorizes query:
   - "What did Wang Zong say about budget?" → factual_recall
   - "What's pending?" → pending_items
   - "Show me Lisa's timeline" → person_context
3. Parallel retrieval:
   a. FTS5 keyword search on raw_items_fts
   b. Vector similarity search on embeddings via sqlite-vec
   c. Entity name lookup on entities table
   d. Graph traversal for relationship queries
4. Fusion ranker combines results using RRF
5. LLM synthesizer generates answer with source citations
6. Return structured response with:
   - answer text
   - source items with channel/date/sender
   - related entity IDs (for "View in graph" links)
```

---

## 7. Scalability Considerations

### Data Volume Projections

| Timeframe | Raw Items | Entities | Relationships | Embeddings | DB Size |
|-----------|-----------|----------|---------------|------------|---------|
| Month 1 | ~15K | ~500 | ~3K | ~15K | ~100MB |
| Month 6 | ~90K | ~2K | ~20K | ~90K | ~500MB |
| Year 1 | ~180K | ~3K | ~50K | ~180K | ~1GB |
| Year 3 | ~500K | ~5K | ~150K | ~500K | ~3GB |

### Performance Strategies

1. **Tiered entity storage**: Active entities in main table, dormant/archived in a separate partition. Queries default to active only.

2. **Embedding quantization**: Use INT8 quantized vectors (sqlite-vec supports this) to halve storage with minimal quality loss.

3. **Lazy thread summarization**: Don't summarize every thread immediately. Summarize on first access or when thread grows beyond 20 messages.

4. **Background processing**: All LLM calls and embedding generation happen in a worker thread (Node.js worker_threads). The main thread stays responsive for queries.

5. **Incremental graph layout**: Pre-compute and cache graph layout positions. Only recompute affected subgraphs when entities change.

6. **Configurable retention**: Users can set retention policies (e.g., archive entities not seen in 6 months, delete raw items older than 2 years but keep entities and relationships).

---

## 8. Open Questions from PRD — My Positions

1. **Graph layout algorithm**: Use a **constrained radial layout** (not pure force-directed). The center node is fixed, ring nodes are positioned on a circle with angular spacing proportional to edge weight. This is deterministic and fast, unlike force-directed which requires simulation convergence.

2. **LLM provider default**: Make it **configurable with Claude Sonnet as default**. Claude has better Chinese understanding. But the tiered extraction approach means the LLM is only used for Tier 3, reducing the importance of this choice.

3. **Notification channel**: **Both**. Attention items appear in the graph (badges), and optionally push to a configured channel (Telegram, system notification). Let the user choose.

4. **Team/shared mode**: **Defer to V2.0**. The privacy implications are complex. Focus on single-user perfection first.

5. **Offline LLM**: **Support Ollama from day one** via the LLM provider abstraction. It's trivial to implement since we already need the provider interface for Claude/GPT. Don't make it a V1.1 thing.

6. **iMessage attachment handling**: **Extract text from PDFs and images in V1.1**. For MVP, index the message text and note that an attachment exists. Attachment content extraction is a significant subsystem.

---

## 9. Risk Mitigation Additions

Beyond the PRD's risk table, I'd add:

| Risk | Severity | Mitigation |
|------|----------|------------|
| SQLite concurrent write contention | Medium | Use WAL mode; serialize writes through a single writer connection; reads can be concurrent |
| ONNX Runtime compatibility across Node.js versions | Medium | Pin ONNX Runtime version; test against Node.js 20 and 22; provide pre-built binaries |
| sqlite-vec not supporting ANN (approximate nearest neighbor) | Low | At <1M vectors, brute-force KNN is sub-100ms. If scale exceeds this, migrate to hnswlib with a file alongside SQLite |
| User loses trust due to incorrect entity merge | High | Conservative auto-merge threshold (>0.85); visible merge history; one-click undo; never auto-merge without at least one deterministic signal |
| Graph UI performance with hundreds of nodes | Medium | Canvas rendering, viewport culling, level-of-detail rendering, max 20 nodes visible per layer |

---

## 10. Summary of Key Differentiators in This Design

1. **Platform-agnostic core**: MindFlow SDK is a standalone library. OpenClaw is one integration, not the only one.
2. **Tiered extraction**: Useful without an LLM API key. Full power with one. No all-or-nothing dependency.
3. **Single-file storage**: Everything in one SQLite file (data, vectors, full-text index). Backup = copy. Migration = copy.
4. **Thread as first-class entity**: Proper conversation grouping before topic abstraction.
5. **Merge provenance and undo**: Entity resolution errors are recoverable without data loss.
6. **Local embeddings by default**: No privacy leak, no cost, no API dependency for search.
7. **Composable pipeline stages**: Each processing stage is independently testable, replaceable, and optional.
8. **Attention scoring with feedback loop**: Proactive items improve over time based on user behavior.
