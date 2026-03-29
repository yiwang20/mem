import type { RawItem } from '../types/index.js';
import type { ScoredItem } from './search.js';

// ---------------------------------------------------------------------------
// Reciprocal Rank Fusion (RRF)
// ---------------------------------------------------------------------------

/**
 * Standard RRF formula: score = Σ 1 / (k + rank)
 * where rank is 1-based position in each ranked list.
 *
 * @param rankedLists  One list per search strategy, each sorted by descending score.
 * @param k            RRF constant (default: 60, standard value from literature).
 * @returns            Fused list sorted by descending RRF score, deduplicated by item ID.
 */
export function rrf(rankedLists: ScoredItem[][], k = 60): FusedItem[] {
  const scores = new Map<string, number>();
  const byId = new Map<string, RawItem>();

  for (const list of rankedLists) {
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      if (!entry) continue;
      const rank = i + 1; // 1-based
      const contrib = 1 / (k + rank);
      scores.set(entry.item.id, (scores.get(entry.item.id) ?? 0) + contrib);
      byId.set(entry.item.id, entry.item);
    }
  }

  const fused: FusedItem[] = [];
  for (const [id, rrfScore] of scores) {
    const item = byId.get(id);
    if (item) fused.push({ item, rrfScore });
  }

  fused.sort((a, b) => b.rrfScore - a.rrfScore);
  return fused;
}

export interface FusedItem {
  item: RawItem;
  rrfScore: number;
}

// ---------------------------------------------------------------------------
// Convenience: extract just the RawItems from a fused result
// ---------------------------------------------------------------------------

export function extractItems(fused: FusedItem[], limit: number): RawItem[] {
  return fused.slice(0, limit).map((f) => f.item);
}
