-- Item embeddings for semantic search and topic discovery
CREATE TABLE IF NOT EXISTS item_embeddings (
  raw_item_id TEXT PRIMARY KEY REFERENCES raw_items(id) ON DELETE CASCADE,
  embedding BLOB NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_item_embeddings_model ON item_embeddings(model);
