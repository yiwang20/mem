import { describe, expect, it } from 'vitest';
import {
  clamp,
  combineSignals,
  deadlineScore,
  lerp,
  staleConversationScore,
  timeDecay,
} from '../../src/attention/scoring.js';

// ============================================================================
// scoring.ts
// ============================================================================

describe('clamp', () => {
  it('keeps values inside [0, 1]', () => {
    expect(clamp(0.5)).toBe(0.5);
    expect(clamp(-1)).toBe(0);
    expect(clamp(2)).toBe(1);
    expect(clamp(0)).toBe(0);
    expect(clamp(1)).toBe(1);
  });
});

describe('lerp', () => {
  it('returns from at progress=0', () => {
    expect(lerp(0.2, 0.8, 0)).toBeCloseTo(0.2);
  });

  it('returns to at progress=1', () => {
    expect(lerp(0.2, 0.8, 1)).toBeCloseTo(0.8);
  });

  it('interpolates midpoint', () => {
    expect(lerp(0, 1, 0.5)).toBeCloseTo(0.5);
  });

  it('clamps progress to [0, 1]', () => {
    expect(lerp(0.2, 0.8, -1)).toBeCloseTo(0.2);
    expect(lerp(0.2, 0.8, 2)).toBeCloseTo(0.8);
  });
});

describe('timeDecay', () => {
  it('returns 1.0 at elapsed=0', () => {
    expect(timeDecay(0)).toBe(1.0);
  });

  it('returns 0.5 at elapsed=halfLife', () => {
    const halfLife = 7 * 24 * 60 * 60 * 1000;
    expect(timeDecay(halfLife, halfLife)).toBeCloseTo(0.5);
  });

  it('returns 0.25 at elapsed=2*halfLife', () => {
    const halfLife = 7 * 24 * 60 * 60 * 1000;
    expect(timeDecay(halfLife * 2, halfLife)).toBeCloseTo(0.25);
  });

  it('approaches 0 with very large elapsed', () => {
    const halfLife = 1000;
    expect(timeDecay(1_000_000, halfLife)).toBeLessThan(0.001);
  });

  it('handles negative elapsed as 0', () => {
    expect(timeDecay(-100)).toBe(1.0);
  });
});

describe('combineSignals', () => {
  it('returns 0 for empty signals', () => {
    expect(combineSignals([])).toBe(0);
  });

  it('returns the value for a single signal', () => {
    expect(combineSignals([[0.7, 1]])).toBeCloseTo(0.7);
  });

  it('computes weighted average', () => {
    // (0.4 * 1 + 0.8 * 3) / (1 + 3) = (0.4 + 2.4) / 4 = 2.8 / 4 = 0.7
    expect(combineSignals([[0.4, 1], [0.8, 3]])).toBeCloseTo(0.7);
  });

  it('clamps output to [0, 1]', () => {
    expect(combineSignals([[1.5, 1]])).toBe(1.0);
    expect(combineSignals([[-0.5, 1]])).toBe(0.0);
  });

  it('handles zero total weight', () => {
    expect(combineSignals([[0.5, 0]])).toBe(0);
  });
});

describe('deadlineScore', () => {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const oneWeek = 7 * oneDay;

  it('returns 1.0 for overdue items', () => {
    expect(deadlineScore(now - oneDay, now)).toBe(1.0);
    expect(deadlineScore(now - 1, now)).toBe(1.0);
  });

  it('returns 0.9 for due today (within 24h)', () => {
    expect(deadlineScore(now + oneDay / 2, now)).toBe(0.9);
  });

  it('returns between 0.7 and 0.9 for due this week', () => {
    const score = deadlineScore(now + 3 * oneDay, now);
    expect(score).toBeGreaterThanOrEqual(0.7);
    expect(score).toBeLessThanOrEqual(0.9);
  });

  it('returns between 0.5 and 0.7 for due next week', () => {
    const score = deadlineScore(now + 10 * oneDay, now);
    expect(score).toBeGreaterThanOrEqual(0.5);
    expect(score).toBeLessThanOrEqual(0.7);
  });

  it('returns less than 0.5 for far future deadlines', () => {
    expect(deadlineScore(now + 30 * oneDay, now)).toBeLessThan(0.5);
  });

  it('scores monotonically: closer deadline = higher urgency', () => {
    const s1 = deadlineScore(now + oneDay, now);
    const s2 = deadlineScore(now + 3 * oneDay, now);
    const s3 = deadlineScore(now + oneWeek, now);
    const s4 = deadlineScore(now + 2 * oneWeek, now);
    expect(s1).toBeGreaterThan(s2);
    expect(s2).toBeGreaterThan(s3);
    expect(s3).toBeGreaterThanOrEqual(s4);
  });
});

describe('staleConversationScore', () => {
  const oneDay = 24 * 60 * 60 * 1000;
  const oneWeek = 7 * oneDay;

  it('returns a score in [0, 1]', () => {
    const score = staleConversationScore(2 * oneWeek, 30 * oneDay, 10);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('returns higher score for longer stale duration', () => {
    const lowStale = staleConversationScore(oneWeek, 14 * oneDay, 5);
    const highStale = staleConversationScore(6 * oneWeek, 14 * oneDay, 5);
    expect(highStale).toBeGreaterThan(lowStale);
  });

  it('returns higher score for higher activity', () => {
    const lowActivity = staleConversationScore(2 * oneWeek, 1 * oneDay, 2);
    const highActivity = staleConversationScore(2 * oneWeek, 60 * oneDay, 50);
    expect(highActivity).toBeGreaterThan(lowActivity);
  });

  it('handles zero prior activity gracefully', () => {
    const score = staleConversationScore(oneWeek, 0, 0);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
