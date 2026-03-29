import type { Entity, RawItem } from '../types/index.js';
import type { EntityRepository, RawItemRepository } from '../storage/repositories.js';
import type { GraphOperations } from '../graph/operations.js';

// ---------------------------------------------------------------------------
// Scored result wrappers
// ---------------------------------------------------------------------------

export interface ScoredItem {
  item: RawItem;
  score: number;
  /** Which strategy produced this result */
  source: 'fts' | 'vector' | 'graph';
}

export interface ScoredEntity {
  entity: Entity;
  score: number;
  source: 'entity_search';
}

// ---------------------------------------------------------------------------
// FTS5 search
// ---------------------------------------------------------------------------

/**
 * Full-text search over raw_items using the FTS5 index.
 * Returns up to `limit` items with a synthetic score based on rank.
 */
export function ftsSearch(
  query: string,
  rawItems: RawItemRepository,
  limit = 20,
): ScoredItem[] {
  const items = rawItems.search(query, limit);
  // RawItemRepository.search returns results ordered by FTS rank;
  // assign a descending score based on position.
  return items.map((item, idx) => ({
    item,
    score: 1.0 - idx * (1.0 / Math.max(items.length, 1)),
    source: 'fts' as const,
  }));
}

// ---------------------------------------------------------------------------
// Vector search (placeholder — sqlite-vec embeddings not generated yet)
// ---------------------------------------------------------------------------

/**
 * Placeholder vector search. Returns an empty list until embeddings are
 * populated in the database. When sqlite-vec embeddings are available,
 * this function will run a KNN query against the vec_items virtual table.
 */
export function vectorSearch(
  _query: string,
  _embedding: Float64Array | null,
  _limit = 20,
): ScoredItem[] {
  // TODO: when embedding generation is wired in, execute:
  //   SELECT ri.*, vec_distance_l2(embedding, ?) as dist
  //   FROM vec_items
  //   JOIN raw_items ri ON ri.id = vec_items.id
  //   ORDER BY dist ASC LIMIT ?
  return [];
}

// ---------------------------------------------------------------------------
// Entity name/alias search
// ---------------------------------------------------------------------------

/**
 * Search entities by name using the FTS index, then by alias fallback.
 * Returns scored entities (higher score = better name match).
 */
export function entitySearch(
  query: string,
  entities: EntityRepository,
  limit = 20,
): ScoredEntity[] {
  const ftsEntities = entities.search(query, limit);
  const scored: ScoredEntity[] = ftsEntities.map((entity, idx) => ({
    entity,
    score: 1.0 - idx * (1.0 / Math.max(ftsEntities.length, 1)),
    source: 'entity_search' as const,
  }));

  // Deduplicate by entity ID (FTS may return duplicates)
  const seen = new Set<string>();
  return scored.filter(({ entity }) => {
    if (seen.has(entity.id)) return false;
    seen.add(entity.id);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Graph-based search
// ---------------------------------------------------------------------------

/**
 * Retrieve raw items from the entity's episode timeline, scored by recency.
 */
export function graphSearch(
  entityId: string,
  graphOps: GraphOperations,
  limit = 20,
): ScoredItem[] {
  const { items } = graphOps.getTimeline(entityId, { limit });
  const now = Date.now();
  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

  return items.map((item) => ({
    item,
    // Recency score: 1.0 at present, decays toward 0 over one year
    score: Math.max(0, 1.0 - (now - item.eventTime) / ONE_YEAR_MS),
    source: 'graph' as const,
  }));
}
