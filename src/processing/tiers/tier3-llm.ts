import type {
  ExtractionContext,
  ExtractionResult,
  LLMProvider,
  RawItem,
} from '../../types/index.js';
import {
  DetectedLanguage,
  EntityType,
  PrivacyMode,
  RelationshipType,
} from '../../types/index.js';
import { OllamaProvider } from '../../llm/provider.js';
import { redactPII, piiDensity } from '../privacy.js';

// ---------------------------------------------------------------------------
// Merge two partial ExtractionResults, preferring higher-confidence entries
// and deduplicating by entity name.
// ---------------------------------------------------------------------------

export function mergeResults(
  base: ExtractionResult,
  incoming: ExtractionResult,
): ExtractionResult {
  const entityMap = new Map<string, ExtractionResult['entities'][number]>();

  for (const e of [...base.entities, ...incoming.entities]) {
    const key = e.name.toLowerCase().trim();
    const existing = entityMap.get(key);
    if (!existing || e.confidence > existing.confidence) {
      entityMap.set(key, e);
    }
  }

  // Deduplicate relationships by (from, to, type)
  const relMap = new Map<string, ExtractionResult['relationships'][number]>();
  for (const r of [...base.relationships, ...incoming.relationships]) {
    const key = `${r.fromEntityName}|${r.toEntityName}|${r.type}`;
    const existing = relMap.get(key);
    if (!existing || r.strength > existing.strength) {
      relMap.set(key, r);
    }
  }

  const language =
    incoming.language !== DetectedLanguage.English
      ? incoming.language
      : base.language;

  return {
    entities: Array.from(entityMap.values()),
    relationships: Array.from(relMap.values()),
    summary: incoming.summary ?? base.summary,
    language,
  };
}

// ---------------------------------------------------------------------------
// Tier 3: LLM-based structured extraction
// ---------------------------------------------------------------------------

/** High-PII density threshold for ContentAware routing (>15% of chars = PII). */
const HIGH_PII_DENSITY_THRESHOLD = 0.15;

export interface Tier3Options {
  privacyMode?: PrivacyMode;
  /** Fallback local provider used when privacy routing forces local-only. */
  localProvider?: LLMProvider;
}

export async function runTier3LLM(
  item: RawItem,
  tier1Result: ExtractionResult,
  tier2Result: ExtractionResult,
  provider: LLMProvider,
  options: Tier3Options = {},
): Promise<ExtractionResult> {
  const privacyMode = options.privacyMode ?? PrivacyMode.MinimalCloud;

  // --- Privacy routing ---
  // Determine which provider actually sends the request, and whether to
  // redact PII from the content before sending.
  let activeProvider = provider;
  let shouldRedact = false;

  if (privacyMode === PrivacyMode.FullLocal) {
    // Never send to cloud — use local provider (Ollama) or skip tier 3
    activeProvider = options.localProvider ?? new OllamaProvider();
  } else if (privacyMode === PrivacyMode.ContentAware) {
    // Check PII density; if high, fall back to local provider
    const senderEmail = extractSenderEmail(item, tier1Result);
    const { piiFound } = redactPII(item.body, senderEmail);
    if (piiDensity(item.body, piiFound) > HIGH_PII_DENSITY_THRESHOLD) {
      activeProvider = options.localProvider ?? new OllamaProvider();
    } else {
      shouldRedact = true; // cloud-safe but still redact for defence-in-depth
    }
  } else {
    // MinimalCloud: always use cloud, but still redact PII before sending
    shouldRedact = true;
  }

  // --- Build content, optionally with PII redacted ---
  const senderEmail = extractSenderEmail(item, tier1Result);
  const contentItem: RawItem = shouldRedact
    ? redactItem(item, senderEmail)
    : item;

  // Build context from existing tier 1+2 findings
  const existingEntities = [
    ...tier1Result.entities,
    ...tier2Result.entities,
  ]
    .filter((e) => e.type === EntityType.Person || e.type === EntityType.Topic)
    .slice(0, 30)
    .map((e) => ({ name: e.name, type: e.type }));

  const context: ExtractionContext = {
    sourceChannel: item.channel,
    senderName: null,
    existingEntities,
  };

  const content = buildLLMContent(contentItem, tier1Result, tier2Result);
  const llmResult = await activeProvider.extract(content, context);

  // Merge: tier1 ← tier2 ← llm, where llm wins on conflicts
  const merged12 = mergeResults(tier1Result, tier2Result);
  return mergeResults(merged12, llmResult);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return a copy of the item with body (and subject) PII-redacted. */
function redactItem(item: RawItem, senderEmail: string | null): RawItem {
  const { redacted: redactedBody } = redactPII(item.body, senderEmail);
  const redactedSubject =
    item.subject ? redactPII(item.subject, senderEmail).redacted : null;
  return { ...item, body: redactedBody, subject: redactedSubject };
}

/** Best-effort extraction of the sender's email from tier1 results. */
function extractSenderEmail(
  item: RawItem,
  tier1Result: ExtractionResult,
): string | null {
  // Tier1 entities with a sender hint
  for (const e of tier1Result.entities) {
    if (e.attributes['email'] && e.attributes['is_sender']) {
      return String(e.attributes['email']);
    }
  }
  // Fall back to metadata if the adapter stored it
  const meta = item.metadata as Record<string, unknown>;
  if (typeof meta['senderEmail'] === 'string') return meta['senderEmail'];
  return null;
}

// ---------------------------------------------------------------------------
// Build the content string to send to the LLM, incorporating tier 1+2 hints
// ---------------------------------------------------------------------------

function buildLLMContent(
  item: RawItem,
  tier1Result: ExtractionResult,
  tier2Result: ExtractionResult,
): string {
  const lines: string[] = [];

  if (item.subject) {
    lines.push(`Subject: ${item.subject}`);
  }
  lines.push(`Body:\n${item.body}`);

  const tier1Hits: string[] = [];
  for (const e of tier1Result.entities) {
    if (e.attributes['email']) {
      tier1Hits.push(`email: ${String(e.attributes['email'])}`);
    }
    if (e.attributes['phone']) {
      tier1Hits.push(`phone: ${String(e.attributes['phone'])}`);
    }
    if (e.attributes['deadline']) {
      tier1Hits.push(`deadline: ${String(e.attributes['deadline'])}`);
    }
    if (e.attributes['amount']) {
      tier1Hits.push(`monetary amount: ${String(e.attributes['amount'])}`);
    }
    if (e.attributes['url']) {
      tier1Hits.push(`url: ${String(e.attributes['url'])}`);
    }
  }

  if (tier1Hits.length > 0) {
    lines.push(`\nRule-based signals already detected:\n${tier1Hits.join(', ')}`);
  }

  const tier2Names = [
    ...tier2Result.entities
      .filter((e) => e.type === EntityType.Person)
      .map((e) => e.name),
  ];
  if (tier2Names.length > 0) {
    lines.push(`\nNER-detected names: ${tier2Names.join(', ')}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Re-export constants that callers may need
// ---------------------------------------------------------------------------

export { DetectedLanguage, EntityType, RelationshipType };
