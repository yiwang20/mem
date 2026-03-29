-- MindFlow Migration 003: Topic Overview Cache
-- Stores LLM-generated AI overviews for topics, keyed by episode count for cache invalidation

CREATE TABLE IF NOT EXISTS topic_overview_cache (
  topic_id       TEXT PRIMARY KEY,
  content        TEXT NOT NULL,
  generated_at   INTEGER NOT NULL,
  episode_count  INTEGER NOT NULL,
  FOREIGN KEY (topic_id) REFERENCES entities(id) ON DELETE CASCADE
);
