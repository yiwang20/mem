# MindFlow Design Proposal — Researcher 1

## 1. PRD Analysis

### 1.1 Strengths

- **Clear problem definition**: The information fragmentation problem is well-articulated and the competitive landscape analysis correctly identifies the gap — no existing tool combines automated communication ingestion, entity extraction, cross-channel linking, and local-first privacy.
- **Person-centric design**: The knowledge graph's person-first navigation model aligns with how users actually think ("Who told me X?"), which is a strong UX insight.
- **Layered progressive disclosure**: The center-and-ring navigation with max 20 nodes per layer is a well-grounded UI pattern that avoids cognitive overload.
- **Bilingual by design**: Treating Chinese/English as a first-class requirement from day one avoids painful retrofitting.
- **Proactive attention surface**: The "Pending" category with AI-driven detection (unanswered requests, approaching deadlines, stale conversations) is the highest-value differentiator.

### 1.2 Gaps and Concerns

**G1: Tight OpenClaw coupling is a strategic risk.** The PRD defines MindFlow as "an OpenClaw plugin" with OpenClaw cron skills, MCP Apps rendering, and OpenClaw SDK dependencies. This creates a single-platform dependency. If OpenClaw's API changes, adoption stalls, or users want MindFlow without OpenClaw, the system is trapped. The architecture must separate the core engine from any platform integration layer.

**G2: LLM cost estimation is absent.** Processing 10K emails + 50K iMessages requires significant LLM API calls for entity extraction. At ~500 tokens/message average, that's ~30M tokens for the initial scan alone. At Claude Sonnet pricing (~$3/M input tokens), that's ~$90 just for the first run, plus ongoing costs. The PRD mentions "smart throttling" but provides no cost model or budget guidance.

**G3: Entity resolution strategy underestimates complexity.** The PRD lists email matching, phone matching, name similarity, and LLM-assisted merge. But real-world entity resolution is harder:
- Same email can be used by multiple people (shared inboxes)
- Chinese names have massive collision rates (e.g., thousands of "张伟")
- People change email addresses, phone numbers, and even names
- The PRD doesn't address entity split (incorrectly merged entities) or confidence decay over time

**G4: No offline-first story for LLM processing.** The PRD acknowledges the privacy risk of sending content to LLM APIs but defers local model support (Ollama) to "maybe V1.1." This undermines the "local-first" value proposition. Users who care enough about privacy to want local-first storage will balk at sending all their messages to an API.

**G5: iMessage access fragility.** The `chat.db` schema is undocumented and Apple changes it across macOS versions. In macOS Ventura+, messages are encoded as hex blobs in `attributedBody` rather than plain text. The PRD mentions "abstract DB access layer" but doesn't address the decoding complexity or the risk that Apple may further restrict access.

**G6: Topic clustering is underspecified.** The PRD says topics "emerge from message content through semantic clustering" but doesn't address:
- How to handle topic drift (a conversation about "budget" evolves into "vendor selection")
- Topic granularity (is "Q3" a topic? Is "Q3 Budget" a subtopic?)
- How users correct wrong topic assignments
- Initial topic seeding vs. cold-start problem

**G7: No conflict resolution strategy.** When the same fact appears with different values across channels (e.g., a price quoted differently in email vs. iMessage), the PRD doesn't specify how conflicts are surfaced or resolved.

**G8: Graph visualization technology not specified.** The PRD describes detailed visual behavior (animations, badges, color coding) but doesn't name a rendering technology or discuss performance characteristics for large graphs.

**G9: No data export or portability story.** If MindFlow is discontinued or the user switches tools, there's no specified way to export the knowledge graph.

**G10: Batch vs. streaming architecture ambiguity.** The 15-minute cron interval implies batch processing, but some features (like "unanswered request detection") would benefit from near-real-time processing. The PRD doesn't address this tension.

---

## 2. Proposed System Architecture

### 2.1 Design Principles

1. **Core-shell separation**: The knowledge engine (ingestion, processing, storage, query) is a standalone library/service with a clean API. Platform integrations (OpenClaw, CLI, web app, Telegram) are thin adapter shells.
2. **Local-first with optional cloud**: All data stored locally by default. Cloud sync is opt-in, encrypted, and only between the user's own devices.
3. **LLM-provider agnostic**: The extraction pipeline abstracts the LLM provider behind an interface. Supports Claude API, OpenAI API, Ollama (local), and any OpenAI-compatible endpoint.
4. **Temporal knowledge graph**: Inspired by Graphiti/Zep's bi-temporal model — every fact has both an event timestamp (when it happened) and an ingestion timestamp (when we learned about it), enabling historical reasoning and conflict resolution.
5. **Plugin architecture for data sources**: Each data source is a self-contained adapter implementing a common interface. Adding a new source (Slack, WeChat, Calendar) requires only implementing the adapter, not modifying the core.
6. **Progressive processing**: Not all messages need full LLM extraction. A tiered processing model applies cheap heuristics first, reserves expensive LLM calls for high-value content.

### 2.2 Component Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     PLATFORM ADAPTERS (Shells)                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │ OpenClaw │ │   CLI    │ │ Web App  │ │ Telegram Bot     │   │
│  │ Plugin   │ │          │ │ (standalone)│ │                │   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────────────┘   │
│       │             │            │             │                  │
│       └─────────────┴────────────┴─────────────┘                 │
│                          │                                        │
│                    MindFlow API                                   │
└────────────────────┬─────────────────────────────────────────────┘

┌────────────────────┴─────────────────────────────────────────────┐
│                     MINDFLOW CORE ENGINE                          │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │                   QUERY ENGINE                            │     │
│  │  ┌──────────┐ ┌──────────────┐ ┌──────────────────┐     │     │
│  │  │ NL Query │ │ Graph        │ │ Semantic Search   │     │     │
│  │  │ Parser   │ │ Traversal    │ │ (Vector + FTS)    │     │     │
│  │  └──────────┘ └──────────────┘ └──────────────────┘     │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │                 KNOWLEDGE GRAPH                           │     │
│  │  ┌──────────┐ ┌──────────────┐ ┌──────────────────┐     │     │
│  │  │ Entity   │ │ Relationship │ │ Temporal          │     │     │
│  │  │ Store    │ │ Store        │ │ Indexing          │     │     │
│  │  └──────────┘ └──────────────┘ └──────────────────┘     │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │               PROCESSING PIPELINE                         │     │
│  │  ┌──────────┐ ┌──────────────┐ ┌──────────────────┐     │     │
│  │  │ Triage   │ │ Entity       │ │ Linking &         │     │     │
│  │  │ (cheap)  │ │ Extraction   │ │ Resolution        │     │     │
│  │  └──────────┘ └──────────────┘ └──────────────────┘     │     │
│  │  ┌──────────┐ ┌──────────────┐ ┌──────────────────┐     │     │
│  │  │ Embedding│ │ Topic        │ │ Attention         │     │     │
│  │  │ Generator│ │ Clustering   │ │ Detector          │     │     │
│  │  └──────────┘ └──────────────┘ └──────────────────┘     │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │                INGESTION LAYER                            │     │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │     │
│  │  │  Gmail   │ │ iMessage │ │  Files   │ │  Slack   │   │     │
│  │  │ Adapter  │ │ Adapter  │ │ Adapter  │ │ Adapter  │   │     │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │     │
│  │                                                           │     │
│  │  Common Interface: SourceAdapter                          │     │
│  │    - connect() / disconnect()                             │     │
│  │    - fetchSince(checkpoint) → RawItem[]                   │     │
│  │    - getCheckpoint() → Checkpoint                         │     │
│  │    - healthCheck() → Status                               │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │                 STORAGE LAYER                             │     │
│  │  ┌───────────────────┐  ┌───────────────────────────┐   │     │
│  │  │ SQLite (primary)  │  │ sqlite-vec (vectors)      │   │     │
│  │  │ - raw_items       │  │ - entity embeddings       │   │     │
│  │  │ - entities        │  │ - message embeddings      │   │     │
│  │  │ - relationships   │  │                           │   │     │
│  │  │ - attention       │  └───────────────────────────┘   │     │
│  │  │ - sync_state      │                                   │     │
│  │  │ - FTS5 index      │                                   │     │
│  │  └───────────────────┘                                   │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │              LLM ABSTRACTION LAYER                        │     │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │     │
│  │  │ Claude   │ │ OpenAI   │ │ Ollama   │ │ Any      │   │     │
│  │  │ Provider │ │ Provider │ │ Provider │ │ OAI-compat│   │     │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │     │
│  │                                                           │     │
│  │  Common Interface: LLMProvider                            │     │
│  │    - extractEntities(content) → Entity[]                  │     │
│  │    - classifyIntent(content) → Intent                     │     │
│  │    - generateAnswer(query, context) → Answer              │     │
│  │    - resolveEntities(candidates) → MergeDecision          │     │
│  └─────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
```

### 2.3 Component Details

#### 2.3.1 Ingestion Layer

**SourceAdapter Interface:**

```typescript
interface SourceAdapter {
  readonly sourceType: string;         // "gmail", "imessage", "filesystem", etc.
  readonly capabilities: AdapterCapabilities;

  connect(config: SourceConfig): Promise<void>;
  disconnect(): Promise<void>;

  fetchSince(checkpoint: Checkpoint): AsyncIterable<RawItem>;
  getCheckpoint(): Promise<Checkpoint>;

  healthCheck(): Promise<HealthStatus>;

  // Optional: real-time support
  watch?(callback: (item: RawItem) => void): Unsubscribe;
}

interface RawItem {
  id: string;
  sourceType: string;
  channel: string;               // "email", "imessage", "file", etc.
  contentHash: string;           // SHA-256 for dedup
  sender: ContactRef;
  recipients: ContactRef[];
  subject?: string;
  body: string;
  bodyFormat: "plaintext" | "html" | "markdown";
  timestamp: Date;               // event time
  ingestedAt: Date;              // ingestion time
  threadId?: string;
  attachments?: AttachmentRef[];
  metadata: Record<string, unknown>;
  language?: string;             // detected language
}
```

**iMessage Adapter specifics:**
- Opens `chat.db` in read-only mode with WAL support
- Handles `attributedBody` hex blob decoding for macOS Ventura+
- Version-detection logic to handle schema changes across macOS versions
- Maps `handle` table to contact identifiers (phone/email)
- Falls back gracefully if Full Disk Access is not granted (clear error message + setup instructions)

**Gmail Adapter specifics:**
- Supports both Gmail API (OAuth) and IMAP
- Preference for Gmail API due to richer metadata (labels, thread IDs, read status)
- Incremental sync via `historyId` (Gmail API) or `SINCE` date (IMAP)
- HTML email body stripped to plain text with structure preserved

**Filesystem Adapter specifics:**
- Uses `fs.watch` / `chokidar` for real-time file change detection
- Supports Markdown, plain text, PDF (via `pdf-parse`), and common document formats
- Configurable directory whitelist and file type filters

#### 2.3.2 Processing Pipeline

The processing pipeline uses a **tiered approach** to manage LLM costs:

**Tier 1: Local heuristics (free, instant)**
- Language detection (using `cld3` or `franc`)
- Sender/recipient extraction from message metadata
- Thread grouping by existing thread IDs
- Duplicate detection via content hash
- Simple pattern matching for dates, phone numbers, email addresses, monetary amounts
- Message importance scoring based on: length, presence of questions, mentions of deadlines, sender frequency

**Tier 2: Local embedding (cheap, fast)**
- Generate embeddings using a local multilingual model
- Recommended: **BGE-M3** (via ONNX Runtime or Transformers.js) — supports 100+ languages, strong Chinese/English performance, 1024 dimensions
- Alternative: **Qwen3-Embedding** for better Chinese-specific performance
- Used for: semantic search, topic clustering, cross-language entity matching

**Tier 3: LLM extraction (expensive, slow)**
- Only applied to messages that pass Tier 1 importance threshold
- Batch processing: group related messages into single LLM calls to reduce API overhead
- Structured output schema using JSON mode for reliable parsing
- Extracts: entities (people, topics, action items, key facts), relationships, intent classification, sentiment

**Cost optimization strategies:**
- Skip LLM extraction for very short messages (<20 chars), automated notifications, and marketing emails
- Batch 5-10 related messages into a single extraction call
- Cache extraction results — if a message is a reply in a thread, use the thread's existing entities as context
- Progressive extraction: extract basic entities on first pass, refine with full context on subsequent passes
- Budget tracking: configurable monthly LLM spend cap with automatic throttling

**Estimated costs with optimization:**
- Initial scan of 60K items: ~$15-25 (vs. $90 without optimization)
- Monthly ongoing (1K new items/day): ~$5-10

#### 2.3.3 Knowledge Graph — Temporal Model

Inspired by Graphiti/Zep's architecture but adapted for personal communications:

**Three-layer graph:**

1. **Episode Layer** — raw indexed items (messages, emails, documents)
   - Each episode is a RawItem with full content and metadata
   - Episodes are immutable once ingested
   - Connected to entities extracted from them

2. **Entity Layer** — extracted structured knowledge
   - Entities: Person, Topic, ActionItem, KeyFact, Document
   - Each entity has a canonical representation and aliases
   - Entities are mutable (can be merged, split, updated)
   - Each entity carries a **confidence score** (0.0–1.0)

3. **Community Layer** — higher-order groupings
   - Auto-detected clusters of tightly connected entities
   - Examples: "Project Alpha team", "Q3 planning", "Family"
   - Used for high-level navigation and context-aware querying

**Bi-temporal edges:**
Every relationship edge carries:
- `event_time`: when the relationship was observed in the real world
- `ingestion_time`: when MindFlow processed it
- `valid_from` / `valid_until`: temporal validity window (null = still valid)
- `strength`: relationship weight (0.0–1.0), decays over time without reinforcement
- `source_episodes`: list of episodes that support this relationship

This enables queries like "What was Wang Zong's role as of January?" even if his role has since changed.

#### 2.3.4 Entity Resolution Engine

A multi-stage resolution pipeline:

**Stage 1: Deterministic matching**
- Exact email address match
- Exact phone number match (normalized to E.164)
- Contact.app integration (macOS Contacts framework) for canonical name resolution

**Stage 2: Probabilistic matching**
- Name similarity with multilingual support:
  - Chinese name ↔ Pinyin conversion (e.g., "王总" → "wáng zǒng")
  - Fuzzy matching with Jaro-Winkler distance for English names
  - Cross-script matching using transliteration tables
- Contextual signals: same topic, same thread, same time window
- Embedding similarity of entity descriptions

**Stage 3: LLM-assisted resolution (for ambiguous cases)**
- Present candidate pairs with surrounding context to LLM
- LLM returns merge/no-merge decision with confidence
- Only triggered when Stage 2 produces candidates with 0.4–0.7 confidence

**Stage 4: User confirmation**
- Entities merged with <0.7 confidence are flagged for user review
- Simple UI: "Is [entity A] the same as [entity B]?" with context preview
- User decisions feed back into the resolution model

**Safeguards:**
- All merges are reversible (entity split operation)
- Merge audit log: who/what triggered each merge and when
- Conservative default: prefer false negatives (two entities for one person) over false positives (one entity for two people)

#### 2.3.5 Topic Clustering

**Algorithm:**
1. Generate embeddings for each message
2. Apply HDBSCAN clustering on embeddings within temporal windows (7-day sliding window)
3. LLM generates human-readable label for each cluster
4. Across windows, merge clusters with >0.6 embedding centroid similarity
5. Track topic lifecycle: new → active → dormant (14 days no activity) → archived (60 days)

**Handling topic drift:**
- When a topic's centroid shifts significantly over time, the system detects drift
- If drift exceeds threshold, the topic is split into a parent topic and child topics
- Example: "Q3 Planning" might spawn subtopics "Q3 Budget" and "Q3 Vendor Selection"

**User corrections:**
- Users can rename, merge, or split topics manually
- User corrections are weighted heavily in future clustering
- Correction patterns are learned (e.g., if user frequently separates budget from timeline topics, the system learns to cluster them separately)

#### 2.3.6 Storage Layer

**Primary store: SQLite with extensions**

Why SQLite:
- Zero-configuration, serverless, local-first
- Proven at scale (handles millions of rows comfortably)
- WAL mode for concurrent reads during writes
- FTS5 for full-text search
- sqlite-vec extension for vector similarity search
- Single-file database simplifies backup and portability
- Optional encryption via SQLCipher

**Schema design (expanded from PRD):**

```sql
-- Raw ingested items (immutable after creation)
CREATE TABLE raw_items (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,         -- "gmail", "imessage", "filesystem"
  channel TEXT NOT NULL,             -- "email", "imessage", "file"
  sender_id TEXT,
  recipient_ids TEXT,                -- JSON array
  subject TEXT,
  body TEXT NOT NULL,
  body_format TEXT DEFAULT 'plaintext',
  content_hash TEXT NOT NULL UNIQUE, -- SHA-256 for dedup
  thread_id TEXT,
  event_time INTEGER NOT NULL,       -- Unix timestamp
  ingested_at INTEGER NOT NULL,
  language TEXT,
  metadata TEXT,                     -- JSON
  processing_status TEXT DEFAULT 'pending'  -- pending/tier1/tier2/tier3/done
);

-- Extracted entities
CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                -- person/topic/action_item/key_fact/document
  canonical_name TEXT NOT NULL,
  aliases TEXT,                      -- JSON array of alternate names
  attributes TEXT,                   -- JSON (type-specific attributes)
  confidence REAL DEFAULT 1.0,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  status TEXT DEFAULT 'active',      -- active/dormant/archived/merged
  merged_into TEXT,                  -- points to surviving entity if merged
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Entity relationships (bi-temporal edges)
CREATE TABLE relationships (
  id TEXT PRIMARY KEY,
  from_entity_id TEXT NOT NULL REFERENCES entities(id),
  to_entity_id TEXT NOT NULL REFERENCES entities(id),
  type TEXT NOT NULL,                -- "discusses", "owns", "assigned_to", etc.
  strength REAL DEFAULT 0.5,
  event_time INTEGER,
  ingestion_time INTEGER NOT NULL,
  valid_from INTEGER,
  valid_until INTEGER,               -- NULL = still valid
  source_item_ids TEXT,              -- JSON array of raw_item IDs
  metadata TEXT
);

-- Entity-episode links
CREATE TABLE entity_episodes (
  entity_id TEXT NOT NULL REFERENCES entities(id),
  raw_item_id TEXT NOT NULL REFERENCES raw_items(id),
  extraction_method TEXT,            -- "tier1", "tier2", "tier3"
  confidence REAL DEFAULT 1.0,
  PRIMARY KEY (entity_id, raw_item_id)
);

-- Community/cluster groupings
CREATE TABLE communities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  member_entity_ids TEXT,            -- JSON array
  centroid_embedding BLOB,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Attention/pending items
CREATE TABLE attention_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                -- "unanswered", "deadline", "stale", "urgent"
  entity_id TEXT REFERENCES entities(id),
  raw_item_id TEXT REFERENCES raw_items(id),
  urgency_score REAL NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  detected_at INTEGER NOT NULL,
  resolved_at INTEGER,
  dismissed_at INTEGER,
  resolution_type TEXT               -- "responded", "done", "dismissed", "expired"
);

-- Sync state per source
CREATE TABLE sync_state (
  source_type TEXT PRIMARY KEY,
  last_checkpoint TEXT NOT NULL,      -- source-specific checkpoint format
  items_processed INTEGER DEFAULT 0,
  last_sync_at INTEGER,
  status TEXT DEFAULT 'idle',
  error_message TEXT
);

-- Entity merge audit log
CREATE TABLE merge_log (
  id TEXT PRIMARY KEY,
  surviving_entity_id TEXT NOT NULL,
  merged_entity_id TEXT NOT NULL,
  merge_reason TEXT,                  -- "email_match", "llm_resolution", "user_manual"
  confidence REAL,
  merged_at INTEGER NOT NULL,
  merged_by TEXT DEFAULT 'system',    -- "system" or "user"
  reversible BOOLEAN DEFAULT TRUE,
  original_data TEXT                   -- JSON snapshot for undo
);

-- User corrections and feedback
CREATE TABLE user_corrections (
  id TEXT PRIMARY KEY,
  correction_type TEXT NOT NULL,      -- "entity_merge", "entity_split", "topic_rename", etc.
  target_entity_id TEXT,
  correction_data TEXT,               -- JSON
  created_at INTEGER NOT NULL
);

-- Configuration
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE raw_items_fts USING fts5(
  subject, body, content=raw_items, content_rowid=rowid
);

CREATE VIRTUAL TABLE entities_fts USING fts5(
  canonical_name, aliases, content=entities, content_rowid=rowid
);
```

**Vector storage:**
- Use `sqlite-vec` extension for embedding storage and KNN search
- Store entity embeddings (1024-dim from BGE-M3) and message embeddings
- Supports cosine similarity search with ~5ms latency for 100K vectors

#### 2.3.7 Query Engine

**Three query modes:**

1. **Full-text search**: FTS5 index for keyword matching across all indexed content
2. **Semantic search**: Vector similarity search for meaning-based queries
3. **Graph traversal**: Navigate relationships to answer complex, multi-hop questions

**Natural language query pipeline:**

```
User Query → Language Detection → Query Classification → Execution Plan → Result Assembly → LLM Answer Generation
```

**Query classification** (can use local heuristics or LLM):
| Query Type | Detection Signal | Execution Strategy |
|---|---|---|
| Factual recall | "what was", "how much" | Semantic search → top results → LLM answer |
| Person context | person name present | Entity lookup → graph traversal → timeline assembly |
| Cross-reference | "who mentioned", "where did" | Semantic search across entities → aggregate |
| Pending items | "forgetting", "pending", "todo" | Attention table query → rank by urgency |
| Relationship | "how do I know" | Graph path finding between entities |
| Temporal | "last week", "in January" | Time-filtered search → chronological results |

**Response format:**
```typescript
interface QueryResponse {
  answer: string;                    // Natural language answer
  confidence: number;
  sources: SourceAttribution[];      // Links back to raw items
  relatedEntities: EntityRef[];      // For "View in graph" functionality
  suggestedFollowups?: string[];     // Optional follow-up questions
}

interface SourceAttribution {
  rawItemId: string;
  channel: string;
  sender: string;
  timestamp: Date;
  snippet: string;                   // Relevant excerpt
  highlightRange?: [number, number]; // Character range of relevant text
}
```

#### 2.3.8 Visualization Layer

**Technology choice: Web-based with D3.js**

Rationale:
- Platform-agnostic: works in any browser, Electron, iframe (MCP Apps), or Telegram WebView
- D3.js force-directed layout is mature and well-suited for the center-and-ring pattern
- Smooth animations built-in (transitions, interpolations)
- Handles 20-node rings easily without performance concerns
- Progressive disclosure is a natural fit for D3's enter/exit/update pattern

**Architecture:**

```
┌─────────────────────────────────┐
│        Visualization Shell       │
│  (Standalone / Iframe / WebView) │
├─────────────────────────────────┤
│      Rendering Engine            │
│  - D3.js force-directed layout   │
│  - SVG rendering                 │
│  - Animation controller          │
│  - Zoom/pan handler              │
├─────────────────────────────────┤
│      State Manager               │
│  - Navigation stack (breadcrumb) │
│  - Current focus entity          │
│  - Visible ring entities         │
│  - Detail panel data             │
├─────────────────────────────────┤
│      Data Fetcher                │
│  - REST API client               │
│  - WebSocket for live updates    │
│  - Local cache (IndexedDB)       │
├─────────────────────────────────┤
│      MindFlow Core API           │
│  (HTTP server on localhost)      │
└─────────────────────────────────┘
```

**Key UI behaviors:**
- **Drill-in animation**: When clicking a ring node, it smoothly transitions to center position while new ring nodes expand outward from it
- **Breadcrumb trail**: Top of the graph shows navigation path (Me > People > Wang Zong > Q3 Budget)
- **Detail panel**: Below the graph, a chronological timeline of all source items related to the focused entity. Each item shows channel icon, sender, date, and preview snippet
- **Badge system**: Numeric badges on nodes show pending items count. Pulsing animation for urgent items
- **Search overlay**: Cmd+K opens search bar for quick entity lookup or NL query
- **Keyboard navigation**: Arrow keys to move between ring nodes, Enter to drill in, Escape/Backspace to go back
- **Responsive layout**: Adapts from full-screen desktop to narrow Telegram WebView

#### 2.3.9 API Layer

The core engine exposes a REST API on a local HTTP server:

```
# Ingestion
POST   /api/v1/sync/trigger          # Manually trigger sync for all/specific sources
GET    /api/v1/sync/status            # Get sync status for all sources

# Entities
GET    /api/v1/entities               # List entities (with type, status filters)
GET    /api/v1/entities/:id           # Get entity details
GET    /api/v1/entities/:id/related   # Get first-degree connections (ring nodes)
GET    /api/v1/entities/:id/timeline  # Get chronological source items
PATCH  /api/v1/entities/:id           # Update entity (rename, merge, etc.)

# Query
POST   /api/v1/query                  # Natural language query
POST   /api/v1/search                 # Semantic/full-text search

# Attention
GET    /api/v1/attention              # Get pending/attention items
PATCH  /api/v1/attention/:id          # Resolve/dismiss attention item

# Graph navigation
GET    /api/v1/graph/root             # Get root layer (Me → categories)
GET    /api/v1/graph/node/:id         # Get node with ring connections
GET    /api/v1/graph/path/:from/:to   # Get path between two entities

# Configuration
GET    /api/v1/config                 # Get current configuration
PATCH  /api/v1/config                 # Update configuration

# Export
GET    /api/v1/export                 # Export entire knowledge graph (JSON-LD)
```

**WebSocket endpoint** for live updates:
```
WS /api/v1/ws
  → { type: "entity_updated", entity: {...} }
  → { type: "new_attention", item: {...} }
  → { type: "sync_progress", source: "gmail", progress: 0.85 }
```

### 2.4 Platform Integration Architecture

The key insight: MindFlow Core is a **library + local server**, not a plugin. Platform adapters are thin wrappers.

**OpenClaw integration:**
- Cron skill calls `POST /api/v1/sync/trigger` every 15 minutes
- Tool skill wraps `POST /api/v1/query` for natural language queries
- MCP Apps iframe loads the visualization from `http://localhost:{port}/graph`

**CLI integration:**
- Standalone binary or npm package
- `mindflow query "What did Wang Zong say about budget?"` → hits local API
- `mindflow sync` → triggers manual sync
- `mindflow status` → shows sync status and stats
- `mindflow serve` → starts the local server + opens web UI

**Telegram integration:**
- Bot receives messages → forwards to `POST /api/v1/query`
- Proactive attention items pushed via bot notifications

**Future integrations (Raycast, Alfred, Spotlight):**
- Simply wrap the local API with the platform's extension format

---

## 3. Key Design Decisions and Rationale

### D1: SQLite over Neo4j/PostgreSQL for knowledge graph

**Decision:** Use SQLite as the primary store for everything — raw items, entities, relationships, and vectors.

**Rationale:**
- Local-first: no database server to install, configure, or maintain
- Single-file portability: easy backup, sync, export
- Performance is sufficient: SQLite handles millions of rows; a personal knowledge graph won't exceed this
- sqlite-vec provides good-enough vector search for 100K-scale embeddings
- FTS5 provides good-enough full-text search
- Trade-off: graph traversal queries are less elegant than Neo4j's Cypher, but the graph is small enough that SQL JOINs work fine

**When to reconsider:** If graph traversal queries become a bottleneck (unlikely for personal-scale data).

### D2: BGE-M3 as the default embedding model

**Decision:** Use BAAI/bge-m3 for all embeddings, run locally via ONNX Runtime.

**Rationale:**
- Best-in-class multilingual support (100+ languages, excellent Chinese/English)
- 1024 dimensions — good balance of quality and storage
- Can run locally via ONNX Runtime with reasonable performance
- No API calls needed — supports the privacy-first design
- Supports dense, sparse, and ColBERT retrieval in a single model

### D3: Tiered processing instead of full LLM extraction

**Decision:** Three-tier processing (local heuristics → local embeddings → LLM extraction) with importance-based routing.

**Rationale:**
- Reduces LLM API costs by 70-80%
- Most messages (automated notifications, short confirmations, group chat noise) don't need LLM extraction
- Tier 1 and 2 are free and fast, providing instant search and basic entity linking
- Tier 3 (LLM) is reserved for messages with high information density: questions, decisions, commitments, new facts

### D4: Bi-temporal model for relationships

**Decision:** Track both event time and ingestion time on all edges, with validity intervals.

**Rationale:**
- Personal communications are inherently temporal: "Wang Zong was the PM for Project X in Q2" should not be confused with "Wang Zong is the PM for Project X"
- Enables historical queries: "What was Lisa's role as of January?"
- Handles corrections: when a previously indexed fact is contradicted by newer information, the old fact gets `valid_until` set rather than deleted
- Slightly more complex than the PRD's simpler model, but the value is significant for a system meant to be used over months/years

### D5: Core-shell architecture for platform independence

**Decision:** MindFlow Core is a standalone library/server with a REST API. All platform integrations are thin adapter shells.

**Rationale:**
- De-risks the OpenClaw dependency — if OpenClaw changes or the user stops using it, MindFlow continues to work
- Enables multiple UIs simultaneously: CLI for quick queries, web graph for exploration, Telegram for mobile
- Simplifies testing: the core can be tested independently of any platform
- Opens up future integrations without core changes

### D6: Conservative entity resolution with user feedback

**Decision:** Default to under-merging rather than over-merging. All automated merges are reversible. Ambiguous cases are flagged for user confirmation.

**Rationale:**
- Over-merging (treating two people as one) creates confusing, incorrect information that undermines trust
- Under-merging (treating one person as two) is a lesser evil — the information is still correct, just fragmented
- User corrections improve the system over time
- The merge audit log enables full reversibility

### D7: Web-based visualization with D3.js

**Decision:** Render the graph as a web application using D3.js force-directed layout, served from a local HTTP server.

**Rationale:**
- Works everywhere: browser, Electron, iframe, WebView
- D3.js is the most mature and flexible graph visualization library
- Force-directed layout naturally handles the center-and-ring pattern
- No native UI framework dependency — pure HTML/CSS/JS
- Can be progressively enhanced (add 3D with three.js later if desired)

---

## 4. Technology Recommendations

### 4.1 Runtime and Language

| Component | Technology | Rationale |
|---|---|---|
| Core engine | TypeScript (Node.js 20+) | Type safety, async I/O, broad ecosystem, OpenClaw compatibility |
| Database | SQLite3 (via `better-sqlite3`) | Synchronous API is simpler and faster for local use |
| Vector search | `sqlite-vec` extension | Integrated with SQLite, no separate process |
| Full-text search | SQLite FTS5 | Built into SQLite, supports Chinese tokenization with ICU |
| Embeddings | ONNX Runtime (`onnxruntime-node`) + BGE-M3 | Local inference, no API dependency |
| Visualization | D3.js + vanilla JS/Svelte | Lightweight, no heavy framework needed |
| Local HTTP server | Fastify | Fast, lightweight, good TypeScript support |
| Encryption | SQLCipher (optional) | Transparent encryption for SQLite |

### 4.2 LLM Providers

| Provider | Use Case | Notes |
|---|---|---|
| Claude Sonnet 4 | Primary extraction (best Chinese) | Best multilingual quality, structured output |
| GPT-4.1-mini | Cost-effective extraction | Cheaper for high-volume processing |
| Ollama (Qwen3 / Llama 3.3) | Offline extraction | For privacy-sensitive users, lower quality trade-off |
| Any OpenAI-compatible | Flexibility | Support custom endpoints (vLLM, LM Studio, etc.) |

### 4.3 Key Libraries

| Library | Purpose |
|---|---|
| `better-sqlite3` | SQLite driver (synchronous, fast) |
| `onnxruntime-node` | Local ML model inference |
| `d3` | Graph visualization |
| `chokidar` | File system watching |
| `franc` / `cld3` | Language detection |
| `pinyin-pro` | Chinese-Pinyin conversion |
| `node-imap` | IMAP email access |
| `googleapis` | Gmail API access |
| `fastify` | HTTP server |
| `ws` | WebSocket server |
| `nanoid` | ID generation |
| `zod` | Schema validation (LLM structured output) |

---

## 5. Making It Platform-Agnostic

### 5.1 Abstraction boundaries

The system has three clear abstraction boundaries:

1. **Data source boundary** (SourceAdapter interface): Isolates the core from specific data sources. Each source implements the same interface. Adding a new source never requires changing the core.

2. **LLM provider boundary** (LLMProvider interface): Isolates the processing pipeline from any specific LLM. Switching from Claude to GPT to Ollama is a configuration change, not a code change.

3. **Platform integration boundary** (REST API): The core exposes a stable REST API. Any platform can integrate by calling the API. The core never imports platform-specific code.

### 5.2 Packaging options

| Distribution | How | Target User |
|---|---|---|
| npm package | `npm install -g mindflow` | Developers, CLI users |
| OpenClaw plugin | `openclaw plugins install @mindflow/mindflow` | OpenClaw users |
| macOS app | Electron wrapper around core + web UI | Non-technical users |
| Docker container | `docker run mindflow` | Linux users, self-hosters |
| Homebrew | `brew install mindflow` | macOS users who prefer Homebrew |

### 5.3 Configuration model

All configuration stored in a single JSON file (`~/.mindflow/config.json` or platform-specific location):

```json
{
  "dataDir": "~/.mindflow/data",
  "sources": {
    "gmail": {
      "enabled": true,
      "auth": { "type": "oauth", "credentials": "..." },
      "filters": { "excludeLabels": ["Promotions", "Social"] }
    },
    "imessage": {
      "enabled": true,
      "dbPath": "~/Library/Messages/chat.db",
      "excludeContacts": ["+1234567890"]
    },
    "filesystem": {
      "enabled": true,
      "watchDirs": ["~/Documents", "~/Google Drive"],
      "fileTypes": [".md", ".txt", ".pdf"]
    }
  },
  "llm": {
    "provider": "claude",
    "model": "claude-sonnet-4-20250514",
    "apiKey": "sk-...",
    "monthlyBudget": 20.00,
    "fallbackProvider": "ollama"
  },
  "embedding": {
    "model": "bge-m3",
    "runtime": "onnx"
  },
  "processing": {
    "syncIntervalMinutes": 15,
    "tier3Threshold": 0.6,
    "batchSize": 10
  },
  "privacy": {
    "encryption": true,
    "encryptionKey": "...",
    "stripMetadataForLLM": true
  },
  "server": {
    "port": 7890,
    "host": "127.0.0.1"
  }
}
```

---

## 6. Risk Mitigations (Beyond PRD)

| Risk | Mitigation |
|---|---|
| LLM API costs spiral | Budget tracking with monthly cap, automatic throttling, tiered processing reduces volume by 70-80% |
| iMessage schema breaks | Version detection + adapter abstraction. Community monitoring of macOS betas. Graceful degradation: if decoding fails, skip with warning |
| Entity resolution errors | Conservative merging, full audit log, reversible merges, user confirmation for low-confidence matches |
| Database corruption | WAL mode for crash recovery, automatic daily backups (rotated), export to JSON-LD for portability |
| OpenClaw dependency | Core-shell architecture means MindFlow works without OpenClaw via CLI or standalone web UI |
| Privacy leak via LLM API | Metadata stripping, content-only extraction prompts, Ollama fallback for full offline mode, user controls over what gets sent |
| Topic explosion (too many topics) | Auto-merge similar topics, topic lifecycle (active → dormant → archived), configurable granularity |
| Large graph performance | SQLite scales to millions of rows, sqlite-vec handles 100K+ vectors, UI caps at 20 visible nodes per layer |

---

## 7. Open Questions — My Positions

**Q1: Graph layout algorithm?**
Start with radial/star layout (center-and-ring). It maps naturally to the progressive disclosure model and is simpler to implement. Card-based layout can be added as an alternative view later. The two are not mutually exclusive.

**Q2: LLM provider default?**
Default to Claude Sonnet (best multilingual quality for entity extraction, particularly Chinese). Provide a clear path to switch to GPT for cost-sensitive users or Ollama for privacy-sensitive users. The LLM abstraction layer makes this a configuration choice, not an architectural one.

**Q3: Notification channel?**
Start with passive (badge counts in graph UI + CLI digest command). Add push notifications (Telegram, macOS notifications) in V1.1. Proactive notifications are a double-edged sword — too many notifications train users to ignore them. Better to be conservative initially.

**Q4: Shared/team mode?**
Defer to V2. The privacy and consent implications are significant. Focus on the single-user experience first. If implemented later, use a federation model where each user controls their own graph and explicitly shares specific entities/topics with others.

**Q5: Offline LLM in MVP?**
Yes, include Ollama support in MVP. The LLM abstraction layer makes this low-cost to implement, and it removes the biggest privacy objection. Accept the quality trade-off (local models are ~80% as good for entity extraction) and document it clearly.

**Q6: iMessage attachment handling?**
MVP: index attachment metadata only (filename, type, size). V1.1: add OCR for images and text extraction from PDFs. The attachment processing pipeline is separable and can be added incrementally.

---

## 8. Implementation Priority (Revised from PRD)

### Phase 0: Foundation (Week 1-2)
- Core library scaffold with TypeScript
- SQLite database setup with schema migrations
- LLM abstraction layer with Claude and Ollama providers
- Local embedding pipeline (BGE-M3 via ONNX)
- SourceAdapter interface + Gmail adapter (IMAP first, simplest)
- Basic tiered processing pipeline
- REST API skeleton (Fastify)

### Phase 1: MVP (Week 3-6)
- iMessage adapter with version detection
- Entity extraction (LLM-powered, structured output)
- Entity resolution engine (stages 1-3)
- Knowledge graph CRUD operations
- Full-text search (FTS5) + semantic search (sqlite-vec)
- Basic NL query pipeline
- Attention/pending item detection
- Web-based graph visualization (D3.js, center-and-ring)
- CLI interface for queries and sync management
- OpenClaw plugin wrapper

### Phase 2: Polish (Week 7-10)
- Filesystem adapter for documents
- Topic clustering with HDBSCAN
- User correction UI (merge/split/rename entities)
- Improved entity resolution (Stage 4: user confirmation)
- Telegram bot integration
- Weekly digest generation
- Budget tracking and cost dashboard
- Data export (JSON-LD)

### Phase 3: Advanced (Week 11-16)
- Slack adapter
- Calendar integration
- Global search overlay (Spotlight-like)
- Multi-device sync (encrypted)
- Advanced graph views (timeline view, topic map)
- iMessage attachment text extraction
- Performance optimization and caching
