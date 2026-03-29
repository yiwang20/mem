-- MindFlow Migration 002: Topic Hierarchy
-- Adds parent_entity_id to entities for hierarchical topic organization

ALTER TABLE entities ADD COLUMN parent_entity_id TEXT REFERENCES entities(id);

-- Index for fast child lookups (partial: only rows where parent is set)
CREATE INDEX idx_entities_parent ON entities(parent_entity_id)
  WHERE parent_entity_id IS NOT NULL;
