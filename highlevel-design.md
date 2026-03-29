# MindFlow — High-Level Design Document

**Version 1.0 · March 28, 2026**

*Unified consensus from Researcher 1, 2, and 3*

---

## 1. Executive Summary

MindFlow is a **platform-agnostic, local-first knowledge engine** that continuously indexes personal communications (email, iMessage, documents) into a unified, searchable knowledge graph. It extracts entities (people, topics, action items, key facts, documents, threads), builds a bi-temporal knowledge graph with cross-channel linking, and exposes a layered visual interface for exploration and natural language query.

**Key architectural principle**: MindFlow Core is a standalone library/service. Platform integrations (OpenClaw, CLI, Telegram, web app) are thin adapter shells. The core has zero platform dependencies.

---

## 2. Architecture Overview

### 2.1 Three-Layer Architecture

```
+-----------------------------------------------------------+
|              Platform Adapters (Shells)                     |
|  ┌──────────┐ ┌──────┐ ┌──────────┐ ┌────────────────┐   |
|  │ OpenClaw │ │ CLI  │ │ Web App  │ │ Telegram Bot   │   |
|  │ Plugin   │ │      │ │(Fastify) │ │                │   |
|  └────┬─────┘ └──┬───┘ └────┬─────┘ └──────┬─────────┘   |
|       └──────────┴──────────┴──────────────┘               |
|                         │                                   |
|                  MindFlow Public API                        |
+─────────────────────────┼───────────────────────────────────+
                          │
+─────────────────────────┼───────────────────────────────────+
|                MindFlow Core Engine                          |
|                                                              |
|  ┌────────────────────────────────────────────────────────┐ |
|  │ Ingestion Layer          │ Processing Pipeline         │ |
|  │ · Source Adapter Registry│ · Tiered Extraction         │ |
|  │ · Scheduler / Cron       │   (Rules→NER→LLM)          │ |
|  │ · Checkpoint Manager     │ · Entity Resolution (4-stage)│|
|  │ · Job Queue (SQLite)     │ · Embedding Generator       │ |
|  │                          │ · Topic Clustering (HDBSCAN) │ |
|  │                          │ · Attention Detector         │ |
|  ├────────────────────────────────────────────────────────┤ |
|  │ Knowledge Graph                                        │ |
|  │ · Entity Store (6 types) │ · Bi-temporal Relationships │ |
|  │ · Community Layer         │ · Episode Layer             │ |
|  ├────────────────────────────────────────────────────────┤ |
|  │ Query Engine                                           │ |
|  │ · NL Query Parser        │ · Graph Traversal           │ |
|  │ · Semantic Search         │ · Attention Surface         │ |
|  ├────────────────────────────────────────────────────────┤ |
|  │ Event Bus                                              │ |
|  │ · Typed events (items:ingested, entity:created, etc.)  │ |
|  │ · Adapters subscribe to events for real-time updates   │ |
|  └────────────────────────────────────────────────────────┘ |
|                          │                                   |
+──────────────────────────┼───────────────────────────────────+
                           │
+──────────────────────────┼───────────────────────────────────+
|                  Storage Layer                                |
|  ┌──────────┐  ┌──────────────┐  ┌────────────────────┐     |
|  │  SQLite  │  │  sqlite-vec  │  │   FTS5 Index       │     |
|  │  (core)  │  │  (vectors)   │  │   (full-text)      │     |
|  └──────────┘  └──────────────┘  └────────────────────┘     |
|  Single-file database · better-sqlite3 · abstracted for     |
|  future libSQL swap                                          |
+──────────────────────────────────────────────────────────────+
```

### 2.2 Design Principles

1. **Core-shell separation**: Core engine has zero platform dependencies. Platform integrations are thin adapters.
2. **Local-first**: All data stored locally. No cloud sync (V1). LLM API calls send content only, no metadata or identity.
3. **LLM-provider agnostic**: Supports Claude (cloud default), OpenAI, Ollama (local). Configurable per operation type.
4. **Event-driven**: Core emits typed events; adapters subscribe. Enables real-time UI updates and multi-adapter support.
5. **CLI-first development**: Build CLI adapter before OpenClaw plugin to force clean API separation.
6. **Progressive processing**: Tiered extraction minimizes LLM costs — only high-value messages get expensive processing.

---

## 3. Knowledge Graph Design

### 3.1 Three-Layer Graph Model

The knowledge graph is organized into three layers inspired by Graphiti/Zep:

| Layer | Contents | Purpose |
|-------|----------|---------|
| **Episode Layer** | Raw ingested items (messages, emails, documents) | Source of truth, immutable record |
| **Entity Layer** | Extracted entities and relationships | Structured knowledge, queryable |
| **Community Layer** | Auto-detected clusters via HDBSCAN | High-level navigation, trend detection |

### 3.2 Entity Types (6 types)

| Entity Type | Key Attributes | Example |
|-------------|---------------|---------|
| **Person** | name, aliases, email, phone, org, role | Wang Zong — CEO, Partner Corp |
| **Topic** | title, status (active/dormant/archived), first/last mention | Q3 Budget — active since Feb 12 |
| **ActionItem** | description, owner, due date, status, source | Submit revised quote by Friday |
| **KeyFact** | statement, source, date, confidence | Vendor B quote: $42K/yr |
| **Document** | title, type, path, last modified | Design spec v3.pdf |
| **Thread** | source, channel, subject, participants, message count, temporal span | Email thread: "Re: Q3 Budget Discussion" |

**Thread** (added by consensus): The natural intermediate grouping between individual messages and topics. Enables cross-channel linking ("same conversation continued in iMessage") and thread-level summarization.

### 3.3 Bi-Temporal Relationship Model

Every relationship edge carries four timestamps:

| Field | Type | Purpose |
|-------|------|---------|
| `event_time` | INTEGER | When the relationship was observed in the real world |
| `ingestion_time` | INTEGER | When MindFlow learned about it |
| `valid_from` | INTEGER (nullable) | Start of validity period |
| `valid_until` | INTEGER (nullable) | End of validity period (NULL = still valid) |

Additional edge attributes: `strength` (0.0-1.0, decays without reinforcement), `occurrence_count`, `source_item_ids` (evidence items).

This enables temporal queries like "What was Wang Zong's role as of January?" and supports fact correction (superseded facts get `valid_until` set rather than being deleted, preserving history).

**Relationship types:**

| Relationship | From → To | Meaning |
|---|---|---|
| discusses | Person → Topic | Person has discussed this topic |
| communicates_with | Person → Person | Two people communicate |
| assigned_to | ActionItem → Person | Action item owned by person |
| requested_by | ActionItem → Person | Action item requested by person |
| related_to | Topic → Document | Document relates to topic |
| part_of | Thread → Topic | Thread is part of a topic |
| participates_in | Person → Thread | Person is in this thread |
| continues_in | Thread → Thread | Cross-channel thread continuation |
| member_of | Entity → Community | Entity belongs to community |

### 3.4 Entity Resolution (4-Stage Pipeline)

| Stage | Method | Merge Confidence |
|-------|--------|-----------------|
| **1. Deterministic** | Email address, phone number exact match | Auto-merge |
| **2. Probabilistic** | Name similarity (multilingual fuzzy + Pinyin), co-occurrence patterns | Auto-merge if score > threshold |
| **3. LLM-Assisted** | Batch LLM calls with context for ambiguous cases | Auto-merge with human-reviewable flag |
| **4. User Confirmation** | UI prompt for remaining uncertain merges | Manual |

**Confidence thresholds:**
- Score >= 0.90: Auto-merge (high confidence)
- Score 0.70-0.89: Suggest merge, require user confirmation
- Score < 0.70: Keep separate

**Chinese-English name resolution specifics:**
1. Chinese characters → Pinyin conversion via `pinyin-pro` (e.g., "王总" → "wáng zǒng")
2. Compare Pinyin against Latin name components (Jaro-Winkler distance, threshold 0.80)
3. Email local-part as strong signal ("wang.zong" maps to "王总" via Pinyin)
4. LLM tiebreaker for ambiguous cases — provide both names + context

**Conservative by default**: Prefer under-merging over over-merging. Never auto-merge without at least one deterministic signal. Every merge is recorded with full provenance and is reversible (undo/split).

### 3.5 Merge Provenance and Undo

Every entity merge is recorded in a `merge_audit` table:

- `merge_id`, `source_entity_id`, `target_entity_id`, `merge_method`, `confidence`, `timestamp`, `undone_at`
- Undo operation: restores the original entities and re-links all relationships
- User corrections tracked in a dedicated `user_corrections` table for feedback learning

### 3.6 Topic Clustering

- **Algorithm**: HDBSCAN on message embeddings for density-based clustering
- **Topic labeling**: LLM generates human-readable topic names
- **Drift detection**: When a topic's centroid shifts significantly, the system detects topic drift and may auto-split
- **Lifecycle**: Active → Dormant (14 days inactive) → Archived (60 days)
- **User corrections**: Users can rename, merge, or split topics; corrections feed back into the model

### 3.7 Community Layer

Auto-detected clusters of related entities using community detection algorithms:
- Groups people who frequently communicate about related topics
- Provides high-level navigation anchors (e.g., "Partner Corp team", "Q3 Budget stakeholders")
- Updated periodically as new data arrives

---

## 4. Data Flow

```
1. INGEST
   Source Adapter → fetch new items since checkpoint → raw_items table
   ↓
2. QUEUE
   New items added to SQLite-backed job queue with priority scoring
   ↓
3. TRIAGE (Tier 1 — Rules, ~30% coverage)
   Rule-based extraction: emails, phone numbers, dates, URLs
   → Cheap, instant, no LLM needed
   ↓
4. LOCAL NER (Tier 2 — ONNX Runtime)
   Named entity recognition: names, organizations, locations
   Embedding generation: BGE-M3 via ONNX Runtime (Core ML on macOS)
   → No API dependency
   ↓
5. LLM EXTRACTION (Tier 3 — high-value items only)
   Action items, key facts, topic classification, relationship inference
   → Content-aware privacy routing decides local vs. cloud LLM
   → Monthly budget cap with automatic throttling
   ↓
6. RESOLVE & LINK
   4-stage entity resolution → merge/link entities across channels
   Cross-channel thread linking
   ↓
7. CLUSTER
   HDBSCAN topic clustering → community detection → community layer update
   ↓
8. ATTENTION
   Pending item detector: unanswered requests, overdue items, stale conversations
   Urgency scoring and attention surface update
   ↓
9. EMIT EVENTS
   Core emits typed events → adapters update UI / send notifications

Note: Items become queryable immediately as processed (incremental availability).
Users can start exploring while the initial historical scan continues in the background.
```

---

<!-- SECTION: Storage Layer — researcher-2 -->
## 5. Storage Layer

### 5.1 Technology Stack

- **SQLite** as the single-file database (via `better-sqlite3`)
- **sqlite-vec** for vector similarity search
- **FTS5** for full-text search
- **Typed raw SQL** with numbered migration files (no ORM)
- Storage layer abstracted behind an interface for future libSQL swap

### 5.2 Core Database Schema

All tables live in a single SQLite database file (`~/.mindflow/data/mindflow.db` or platform-configurable path). IDs use ULIDs for time-sortable uniqueness. Timestamps are Unix epoch integers.

#### raw_items — Immutable source records

```sql
CREATE TABLE raw_items (
  id TEXT PRIMARY KEY,                    -- ULID
  source_adapter TEXT NOT NULL,           -- "gmail", "imessage", "filesystem"
  channel TEXT NOT NULL,                  -- "email", "imessage", "file"
  external_id TEXT NOT NULL,              -- unique ID within source
  thread_id TEXT,                         -- source-native thread grouping
  sender_entity_id TEXT REFERENCES entities(id),
  recipient_entity_ids TEXT,              -- JSON array of entity IDs
  subject TEXT,
  body TEXT NOT NULL,
  body_format TEXT DEFAULT 'plaintext',   -- "plaintext", "html", "markdown"
  content_hash TEXT NOT NULL UNIQUE,      -- SHA-256 for dedup
  language TEXT,                          -- detected: "en", "zh", "mixed"
  event_time INTEGER NOT NULL,            -- when it happened
  ingested_at INTEGER NOT NULL,           -- when MindFlow processed it
  processing_status TEXT DEFAULT 'pending', -- pending/tier1/tier2/tier3/done
  attachments TEXT,                       -- JSON array of {filename, type, size, path}
  metadata TEXT                           -- JSON: source-specific data
);
```

#### entities — Extracted knowledge objects (6 types)

```sql
CREATE TABLE entities (
  id TEXT PRIMARY KEY,                    -- ULID
  type TEXT NOT NULL CHECK(type IN (
    'person','topic','action_item','key_fact','document','thread'
  )),
  canonical_name TEXT NOT NULL,
  name_alt TEXT,                          -- cross-lingual alternative
  aliases TEXT,                           -- JSON array of all known names
  attributes TEXT,                        -- JSON: type-specific attributes
  confidence REAL DEFAULT 1.0,           -- entity extraction confidence
  status TEXT DEFAULT 'active' CHECK(status IN (
    'active','dormant','archived','merged'
  )),
  merged_into TEXT REFERENCES entities(id), -- points to surviving entity if merged
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

#### relationships — Bi-temporal edges

```sql
CREATE TABLE relationships (
  id TEXT PRIMARY KEY,                    -- ULID
  from_entity_id TEXT NOT NULL REFERENCES entities(id),
  to_entity_id TEXT NOT NULL REFERENCES entities(id),
  type TEXT NOT NULL,                     -- "discusses", "assigned_to", "related_to",
                                          -- "continues_in", "communicates_with", etc.
  strength REAL DEFAULT 0.5,             -- computed relationship weight
  event_time INTEGER,                    -- when observed in real world
  ingestion_time INTEGER NOT NULL,       -- when MindFlow learned about it
  valid_from INTEGER,                    -- start of validity (nullable)
  valid_until INTEGER,                   -- end of validity (NULL = still valid)
  occurrence_count INTEGER DEFAULT 1,
  source_item_ids TEXT,                  -- JSON array of raw_item IDs
  metadata TEXT                          -- JSON: edge-specific data
);
```

#### entity_episodes — Junction table linking entities to source items

```sql
CREATE TABLE entity_episodes (
  entity_id TEXT NOT NULL REFERENCES entities(id),
  raw_item_id TEXT NOT NULL REFERENCES raw_items(id),
  extraction_method TEXT,                -- "tier1_rules", "tier2_ner", "tier3_llm"
  confidence REAL DEFAULT 1.0,
  PRIMARY KEY (entity_id, raw_item_id)
);
```

#### threads — First-class conversation grouping

```sql
CREATE TABLE threads (
  id TEXT PRIMARY KEY,                   -- ULID (this is also the entities.id for type='thread')
  source_adapter TEXT NOT NULL,
  channel TEXT NOT NULL,
  external_thread_id TEXT,               -- source-native thread ID
  subject TEXT,
  participant_entity_ids TEXT,           -- JSON array of person entity IDs
  first_message_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL,
  message_count INTEGER DEFAULT 0,
  summary TEXT,                          -- LLM-generated thread summary
  status TEXT DEFAULT 'active'
);
```

#### entity_aliases — For entity resolution lookups

```sql
CREATE TABLE entity_aliases (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  alias TEXT NOT NULL,                   -- "王总", "wang.zong@partner.com", "+1234567890"
  alias_type TEXT NOT NULL,              -- "name", "email", "phone", "handle"
  confidence REAL DEFAULT 1.0
);
```

#### communities — Auto-detected entity clusters

```sql
CREATE TABLE communities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                    -- LLM-generated label
  description TEXT,
  member_entity_ids TEXT,                -- JSON array
  centroid_embedding BLOB,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

#### attention_items — Proactive attention surface

```sql
CREATE TABLE attention_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN (
    'unanswered_request','approaching_deadline','unreviewed_document',
    'stale_conversation','repeated_mentions'
  )),
  entity_id TEXT REFERENCES entities(id),
  raw_item_id TEXT REFERENCES raw_items(id),
  urgency_score REAL NOT NULL DEFAULT 0.5,
  title TEXT NOT NULL,
  description TEXT,
  detected_at INTEGER NOT NULL,
  resolved_at INTEGER,
  dismissed_at INTEGER,
  snoozed_until INTEGER,
  resolution_type TEXT                   -- "responded", "done", "dismissed", "expired"
);
```

#### merge_audit — Entity merge provenance for undo

```sql
CREATE TABLE merge_audit (
  id TEXT PRIMARY KEY,
  surviving_entity_id TEXT NOT NULL,
  merged_entity_id TEXT NOT NULL,
  merge_method TEXT NOT NULL,            -- "email_match", "phone_match", "name_similarity",
                                          -- "llm_resolution", "user_manual"
  confidence REAL,
  merged_at INTEGER NOT NULL,
  merged_by TEXT DEFAULT 'system',       -- "system" or "user"
  pre_merge_snapshot TEXT,               -- JSON snapshot for undo
  undone_at INTEGER                      -- NULL unless reversed
);
```

#### user_corrections — Feedback for learning

```sql
CREATE TABLE user_corrections (
  id TEXT PRIMARY KEY,
  correction_type TEXT NOT NULL,         -- "entity_merge", "entity_split", "topic_rename",
                                          -- "topic_merge", "entity_update"
  target_entity_id TEXT,
  correction_data TEXT,                  -- JSON: what was changed
  created_at INTEGER NOT NULL
);
```

#### job_queue — Processing pipeline queue with retry

```sql
CREATE TABLE job_queue (
  id TEXT PRIMARY KEY,
  raw_item_id TEXT REFERENCES raw_items(id),
  stage TEXT NOT NULL,                   -- "triage", "ner", "llm_extract", "resolve", "embed", "link"
  status TEXT DEFAULT 'pending' CHECK(status IN (
    'pending','processing','completed','failed','skipped'
  )),
  priority REAL DEFAULT 0.5,            -- importance score for processing order
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER
);
```

#### sync_state — Per-source checkpoint tracking

```sql
CREATE TABLE sync_state (
  source_adapter TEXT PRIMARY KEY,
  last_checkpoint TEXT NOT NULL,         -- JSON: adapter-specific checkpoint data
  last_sync_at INTEGER NOT NULL,
  items_processed INTEGER DEFAULT 0,
  status TEXT DEFAULT 'idle',            -- "idle", "syncing", "error"
  error_message TEXT,
  config TEXT                            -- JSON: adapter configuration
);
```

#### config — Application configuration

```sql
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

#### Full-text search virtual tables

```sql
CREATE VIRTUAL TABLE raw_items_fts USING fts5(
  subject, body, content=raw_items, content_rowid=rowid,
  tokenize='unicode61'
);

CREATE VIRTUAL TABLE entities_fts USING fts5(
  canonical_name, name_alt, aliases,
  content=entities, content_rowid=rowid,
  tokenize='unicode61'
);
```

#### Schema migrations

Migrations are plain SQL files in a `migrations/` directory, applied in order:

```
migrations/
  001_initial_schema.sql
  002_add_threads.sql
  003_add_communities.sql
  ...
```

A `schema_version` table tracks which migrations have been applied:

```sql
CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  filename TEXT NOT NULL
);
```

### 5.3 Query Optimization

#### Index Strategy

```sql
-- Entity lookups
CREATE INDEX idx_entities_type_status ON entities(type, status);
CREATE INDEX idx_entities_name ON entities(canonical_name COLLATE NOCASE);
CREATE INDEX idx_entities_last_seen ON entities(last_seen_at DESC);

-- Relationship traversal (the most critical indexes)
CREATE INDEX idx_rel_from ON relationships(from_entity_id, type);
CREATE INDEX idx_rel_to ON relationships(to_entity_id, type);
CREATE INDEX idx_rel_temporal ON relationships(valid_until, last_seen DESC)
  WHERE valid_until IS NULL;  -- partial index for active relationships only

-- Raw item queries
CREATE INDEX idx_raw_items_timestamp ON raw_items(event_time DESC);
CREATE INDEX idx_raw_items_sender ON raw_items(sender_entity_id, event_time DESC);
CREATE INDEX idx_raw_items_thread ON raw_items(thread_id);
CREATE INDEX idx_raw_items_hash ON raw_items(content_hash);
CREATE INDEX idx_raw_items_source ON raw_items(source_adapter, event_time DESC);
CREATE INDEX idx_raw_items_status ON raw_items(processing_status)
  WHERE processing_status != 'done';  -- partial index for unprocessed items

-- Entity resolution
CREATE INDEX idx_aliases_alias ON entity_aliases(alias COLLATE NOCASE);
CREATE INDEX idx_aliases_entity ON entity_aliases(entity_id);

-- Attention surface
CREATE INDEX idx_attention_active ON attention_items(urgency_score DESC)
  WHERE resolved_at IS NULL AND dismissed_at IS NULL;

-- Job queue processing order
CREATE INDEX idx_jobs_pending ON job_queue(priority DESC, created_at)
  WHERE status IN ('pending', 'failed');
```

#### Graph Traversal with Recursive CTEs

For 1-2 hop traversals (the common case in MindFlow's center-ring UI), recursive CTEs perform well at personal scale:

```sql
-- Get all entities connected to a center node (1 hop, for ring display)
SELECT e.*, r.type AS rel_type, r.strength
FROM relationships r
JOIN entities e ON e.id = r.to_entity_id
WHERE r.from_entity_id = :center_id
  AND r.valid_until IS NULL          -- only active relationships
  AND e.status = 'active'
ORDER BY r.strength DESC, e.last_seen_at DESC
LIMIT 20;                            -- max 20 nodes per ring

-- Multi-hop traversal (e.g., "find all people connected to Topic X")
WITH RECURSIVE connected(entity_id, depth, path) AS (
  SELECT to_entity_id, 1, from_entity_id || ',' || to_entity_id
  FROM relationships
  WHERE from_entity_id = :start_id AND valid_until IS NULL
  UNION ALL
  SELECT r.to_entity_id, c.depth + 1,
         c.path || ',' || r.to_entity_id
  FROM relationships r
  JOIN connected c ON r.from_entity_id = c.entity_id
  WHERE c.depth < :max_depth
    AND r.valid_until IS NULL
    AND c.path NOT LIKE '%' || r.to_entity_id || '%'  -- cycle prevention
)
SELECT DISTINCT e.*
FROM connected c
JOIN entities e ON e.id = c.entity_id
WHERE e.status = 'active';
```

At <100K entities with proper indexes, these queries complete in <50ms.

#### Vector Search with sqlite-vec

sqlite-vec provides brute-force KNN search, which is sufficient for <1M vectors:

```sql
-- Semantic search: find items similar to a query embedding
SELECT ri.id, ri.subject, ri.body, ri.event_time,
       vec_distance_cosine(ri.embedding, :query_vec) AS distance
FROM raw_items ri
WHERE ri.embedding IS NOT NULL
ORDER BY distance ASC
LIMIT 20;
```

Embeddings are stored as BLOB columns using sqlite-vec's vector type. At 1024 dimensions (BGE-M3) with float32, each embedding is ~4KB. For 100K items, the embedding data is ~400MB.

**Quantization option**: sqlite-vec supports INT8 quantization, halving storage to ~2KB per vector with minimal quality loss. Recommended for deployments exceeding 200K items.

#### Hybrid Search (FTS5 + Vector + Graph)

The query engine combines three retrieval strategies using Reciprocal Rank Fusion (RRF):

```
final_score = Σ(1 / (k + rank_i))  for each retrieval strategy i
```

Where `k = 60` (standard RRF constant) and `rank_i` is the item's rank in each strategy's result set:

1. **FTS5** — keyword matches (high precision for exact terms, names, numbers)
2. **Vector** — semantic matches (handles paraphrasing, cross-lingual queries)
3. **Graph** — relationship-based results (e.g., "all topics discussed with Person X")

Results are further weighted by recency (exponential decay, half-life 30 days) and relationship strength to the query context.

#### FTS5 Configuration

```sql
-- Unicode61 tokenizer handles CJK characters via Unicode segmentation
-- This provides reasonable Chinese tokenization without a custom tokenizer
CREATE VIRTUAL TABLE raw_items_fts USING fts5(
  subject, body,
  content=raw_items,
  content_rowid=rowid,
  tokenize='unicode61 remove_diacritics 2'
);
```

**Note on CJK tokenization**: FTS5's `unicode61` tokenizer segments Chinese text by Unicode word boundaries, which works reasonably well for most queries. For higher-quality Chinese search, a custom tokenizer using `jieba` segmentation could be added as a V1.1 enhancement.

---

<!-- SECTION: Extraction Pipeline — researcher-2 -->
## 6. Extraction Pipeline

### 6.1 Tiered Processing Model

The extraction pipeline processes each ingested item through up to three tiers, each adding cost but also value. Items that fail importance filtering after Tier 1 skip Tier 3 (LLM) but still get Tier 1 (rules) and Tier 2 (NER/embeddings).

#### Tier 1 — Rule-Based Extraction (free, instant, ~30% of entity extraction)

Runs on every item. No external dependencies.

| What it extracts | Method |
|-----------------|--------|
| Email addresses | Regex pattern matching |
| Phone numbers | Regex + E.164 normalization |
| URLs | Regex + domain extraction |
| Dates and deadlines | Regex + `chrono` date parser (handles "next Friday", "3月15日") |
| Monetary amounts | Regex for "$42K", "42万", "€1,200" patterns |
| Sender/recipient identity | From message metadata (headers, handle table) |
| Thread grouping | From `In-Reply-To`/`References` headers (email) or conversation ID (iMessage) |
| Language detection | `franc` library (fast, supports 100+ languages) |
| Content deduplication | SHA-256 content hash comparison |

**Importance scoring** (determines whether Tier 3 runs):

```typescript
function computeImportance(item: RawItem, tier1Results: Tier1Result): number {
  let score = 0.0;
  // Length signal: very short or very long messages are often low-value
  if (item.body.length > 50 && item.body.length < 5000) score += 0.2;
  // Question detection: contains "?", "吗", "呢"
  if (/[?？]|吗|呢|能不能|可以/.test(item.body)) score += 0.3;
  // Deadline/commitment language
  if (/deadline|by\s+(monday|friday|end of)|之前|截止/.test(item.body)) score += 0.3;
  // Monetary values detected
  if (tier1Results.monetaryAmounts.length > 0) score += 0.2;
  // Sender frequency (frequent contacts are higher value)
  score += Math.min(0.2, senderFrequency(item.sender) * 0.02);
  // Penalize automated messages
  if (isAutomatedMessage(item)) score -= 0.5;
  return Math.max(0, Math.min(1, score));
}
```

Items with `importance >= 0.4` proceed to Tier 3. All items get Tier 2.

#### Tier 2 — Local NER and Embeddings (free, fast, ~30% of entity extraction)

Runs on every item. Uses ONNX Runtime locally.

| What it extracts | Method |
|-----------------|--------|
| Person names (English) | ONNX NER model (BERT-base multilingual) |
| Person names (Chinese) | Same ONNX NER model + Pinyin conversion for cross-lingual matching |
| Organization names | Same NER model |
| Location names | Same NER model |
| Semantic embeddings | BGE-M3 via ONNX Runtime (1024-dim) |
| Semantic grouping | Embedding similarity for topic cluster assignment |

**NER model selection**: A single `bert-base-multilingual-cased` model fine-tuned for NER handles both English and Chinese entity recognition. Running via ONNX Runtime with Core ML backend on macOS, inference is ~20ms per item.

**Embedding generation**: BGE-M3 via ONNX Runtime. ~40ms per item on Apple Silicon. Embeddings are stored in the `raw_items` table and the `entities` table for both item-level and entity-level semantic search.

#### Tier 3 — LLM Extraction (costs money, high value, ~30% of entity extraction)

Runs only on items passing the importance threshold. Uses the configured LLM provider.

| What it extracts | Method |
|-----------------|--------|
| Action items with direction | Structured output: "Submit quote by Friday" (outbound) |
| Key facts with confidence | Structured output: "Vendor B quote: $42K/yr" (confidence: 0.9) |
| Topic classification | Assign to existing topic or create new one |
| Relationship inference | "Wang Zong is Lisa's manager" |
| Sentiment and intent | Classification: request, inform, question, commitment |
| Thread summary | 1-2 sentence summary of the conversation |

**Structured output schema** (sent to LLM):

```typescript
interface LLMExtractionResult {
  action_items: Array<{
    description: string;
    owner?: string;
    due_date?: string;
    direction: 'inbound' | 'outbound';  // requested of me, or I requested
  }>;
  key_facts: Array<{
    statement: string;
    confidence: number;                  // 0.0 - 1.0
    supersedes?: string;                 // previous fact this corrects
  }>;
  topics: Array<{
    title: string;
    title_alt?: string;                  // cross-lingual alternative
    status: 'active' | 'mentioned';
  }>;
  relationships: Array<{
    person_a: string;
    person_b: string;
    relationship: string;                // "manages", "reports_to", "introduced_by"
  }>;
  sentiment: 'positive' | 'neutral' | 'negative';
  summary: string;
}
```

**Batching**: Group 5-10 related messages (same thread or same sender within 24h) into a single LLM call to reduce API overhead and improve context for extraction.

#### Cost Model

| Scenario | Tier 1 | Tier 2 | Tier 3 | Total |
|----------|--------|--------|--------|-------|
| Initial scan (60K items) | $0 | $0 (local) | ~$15-25 (40% pass importance filter, batched) | ~$15-25 |
| Monthly ongoing (3K items) | $0 | $0 (local) | ~$3-5 | ~$3-5 |
| No API key mode | $0 | $0 | $0 | $0 (reduced quality) |

**Budget enforcement**: A monthly cap (default: $20) is tracked in the `config` table. When 80% of budget is consumed, the system logs a warning. At 100%, Tier 3 falls back to Ollama (local) automatically.

### 6.2 Thread Detection and Linking

Threads are the intermediate grouping between individual messages and topics. Each thread is both a row in the `threads` table and an entity of type `thread` in the `entities` table.

#### Per-Source Thread Detection

**Email (Gmail/IMAP)**:
- Primary signal: `In-Reply-To` and `References` headers form a deterministic thread chain
- Secondary signal: Gmail API `threadId` groups messages in the same conversation
- Fallback: Subject line matching with `Re:`/`Fwd:` prefix stripping + temporal proximity

**iMessage**:
- Primary signal: `chat.db` groups messages by `chat_id` (conversation identifier)
- Each `chat_id` maps to a conversation with one or more participants
- Thread boundaries within a conversation are detected by temporal gaps (>4 hours of silence starts a new logical thread)

**Documents/Files**:
- Documents are not threaded. Each document is a standalone item.
- Version detection: if two documents share a filename pattern (e.g., `spec_v2.pdf`, `spec_v3.pdf`), they are linked via a `version_of` relationship.

#### Thread Entity Creation

When a thread is detected, the system:

1. Creates or updates a row in the `threads` table with participants, timestamps, and message count
2. Creates a corresponding entity of type `thread` in the `entities` table
3. Links the thread entity to participant `person` entities via `participates_in` relationships
4. Links the thread entity to relevant `topic` entities via `discusses` relationships (after Tier 3 extraction)
5. Updates the thread `summary` field periodically (when thread grows beyond 5 messages, or on first access)

#### Cross-Channel Thread Linking

When the same conversation continues across channels (e.g., email thread about "Q3 budget" followed by iMessage messages about the same topic), the system detects this via:

1. **Temporal proximity**: Messages within 2 hours across channels between the same participants
2. **Semantic similarity**: Embedding cosine similarity > 0.75 between the last email message and the first iMessage
3. **Entity overlap**: Same person + same topic entities present in both threads
4. **Explicit references**: "As I mentioned in my email..." or "刚才邮件里说的..." detected by LLM

When a cross-channel link is detected, the two threads remain separate entities (preserving source fidelity), but are connected via a `continues_in` relationship edge:

```sql
INSERT INTO relationships (id, from_entity_id, to_entity_id, type, strength, ...)
VALUES (:id, :email_thread_id, :imessage_thread_id, 'continues_in', 0.85, ...);
```

The query engine follows `continues_in` edges to present a unified cross-channel timeline when the user drills into a thread.

### 6.3 LLM Provider Abstraction

The LLM dependency is abstracted behind a provider interface so that providers can be swapped, combined, or upgraded without changing core logic.

#### Provider Interface

```typescript
interface LLMProvider {
  id: string;                            // "claude", "openai", "ollama"
  name: string;

  // Structured extraction (entity extraction, intent classification)
  extract<T>(
    prompt: string,
    schema: JSONSchema,                  // for structured output
    options?: LLMOptions
  ): Promise<T>;

  // Free-form generation (query answer synthesis, thread summarization)
  generate(
    prompt: string,
    options?: LLMOptions
  ): Promise<string>;

  // Provider health and availability
  isAvailable(): Promise<boolean>;
  estimateCost(inputTokens: number, outputTokens: number): number;
}

interface LLMOptions {
  temperature?: number;                  // default: 0.1 for extraction, 0.3 for synthesis
  maxTokens?: number;
  timeout?: number;                      // ms
}
```

#### Supported Providers

| Provider | Implementation | Best For | Cost |
|----------|---------------|----------|------|
| **ClaudeProvider** | `@anthropic-ai/sdk` | Entity extraction (best Chinese), answer synthesis | ~$3/M input tokens (Sonnet) |
| **OpenAIProvider** | `openai` SDK | Batch extraction, cost-sensitive processing | ~$1.25/M input tokens (GPT-4.1-mini) |
| **OllamaProvider** | HTTP API to local Ollama | Privacy-sensitive content, offline mode, zero cost | Free (local compute) |

#### Per-Operation Configuration

Different operations can use different providers:

```typescript
interface LLMConfig {
  extraction: {
    provider: string;                    // default: "claude"
    model: string;                       // default: "claude-sonnet-4-6"
    fallback?: string;                   // default: "ollama" (when budget exhausted)
  };
  synthesis: {
    provider: string;                    // default: "claude"
    model: string;
  };
  resolution: {
    provider: string;                    // default: "claude" (needs best quality)
    model: string;
  };
  summarization: {
    provider: string;                    // default: "ollama" (high volume, lower stakes)
    model: string;                       // default: "qwen2.5:7b"
  };
}
```

This allows cost optimization: use Claude for high-value extraction and entity resolution, Ollama for routine summarization, and GPT-4.1-mini for batch processing during initial scan.

#### Fallback Chain

When a provider is unavailable (API down, budget exhausted, offline), the system falls through a configurable chain:

```
Claude → OpenAI → Ollama → Skip (queue for later)
```

If no LLM is available, the item remains at Tier 2 processing status. Tier 1 (rules) and Tier 2 (NER/embeddings) still work, so the item is searchable — it just lacks semantic extraction.

---

## 7. Platform Abstraction Layer

### 7.1 Source Adapter Interface

Each data source is a self-contained adapter implementing a common interface. Adding a new source requires only implementing this interface — no core engine modifications.

```typescript
interface SourceAdapter {
  readonly id: string;                    // "gmail", "imessage", "filesystem"
  readonly name: string;
  readonly capabilities: AdapterCapabilities;

  isAvailable(): Promise<boolean>;        // e.g., iMessage returns false on Linux
  configure(config: AdapterConfig): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  fetchSince(checkpoint: Checkpoint): AsyncIterable<RawItem>;
  getCheckpoint(): Promise<Checkpoint>;
  healthCheck(): Promise<HealthStatus>;
  watch?(callback: (item: RawItem) => void): Unsubscribe;  // optional real-time
}
```

Adapters are registered explicitly at configuration time:

```typescript
const engine = new MindFlowEngine(config);
engine.registerSource(new GmailAdapter(gmailConfig));
engine.registerSource(new IMessageAdapter());
engine.registerSource(new FilesystemAdapter(fsConfig));
```

**MVP adapters**: Gmail (IMAP), iMessage (SQLite `chat.db`), Filesystem (chokidar)
**V1.1**: Slack, Calendar, Meeting Notes | **Future**: WeChat, Voice Memos, Notion

### 7.2 Integration Adapter Interface

Each platform integration implements a thin adapter that translates platform-specific calls into Core Engine API calls:

```typescript
interface IntegrationAdapter {
  readonly id: string;
  readonly type: 'cli' | 'plugin' | 'http' | 'bot';

  initialize(engine: MindFlowEngine): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}
```

| Adapter | Maps Platform Calls To | Data Location |
|---------|----------------------|---------------|
| **OpenClaw** | Cron -> `triggerSync()`, Tool -> `query()`, MCP Apps -> graph UI | `~/.openclaw/mindflow/` |
| **CLI** | `sync`, `query`, `status`, `serve`, `export` commands | `~/.mindflow/` |
| **HTTP + Web UI** | REST + WebSocket endpoints, serves Cytoscape SPA | `~/.mindflow/` |
| **Telegram** | Bot messages -> `query()`, daily digest -> `getAttentionItems()` | Shared with HTTP |

### 7.3 Event System

The core engine emits typed events. Adapters subscribe — no polling required.

```typescript
type MindFlowEvent =
  | 'items:ingested'      // { count, sourceType }
  | 'items:processed'     // { itemId, entities[] }
  | 'entity:created'      // { entity }
  | 'entity:updated'      // { entity, changes }
  | 'entity:merged'       // { surviving, merged }
  | 'attention:new'       // { attentionItem }
  | 'attention:resolved'  // { itemId }
  | 'sync:started'        // { sourceType }
  | 'sync:completed'      // { sourceType, stats }
  | 'sync:error'          // { sourceType, error }
```

Usage in adapters:

```typescript
engine.on('attention:new', (item) => {
  telegramBot.sendMessage(chatId, `Pending: ${item.description}`);
});

engine.on('entity:created', (entity) => {
  cytoscapeGraph.addNode(entity);
});
```

The HTTP adapter exposes a WebSocket at `/api/v1/ws` that forwards all engine events to connected browser clients for real-time graph updates.

### 7.4 HTTP API

The REST API is the universal integration point — any platform that can make HTTP calls can integrate:

```
POST   /api/v1/sync/trigger              # Trigger ingestion cycle
GET    /api/v1/sync/status               # Sync status per source

GET    /api/v1/entities                  # List (type/status filters)
GET    /api/v1/entities/:id              # Entity details
GET    /api/v1/entities/:id/neighbors    # First-degree connections (ring nodes)
GET    /api/v1/entities/:id/timeline     # Chronological source items
PATCH  /api/v1/entities/:id              # Update / merge / split

POST   /api/v1/query                     # Natural language query
POST   /api/v1/search                    # Semantic + full-text search

GET    /api/v1/attention                 # Pending items
PATCH  /api/v1/attention/:id             # Resolve / dismiss / snooze

GET    /api/v1/graph/root                # Root layer (Me -> categories)
GET    /api/v1/graph/node/:id            # Node with ring connections
GET    /api/v1/graph/path/:from/:to      # Path between entities

GET    /api/v1/export                    # Full graph (JSON-LD)
GET    /api/v1/config                    # Configuration
PATCH  /api/v1/config                    # Update configuration
```

Server: Fastify on `localhost:7890` (configurable), CORS-restricted to localhost.

---

## 8. Privacy and Security

### 8.1 Content-Aware Privacy Routing

Three privacy tiers, with **Content-aware** as the default:

| Level | Description | LLM Usage | Use Case |
|-------|-------------|-----------|----------|
| **Full Local** | All processing via Ollama | Local only | Maximum privacy, zero API costs |
| **Content-aware** (default) | Intelligent per-item routing | Hybrid | Best quality/privacy balance |
| **Minimal Cloud** | All extraction via cloud API | Cloud with metadata stripping | Maximum extraction quality |

**Content-aware decision flow:**

```
New Item
  → Check sender against user's sensitivity list
    → If sensitive contact/topic: route to Ollama (local)
    → If not sensitive:
      → Run PII detection pass (local regex + NER)
        → If PII found: redact PII, then route to cloud LLM
        → If clean: route to cloud LLM directly
```

Three signals drive the routing decision:
1. **User-configured sensitivity list**: Contacts, email labels, or topic patterns marked as "sensitive" are always processed locally
2. **Automated PII detection**: Fast local regex + NER pass identifies sensitive content
3. **Explicit user flags**: Individual conversations can be marked "never send to cloud"

### 8.2 PII Redaction Pipeline

Before sending content to cloud LLMs, a fast local pass redacts sensitive data:

| PII Type | Detection Method | Replacement |
|----------|-----------------|-------------|
| Phone numbers | Regex (international formats) | `[PHONE]` |
| Credit card numbers | Regex + Luhn validation | `[CARD]` |
| SSN / government IDs | Regex (country-specific) | `[ID]` |
| Third-party email addresses | Regex (excluding sender/recipient) | `[EMAIL]` |
| Physical addresses | Local NER model | `[ADDRESS]` |

The redacted content is sent to the cloud LLM for extraction. Extracted entities are mapped back to the original unredacted content locally — the cloud LLM never sees the raw PII.

### 8.3 Data Encryption and Access Control

- **At-rest encryption**: SQLCipher with user-provided passphrase (optional, recommended). Transparent to application code.
- **No cloud storage**: All data stays on the local filesystem. Zero telemetry.
- **LLM API calls**: Only message content is sent — no metadata, file paths, user identity, or system context.
- **Exclusion list**: Users can exclude specific contacts, email labels, or iMessage conversations from indexing entirely.
- **Data retention**: Configurable policies — archive entities after N months, delete raw items after N years while preserving entities and relationships.
- **Data export**: Full knowledge graph exportable as JSON-LD for portability and right-to-delete compliance.

---

## 9. Visualization

### 9.1 Technology Choice

- **Cytoscape.js** for the interactive knowledge graph — built-in concentric layout matches the center-ring model, first-class interaction events (tap, drag, zoom), Canvas rendering for performance
- **D3.js** for the timeline detail panel — superior time axis handling and scale management
- **React (Vite)** for UI shell — component model for search bar, breadcrumbs, detail panels

### 9.2 Graph UI Design

**Center-and-ring navigation** with progressive disclosure (max 20 nodes per layer):

| Layer | Center | Ring Shows | Example |
|-------|--------|-----------|---------|
| L0 (Root) | Me | People, Topics, Documents, Pending, Communities | 5 top-level categories |
| L1 (Category) | People | Contacts sorted by recency | Wang Zong, Lisa Chen... |
| L2 (Entity) | Wang Zong | His topics + detail timeline | Q3 Budget, Vendor Selection |
| L3 (Cross-ref) | Wang Zong x Q3 Budget | Filtered timeline for this intersection | 3 emails, 1 meeting |

**Cytoscape.js layout configuration:**

```typescript
const concentricLayout = {
  name: 'concentric',
  concentric: (node) => node.data('rank'),    // Rank by relationship strength
  levelWidth: () => 1,                         // One ring per level
  minNodeSpacing: 60,
  startAngle: -Math.PI / 2,                   // Start from top
  sweep: 2 * Math.PI,                         // Full circle
  animate: true,
  animationDuration: 300,
  animationEasing: 'ease-out-cubic',
};
```

**Drill-down animation sequence:**
1. User clicks ring node (200ms highlight)
2. Fade out current ring nodes (200ms)
3. Move clicked node to center (300ms, ease-out-cubic)
4. Fetch neighbors via `GET /api/v1/entities/:id/neighbors`
5. Fade in new ring nodes from center outward (300ms, staggered 30ms each)
6. Update breadcrumb trail

**Visual design:**
- **Color coding**: Purple (people), Teal (topics), Amber (documents), Coral (pending), Gray (threads)
- **Channel tags**: Blue (email), Green (iMessage), Purple (meetings), Amber (documents)
- **Badges**: Numeric badges on nodes for pending items. Pulsing animation for urgent.
- **Stale edges**: Relationships with old `last_seen` render at reduced opacity.
- **Keyboard navigation**: Arrow keys between ring nodes, Enter to drill in, Escape to go back, Cmd+K for search overlay.

**Detail panel** (below graph, powered by D3.js):
- Chronological timeline of source items related to the focused entity
- D3 time scale for horizontal axis
- Each item: channel icon, sender, date, preview snippet
- Filter by channel, date range, entity type
- "View in graph" button to jump to any mentioned entity

### 9.3 Standalone SPA

The visualization is a self-contained web application served by the HTTP adapter. This is the key to platform-agnosticism — the same SPA works in:

- Any modern browser via `localhost:7890`
- OpenClaw MCP Apps iframe (`ui://mindflow`)
- Telegram WebApp view
- VS Code webview panel
- Electron/Tauri wrapper (future desktop app)

Communication with the core engine is exclusively via the REST API + WebSocket — the SPA has no direct dependency on any platform SDK.

---

## 10. Query Engine

### 10.1 Query Pipeline

```
User Query → Language Detection → Intent Classification → Query Plan →
  Parallel Retrieval (FTS5 + Vector + Graph) → Fusion Ranking → LLM Synthesis → Response
```

### 10.2 Intent Classification

| Intent | Signal | Execution Strategy |
|---|---|---|
| factual_recall | "what was", "how much", "多少" | Semantic search → top results → LLM answer |
| person_context | person name present | Entity lookup → graph traversal → timeline |
| cross_reference | "who mentioned", "where did" | Cross-entity search → aggregate |
| pending_items | "forgetting", "pending", "todo", "忘了什么" | Attention table → rank by urgency |
| relationship | "how do I know" | Graph path finding between entities |
| temporal | "last week", "in January", "上周" | Time-filtered search → chronological |

MVP: rule-based classification (keyword patterns + entity detection). V1.1: LLM-based classification.

### 10.3 Hybrid Search with RRF

Three retrieval strategies run in parallel, combined via Reciprocal Rank Fusion:

1. **FTS5**: Keyword matches (high precision for exact terms, names, numbers)
2. **Vector similarity**: Semantic matches via sqlite-vec (paraphrasing, cross-lingual)
3. **Graph traversal**: Relationship-based results (person X's topics, action items for topic Y)

Weighted scoring:
```
final_score = 0.30 * fts_score + 0.35 * vector_similarity + 0.20 * recency_decay + 0.15 * relationship_strength
```

Recency decay: exponential with 30-day half-life.

### 10.4 Response Format

```typescript
interface QueryResponse {
  answer: string;                     // Natural language answer
  confidence: number;
  sources: SourceAttribution[];       // Links to raw items
  relatedEntities: EntityRef[];       // For "View in graph"
  suggestedFollowups?: string[];
}

interface SourceAttribution {
  rawItemId: string;
  channel: string;                    // "email", "imessage", "file"
  sender: string;
  timestamp: Date;
  snippet: string;                    // Relevant excerpt
}
```

---

## 11. Attention Engine

### 11.1 Composable Attention Rules

Each rule is an independent, testable module:

```typescript
interface AttentionRule {
  id: string;
  type: AttentionType;
  evaluate(context: AttentionContext): Promise<AttentionSignal[]>;
  defaultUrgencyWeight: number;
}
```

| Rule | Detection Method | Default Urgency |
|---|---|---|
| Unanswered requests | Question/request patterns in inbound messages without reply within 48h | 0.7 |
| Approaching deadlines | Action items with due dates approaching or past | 0.9 |
| Unreviewed documents | Shared documents not opened within 72h | 0.4 |
| Stale conversations | Active topics with no activity for 7+ days | 0.5 |
| Repeated mentions | Same entity mentioned 3+ times across channels within 48h | 0.6 |

### 11.2 Urgency Scoring

- Base urgency score (0.0-1.0) per signal
- Modified by: person importance (communication frequency), request explicitness, channel count
- Decays over time unless hard deadline exists
- Signals deduplicated and merged across detection cycles

### 11.3 Feedback Loop

- User acts on attention item → increase weight for that rule type
- User dismisses → decrease weight
- Calibrates urgency weights to user behavior over time
- Feedback stored in `user_corrections` table

---

## 12. Technology Stack Summary

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Language | TypeScript | Type safety, ecosystem, OpenClaw compatibility |
| Database | SQLite + sqlite-vec + FTS5 | Single-file, local-first, no server needed |
| DB Driver | better-sqlite3 | Synchronous, fast, stable |
| Embeddings | BGE-M3 (default) / Qwen3-Embedding-0.6B (lightweight) | Best multilingual (Chinese/English) performance |
| Embedding Runtime | ONNX Runtime (Core ML on macOS) | 2-5x faster than Transformers.js on Apple Silicon |
| Local LLM | Qwen2.5-7B-Instruct via Ollama | Best Chinese/English balance at 7B |
| Cloud LLM | Claude Sonnet (default), OpenAI configurable | Superior Chinese extraction quality |
| Graph Visualization | Cytoscape.js | Built-in concentric layout, interactive features |
| Timeline Visualization | D3.js | Flexible, lightweight for linear timelines |
| HTTP Server | Fastify | Fast, TypeScript-friendly |
| Testing | Vitest | Fast, ESM-native |
| Topic Clustering | HDBSCAN | Density-based, no preset cluster count needed |
| NER | ONNX Runtime local models | No API dependency for basic extraction |
| Data Export | JSON-LD | Interoperable, semantic web standard |

---

## 13. Monorepo Structure

```
mindflow/
├── packages/
│   ├── core/           # @mindflow/core — engine, graph, query, processing
│   ├── cli/            # @mindflow/cli — CLI adapter (built first)
│   ├── server/         # @mindflow/server — Fastify HTTP API + SPA serving
│   ├── openclaw/       # @mindflow/openclaw — OpenClaw plugin adapter
│   ├── telegram/       # @mindflow/telegram — Telegram bot adapter
│   └── shared/         # @mindflow/shared — shared types, constants
├── apps/
│   └── web/            # React + Vite SPA (Cytoscape.js + D3.js)
├── pnpm-workspace.yaml
├── vitest.config.ts
└── tsconfig.base.json
```

**Development order**: `core` → `cli` → `server` + `web` → `openclaw` → `telegram`

**Dependency boundaries** (enforced by package.json):
- `@mindflow/core` has zero platform imports — only Node.js builtins, `better-sqlite3`, `onnxruntime-node`
- All adapter packages depend on `@mindflow/core` (never the reverse)
- Source adapters (`adapter-gmail`, etc.) are optional peer dependencies of core

### 11.1 Installation and Distribution

| Distribution | Command | Target User |
|---|---|---|
| npm (global) | `npm install -g @mindflow/cli` | Developers |
| npx (no install) | `npx @mindflow/cli serve` | Quick trial |
| OpenClaw plugin | `openclaw plugins install @mindflow/openclaw` | OpenClaw users |
| Homebrew | `brew install mindflow` | macOS users |
| Single binary | Compiled via `bun build --compile` | Zero-dependency |
| Docker | `docker run mindflow` | Linux / self-hosters |

### 11.2 First-Run Experience

`mindflow init` launches an interactive CLI wizard:

1. Configure email source (Gmail OAuth or IMAP)
2. Grant Full Disk Access for iMessage (macOS only — skip on other platforms)
3. Set document watch directories (optional)
4. Configure exclusion list (optional)
5. Choose LLM provider: Claude API key / OpenAI / Ollama (local) / Skip
6. Choose scan depth: 30 days / 6 months / 1 year / all time
7. Set privacy level: Full Local / Content-aware (default) / Minimal Cloud

### 11.3 Configuration

All configuration in `~/.mindflow/config.json` (platform adapters may override the data directory):

```json
{
  "dataDir": "~/.mindflow/data",
  "sources": {
    "gmail": { "enabled": true, "auth": { "type": "oauth" } },
    "imessage": { "enabled": true, "excludeContacts": [] },
    "filesystem": { "enabled": true, "watchDirs": ["~/Documents"] }
  },
  "llm": {
    "provider": "claude",
    "model": "claude-sonnet-4-6",
    "apiKey": "sk-...",
    "monthlyBudget": 20.00,
    "fallbackProvider": "ollama",
    "localModel": "qwen2.5:7b"
  },
  "embedding": { "model": "bge-m3", "runtime": "onnx" },
  "privacy": {
    "level": "content-aware",
    "sensitiveContacts": [],
    "piiRedaction": true,
    "encryption": true
  },
  "processing": { "syncIntervalMinutes": 15, "concurrency": 5 },
  "server": { "port": 7890, "host": "127.0.0.1" }
}
```

---

## 14. LLM Budget Control

- **Monthly cap**: User-configurable monthly spending limit (default: $20)
- **Automatic throttling**: When approaching cap, system degrades to local-only extraction
- **Cost tracking**: Per-operation cost logged; dashboard shows spending breakdown
- **Tiered processing reduces cost**: Rules (~30%) + local NER (~30%) handle 60% of extraction without any LLM cost

---

## 15. Data Export and Portability

- **JSON-LD format**: Full knowledge graph exportable as JSON-LD for interoperability
- **Granular export**: Export by person, topic, time range, or full graph
- **SQLite file**: The database file itself is portable (single file, copy to new machine)

---

## 16. Testing Strategy

### 14.1 Framework

- **Vitest** for unit and integration tests
- In-memory SQLite for fast unit tests, file-based for integration tests
- Mock LLM provider for deterministic extraction testing
- Pre-computed BGE-M3 embedding fixtures

### 14.2 Key Test Areas

| Area | Approach |
|---|---|
| Entity resolution accuracy | Precision/recall on labeled bilingual test set |
| Cross-lingual matching | Chinese-English entity linking test cases |
| Topic clustering quality | Coherence metrics on synthetic message sets |
| Query response relevance | Manual evaluation set (70%+ accuracy target) |
| Attention detection | Recall on synthetic pending-item scenarios |
| Graph traversal performance | Latency benchmarks at 10K/100K/500K scale |
| Schema migrations | Forward/backward migration correctness |
| Privacy routing | Verify sensitive content never reaches cloud LLM |
| Thread detection | Cross-channel linking accuracy on labeled data |

---

## 17. Implementation Phases

### Phase 0: Foundation (Weeks 1-2)
- Monorepo scaffold (pnpm workspaces, TypeScript, Vitest)
- SQLite schema + migrations
- LLM abstraction (Claude + Ollama providers)
- Embedding pipeline (BGE-M3 via ONNX Runtime)
- SourceAdapter interface + Gmail adapter (IMAP)
- Tiered processing (Tier 1 + Tier 2)
- REST API skeleton (Fastify)
- CLI adapter with basic commands

### Phase 1: MVP (Weeks 3-6)
- iMessage adapter with macOS version detection
- Tier 3 LLM extraction (structured output)
- Entity resolution (Stages 1-3)
- Knowledge graph CRUD
- FTS5 + sqlite-vec search
- Basic NL query pipeline
- Attention detection
- Cytoscape.js graph (center-and-ring)
- D3.js timeline panel
- Content-aware privacy routing + PII redaction
- OpenClaw plugin wrapper

### Phase 2: Polish (Weeks 7-10)
- Filesystem adapter
- Topic clustering (HDBSCAN + drift detection)
- Community detection layer
- Thread entity with cross-channel linking + summarization
- User correction UI (merge/split/rename)
- Entity resolution Stage 4 (user confirmation)
- Telegram bot adapter
- Weekly digest generation
- Budget tracking dashboard
- Data export (JSON-LD)
- Keyboard navigation

### Phase 3: Advanced (Weeks 11-16)
- Slack source adapter
- Calendar integration (pre-meeting briefs)
- Global search overlay (Spotlight-like)
- Multi-device sync (encrypted, via libSQL replication)
- Advanced graph views (timeline view, topic map)
- iMessage attachment text extraction (OCR)
- Performance optimization and caching
- Compiled binary distribution

---

## 18. Risk Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| iMessage DB schema changes | High | Version detection + adapter abstraction; community monitoring of macOS betas; graceful degradation |
| LLM API costs spiral | Medium | Monthly budget cap; tiered processing reduces volume 70-80%; auto-throttle to local-only |
| Entity resolution errors | High | Conservative merging (>0.85); merge audit log; one-click undo; never auto-merge without deterministic signal |
| Privacy leak via cloud LLM | High | Content-aware routing; PII redaction; Ollama fallback; user-controlled sensitive lists |
| Full Disk Access friction | Medium | Clear setup wizard; explain privacy model; show what data is accessed |
| SQLite write contention | Medium | WAL mode; single writer; concurrent reads |
| Database corruption | Medium | WAL crash recovery; daily backups (rotated); JSON-LD export |
| OpenClaw platform dependency | Medium | Core-shell architecture — works independently via CLI or web UI |
| Graph scale over time | Low | Automatic archiving; configurable retention; max 20 nodes per UI layer |
| sqlite-vec scale (>1M vectors) | Low | Brute-force KNN sub-100ms at scale; future: libSQL or hnswlib |

---

## 19. Design Decision Log

| # | Decision | Resolution | Source | Rationale |
|---|---|---|---|---|
| D1 | Architecture | Three-layer platform-agnostic | All 3 | Independent convergence; de-risks platform dependency |
| D2 | Database | SQLite + sqlite-vec + FTS5 | R1, R2 | Battle-tested, single-file; abstracted for future libSQL |
| D3 | Embedding model | BGE-M3 default, Qwen3 alt | R1, R3 | Best cross-lingual; dense+sparse+ColBERT |
| D4 | Embedding runtime | ONNX Runtime (Core ML) | R1, R3 | 2-5x speedup on Apple Silicon |
| D5 | Graph viz | Cytoscape.js + D3.js timeline | R3 | Built-in concentric layout saves dev time |
| D6 | Temporal model | Bi-temporal edges (valid_from/until) | R1 | Historical queries; fact correction |
| D7 | Graph layers | Episode + Entity + Community | R1 | Three-tier navigation and context |
| D8 | Entity types | 6 types (added Thread) | R2 | Thread fills gap between messages and topics |
| D9 | Extraction | Rules → NER → LLM (tiered) | R2 tiers, R1 routing | Works without API key; 70-80% cost reduction |
| D10 | Entity resolution | 4-stage with merge audit | R1 | Most complete; conservative defaults |
| D11 | Job queue | SQLite-backed with retry | R3 | Crash-safe, no external deps |
| D12 | Privacy | Content-aware + PII redaction | R3 | Best quality/privacy balance |
| D13 | Topic clustering | HDBSCAN + drift detection | R1 | Concrete algorithm; handles evolution |
| D14 | Packaging | Monorepo (@mindflow/*) | R3 | Enforces boundary at package level |
| D15 | Local LLM | Qwen2.5-7B via Ollama (MVP) | R3 | Best bilingual at 7B; ships day one |
| D16 | Cloud LLM | Claude Sonnet default | All 3 | Best Chinese extraction quality |
| D17 | Events | Engine emits, adapters subscribe | R3 | Real-time without polling |
| D18 | Export | JSON-LD | R1 | Portability and user trust |
| D19 | Budget | Monthly cap + auto-throttle | R1 | Prevents cost surprises |
| D20 | Feedback | User corrections table | R1 | Learning loop for resolution/clustering |
| D21 | HTTP | Fastify | All 3 | Fast, lightweight, TS support |
| D22 | Testing | Vitest | R2, R3 | Fast, TypeScript-native |

---

## 20. Changes from Original PRD

Based on the collaborative design process, the following changes are recommended:

1. **Architecture**: MindFlow is a standalone platform-agnostic engine, not "an OpenClaw plugin"
2. **Entity types**: Added Thread as 6th entity type
3. **Temporal model**: Added bi-temporal edges with validity intervals
4. **Graph layers**: Added Community layer above Entity layer
5. **Extraction**: Changed from all-LLM to tiered (rules → NER → LLM)
6. **Privacy**: Added content-aware routing with PII redaction
7. **Embedding**: Changed to BGE-M3 via ONNX Runtime (from MiniLM + Transformers.js)
8. **Visualization**: Specified Cytoscape.js + D3.js
9. **Local LLM**: Moved Ollama from "maybe V1.1" to MVP
10. **Storage path**: Changed from `~/.openclaw/mindflow/` to `~/.mindflow/`
11. **Job queue**: Added SQLite-backed queue with backpressure
12. **Export**: Added JSON-LD export for portability
13. **Budget**: Added monthly LLM spending cap with throttling
14. **Event system**: Added typed event bus for real-time integration

---

## 21. Open Design Decisions

| Question | Status | Notes |
|----------|--------|-------|
| Graph layout: constrained radial vs force-directed | **Resolved**: Constrained radial via Cytoscape.js concentric layout | Deterministic positioning preferred |
| libSQL vs SQLite | **Resolved**: SQLite now, abstracted for libSQL swap later | libSQL replication useful for V2 multi-device |
| Drizzle ORM vs raw SQL | **Resolved**: Use Drizzle ORM for type-safe migrations | Consensus: type safety worth the dependency |
| iMessage attachment OCR | **Deferred to V1.1** | MVP indexes metadata only |
| Multi-device sync | **Deferred to V2** | Will evaluate libSQL replication |
| Team/shared knowledge spaces | **Deferred to V2** | Privacy implications need careful design |

---

*This document represents the unified consensus of three independent research proposals. Individual proposals available at [research-1.md](research-1.md), [research-2.md](research-2.md), [research-3.md](research-3.md).*
