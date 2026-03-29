// ============================================================================
// PII detection and redaction
// ============================================================================

export interface PIIMatch {
  type: 'credit_card' | 'ssn' | 'phone' | 'email';
  original: string;
  replacement: string;
  index: number;
}

export interface RedactionResult {
  redacted: string;
  piiFound: PIIMatch[];
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

// 16-digit cards: plain (4916123456781234), spaced (4916 1234 5678 1234),
// or dashed (4916-1234-5678-1234).
const CARD_RE =
  /\b(?:\d{4}[- ]){3}\d{4}\b|\b\d{16}\b/g;

// SSN: 123-45-6789
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;

// Phone: matches common US/international formats already covered by tier1,
// but we now mask them.
// Accepts: +1-800-555-0100, (800) 555-0100, 800.555.0100, +861380000001
const PHONE_RE =
  /(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b|\+\d{10,15}\b/g;

// Email: user@domain.tld
const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan `text` for PII patterns and replace each match with a placeholder.
 * The replacement tokens are stable so the LLM can still parse sentence
 * structure around them.
 *
 * @param text   Raw text to scan (item body or subject).
 * @param senderEmail  Optional sender email to preserve (not redacted).
 */
export function redactPII(
  text: string,
  senderEmail?: string | null,
): RedactionResult {
  const matches: PIIMatch[] = [];

  // Work with a mutable copy; we'll replace matches in a single pass using
  // offset tracking so earlier replacements don't shift later indices.
  // Collect all matches first, then apply right-to-left to avoid index drift.

  const collected: Array<{
    start: number;
    end: number;
    type: PIIMatch['type'];
    original: string;
    replacement: string;
  }> = [];

  const collect = (
    re: RegExp,
    type: PIIMatch['type'],
    makeReplacement: (match: string) => string,
    skip?: (match: string) => boolean,
  ) => {
    re.lastIndex = 0; // reset stateful global regex
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const original = m[0];
      if (skip && skip(original)) continue;
      collected.push({
        start: m.index,
        end: m.index + original.length,
        type,
        original,
        replacement: makeReplacement(original),
      });
    }
  };

  // Collect credit cards — show last 4 digits in the token
  collect(CARD_RE, 'credit_card', (s) => {
    const digits = s.replace(/\D/g, '');
    return `[CARD_${digits.slice(-4)}]`;
  });

  // Collect SSNs
  collect(SSN_RE, 'ssn', () => '[SSN_REDACTED]');

  // Collect phones
  collect(PHONE_RE, 'phone', () => '[PHONE_REDACTED]');

  // Collect emails — skip the sender's own address if provided
  collect(EMAIL_RE, 'email', () => '[EMAIL_REDACTED]', (s) =>
    senderEmail != null && s.toLowerCase() === senderEmail.toLowerCase(),
  );

  // Remove overlapping matches (keep the one that starts earlier; on tie, longer wins)
  const deduped = deduplicateMatches(collected);

  // Sort right-to-left so string indices remain valid as we replace
  deduped.sort((a, b) => b.start - a.start);

  let result = text;
  for (const hit of deduped) {
    result = result.slice(0, hit.start) + hit.replacement + result.slice(hit.end);
    matches.push({
      type: hit.type,
      original: hit.original,
      replacement: hit.replacement,
      index: hit.start,
    });
  }

  // Re-sort matches by original position (ascending) for the caller
  matches.sort((a, b) => a.index - b.index);

  return { redacted: result, piiFound: matches };
}

/**
 * Rough measure of PII density: fraction of non-whitespace characters that
 * are covered by PII matches.  Used by ContentAware routing.
 */
export function piiDensity(text: string, piiFound: PIIMatch[]): number {
  if (piiFound.length === 0) return 0;
  const totalPIIChars = piiFound.reduce((sum, m) => sum + m.original.length, 0);
  const contentChars = text.replace(/\s/g, '').length;
  return contentChars === 0 ? 0 : Math.min(totalPIIChars / contentChars, 1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deduplicateMatches<
  T extends { start: number; end: number },
>(items: T[]): T[] {
  // Sort by start ascending, end descending (prefer longer on tie)
  const sorted = [...items].sort((a, b) =>
    a.start !== b.start ? a.start - b.start : b.end - a.end,
  );

  const result: T[] = [];
  let cursor = -1;

  for (const item of sorted) {
    if (item.start >= cursor) {
      result.push(item);
      cursor = item.end;
    }
    // Overlapping item — skip
  }

  return result;
}
