import type { ExtractionContext } from '../types/index.js';

// ---------------------------------------------------------------------------
// Entity Extraction Prompt
// ---------------------------------------------------------------------------

export function buildExtractionPrompt(
  content: string,
  context: ExtractionContext | undefined,
): string {
  const existingNames =
    context?.existingEntities.length
      ? context.existingEntities
          .map((e) => `  - ${e.name} (${e.type})`)
          .join('\n')
      : '  (none)';

  const senderLine = context?.senderName
    ? `Sender: ${context.senderName}`
    : '';

  const channelLine = context?.sourceChannel
    ? `Channel: ${context.sourceChannel}`
    : '';

  return `You are an information extraction assistant. Extract structured entities and relationships from the message below.

${senderLine}
${channelLine}

Known entities already in the knowledge base (prefer reusing these names if they match):
${existingNames}

Message content:
---
${content}
---

Return a JSON object with exactly this structure (no markdown fences):
{
  "entities": [
    {
      "type": "<person|topic|action_item|key_fact|document|thread>",
      "name": "<canonical English or Chinese name>",
      "nameAlt": "<alternative language name if bilingual, otherwise null>",
      "attributes": {},
      "confidence": <0.0-1.0>
    }
  ],
  "relationships": [
    {
      "fromEntityName": "<entity name>",
      "toEntityName": "<entity name>",
      "type": "<discusses|communicates_with|assigned_to|requested_by|related_to|part_of|participates_in|continues_in|member_of>",
      "strength": <0.0-1.0>,
      "metadata": {}
    }
  ],
  "summary": "<1-2 sentence summary of the message, or null>",
  "language": "<en|zh|mixed>"
}

Guidelines:
- Extract people mentioned by name, email, or handle
- Extract topics (subjects being discussed)
- Extract action items (tasks, requests, deadlines)
- Extract key facts (decisions, numbers, important statements)
- For Chinese names include the original characters in "name" and Pinyin/English in "nameAlt" if known
- Only include relationships you are confident about
- Return valid JSON only — no explanations outside the JSON object`;
}

// ---------------------------------------------------------------------------
// Answer Synthesis Prompt
// ---------------------------------------------------------------------------

export function buildAnswerPrompt(
  query: string,
  itemSummaries: string[],
  entitySummaries: string[],
): string {
  const items = itemSummaries.length
    ? itemSummaries.map((s, i) => `[${i + 1}] ${s}`).join('\n')
    : '(no relevant messages found)';

  const entities = entitySummaries.length
    ? entitySummaries.map((s, i) => `[E${i + 1}] ${s}`).join('\n')
    : '(no relevant entities found)';

  return `You are a personal knowledge assistant. Answer the user's question based only on the provided context from their messages and knowledge graph.

User question: ${query}

Relevant messages:
${items}

Relevant entities:
${entities}

Instructions:
- Answer concisely and directly
- Cite message numbers [1], [2], etc. where appropriate
- If the answer is not in the provided context, say so clearly
- Do not invent information not present in the context

Return a JSON object (no markdown fences):
{
  "answer": "<your answer>",
  "sourceIndices": [<1-based indices of messages used>],
  "confidence": <0.0-1.0>
}`;
}

// ---------------------------------------------------------------------------
// Entity Resolution Prompt
// ---------------------------------------------------------------------------

export function buildEntityResolutionPrompt(
  nameA: string,
  nameB: string,
  contextA: string,
  contextB: string,
): string {
  return `Determine whether the following two names refer to the same person or entity.

Name A: ${nameA}
Context A: ${contextA}

Name B: ${nameB}
Context B: ${contextB}

Consider:
- Bilingual name equivalents (e.g., "王总" and "Wang Zong" are likely the same)
- Nicknames, shortened names, and aliases
- Email addresses that match name patterns
- Same role/organization signals

Return a JSON object (no markdown fences):
{
  "isSame": <true|false>,
  "confidence": <0.0-1.0>,
  "reasoning": "<brief explanation>"
}`;
}
