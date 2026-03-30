import { DetectedLanguage, EntityType } from '../../types/index.js';
import type { ExtractionResult, RawItem } from '../../types/index.js';

// We import compromise dynamically because it is a CommonJS module and
// the project uses ES modules. The dynamic import below works under NodeNext.
type NlpDoc = {
  people(): { out(format: 'array'): string[] };
  organizations(): { out(format: 'array'): string[] };
  places(): { out(format: 'array'): string[] };
};
type NlpFn = (text: string) => NlpDoc;

let _nlp: NlpFn | null = null;

async function getNlp(): Promise<NlpFn> {
  if (_nlp) return _nlp;
  // compromise ships as CJS; we use a dynamic import to load it at runtime.
  const mod = await import('compromise');
  // Default export is the nlp function in compromise v14+
  _nlp = (mod.default ?? mod) as NlpFn;
  return _nlp;
}

// ---------------------------------------------------------------------------
// Chinese name regex patterns
// ---------------------------------------------------------------------------
// Matches common Chinese full names: 2–4 Chinese characters where the first
// character is a common surname (top ~50).
const CHINESE_SURNAMES =
  '王李张刘陈杨黄赵周吴徐孙朱马胡郭林何高罗郑梁谢宋唐许韩冯邓曹彭曾萧田董袁潘于蒋蔡余杜叶程苏魏吕丁任卢姚沈钟姜崔谭廖范汪陆金石戴贾韦夏邱方侯邹熊孟秦白江阎薛尹段雷黎史龙陶贺顾毛郝龚邵万钱严赖覃洪武莫孔汤向常温康施文牛樊葛邢安齐易乔伍庞颜倪庄聂章鲁岳翟殷詹申欧耿关兰焦俞左柳甘祝包宁尚符舒阮柯纪梅童凌毕单季裴霍涂成苗谷盛江阎曲翁侯';
const CHINESE_NAME_RE = new RegExp(
  `[${CHINESE_SURNAMES}][\\u4e00-\\u9fff]{1,3}`,
  'g',
);

// "X总" pattern — "Wang Zong", "Li Jing" etc.
const CHINESE_TITLE_RE = /[\u4e00-\u9fff]{1,3}(?:总|先生|女士|老师|经理|主任|主席|书记|部长|局长|处长|科长|厂长|院长|校长|市长|省长)/g;

// ---------------------------------------------------------------------------
// Post-processing filters for NER quality
// ---------------------------------------------------------------------------

function cleanName(name: string): string {
  // Strip trailing/leading punctuation that NER leaves behind
  return name.trim().replace(/^[.,;:!]+|[.,;:!]+$/g, '').trim();
}

function isLikelyPerson(name: string): boolean {
  const trimmed = cleanName(name);
  if (trimmed.length < 2) return false;
  // Reject if contains special characters unlikely in names
  if (/[)(\]\[@_:#{}]/.test(trimmed)) return false;
  // Reject OKR/ID-like patterns
  if (/^[A-Z]{2,}\s*L\d|^[A-Z]+[-_]\d/i.test(trimmed)) return false;
  // Reject single-word names from NER — too ambiguous without a surname.
  // Full names come from metadata.sender which is more reliable.
  const words = trimmed.split(/\s+/);
  if (words.length < 2) return false;
  // Reject if contains technical keywords (these are product/feature names, not people)
  const techWords = /\b(Search|Service|Connector|Goal|Design|Path|System|Platform|Engine|Module|API|SDK|Config|Manager|Builder|Driver|Pipeline|Model|Foundation|Teams|Enterprise)\b/i;
  if (techWords.test(trimmed)) return false;
  return true;
}

function isLikelyOrganization(name: string): boolean {
  const trimmed = name.trim();
  if (/[)(\]\[@_:#{}]/.test(trimmed)) return false;
  if (/[.,;:!]$/.test(trimmed)) return false;
  if (trimmed.length < 2) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Tier 2 NER extraction
// ---------------------------------------------------------------------------

export async function runTier2NER(item: RawItem): Promise<ExtractionResult> {
  const text = [item.subject ?? '', item.body].join(' ');
  const entities: ExtractionResult['entities'] = [];

  // --- English NER via compromise ---
  const nlp = await getNlp();
  const doc = nlp(text);

  for (const name of dedupe(doc.people().out('array'))) {
    const cleaned = cleanName(name);
    if (cleaned.length < 2) continue;
    if (!isLikelyPerson(cleaned)) continue;
    entities.push({
      type: EntityType.Person,
      name: cleaned,
      nameAlt: null,
      attributes: { source: 'compromise_ner' },
      confidence: 0.75,
    });
  }

  // --- Extract sender/recipients from metadata (Slack, MCP injected data) ---
  const senderName = typeof item.metadata?.sender === 'string' ? item.metadata.sender.trim() : null;
  if (senderName && senderName.length >= 2 && isLikelyPerson(senderName)) {
    entities.push({
      type: EntityType.Person,
      name: senderName,
      nameAlt: null,
      attributes: { source: 'metadata_sender' },
      confidence: 0.9,
    });
  }
  const recipients = Array.isArray(item.metadata?.recipients) ? item.metadata.recipients as string[] : [];
  for (const r of recipients) {
    const rName = typeof r === 'string' ? r.trim() : '';
    if (rName.length >= 2 && isLikelyPerson(rName)) {
      entities.push({
        type: EntityType.Person,
        name: rName,
        nameAlt: null,
        attributes: { source: 'metadata_recipient' },
        confidence: 0.85,
      });
    }
  }

  for (const org of dedupe(doc.organizations().out('array'))) {
    const cleanedOrg = cleanName(org);
    if (cleanedOrg.length < 2) continue;
    if (!isLikelyOrganization(cleanedOrg)) continue;
    entities.push({
      type: EntityType.Topic,
      name: cleanedOrg,
      nameAlt: null,
      attributes: { organization: true, source: 'compromise_ner' },
      confidence: 0.7,
    });
  }

  for (const place of dedupe(doc.places().out('array'))) {
    if (place.trim().length < 2) continue;
    entities.push({
      type: EntityType.KeyFact,
      name: `Location: ${place.trim()}`,
      nameAlt: null,
      attributes: { location: place.trim(), source: 'compromise_ner' },
      confidence: 0.65,
    });
  }

  // --- Extract explicit topics from metadata (set by agent at ingest time) ---
  const topicHints = Array.isArray(item.metadata?.topics) ? item.metadata.topics as string[] : [];
  for (const t of topicHints) {
    const topicName = typeof t === 'string' ? t.trim() : '';
    if (topicName.length >= 2) {
      entities.push({
        type: EntityType.Topic,
        name: topicName,
        nameAlt: null,
        attributes: { source: 'explicit_topic' },
        confidence: 0.95,
      });
    }
  }

  // --- Extract topic from threadId (Slack threads often have meaningful names) ---
  if (item.threadId) {
    // Convert slug-style thread IDs to readable topic names: "auth-migration" -> "Auth Migration"
    const threadName = item.threadId
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim();
    if (threadName.length >= 3 && !/^\d+$/.test(threadName)) {
      entities.push({
        type: EntityType.Topic,
        name: threadName,
        nameAlt: null,
        attributes: { source: 'thread_id' },
        confidence: 0.85,
      });
    }
  }

  // --- Extract subject as topic for emails/documents ---
  if (item.subject && item.subject.length >= 5) {
    const subjectClean = item.subject.replace(/^(Re|Fwd|FW):\s*/i, '').trim();
    if (subjectClean.length >= 5) {
      entities.push({
        type: EntityType.Topic,
        name: subjectClean,
        nameAlt: null,
        attributes: { source: 'subject_line' },
        confidence: 0.8,
      });
    }
  }

  // --- Chinese NER via regex ---
  const chineseNames = dedupe([
    ...(text.match(CHINESE_NAME_RE) ?? []),
    ...(text.match(CHINESE_TITLE_RE) ?? []),
  ]);

  for (const name of chineseNames) {
    if (name.length < 2) continue;
    entities.push({
      type: EntityType.Person,
      name: name.trim(),
      nameAlt: null,
      attributes: { source: 'chinese_regex_ner' },
      confidence: 0.7,
    });
  }

  // Detect language from existing result (passed upstream) or re-detect
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const totalChars = text.replace(/\s/g, '').length;
  const ratio = totalChars > 0 ? chineseChars / totalChars : 0;
  const language =
    ratio > 0.4
      ? DetectedLanguage.Chinese
      : ratio > 0.05
      ? DetectedLanguage.Mixed
      : DetectedLanguage.English;

  // --- Deduplicate: if a shorter name is a substring of a longer name of the same type, drop the shorter one ---
  const deduped = dedupeEntities(entities);

  return {
    entities: deduped,
    relationships: [],
    summary: null,
    language,
  };
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

/**
 * Deduplicate extracted entities: if a shorter name is a prefix/substring of
 * a longer name of the same type, keep only the longer (more specific) one.
 * E.g., "Grace" (person) is dropped when "Grace Huang" (person) exists.
 */
function dedupeEntities(entities: ExtractionResult['entities']): ExtractionResult['entities'] {
  const result: ExtractionResult['entities'] = [];
  const sorted = [...entities].sort((a, b) => b.name.length - a.name.length); // longest first

  for (const entity of sorted) {
    const dominated = result.some(
      existing =>
        existing.type === entity.type &&
        existing.name.toLowerCase().includes(entity.name.toLowerCase()) &&
        existing.name.toLowerCase() !== entity.name.toLowerCase(),
    );
    if (!dominated) {
      result.push(entity);
    }
  }

  return result;
}
