import {
  DetectedLanguage,
  EntityType,
  RelationshipType,
} from '../../types/index.js';
import type { ExtractionResult, RawItem } from '../../types/index.js';

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

const EMAIL_RE =
  /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g;

// International phone: +1-555-123-4567, (555) 123-4567, +86 138 0000 0000, etc.
const PHONE_RE =
  /(?:\+\d{1,3}[\s\-]?)?\(?\d{2,4}\)?[\s\-]?\d{3,4}[\s\-]?\d{3,6}(?!\d)/g;

// URLs
const URL_RE =
  /https?:\/\/[^\s<>"']+/gi;

// Monetary amounts: $42K, ¥100, €50, USD 1,000, CNY 500
const MONEY_RE =
  /(?:USD|CNY|EUR|GBP|JPY|¥|€|£|\$)\s*[\d,]+(?:\.\d+)?(?:K|M|B)?|[\d,]+(?:\.\d+)?(?:K|M|B)?\s*(?:USD|CNY|EUR|GBP|JPY)/gi;

// @mentions
const MENTION_RE = /@([a-zA-Z0-9_\u4e00-\u9fff]+)/g;

// Absolute date patterns
const DATE_RE =
  /\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4})\b/gi;

// Relative date / deadline markers
const RELATIVE_DATE_RE =
  /\b(?:next\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|week|month)|(?:this|last)\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|week|month)|tomorrow|today|EOD|end\s+of\s+(?:day|week|month|quarter))\b/gi;

// Deadline keywords that precede a date or time reference
const DEADLINE_SIGNAL_RE =
  /\b(?:by|due|deadline|before|until|no\s+later\s+than)\b/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function detectLanguage(text: string): DetectedLanguage {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const totalChars = text.replace(/\s/g, '').length;
  if (totalChars === 0) return DetectedLanguage.English;
  const ratio = chineseChars / totalChars;
  if (ratio > 0.4) return DetectedLanguage.Chinese;
  if (ratio > 0.05) return DetectedLanguage.Mixed;
  return DetectedLanguage.English;
}

// ---------------------------------------------------------------------------
// Tier 1 extraction
// ---------------------------------------------------------------------------

export function runTier1Rules(item: RawItem): ExtractionResult {
  const text = [item.subject ?? '', item.body].join(' ');
  const language = detectLanguage(text);

  const entities: ExtractionResult['entities'] = [];
  const relationships: ExtractionResult['relationships'] = [];

  // --- Emails → person aliases ---
  const emails = dedupe(text.match(EMAIL_RE) ?? []);
  for (const email of emails) {
    entities.push({
      type: EntityType.Person,
      name: email,
      nameAlt: null,
      attributes: { email },
      confidence: 0.95,
    });
  }

  // --- Phone numbers ---
  const rawPhones = text.match(PHONE_RE) ?? [];
  const phones = dedupe(rawPhones.map((p) => p.trim()));
  for (const phone of phones) {
    // Skip if it looks like a date (e.g. 2024/01/01)
    if (/^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(phone)) continue;
    entities.push({
      type: EntityType.Person,
      name: phone,
      nameAlt: null,
      attributes: { phone },
      confidence: 0.85,
    });
  }

  // --- URLs → document references ---
  const urls = dedupe(text.match(URL_RE) ?? []);
  for (const url of urls) {
    entities.push({
      type: EntityType.Document,
      name: url,
      nameAlt: null,
      attributes: { url },
      confidence: 0.9,
    });
  }

  // --- Monetary amounts → key facts ---
  const amounts = dedupe(text.match(MONEY_RE) ?? []);
  for (const amount of amounts) {
    entities.push({
      type: EntityType.KeyFact,
      name: `Amount: ${amount.trim()}`,
      nameAlt: null,
      attributes: { amount: amount.trim() },
      confidence: 0.9,
    });
  }

  // --- @mentions → person references ---
  const mentions: string[] = [];
  let m: RegExpExecArray | null;
  const mentionRe = new RegExp(MENTION_RE.source, 'g');
  while ((m = mentionRe.exec(text)) !== null) {
    const handle = m[1];
    if (handle) mentions.push(handle);
  }
  for (const handle of dedupe(mentions)) {
    entities.push({
      type: EntityType.Person,
      name: `@${handle}`,
      nameAlt: null,
      attributes: { handle },
      confidence: 0.8,
    });
  }

  // --- Dates and deadlines → action item signals ---
  const absoluteDates = dedupe(text.match(DATE_RE) ?? []);
  const relativeDates = dedupe(text.match(RELATIVE_DATE_RE) ?? []);
  const allDates = [...absoluteDates, ...relativeDates];

  for (const date of allDates) {
    // Check proximity to a deadline keyword (rough heuristic: within 100 chars)
    const idx = text.toLowerCase().indexOf(date.toLowerCase());
    const surroundingText = text.slice(Math.max(0, idx - 100), idx + date.length + 20);
    const isDeadline = DEADLINE_SIGNAL_RE.test(surroundingText);

    if (isDeadline) {
      entities.push({
        type: EntityType.ActionItem,
        name: `Deadline: ${date}`,
        nameAlt: null,
        attributes: { deadline: date, extractedFrom: surroundingText.trim().slice(0, 100) },
        confidence: 0.75,
      });
    } else {
      entities.push({
        type: EntityType.KeyFact,
        name: `Date: ${date}`,
        nameAlt: null,
        attributes: { date },
        confidence: 0.7,
      });
    }
  }

  // --- Cross-entity relationships: sender → mentions ---
  if (item.senderEntityId && emails.length > 0) {
    for (const email of emails.slice(0, 3)) {
      relationships.push({
        fromEntityName: item.senderEntityId,
        toEntityName: email,
        type: RelationshipType.CommunicatesWith,
        strength: 0.6,
        metadata: { source: 'tier1_rules' },
      });
    }
  }

  return {
    entities,
    relationships,
    summary: null,
    language,
  };
}
