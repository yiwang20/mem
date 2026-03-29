// ============================================================================
// Importance scoring for raw items
// ============================================================================
//
// Returns a 0.0–1.0 score that controls whether Tier 3 LLM extraction is
// worth the latency and cost.  Each signal contributes an additive weight;
// total is clamped to [0, 1].

import type { ExtractionResult, RawItem } from '../types/index.js';
import { EntityType } from '../types/index.js';

export interface ImportanceBreakdown {
  score: number;
  signals: Record<string, number>;
}

/**
 * Score the importance of a raw item based on tier-1 extraction signals and
 * simple heuristics on the body text.
 *
 * @param item          The raw item to score.
 * @param tier1Result   Output from runTier1Rules (already computed).
 * @param frequentContactIds  Optional set of entity IDs considered frequent contacts.
 */
export function scoreImportance(
  item: RawItem,
  tier1Result: ExtractionResult,
  frequentContactIds?: ReadonlySet<string>,
): number {
  return scoreImportanceDetailed(item, tier1Result, frequentContactIds).score;
}

/**
 * Same as scoreImportance but also returns the per-signal breakdown for
 * debugging and testing.
 */
export function scoreImportanceDetailed(
  item: RawItem,
  tier1Result: ExtractionResult,
  frequentContactIds?: ReadonlySet<string>,
): ImportanceBreakdown {
  const signals: Record<string, number> = {};

  const attrs = tier1Result.entities.flatMap((e) => Object.keys(e.attributes));
  const hasAttr = (key: string) => attrs.includes(key);

  // +0.3 — action items detected (deadline_signal or action_item type)
  const hasActionItem =
    tier1Result.entities.some((e) => e.type === EntityType.ActionItem) ||
    hasAttr('deadline_signal');
  if (hasActionItem) signals['action_item'] = 0.3;

  // +0.2 — monetary amounts mentioned
  if (hasAttr('amount')) signals['monetary_amount'] = 0.2;

  // +0.2 — explicit deadline detected
  if (hasAttr('deadline')) signals['deadline'] = 0.2;

  // +0.1 — message contains a question
  if (item.body.includes('?')) signals['has_question'] = 0.1;

  // +0.1 — message body is substantial (> 200 chars)
  if (item.body.length > 200) signals['long_message'] = 0.1;

  // +0.1 — sender is a frequent contact
  if (
    item.senderEntityId !== null &&
    frequentContactIds?.has(item.senderEntityId)
  ) {
    signals['frequent_contact'] = 0.1;
  }

  const score = Math.min(
    Object.values(signals).reduce((sum, v) => sum + v, 0),
    1.0,
  );

  return { score, signals };
}
