// ---------------------------------------------------------------------------
// Query intent classification — rule-based for MVP
// ---------------------------------------------------------------------------

export type QueryIntent =
  | 'factual_recall'
  | 'person_context'
  | 'cross_ref'
  | 'pending_items'
  | 'relationship';

export interface ClassifiedQuery {
  intent: QueryIntent;
  /** Detected person names in the query (for person_context / cross_ref) */
  detectedNames: string[];
  /** Whether the query appears to be in Chinese */
  isChinese: boolean;
}

// ---------------------------------------------------------------------------
// Keyword patterns
// ---------------------------------------------------------------------------

// Pending-item signals (English + Chinese)
const PENDING_PATTERNS = [
  /\bpending\b/i,
  /\bwaiting\b/i,
  /\bfollow[- ]?up\b/i,
  /\bunanswered\b/i,
  /\boverdue\b/i,
  /\baction items?\b/i,
  /\bto[- ]?do\b/i,
  /\bremind\b/i,
  /忘了什么/,
  /待办/,
  /未处理/,
  /未回复/,
  /跟进/,
  /提醒/,
];

// Relationship signals
const RELATIONSHIP_PATTERNS = [
  /\brelat(?:ed|ionship)\b/i,
  /\bconnect(?:ed|ion)\b/i,
  /\bknow(?:s)?\b/i,
  /\bwork(?:s)?\s+with\b/i,
  /\bteam\b/i,
  /\bcolleague\b/i,
  /关系/,
  /认识/,
  /合作/,
];

// English name heuristic: two consecutive capitalized words not at sentence start
const ENGLISH_NAME_RE = /\b([A-Z][a-z]{1,15})\s+([A-Z][a-z]{1,15})\b/g;

// Chinese personal name: surname + 1-3 chars (reusing tier1 surname list)
const CHINESE_SURNAMES = '王李张刘陈杨黄赵周吴徐孙朱马胡郭林何高罗郑梁谢宋唐许韩冯邓曹彭曾萧田董袁潘于蒋蔡余杜叶程苏魏吕丁任卢姚沈钟姜崔谭廖范汪陆金石戴贾韦夏邱方侯邹熊孟秦白江阎薛尹段雷黎史龙陶贺顾毛郝龚邵万钱严赖覃洪武莫孔汤向常温康施文牛樊葛邢安齐易乔伍庞颜倪庄聂章鲁岳翟殷詹申欧耿关兰焦俞左柳甘祝包宁尚符舒阮柯纪梅童凌毕单季裴霍涂成苗谷盛江阎曲翁侯';
const CHINESE_NAME_RE = new RegExp(`[${CHINESE_SURNAMES}][\\u4e00-\\u9fff]{1,3}`, 'g');
const CHINESE_TITLE_RE = /[\u4e00-\u9fff]{1,3}(?:总|先生|女士|老师|经理|主任|主席|书记|部长|局长)/g;

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

export function classifyIntent(query: string): ClassifiedQuery {
  const chineseChars = (query.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const isChinese = chineseChars / Math.max(query.replace(/\s/g, '').length, 1) > 0.2;

  // Collect candidate names
  const names: string[] = [];

  // English two-word names
  const englishNameRe = new RegExp(ENGLISH_NAME_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = englishNameRe.exec(query)) !== null) {
    if (m[1] && m[2]) names.push(`${m[1]} ${m[2]}`);
  }

  // Chinese names
  for (const n of query.match(CHINESE_NAME_RE) ?? []) names.push(n);
  for (const n of query.match(CHINESE_TITLE_RE) ?? []) names.push(n);

  const detectedNames = [...new Set(names)];

  // --- Intent rules (evaluated in priority order) ---

  // 1. Pending items
  if (PENDING_PATTERNS.some((p) => p.test(query))) {
    return { intent: 'pending_items', detectedNames, isChinese };
  }

  // 2. Cross-reference: two distinct entity names mentioned
  if (detectedNames.length >= 2) {
    return { intent: 'cross_ref', detectedNames, isChinese };
  }

  // 3. Relationship query
  if (RELATIONSHIP_PATTERNS.some((p) => p.test(query))) {
    return { intent: 'relationship', detectedNames, isChinese };
  }

  // 4. Person context: one name detected
  if (detectedNames.length === 1) {
    return { intent: 'person_context', detectedNames, isChinese };
  }

  // 5. Default: factual recall (question mark is a strong signal but not required)
  return { intent: 'factual_recall', detectedNames, isChinese };
}
