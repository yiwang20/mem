import { describe, expect, it } from 'vitest';
import { redactPII, piiDensity } from '../../src/processing/privacy.js';

// ---------------------------------------------------------------------------
// Credit card redaction
// ---------------------------------------------------------------------------

describe('credit card redaction', () => {
  it('redacts a plain 16-digit card number', () => {
    const { redacted, piiFound } = redactPII('card: 4916123456781234');
    expect(redacted).toBe('card: [CARD_1234]');
    expect(piiFound).toHaveLength(1);
    expect(piiFound[0]?.type).toBe('credit_card');
    expect(piiFound[0]?.original).toBe('4916123456781234');
  });

  it('redacts a spaced card number', () => {
    const { redacted } = redactPII('pay with 4916 1234 5678 9999');
    expect(redacted).toBe('pay with [CARD_9999]');
  });

  it('redacts a dashed card number', () => {
    const { redacted } = redactPII('4916-1234-5678-0001 expired');
    expect(redacted).toBe('[CARD_0001] expired');
  });

  it('preserves the last-4 in the token', () => {
    const { piiFound } = redactPII('4916 1234 5678 7777');
    expect(piiFound[0]?.replacement).toBe('[CARD_7777]');
  });
});

// ---------------------------------------------------------------------------
// SSN redaction
// ---------------------------------------------------------------------------

describe('SSN redaction', () => {
  it('redacts an SSN in standard format', () => {
    const { redacted, piiFound } = redactPII('ssn: 123-45-6789');
    expect(redacted).toBe('ssn: [SSN_REDACTED]');
    expect(piiFound[0]?.type).toBe('ssn');
  });

  it('does not redact partial SSN-like patterns', () => {
    // Only 2-digit middle part — no match
    const { piiFound } = redactPII('ref: 123-4-5678');
    expect(piiFound.filter((m) => m.type === 'ssn')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Phone redaction
// ---------------------------------------------------------------------------

describe('phone redaction', () => {
  it('redacts US phone (800) 555-0100', () => {
    const { redacted, piiFound } = redactPII('call (800) 555-0100 now');
    expect(redacted).toContain('[PHONE_REDACTED]');
    expect(piiFound.some((m) => m.type === 'phone')).toBe(true);
  });

  it('redacts international E.164 number', () => {
    const { redacted } = redactPII('reach me at +8613800000001');
    expect(redacted).toContain('[PHONE_REDACTED]');
  });

  it('redacts dotted US format', () => {
    const { redacted } = redactPII('my number is 800.555.0199');
    expect(redacted).toContain('[PHONE_REDACTED]');
  });
});

// ---------------------------------------------------------------------------
// Email redaction
// ---------------------------------------------------------------------------

describe('email redaction', () => {
  it('redacts a third-party email', () => {
    const { redacted, piiFound } = redactPII('contact alice@example.com');
    expect(redacted).toBe('contact [EMAIL_REDACTED]');
    expect(piiFound[0]?.type).toBe('email');
  });

  it('does not redact the sender email when provided', () => {
    const { redacted, piiFound } = redactPII(
      'from me@corp.com to alice@example.com',
      'me@corp.com',
    );
    expect(redacted).toContain('me@corp.com'); // preserved
    expect(redacted).toContain('[EMAIL_REDACTED]'); // alice redacted
    expect(piiFound.filter((m) => m.type === 'email')).toHaveLength(1);
  });

  it('is case-insensitive for sender email matching', () => {
    const { redacted } = redactPII('from ME@Corp.COM to bob@test.com', 'me@corp.com');
    expect(redacted).toContain('ME@Corp.COM');
    expect(redacted).toContain('[EMAIL_REDACTED]');
  });
});

// ---------------------------------------------------------------------------
// Multiple PII types in one string
// ---------------------------------------------------------------------------

describe('multiple PII types', () => {
  it('redacts all types in the same string', () => {
    const text =
      'card 4916 1234 5678 1234, ssn 123-45-6789, phone (800) 555-0199, email foo@bar.com';
    const { piiFound } = redactPII(text);
    const types = piiFound.map((m) => m.type);
    expect(types).toContain('credit_card');
    expect(types).toContain('ssn');
    expect(types).toContain('phone');
    expect(types).toContain('email');
  });

  it('handles overlapping-ish regions without duplicates', () => {
    // Adjacent patterns should each be redacted once
    const { redacted } = redactPII('foo@bar.com baz@qux.com');
    expect((redacted.match(/\[EMAIL_REDACTED\]/g) ?? []).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Clean text — no matches
// ---------------------------------------------------------------------------

describe('clean text', () => {
  it('returns the original text unchanged when no PII found', () => {
    const text = 'Hello, please review the Q3 budget proposal by Friday.';
    const { redacted, piiFound } = redactPII(text);
    expect(redacted).toBe(text);
    expect(piiFound).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// piiDensity
// ---------------------------------------------------------------------------

describe('piiDensity', () => {
  it('returns 0 when no PII', () => {
    const { piiFound } = redactPII('hello world');
    expect(piiDensity('hello world', piiFound)).toBe(0);
  });

  it('returns > 0 when PII present', () => {
    const text = 'card 4916123456781234 ok';
    const { piiFound } = redactPII(text);
    expect(piiDensity(text, piiFound)).toBeGreaterThan(0);
  });

  it('is capped at 1.0', () => {
    // Entire text is a card number
    const text = '4916123456781234';
    const { piiFound } = redactPII(text);
    expect(piiDensity(text, piiFound)).toBeLessThanOrEqual(1.0);
  });
});
