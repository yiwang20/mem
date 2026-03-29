/**
 * Urgency scoring utilities for the attention engine.
 *
 * All scores are normalized to the [0.0, 1.0] range.
 */

/** Half-life for time-based decay (7 days in ms). Score halves every 7 days. */
const DEFAULT_DECAY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Exponential decay: returns 1.0 at t=0, decays toward 0 as elapsed time grows.
 *
 * @param elapsedMs  Time elapsed in milliseconds.
 * @param halfLifeMs Half-life in milliseconds (time at which score halves).
 */
export function timeDecay(
  elapsedMs: number,
  halfLifeMs = DEFAULT_DECAY_HALF_LIFE_MS,
): number {
  if (elapsedMs <= 0) return 1.0;
  return Math.pow(0.5, elapsedMs / halfLifeMs);
}

/**
 * Combine multiple urgency signals into a single score using weighted average.
 * Each signal is a [value, weight] pair where value is in [0, 1].
 * Returns a value in [0, 1].
 */
export function combineSignals(signals: Array<[number, number]>): number {
  if (signals.length === 0) return 0;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const [value, weight] of signals) {
    weightedSum += clamp(value) * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return 0;
  return clamp(weightedSum / totalWeight);
}

/**
 * Clamp a value to the [0.0, 1.0] range.
 */
export function clamp(value: number): number {
  return Math.max(0.0, Math.min(1.0, value));
}

/**
 * Linearly interpolate from `from` to `to` based on progress in [0, 1].
 * Returns `from` when progress=0, `to` when progress=1.
 */
export function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * clamp(progress);
}

/**
 * Score urgency based on how far in the past a deadline was (or how soon it is).
 *
 * @param dueMs    Due date as Unix epoch ms.
 * @param nowMs    Current time as Unix epoch ms.
 * @returns Urgency score in [0, 1].
 */
export function deadlineScore(dueMs: number, nowMs: number): number {
  const msUntilDue = dueMs - nowMs;

  if (msUntilDue <= 0) {
    // Overdue — maximum urgency
    return 1.0;
  }

  const oneDayMs = 24 * 60 * 60 * 1000;
  const oneWeekMs = 7 * oneDayMs;

  if (msUntilDue <= oneDayMs) {
    // Due today
    return 0.9;
  } else if (msUntilDue <= oneWeekMs) {
    // Due this week: linearly from 0.9 (at 1 day) down to 0.7 (at 7 days)
    const progress = (msUntilDue - oneDayMs) / (oneWeekMs - oneDayMs);
    return lerp(0.9, 0.7, progress);
  } else if (msUntilDue <= 2 * oneWeekMs) {
    // Due next week: linearly from 0.7 (at 7 days) down to 0.5 (at 14 days)
    const progress = (msUntilDue - oneWeekMs) / oneWeekMs;
    return lerp(0.7, 0.5, progress);
  }

  // More than 2 weeks away — low urgency, still present
  return clamp(0.5 * timeDecay(msUntilDue - 2 * oneWeekMs, oneWeekMs * 4));
}

/**
 * Score urgency for a stale conversation based on how long it has been stale
 * and how active it was before going stale.
 *
 * @param staleMs          How long the conversation has been stale (ms).
 * @param priorActivityMs  Total time span of prior activity (first to last message).
 * @param messageCount     Number of messages in the conversation.
 */
export function staleConversationScore(
  staleMs: number,
  priorActivityMs: number,
  messageCount: number,
): number {
  // Base urgency from staleness — older stale conversations are more urgent
  // (up to a point; after 60 days it's probably dead and less urgent)
  const staleWeeks = staleMs / (7 * 24 * 60 * 60 * 1000);
  const stalenessSignal = clamp(staleWeeks / 8); // saturates at 8 weeks

  // Activity signal: longer-lived and higher-volume conversations deserve more attention
  const activityDays = priorActivityMs / (24 * 60 * 60 * 1000);
  const activitySignal = clamp((activityDays / 30 + messageCount / 20) / 2);

  return combineSignals([
    [stalenessSignal, 1.5],
    [activitySignal, 1.0],
  ]);
}
