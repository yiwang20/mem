import { pinyin } from 'pinyin-pro';

// ----------------------------------------------------------------------------
// Email / Phone normalization
// ----------------------------------------------------------------------------

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Normalize a phone number to a simple digit string (E.164-like).
 * Strips all non-digit characters, then prepends "+" if the result
 * looks like a full international number (>= 10 digits).
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length >= 10) {
    return `+${digits}`;
  }
  return digits;
}

// ----------------------------------------------------------------------------
// Jaro-Winkler similarity
// ----------------------------------------------------------------------------

function jaroDistance(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0.0;

  const matchDist = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0);

  const s1Matched = new Uint8Array(len1);
  const s2Matched = new Uint8Array(len2);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDist);
    const end = Math.min(i + matchDist + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matched[j] || s1[i] !== s2[j]) continue;
      s1Matched[i] = 1;
      s2Matched[j] = 1;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matched[i]) continue;
    while (!s2Matched[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  return (
    (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3
  );
}

/**
 * Jaro-Winkler distance (0.0 – 1.0, higher = more similar).
 * Uses standard p=0.1 prefix scaling factor.
 */
export function jaroWinkler(s1: string, s2: string): number {
  const jaro = jaroDistance(s1, s2);
  if (jaro < 0.7) return jaro;

  const prefixLen = Math.min(
    4,
    [...Array(Math.min(s1.length, s2.length))].findIndex((_, i) => s1[i] !== s2[i]) === -1
      ? Math.min(s1.length, s2.length)
      : [...Array(Math.min(s1.length, s2.length))].findIndex((_, i) => s1[i] !== s2[i]),
  );

  return jaro + prefixLen * 0.1 * (1 - jaro);
}

// ----------------------------------------------------------------------------
// Pinyin conversion
// ----------------------------------------------------------------------------

/**
 * Convert Chinese characters to space-separated pinyin (tone-stripped, lowercase).
 * Non-Chinese characters are passed through as-is.
 */
export function toPinyin(chinese: string): string {
  return pinyin(chinese, { toneType: 'none', type: 'string', nonZh: 'consecutive' })
    .toLowerCase()
    .trim();
}

function looksLikelyChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

// ----------------------------------------------------------------------------
// Combined name similarity
// ----------------------------------------------------------------------------

/**
 * Compute a similarity score (0.0 – 1.0) between two names.
 * Handles:
 *  - Exact match (case-insensitive)
 *  - Jaro-Winkler on normalized ASCII forms
 *  - Pinyin-to-Latin matching for Chinese names
 */
export function nameSimilarity(name1: string, name2: string): number {
  const n1 = name1.trim().toLowerCase();
  const n2 = name2.trim().toLowerCase();

  if (n1 === n2) return 1.0;

  // Direct Jaro-Winkler
  const directScore = jaroWinkler(n1, n2);

  // Pinyin expansion: if either name contains Chinese, convert and compare
  let pinyinScore = 0;
  const has1 = looksLikelyChinese(name1);
  const has2 = looksLikelyChinese(name2);

  if (has1 || has2) {
    const py1 = has1 ? toPinyin(name1).replace(/\s+/g, '') : n1.replace(/\s+/g, '');
    const py2 = has2 ? toPinyin(name2).replace(/\s+/g, '') : n2.replace(/\s+/g, '');
    pinyinScore = jaroWinkler(py1, py2);
  }

  return Math.max(directScore, pinyinScore);
}
