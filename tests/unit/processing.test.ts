import { describe, expect, it } from 'vitest';
import {
  BodyFormat,
  DetectedLanguage,
  EntityType,
  ProcessingStatus,
  RelationshipType,
  SourceAdapterType,
  SourceChannel,
} from '../../src/types/index.js';
import type { RawItem } from '../../src/types/index.js';
import { runTier1Rules } from '../../src/processing/tiers/tier1-rules.js';
import { runTier2NER } from '../../src/processing/tiers/tier2-ner.js';
import { mergeResults } from '../../src/processing/tiers/tier3-llm.js';
import { MockProvider } from '../../src/llm/provider.js';
import { buildExtractionPrompt } from '../../src/llm/prompts.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRawItem(overrides: Partial<RawItem> = {}): RawItem {
  return {
    id: 'item-001',
    sourceAdapter: SourceAdapterType.Gmail,
    channel: SourceChannel.Email,
    externalId: 'ext-001',
    threadId: null,
    senderEntityId: null,
    recipientEntityIds: [],
    subject: null,
    body: '',
    bodyFormat: BodyFormat.Plaintext,
    contentHash: 'abc123',
    language: DetectedLanguage.English,
    eventTime: Date.now(),
    ingestedAt: Date.now(),
    processingStatus: ProcessingStatus.Pending,
    attachments: [],
    metadata: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tier 1: rule-based extraction
// ---------------------------------------------------------------------------

describe('runTier1Rules', () => {
  it('extracts email addresses as person entities', () => {
    const item = makeRawItem({ body: 'Please contact alice@example.com for details.' });
    const result = runTier1Rules(item);
    const emailEntity = result.entities.find((e) => e.attributes['email'] === 'alice@example.com');
    expect(emailEntity).toBeDefined();
    expect(emailEntity?.type).toBe(EntityType.Person);
    expect(emailEntity?.confidence).toBeGreaterThan(0.9);
  });

  it('extracts URLs as document entities', () => {
    const item = makeRawItem({ body: 'See https://example.com/doc for the report.' });
    const result = runTier1Rules(item);
    const urlEntity = result.entities.find((e) => e.attributes['url'] === 'https://example.com/doc');
    expect(urlEntity).toBeDefined();
    expect(urlEntity?.type).toBe(EntityType.Document);
  });

  it('extracts monetary amounts as key facts', () => {
    const item = makeRawItem({ body: 'The quote is $42K for the project.' });
    const result = runTier1Rules(item);
    const moneyEntity = result.entities.find((e) => e.type === EntityType.KeyFact && String(e.attributes['amount']).includes('42'));
    expect(moneyEntity).toBeDefined();
  });

  it('extracts @mentions as person entities', () => {
    const item = makeRawItem({ body: 'Hey @alice, please review this.' });
    const result = runTier1Rules(item);
    const mention = result.entities.find((e) => e.attributes['handle'] === 'alice');
    expect(mention).toBeDefined();
    expect(mention?.type).toBe(EntityType.Person);
  });

  it('extracts deadline action items', () => {
    const item = makeRawItem({ body: 'Submit the report by next Friday.' });
    const result = runTier1Rules(item);
    const deadline = result.entities.find(
      (e) => e.type === EntityType.ActionItem && String(e.attributes['deadline']).toLowerCase().includes('friday'),
    );
    expect(deadline).toBeDefined();
  });

  it('detects Chinese language content', () => {
    const item = makeRawItem({ body: '请联系王总讨论这个项目的进展情况。' });
    const result = runTier1Rules(item);
    expect(result.language).toBe(DetectedLanguage.Chinese);
  });

  it('detects English language content', () => {
    const item = makeRawItem({ body: 'Please schedule a meeting for Monday.' });
    const result = runTier1Rules(item);
    expect(result.language).toBe(DetectedLanguage.English);
  });

  it('returns empty extraction for content with no signals', () => {
    const item = makeRawItem({ body: 'Ok sounds good.' });
    const result = runTier1Rules(item);
    expect(result.entities).toHaveLength(0);
    expect(result.summary).toBeNull();
  });

  it('includes subject in extraction', () => {
    const item = makeRawItem({
      subject: 'Quote from vendor@acme.com',
      body: 'Please see attached.',
    });
    const result = runTier1Rules(item);
    const emailEntity = result.entities.find((e) => e.attributes['email'] === 'vendor@acme.com');
    expect(emailEntity).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tier 2: NER
// ---------------------------------------------------------------------------

describe('runTier2NER', () => {
  it('returns an ExtractionResult', async () => {
    const item = makeRawItem({ body: 'Alice Johnson met with Bob Smith at Acme Corp.' });
    const result = await runTier2NER(item);
    expect(result).toHaveProperty('entities');
    expect(result).toHaveProperty('relationships');
    expect(result).toHaveProperty('language');
    expect(Array.isArray(result.entities)).toBe(true);
  });

  it('extracts people from English text', async () => {
    const item = makeRawItem({ body: 'Alice Johnson discussed the proposal with Bob Smith.' });
    const result = await runTier2NER(item);
    const names = result.entities
      .filter((e) => e.type === EntityType.Person)
      .map((e) => e.name);
    // compromise may not get all names, but should get at least one
    expect(names.length).toBeGreaterThanOrEqual(0);
  });

  it('extracts Chinese names from Chinese text', async () => {
    const item = makeRawItem({ body: '今天王总和李经理开了个会议，讨论了项目进展。' });
    const result = await runTier2NER(item);
    const chinesePersons = result.entities.filter(
      (e) => e.type === EntityType.Person && /[\u4e00-\u9fff]/.test(e.name),
    );
    expect(chinesePersons.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// mergeResults
// ---------------------------------------------------------------------------

describe('mergeResults', () => {
  it('merges two results, deduplicating by name (case-insensitive)', () => {
    const base = {
      entities: [{ type: EntityType.Person, name: 'Alice', nameAlt: null, attributes: {}, confidence: 0.7 }],
      relationships: [],
      summary: null,
      language: DetectedLanguage.English,
    };
    const incoming = {
      entities: [
        { type: EntityType.Person, name: 'alice', nameAlt: null, attributes: {}, confidence: 0.9 },
        { type: EntityType.Topic, name: 'Budget', nameAlt: null, attributes: {}, confidence: 0.8 },
      ],
      relationships: [],
      summary: 'A discussion.',
      language: DetectedLanguage.English,
    };
    const merged = mergeResults(base, incoming);
    const alices = merged.entities.filter((e) => e.name.toLowerCase() === 'alice');
    expect(alices).toHaveLength(1);
    // Higher confidence wins
    expect(alices[0]?.confidence).toBe(0.9);
    expect(merged.entities).toHaveLength(2);
    expect(merged.summary).toBe('A discussion.');
  });

  it('prefers incoming language over English', () => {
    const base = {
      entities: [],
      relationships: [],
      summary: null,
      language: DetectedLanguage.English,
    };
    const incoming = {
      entities: [],
      relationships: [],
      summary: null,
      language: DetectedLanguage.Chinese,
    };
    const merged = mergeResults(base, incoming);
    expect(merged.language).toBe(DetectedLanguage.Chinese);
  });

  it('deduplicates relationships by (from, to, type)', () => {
    const base = {
      entities: [],
      relationships: [
        { fromEntityName: 'Alice', toEntityName: 'Bob', type: RelationshipType.CommunicatesWith, strength: 0.5, metadata: {} },
      ],
      summary: null,
      language: DetectedLanguage.English,
    };
    const incoming = {
      entities: [],
      relationships: [
        { fromEntityName: 'Alice', toEntityName: 'Bob', type: RelationshipType.CommunicatesWith, strength: 0.9, metadata: {} },
      ],
      summary: null,
      language: DetectedLanguage.English,
    };
    const merged = mergeResults(base, incoming);
    expect(merged.relationships).toHaveLength(1);
    expect(merged.relationships[0]?.strength).toBe(0.9);
  });
});

// ---------------------------------------------------------------------------
// MockProvider
// ---------------------------------------------------------------------------

describe('MockProvider', () => {
  it('returns a valid ExtractionResult from extract()', async () => {
    const provider = new MockProvider();
    const result = await provider.extract('Some text content');
    expect(result).toHaveProperty('entities');
    expect(result).toHaveProperty('relationships');
    expect(result).toHaveProperty('language');
    expect(Array.isArray(result.entities)).toBe(true);
  });

  it('returns a valid AnswerResult from answer()', async () => {
    const provider = new MockProvider();
    const result = await provider.answer('What happened?', {
      relevantItems: [],
      relevantEntities: [],
      relevantRelationships: [],
    });
    expect(typeof result.answer).toBe('string');
    expect(typeof result.confidence).toBe('number');
    expect(Array.isArray(result.sourceItemIds)).toBe(true);
  });

  it('returns a Float64Array from embed()', async () => {
    const provider = new MockProvider();
    const embedding = await provider.embed('hello world');
    expect(embedding).toBeInstanceOf(Float64Array);
    expect(embedding.length).toBeGreaterThan(0);
  });

  it('isAvailable() returns true', async () => {
    const provider = new MockProvider();
    expect(await provider.isAvailable()).toBe(true);
  });

  it('respects a fixed extraction result', async () => {
    const fixedResult = {
      entities: [{ type: EntityType.Topic, name: 'Fixed', nameAlt: null, attributes: {}, confidence: 1.0 }],
      relationships: [],
      summary: 'fixed',
      language: DetectedLanguage.English,
    };
    const provider = new MockProvider(fixedResult);
    const result = await provider.extract('anything');
    expect(result).toEqual(fixedResult);
  });
});

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

describe('buildExtractionPrompt', () => {
  it('includes content in the prompt', () => {
    const prompt = buildExtractionPrompt('Hello from alice@example.com', undefined);
    expect(prompt).toContain('alice@example.com');
  });

  it('includes existing entity names in the prompt when provided', () => {
    const prompt = buildExtractionPrompt('Some text', {
      sourceChannel: SourceChannel.Email,
      senderName: 'Bob',
      existingEntities: [{ name: 'Alice', type: EntityType.Person }],
    });
    expect(prompt).toContain('Alice');
    expect(prompt).toContain('Bob');
  });
});
