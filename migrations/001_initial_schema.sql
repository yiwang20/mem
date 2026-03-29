-- MindFlow Initial Schema
-- Migration 001: Create all core tables, FTS5 virtual tables, and indices

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  filename TEXT NOT NULL
);

-- ----------------------------------------------------------------------------
-- Core tables
-- ----------------------------------------------------------------------------

-- raw_items: Immutable source records
CREATE TABLE raw_items (
  id TEXT PRIMARY KEY,
  source_adapter TEXT NOT NULL,
  channel TEXT NOT NULL,
  external_id TEXT NOT NULL,
  thread_id TEXT,
  sender_entity_id TEXT REFERENCES entities(id),
  recipient_entity_ids TEXT,              -- JSON array of entity IDs
  subject TEXT,
  body TEXT NOT NULL,
  body_format TEXT DEFAULT 'plaintext',
  content_hash TEXT NOT NULL UNIQUE,
  language TEXT,
  event_time INTEGER NOT NULL,
  ingested_at INTEGER NOT NULL,
  processing_status TEXT DEFAULT 'pending',
  attachments TEXT,                       -- JSON array of {filename, type, size, path}
  metadata TEXT                           -- JSON: source-specific data
);

-- entities: Extracted knowledge objects (6 types)
CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN (
    'person','topic','action_item','key_fact','document','thread'
  )),
  canonical_name TEXT NOT NULL,
  name_alt TEXT,
  aliases TEXT,                           -- JSON array
  attributes TEXT,                        -- JSON: type-specific attributes
  confidence REAL DEFAULT 1.0,
  status TEXT DEFAULT 'active' CHECK(status IN (
    'active','dormant','archived','merged'
  )),
  merged_into TEXT REFERENCES entities(id),
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- relationships: Bi-temporal edges
CREATE TABLE relationships (
  id TEXT PRIMARY KEY,
  from_entity_id TEXT NOT NULL REFERENCES entities(id),
  to_entity_id TEXT NOT NULL REFERENCES entities(id),
  type TEXT NOT NULL,
  strength REAL DEFAULT 0.5,
  event_time INTEGER,
  ingestion_time INTEGER NOT NULL,
  valid_from INTEGER,
  valid_until INTEGER,
  occurrence_count INTEGER DEFAULT 1,
  source_item_ids TEXT,                   -- JSON array of raw_item IDs
  metadata TEXT                           -- JSON: edge-specific data
);

-- entity_episodes: Junction table linking entities to source items
CREATE TABLE entity_episodes (
  entity_id TEXT NOT NULL REFERENCES entities(id),
  raw_item_id TEXT NOT NULL REFERENCES raw_items(id),
  extraction_method TEXT,
  confidence REAL DEFAULT 1.0,
  PRIMARY KEY (entity_id, raw_item_id)
);

-- threads: First-class conversation grouping
CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  source_adapter TEXT NOT NULL,
  channel TEXT NOT NULL,
  external_thread_id TEXT,
  subject TEXT,
  participant_entity_ids TEXT,            -- JSON array of person entity IDs
  first_message_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL,
  message_count INTEGER DEFAULT 0,
  summary TEXT,
  status TEXT DEFAULT 'active'
);

-- entity_aliases: For entity resolution lookups
CREATE TABLE entity_aliases (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  alias TEXT NOT NULL,
  alias_type TEXT NOT NULL,
  confidence REAL DEFAULT 1.0
);

-- communities: Auto-detected entity clusters
CREATE TABLE communities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  member_entity_ids TEXT,                 -- JSON array
  centroid_embedding BLOB,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- attention_items: Proactive attention surface
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
  resolution_type TEXT
);

-- merge_audit: Entity merge provenance for undo
CREATE TABLE merge_audit (
  id TEXT PRIMARY KEY,
  surviving_entity_id TEXT NOT NULL,
  merged_entity_id TEXT NOT NULL,
  merge_method TEXT NOT NULL,
  confidence REAL,
  merged_at INTEGER NOT NULL,
  merged_by TEXT DEFAULT 'system',
  pre_merge_snapshot TEXT,                -- JSON snapshot for undo
  undone_at INTEGER
);

-- user_corrections: Feedback for learning
CREATE TABLE user_corrections (
  id TEXT PRIMARY KEY,
  correction_type TEXT NOT NULL,
  target_entity_id TEXT,
  correction_data TEXT,                   -- JSON
  created_at INTEGER NOT NULL
);

-- job_queue: Processing pipeline queue with retry
CREATE TABLE job_queue (
  id TEXT PRIMARY KEY,
  raw_item_id TEXT REFERENCES raw_items(id),
  stage TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN (
    'pending','processing','completed','failed','skipped'
  )),
  priority REAL DEFAULT 0.5,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER
);

-- sync_state: Per-source checkpoint tracking
CREATE TABLE sync_state (
  source_adapter TEXT PRIMARY KEY,
  last_checkpoint TEXT NOT NULL,          -- JSON
  last_sync_at INTEGER NOT NULL,
  items_processed INTEGER DEFAULT 0,
  status TEXT DEFAULT 'idle',
  error_message TEXT,
  config TEXT                             -- JSON
);

-- config: Application configuration
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ----------------------------------------------------------------------------
-- FTS5 virtual tables
-- ----------------------------------------------------------------------------

CREATE VIRTUAL TABLE raw_items_fts USING fts5(
  subject, body,
  content=raw_items,
  content_rowid=rowid,
  tokenize='unicode61 remove_diacritics 2'
);

CREATE VIRTUAL TABLE entities_fts USING fts5(
  canonical_name, name_alt, aliases,
  content=entities,
  content_rowid=rowid,
  tokenize='unicode61 remove_diacritics 2'
);

-- FTS5 triggers to keep content tables in sync
CREATE TRIGGER raw_items_fts_insert AFTER INSERT ON raw_items BEGIN
  INSERT INTO raw_items_fts(rowid, subject, body)
    VALUES (new.rowid, new.subject, new.body);
END;

CREATE TRIGGER raw_items_fts_delete AFTER DELETE ON raw_items BEGIN
  INSERT INTO raw_items_fts(raw_items_fts, rowid, subject, body)
    VALUES ('delete', old.rowid, old.subject, old.body);
END;

CREATE TRIGGER raw_items_fts_update AFTER UPDATE ON raw_items BEGIN
  INSERT INTO raw_items_fts(raw_items_fts, rowid, subject, body)
    VALUES ('delete', old.rowid, old.subject, old.body);
  INSERT INTO raw_items_fts(rowid, subject, body)
    VALUES (new.rowid, new.subject, new.body);
END;

CREATE TRIGGER entities_fts_insert AFTER INSERT ON entities BEGIN
  INSERT INTO entities_fts(rowid, canonical_name, name_alt, aliases)
    VALUES (new.rowid, new.canonical_name, new.name_alt, new.aliases);
END;

CREATE TRIGGER entities_fts_delete AFTER DELETE ON entities BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, canonical_name, name_alt, aliases)
    VALUES ('delete', old.rowid, old.canonical_name, old.name_alt, old.aliases);
END;

CREATE TRIGGER entities_fts_update AFTER UPDATE ON entities BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, canonical_name, name_alt, aliases)
    VALUES ('delete', old.rowid, old.canonical_name, old.name_alt, old.aliases);
  INSERT INTO entities_fts(rowid, canonical_name, name_alt, aliases)
    VALUES (new.rowid, new.canonical_name, new.name_alt, new.aliases);
END;

-- ----------------------------------------------------------------------------
-- Indices
-- ----------------------------------------------------------------------------

-- Entity lookups
CREATE INDEX idx_entities_type_status ON entities(type, status);
CREATE INDEX idx_entities_name ON entities(canonical_name COLLATE NOCASE);
CREATE INDEX idx_entities_last_seen ON entities(last_seen_at DESC);

-- Relationship traversal (most critical)
CREATE INDEX idx_rel_from ON relationships(from_entity_id, type);
CREATE INDEX idx_rel_to ON relationships(to_entity_id, type);
CREATE INDEX idx_rel_temporal ON relationships(valid_until, ingestion_time DESC)
  WHERE valid_until IS NULL;

-- Raw item queries
CREATE INDEX idx_raw_items_timestamp ON raw_items(event_time DESC);
CREATE INDEX idx_raw_items_sender ON raw_items(sender_entity_id, event_time DESC);
CREATE INDEX idx_raw_items_thread ON raw_items(thread_id);
CREATE INDEX idx_raw_items_hash ON raw_items(content_hash);
CREATE INDEX idx_raw_items_source ON raw_items(source_adapter, event_time DESC);
CREATE INDEX idx_raw_items_status ON raw_items(processing_status)
  WHERE processing_status != 'done';

-- Entity resolution
CREATE INDEX idx_aliases_alias ON entity_aliases(alias COLLATE NOCASE);
CREATE INDEX idx_aliases_entity ON entity_aliases(entity_id);

-- Attention surface
CREATE INDEX idx_attention_active ON attention_items(urgency_score DESC)
  WHERE resolved_at IS NULL AND dismissed_at IS NULL;

-- Job queue processing order
CREATE INDEX idx_jobs_pending ON job_queue(priority DESC, created_at)
  WHERE status IN ('pending', 'failed');
