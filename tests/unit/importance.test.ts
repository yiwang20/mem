import { describe, expect, it } from 'vitest';
import { scoreImportance, scoreImportanceDetailed } from '../../src/processing/importance.js';
import {
  BodyFormat,
  DetectedLanguage,
  EntityType,
  ProcessingStatus,
  SourceAdapterType,
  SourceChannel,
} from '../../src/types/index.js';
import type { ExtractionResult, RawItem } from '../../src/types/index.js';
import { ulid } from '../../src/utils/ulid.js';
import { sha256 } from '../../src/utils/hash.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(body: string, overrides: Partial<RawItem> = {}): RawItem {
  return {
    id: ulid(),
    sourceAdapter: SourceAdapterType.Gmail,
    channel: SourceChannel.Email,
    externalId: ulid(),
    threadId: null,
    senderEntityId: null,
    recipientEntityIds: [],
    subject: null,
    body,
    bodyFormat: BodyFormat.Plaintext,
    contentHash: sha256(body),
    language: DetectedLanguage.English,
    eventTime: Date.now(),
    ingestedAt: Date.now(),
    processingStatus: ProcessingStatus.Done,
    attachments: [],
    metadata: {},
    ...overrides,
  };
}

const emptyTier1: ExtractionResult = {
  entities: [],
  relationships: [],
  summary: null,
  language: DetectedLanguage.English,
};

function tier1With(attrs: Record<string, unknown>[]): ExtractionResult {
  return {
    entities: attrs.map((a) => ({
      type: EntityType.KeyFact,
      name: 'signal',
      nameAlt: null,
      attributes: a,
      confidence: 1.0,
    })),
    relationships: [],
    summary: null,
    language: DetectedLanguage.English,
  };
}

function tier1WithActionItem(): ExtractionResult {
  return {
    entities: [
      {
        type: EntityType.ActionItem,
        name: 'do something',
        nameAlt: null,
        attributes: {},
        confidence: 1.0,
      },
    ],
    relationships: [],
    summary: null,
    language: DetectedLanguage.English,
  };
}

// ---------------------------------------------------------------------------
// Individual signal tests
// ---------------------------------------------------------------------------

describe('action item signal (+0.3)', () => {
  it('adds 0.3 when an ActionItem entity is present', () => {
    const { signals } = scoreImportanceDetailed(makeItem('do x'), tier1WithActionItem());
    expect(signals['action_item']).toBe(0.3);
  });

  it('adds 0.3 when deadline_signal attribute is present', () => {
    const { signals } = scoreImportanceDetailed(
      makeItem('by next Friday'),
      tier1With([{ deadline_signal: 'next Friday' }]),
    );
    expect(signals['action_item']).toBe(0.3);
  });

  it('does not add when no action signals', () => {
    const { signals } = scoreImportanceDetailed(makeItem('hello'), emptyTier1);
    expect(signals['action_item']).toBeUndefined();
  });
});

describe('monetary amount signal (+0.2)', () => {
  it('adds 0.2 when amount attribute detected', () => {
    const { signals } = scoreImportanceDetailed(
      makeItem('invoice $500'),
      tier1With([{ amount: '$500' }]),
    );
    expect(signals['monetary_amount']).toBe(0.2);
  });
});

describe('deadline signal (+0.2)', () => {
  it('adds 0.2 when deadline attribute detected', () => {
    const { signals } = scoreImportanceDetailed(
      makeItem('due 2026-04-01'),
      tier1With([{ deadline: '2026-04-01' }]),
    );
    expect(signals['deadline']).toBe(0.2);
  });
});

describe('question signal (+0.1)', () => {
  it('adds 0.1 when body contains ?', () => {
    const { signals } = scoreImportanceDetailed(makeItem('Can you review?'), emptyTier1);
    expect(signals['has_question']).toBe(0.1);
  });

  it('does not add when no ?', () => {
    const { signals } = scoreImportanceDetailed(makeItem('FYI only'), emptyTier1);
    expect(signals['has_question']).toBeUndefined();
  });
});

describe('long message signal (+0.1)', () => {
  it('adds 0.1 for body > 200 chars', () => {
    const { signals } = scoreImportanceDetailed(makeItem('x'.repeat(201)), emptyTier1);
    expect(signals['long_message']).toBe(0.1);
  });

  it('does not add for body <= 200 chars', () => {
    const { signals } = scoreImportanceDetailed(makeItem('x'.repeat(200)), emptyTier1);
    expect(signals['long_message']).toBeUndefined();
  });
});

describe('frequent contact signal (+0.1)', () => {
  it('adds 0.1 when sender is in frequent contact set', () => {
    const senderId = ulid();
    const item = makeItem('hello', { senderEntityId: senderId });
    const { signals } = scoreImportanceDetailed(item, emptyTier1, new Set([senderId]));
    expect(signals['frequent_contact']).toBe(0.1);
  });

  it('does not add when sender not in frequent contact set', () => {
    const item = makeItem('hello', { senderEntityId: ulid() });
    const { signals } = scoreImportanceDetailed(item, emptyTier1, new Set([ulid()]));
    expect(signals['frequent_contact']).toBeUndefined();
  });

  it('does not add when senderEntityId is null', () => {
    const { signals } = scoreImportanceDetailed(makeItem('hi'), emptyTier1, new Set([ulid()]));
    expect(signals['frequent_contact']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Combined / clamping
// ---------------------------------------------------------------------------

describe('combined scoring', () => {
  it('returns 0 for a plain unimportant item', () => {
    expect(scoreImportance(makeItem('FYI meeting notes attached.'), emptyTier1)).toBe(0);
  });

  it('adds up multiple signals correctly', () => {
    const item = makeItem('Invoice $500 due by Friday?'); // ? = +0.1
    const tier1 = tier1With([{ amount: '$500' }, { deadline: 'Friday' }]); // +0.2 +0.2
    const score = scoreImportance(item, tier1);
    expect(score).toBeCloseTo(0.5, 5);
  });

  it('caps at 1.0 when all signals fire', () => {
    const senderId = ulid();
    const item = makeItem('x'.repeat(201) + '?', { senderEntityId: senderId });
    const tier1 = tier1With([{ amount: '$1000', deadline: '2026-01-01', deadline_signal: 'now' }]);
    const score = scoreImportance(item, tier1, new Set([senderId]));
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it('reaches the default 0.3 threshold with just an action item', () => {
    const score = scoreImportance(makeItem('please do X'), tier1WithActionItem());
    expect(score).toBeGreaterThanOrEqual(0.3);
  });
});
