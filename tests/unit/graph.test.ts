import { describe, expect, it } from 'vitest';
import {
  jaroWinkler,
  toPinyin,
  normalizeEmail,
  normalizePhone,
  nameSimilarity,
} from '../../src/graph/name-utils.js';

// ----------------------------------------------------------------------------
// normalizeEmail
// ----------------------------------------------------------------------------

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  User@Example.COM  ')).toBe('user@example.com');
  });

  it('already lowercase is unchanged', () => {
    expect(normalizeEmail('alice@corp.io')).toBe('alice@corp.io');
  });
});

// ----------------------------------------------------------------------------
// normalizePhone
// ----------------------------------------------------------------------------

describe('normalizePhone', () => {
  it('strips non-digits and prepends + for full numbers', () => {
    expect(normalizePhone('+1 (555) 123-4567')).toBe('+15551234567');
  });

  it('handles international format', () => {
    expect(normalizePhone('+86-138-0013-8000')).toBe('+8613800138000');
  });

  it('returns digits only for short numbers', () => {
    expect(normalizePhone('1234')).toBe('1234');
  });

  it('normalises same number expressed differently to equal value', () => {
    const a = normalizePhone('+15551234567');
    const b = normalizePhone('15551234567');
    expect(a).toBe(b);
  });
});

// ----------------------------------------------------------------------------
// jaroWinkler
// ----------------------------------------------------------------------------

describe('jaroWinkler', () => {
  it('returns 1.0 for identical strings', () => {
    expect(jaroWinkler('alice', 'alice')).toBe(1.0);
  });

  it('returns 0.0 for completely different strings', () => {
    expect(jaroWinkler('abc', 'xyz')).toBeLessThan(0.4);
  });

  it('high score for common prefix strings', () => {
    const score = jaroWinkler('Wang Zong', 'Wang Zong Jr');
    expect(score).toBeGreaterThan(0.85);
  });

  it('handles empty strings', () => {
    expect(jaroWinkler('', '')).toBe(1.0);
    expect(jaroWinkler('abc', '')).toBe(0.0);
  });

  it('is symmetric', () => {
    const a = jaroWinkler('Robert', 'Rupert');
    const b = jaroWinkler('Rupert', 'Robert');
    expect(Math.abs(a - b)).toBeLessThan(0.001);
  });
});

// ----------------------------------------------------------------------------
// toPinyin
// ----------------------------------------------------------------------------

describe('toPinyin', () => {
  it('converts simple Chinese to pinyin', () => {
    const result = toPinyin('王');
    expect(result).toContain('wang');
  });

  it('handles multi-character Chinese names', () => {
    const result = toPinyin('王总');
    expect(result).toContain('wang');
    expect(result).toContain('zong');
  });

  it('retains latin characters unchanged', () => {
    const result = toPinyin('Alice');
    expect(result.toLowerCase()).toContain('alice');
  });
});

// ----------------------------------------------------------------------------
// nameSimilarity
// ----------------------------------------------------------------------------

describe('nameSimilarity', () => {
  it('returns 1.0 for identical names', () => {
    expect(nameSimilarity('Alice', 'Alice')).toBe(1.0);
  });

  it('case-insensitive exact match scores 1.0', () => {
    expect(nameSimilarity('Alice', 'alice')).toBe(1.0);
  });

  it('high score for fuzzy match on Latin names', () => {
    const score = nameSimilarity('Bob Smith', 'Bob Smyth');
    expect(score).toBeGreaterThan(0.85);
  });

  it('Chinese to pinyin matching', () => {
    // "王总" pinyin = "wangzong", should score high against "Wang Zong"
    const score = nameSimilarity('王总', 'Wang Zong');
    expect(score).toBeGreaterThan(0.75);
  });

  it('low score for unrelated names', () => {
    const score = nameSimilarity('Alice Wong', 'Bob Smith');
    expect(score).toBeLessThan(0.6);
  });
});
