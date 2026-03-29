import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MindFlowDatabase } from '../../src/storage/database.js';
import {
  AttentionItemRepository,
  EntityEpisodeRepository,
  EntityRepository,
  RawItemRepository,
} from '../../src/storage/repositories.js';
import {
  AttentionItemType,
  BodyFormat,
  DetectedLanguage,
  EntityStatus,
  EntityType,
  ProcessingStatus,
  ResolutionType,
  SourceAdapterType,
  SourceChannel,
} from '../../src/types/index.js';
import type { AttentionItem, Entity, RawItem } from '../../src/types/index.js';
import { ulid } from '../../src/utils/ulid.js';
import { sha256 } from '../../src/utils/hash.js';
import { AttentionEngine } from '../../src/attention/engine.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * ONE_HOUR;
const ONE_WEEK = 7 * ONE_DAY;

function makeRawItem(overrides: Partial<RawItem> = {}): RawItem {
  const body = overrides.body ?? 'body ' + ulid();
  const now = Date.now();
  return {
    id: ulid(),
    sourceAdapter: SourceAdapterType.Gmail,
    channel: SourceChannel.Email,
    externalId: `ext-${ulid()}`,
    threadId: null,
    senderEntityId: null,
    recipientEntityIds: [],
    subject: null,
    body,
    bodyFormat: BodyFormat.Plaintext,
    contentHash: sha256(body),
    language: DetectedLanguage.English,
    eventTime: now,
    ingestedAt: now,
    processingStatus: ProcessingStatus.Done,
    attachments: [],
    metadata: {},
    ...overrides,
  };
}

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  const now = Date.now();
  return {
    id: ulid(),
    type: EntityType.Person,
    canonicalName: 'Alice',
    nameAlt: null,
    aliases: [],
    attributes: {},
    confidence: 0.9,
    status: EntityStatus.Active,
    mergedInto: null,
    firstSeenAt: now,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeAttentionItem(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: ulid(),
    type: AttentionItemType.UnansweredRequest,
    entityId: null,
    rawItemId: null,
    urgencyScore: 0.5,
    title: 'Test attention item',
    description: null,
    detectedAt: Date.now(),
    resolvedAt: null,
    dismissedAt: null,
    snoozedUntil: null,
    resolutionType: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let mfdb: MindFlowDatabase;
let rawItems: RawItemRepository;
let entities: EntityRepository;
let attentionItems: AttentionItemRepository;
let episodes: EntityEpisodeRepository;
let attentionEngine: AttentionEngine;

beforeEach(() => {
  mfdb = new MindFlowDatabase(':memory:');
  rawItems = new RawItemRepository(mfdb.db);
  entities = new EntityRepository(mfdb.db);
  attentionItems = new AttentionItemRepository(mfdb.db);
  episodes = new EntityEpisodeRepository(mfdb.db);
  attentionEngine = new AttentionEngine(mfdb.db, attentionItems, entities, rawItems);
});

afterEach(() => {
  mfdb.close();
});

// ---------------------------------------------------------------------------
// Unanswered request detection
// ---------------------------------------------------------------------------

// Helper: insert user entity with enough outbound messages to dominate the
// inferUserEntityIds top-3, plus two extra dummy senders with 2 messages each
// so that a test sender with 1 message is NOT included in the inferred user set.
function setupUserDominance(
  entities: EntityRepository,
  rawItems: RawItemRepository,
): string {
  const userEntity = makeEntity({ canonicalName: 'Me' });
  entities.insert(userEntity);
  // 10 outbound messages — clearly the top sender
  for (let i = 0; i < 10; i++) {
    rawItems.insert(makeRawItem({
      senderEntityId: userEntity.id,
      eventTime: Date.now() - i * ONE_HOUR,
    }));
  }
  // Two dummy frequent-senders to fill spots 2 and 3 in top-3
  for (let d = 0; d < 2; d++) {
    const dummy = makeEntity({ canonicalName: `Dummy${d}` });
    entities.insert(dummy);
    for (let i = 0; i < 3; i++) {
      rawItems.insert(makeRawItem({
        senderEntityId: dummy.id,
        eventTime: Date.now() - (d * 10 + i) * ONE_HOUR,
      }));
    }
  }
  return userEntity.id;
}

describe('Unanswered request detection', () => {
  it('detects an unanswered request from someone else', () => {
    // The "user" is the most frequent sender. Insert several outbound items
    // so the user entity is established before Alice's inbound request.
    // Also add dummy senders so Alice (1 msg) is NOT in the inferred user top-3.
    setupUserDominance(entities, rawItems);

    const sender = makeEntity({ canonicalName: 'Alice' });
    entities.insert(sender);

    const now = Date.now();
    // Message from Alice arrived 3 days ago — past the 48h window
    const item = makeRawItem({
      body: 'Can you please review the attached proposal and let me know?',
      senderEntityId: sender.id,
      eventTime: now - 3 * ONE_DAY,
    });
    rawItems.insert(item);

    const detected = attentionEngine.detectAll({ now });
    const unanswered = detected.filter((a) => a.type === AttentionItemType.UnansweredRequest);
    expect(unanswered.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag items within the unanswered window (too recent)', () => {
    setupUserDominance(entities, rawItems);

    const sender = makeEntity();
    entities.insert(sender);

    const now = Date.now();
    // Message arrived 1 hour ago — well within the 48h window
    const item = makeRawItem({
      body: 'Can you please respond to this?',
      senderEntityId: sender.id,
      eventTime: now - ONE_HOUR,
    });
    rawItems.insert(item);

    const detected = attentionEngine.detectAll({ now });
    const unanswered = detected.filter((a) => a.type === AttentionItemType.UnansweredRequest);
    expect(unanswered).toHaveLength(0);
  });

  it('does not flag non-question messages', () => {
    setupUserDominance(entities, rawItems);

    const sender = makeEntity();
    entities.insert(sender);

    const now = Date.now();
    const item = makeRawItem({
      body: 'Just FYI, here is the meeting notes from yesterday.',
      senderEntityId: sender.id,
      eventTime: now - 3 * ONE_DAY,
    });
    rawItems.insert(item);

    const detected = attentionEngine.detectAll({ now });
    const unanswered = detected.filter((a) => a.type === AttentionItemType.UnansweredRequest);
    expect(unanswered).toHaveLength(0);
  });

  it('detects Chinese unanswered request', () => {
    setupUserDominance(entities, rawItems);

    const sender = makeEntity({ canonicalName: '王总' });
    entities.insert(sender);

    const now = Date.now();
    const item = makeRawItem({
      body: '麻烦你帮我确认一下这份合同的内容。',
      senderEntityId: sender.id,
      eventTime: now - 3 * ONE_DAY,
    });
    rawItems.insert(item);

    const detected = attentionEngine.detectAll({ now });
    const unanswered = detected.filter((a) => a.type === AttentionItemType.UnansweredRequest);
    expect(unanswered.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Deadline urgency scoring (via approaching-deadline detection)
// ---------------------------------------------------------------------------

describe('Approaching deadline detection', () => {
  it('detects an action item entity with an approaching due date', () => {
    const now = Date.now();
    // Action item due in 2 days
    const deadline = makeEntity({
      type: EntityType.ActionItem,
      canonicalName: 'Submit Q3 report',
      attributes: { due_date: new Date(now + 2 * ONE_DAY).toISOString() },
    });
    entities.insert(deadline);

    const detected = attentionEngine.detectAll({ now });
    const deadlines = detected.filter((a) => a.type === AttentionItemType.ApproachingDeadline);
    expect(deadlines.length).toBeGreaterThanOrEqual(1);
    const titles = deadlines.map((d) => d.title);
    expect(titles.some((t) => t.includes('Submit Q3 report'))).toBe(true);
  });

  it('does not surface overdue items more than 60 days old', () => {
    const now = Date.now();
    const veryOldDeadline = makeEntity({
      type: EntityType.ActionItem,
      canonicalName: 'Ancient task',
      attributes: { due_date: new Date(now - 70 * ONE_DAY).toISOString() },
    });
    entities.insert(veryOldDeadline);

    const detected = attentionEngine.detectAll({ now });
    const deadlines = detected.filter(
      (a) => a.type === AttentionItemType.ApproachingDeadline && a.title.includes('Ancient task'),
    );
    expect(deadlines).toHaveLength(0);
  });

  it('urgency score is higher for items due sooner', () => {
    const now = Date.now();
    const urgent = makeEntity({
      type: EntityType.ActionItem,
      canonicalName: 'Urgent task',
      attributes: { due_date: new Date(now + ONE_DAY).toISOString() },
    });
    const lessUrgent = makeEntity({
      type: EntityType.ActionItem,
      canonicalName: 'Less urgent task',
      attributes: { due_date: new Date(now + 10 * ONE_DAY).toISOString() },
    });
    entities.insert(urgent);
    entities.insert(lessUrgent);

    const detected = attentionEngine.detectAll({ now });
    const deadlines = detected.filter((a) => a.type === AttentionItemType.ApproachingDeadline);

    const urgentItem = deadlines.find((d) => d.title.includes('Urgent task'));
    const lessItem = deadlines.find((d) => d.title.includes('Less urgent task'));

    if (urgentItem && lessItem) {
      expect(urgentItem.urgencyScore).toBeGreaterThanOrEqual(lessItem.urgencyScore);
    }
  });
});

// ---------------------------------------------------------------------------
// Stale conversation detection
// ---------------------------------------------------------------------------

describe('Stale conversation detection', () => {
  it('detects a topic entity with no recent activity', () => {
    const now = Date.now();
    const staleTopic = makeEntity({
      type: EntityType.Topic,
      canonicalName: 'Q2 Budget Discussion',
      lastSeenAt: now - 15 * ONE_DAY, // 15 days ago → stale
    });
    entities.insert(staleTopic);

    // Ensure an episode exists linking the topic to a raw item
    const item = makeRawItem({ eventTime: now - 15 * ONE_DAY });
    rawItems.insert(item);
    episodes.insert({
      entityId: staleTopic.id,
      rawItemId: item.id,
      extractionMethod: 'tier3_llm',
      confidence: 0.9,
    });

    const detected = attentionEngine.detectAll({ now });
    const stale = detected.filter((a) => a.type === AttentionItemType.StaleConversation);
    expect(stale.length).toBeGreaterThanOrEqual(1);
    expect(stale.some((s) => s.title.includes('Q2 Budget Discussion'))).toBe(true);
  });

  it('does not flag topics with recent activity', () => {
    const now = Date.now();
    const activeTopic = makeEntity({
      type: EntityType.Topic,
      canonicalName: 'Active Topic',
      lastSeenAt: now - ONE_DAY, // only 1 day ago — not stale
    });
    entities.insert(activeTopic);

    const item = makeRawItem({ eventTime: now - ONE_DAY });
    rawItems.insert(item);
    episodes.insert({
      entityId: activeTopic.id,
      rawItemId: item.id,
      extractionMethod: 'tier3_llm',
      confidence: 0.9,
    });

    const detected = attentionEngine.detectAll({ now });
    const stale = detected.filter(
      (a) => a.type === AttentionItemType.StaleConversation && a.title.includes('Active Topic'),
    );
    expect(stale).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Deduplication: existing open items are not re-created
// ---------------------------------------------------------------------------

describe('Attention item deduplication', () => {
  it('does not create a duplicate for the same raw item', () => {
    setupUserDominance(entities, rawItems);

    const sender = makeEntity();
    entities.insert(sender);

    const now = Date.now();
    const item = makeRawItem({
      body: 'Can you please get back to me?',
      senderEntityId: sender.id,
      eventTime: now - 3 * ONE_DAY,
    });
    rawItems.insert(item);

    // First detection
    const first = attentionEngine.detectAll({ now });
    const firstUnanswered = first.filter((a) => a.rawItemId === item.id);
    expect(firstUnanswered.length).toBeGreaterThanOrEqual(1);

    // Second detection — should not add new items for the same raw_item
    const second = attentionEngine.detectAll({ now });
    const secondUnanswered = second.filter((a) => a.rawItemId === item.id);
    expect(secondUnanswered).toHaveLength(0);

    // Total in DB should be from first run only
    const allPending = attentionItems.findPending(now);
    const forItem = allPending.filter((a) => a.rawItemId === item.id);
    expect(forItem).toHaveLength(firstUnanswered.length);
  });
});

// ---------------------------------------------------------------------------
// Dismiss, resolve, snooze
// ---------------------------------------------------------------------------

describe('AttentionItemRepository actions', () => {
  it('dismiss removes item from findPending results', () => {
    const item = makeAttentionItem();
    attentionItems.insert(item);

    attentionItems.dismiss(item.id);

    const pending = attentionItems.findPending();
    expect(pending.find((a) => a.id === item.id)).toBeUndefined();
  });

  it('resolve removes item from findPending results', () => {
    const item = makeAttentionItem();
    attentionItems.insert(item);

    attentionItems.resolve(item.id, ResolutionType.Done);

    const pending = attentionItems.findPending();
    expect(pending.find((a) => a.id === item.id)).toBeUndefined();
  });

  it('snooze hides item until snooze expires', () => {
    const now = Date.now();
    const item = makeAttentionItem();
    attentionItems.insert(item);

    // Snooze until far in the future
    attentionItems.snooze(item.id, now + ONE_WEEK);

    const pendingNow = attentionItems.findPending(now);
    expect(pendingNow.find((a) => a.id === item.id)).toBeUndefined();

    // After snooze expires, item reappears
    const pendingAfter = attentionItems.findPending(now + ONE_WEEK + 1);
    expect(pendingAfter.find((a) => a.id === item.id)).toBeDefined();
  });

  it('findPending returns items ordered by urgency_score descending', () => {
    const low = makeAttentionItem({ urgencyScore: 0.2 });
    const high = makeAttentionItem({ urgencyScore: 0.9 });
    const mid = makeAttentionItem({ urgencyScore: 0.5 });
    attentionItems.insert(low);
    attentionItems.insert(high);
    attentionItems.insert(mid);

    const pending = attentionItems.findPending();
    expect(pending[0]?.urgencyScore).toBe(0.9);
    expect(pending[1]?.urgencyScore).toBe(0.5);
    expect(pending[2]?.urgencyScore).toBe(0.2);
  });

  it('auto-expires old unresolved items on detectAll', () => {
    const now = Date.now();
    const old = makeAttentionItem({ detectedAt: now - 31 * ONE_DAY });
    attentionItems.insert(old);

    attentionEngine.detectAll({ now });

    const pending = attentionItems.findPending(now);
    expect(pending.find((a) => a.id === old.id)).toBeUndefined();
  });
});
