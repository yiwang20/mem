-- MindFlow Migration 004: Living Taxonomy
-- Adds depth/path columns to entities and creates taxonomy audit tables

-- Idempotent: SQLite doesn't support IF NOT EXISTS for ALTER TABLE,
-- so we check via a temp trigger trick. If columns exist, these are no-ops
-- handled by the bootstrap ensureMigration004() function.

-- taxonomy_log: Audit trail for all hierarchy changes
CREATE TABLE IF NOT EXISTS taxonomy_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,  -- 'set_parent', 'remove_parent', 'merge', 'create', 'delete'
  entity_id TEXT NOT NULL,
  old_parent_id TEXT,
  new_parent_id TEXT,
  reason TEXT,
  confidence REAL,
  source TEXT NOT NULL,  -- 'bootstrap', 'ingest', 'daily_check', 'manual'
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_taxonomy_log_entity ON taxonomy_log(entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_taxonomy_log_source ON taxonomy_log(source, created_at DESC);

-- taxonomy_snapshot: Point-in-time snapshots before bulk changes
CREATE TABLE IF NOT EXISTS taxonomy_snapshot (
  id TEXT PRIMARY KEY,
  snapshot_data TEXT NOT NULL,  -- JSON of all topic entities with their parent_entity_id
  reason TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entities_depth ON entities(depth) WHERE type = 'topic';
