#!/usr/bin/env node
/**
 * MindFlow MCP Server
 *
 * Exposes the MindFlow knowledge engine as an MCP stdio server
 * so that external agents (e.g. x-super-agent) can query, search,
 * and manage the personal knowledge graph.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { MindFlowEngine } from '../../core/engine.js';
import { HttpProxyProvider } from '../../llm/http-proxy-provider.js';
import {
  BodyFormat,
  EntityStatus,
  EntityType,
  JobStage,
  ProcessingStatus,
  RelationshipType,
  SourceAdapterType,
  SourceChannel,
} from '../../types/index.js';
import type { Entity, RawItem, Relationship } from '../../types/index.js';
import { ulid } from '../../utils/ulid.js';

// ---------------------------------------------------------------------------
// Engine singleton
// ---------------------------------------------------------------------------

let engine: MindFlowEngine | null = null;

async function getEngine(): Promise<MindFlowEngine> {
  if (engine) return engine;
  const dataDir = process.env.MINDFLOW_DATA_DIR || undefined;
  const dbPath = process.env.MINDFLOW_DB_PATH || undefined;

  // Use HTTP proxy provider if LLM_PROXY_URL is set (e.g. http://localhost:18787/llm/complete)
  const proxyUrl = process.env.LLM_PROXY_URL;
  const provider = proxyUrl ? new HttpProxyProvider(proxyUrl) : undefined;

  engine = new MindFlowEngine(
    { ...(dataDir ? { dataDir } : {}), ...(dbPath ? { dbPath } : {}) },
    provider,
  );
  await engine.init();
  return engine;
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'mindflow',
  version: '0.1.0',
});

// ---- query ----------------------------------------------------------------

server.tool(
  'query',
  'Search the personal knowledge base with natural language. Returns matching entities, raw items, and an AI-synthesized answer when available.',
  {
    query: z.string().describe('Natural language query (e.g. "What did Alice say about the Q3 budget?")'),
    entityTypes: z.array(z.nativeEnum(EntityType)).optional().describe('Filter by entity types'),
    channels: z.array(z.string()).optional().describe('Filter by source channel (e.g. email, slack, imessage, file)'),
    limit: z.number().int().min(1).max(100).optional().describe('Max results (default 20)'),
  },
  async ({ query, entityTypes, channels, limit }) => {
    const eng = await getEngine();
    const result = await eng.query({
      query,
      filters: {
        ...(entityTypes ? { entityTypes } : {}),
        ...(channels ? { channels } : {}),
      },
      ...(limit ? { limit } : {}),
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// ---- get_entity -----------------------------------------------------------

server.tool(
  'get_entity',
  'Retrieve a single entity by ID with full details.',
  {
    id: z.string().describe('Entity ID (ULID)'),
  },
  async ({ id }) => {
    const eng = await getEngine();
    const entity = eng.getEntity(id);
    if (!entity) {
      return { content: [{ type: 'text' as const, text: `Entity ${id} not found` }], isError: true };
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(entity, null, 2) }] };
  },
);

// ---- list_entities --------------------------------------------------------

server.tool(
  'list_entities',
  'List or search entities by type and/or keyword.',
  {
    type: z.nativeEnum(EntityType).optional().describe('Filter by entity type (person, topic, action_item, etc.)'),
    search: z.string().optional().describe('FTS keyword search'),
    limit: z.number().int().min(1).max(100).optional().describe('Max results (default 20)'),
  },
  async ({ type, search, limit }) => {
    const eng = await getEngine();
    const max = limit ?? 20;
    let entities;
    if (search) {
      entities = eng.entities.search(search, max);
      if (type) entities = entities.filter((e) => e.type === type);
    } else if (type) {
      entities = eng.graphOps.getTopEntities(type, max, 'recent');
    } else {
      entities = eng.graphOps.getTopEntities(EntityType.Person, max, 'recent');
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(entities, null, 2) }] };
  },
);

// ---- get_graph ------------------------------------------------------------

server.tool(
  'get_graph',
  'Get a subgraph (nodes + edges) centered on an entity. Useful for exploring connections.',
  {
    centerId: z.string().describe('Center entity ID'),
    depth: z.number().int().min(1).max(4).optional().describe('Traversal depth (default 2)'),
  },
  async ({ centerId, depth }) => {
    const eng = await getEngine();
    const graph = eng.getGraph(centerId, depth ?? 2);
    return { content: [{ type: 'text' as const, text: JSON.stringify(graph, null, 2) }] };
  },
);

// ---- get_timeline ---------------------------------------------------------

server.tool(
  'get_timeline',
  'Get the timeline of raw items (emails, messages, documents) linked to an entity.',
  {
    entityId: z.string().describe('Entity ID'),
    limit: z.number().int().min(1).max(50).optional().describe('Max items (default 10)'),
    after: z.number().optional().describe('Only items after this Unix timestamp (ms)'),
  },
  async ({ entityId, limit, after }) => {
    const eng = await getEngine();
    const timeline = eng.graphOps.getTimeline(entityId, {
      limit: limit ?? 10,
      ...(after ? { after } : {}),
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(timeline, null, 2) }] };
  },
);

// ---- get_attention_items --------------------------------------------------

server.tool(
  'get_attention_items',
  'Get pending attention items: unanswered requests, approaching deadlines, stale conversations, etc.',
  {},
  async () => {
    const eng = await getEngine();
    const items = eng.getAttentionItems();
    return { content: [{ type: 'text' as const, text: JSON.stringify(items, null, 2) }] };
  },
);

// ---- get_stats ------------------------------------------------------------

server.tool(
  'get_stats',
  'Get system statistics: item count, entity count, relationships, pending jobs, last sync time.',
  {},
  async () => {
    const eng = await getEngine();
    const stats = eng.getStats();
    return { content: [{ type: 'text' as const, text: JSON.stringify(stats, null, 2) }] };
  },
);

// ==========================================================================
// WRITE TOOLS — External agents push data into MindFlow
// ==========================================================================

// ---- Topic matching helpers ------------------------------------------------

/** Strip dates, filler words, normalize for comparison */
function normalizeTopic(name: string): string {
  return name
    .toLowerCase()
    .replace(/\d{4}[\s\-\/]\d{2}[\s\-\/]\d{2}/g, '')       // YYYY-MM-DD / YYYY MM DD
    .replace(/\b\d{2}[\s\-\/]\d{2}[\s\-\/]\d{4}/g, '')       // DD-MM-YYYY
    .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s*\d{1,2}/gi, '')
    .replace(/\b\d{1,2}\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*/gi, '')
    .replace(/\b(?:main|channel|tiger\s*team|working\s*group|squad)\b/gi, '')
    .replace(/[\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Score how good a topic name is. Higher = better canonical name. */
function topicNameQuality(name: string): number {
  let score = 10;
  // Penalize dates
  if (/\d{4}/.test(name)) score -= 3;
  if (/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(name)) score -= 2;
  // Penalize filler
  if (/\b(?:main|channel)\b/i.test(name)) score -= 1;
  // Prefer concise (3-50 chars ideal)
  if (name.length < 3) score -= 5;
  if (name.length > 60) score -= 2;
  // Prefer proper capitalization
  if (/^[A-Z0-9]/.test(name)) score += 1;
  return score;
}

/** Check if two normalized topic names are similar enough to merge */
function topicsSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  // One contains the other
  if (a.includes(b) || b.includes(a)) return true;
  // Token overlap: if 60%+ tokens match, they're the same topic
  const tokA = new Set(a.split(/\s+/).filter(t => t.length > 1));
  const tokB = new Set(b.split(/\s+/).filter(t => t.length > 1));
  if (tokA.size === 0 || tokB.size === 0) return false;
  let overlap = 0;
  for (const t of tokA) { if (tokB.has(t)) overlap++; }
  const smaller = Math.min(tokA.size, tokB.size);
  return smaller > 0 && overlap / smaller >= 0.6;
}

type TopicRow = { id: string; canonical_name: string; aliases: string };

/**
 * Find an existing topic by fuzzy match, or create a new one.
 * If matched, upgrade the canonical name if the incoming name is better.
 */
function findOrCreateTopic(db: any, incoming: string, now: number): { id: string } {
  const normIncoming = normalizeTopic(incoming);

  // 1. Exact match (case-insensitive)
  const exact = db
    .prepare("SELECT id, canonical_name, aliases FROM entities WHERE type = 'topic' AND LOWER(canonical_name) = LOWER(?) AND status != 'merged' LIMIT 1")
    .get(incoming) as TopicRow | undefined;
  if (exact) {
    db.prepare("UPDATE entities SET last_seen_at = MAX(last_seen_at, ?), updated_at = ? WHERE id = ?")
      .run(now, now, exact.id);
    return { id: exact.id };
  }

  // 2. Fuzzy match against all active topics
  const allTopics = db
    .prepare("SELECT id, canonical_name, aliases FROM entities WHERE type = 'topic' AND status != 'merged'")
    .all() as TopicRow[];

  let bestMatch: TopicRow | null = null;
  for (const t of allTopics) {
    const normExisting = normalizeTopic(t.canonical_name);
    if (topicsSimilar(normIncoming, normExisting)) {
      bestMatch = t;
      break;
    }
    // Also check aliases
    const aliases: string[] = JSON.parse(t.aliases || '[]');
    for (const alias of aliases) {
      if (topicsSimilar(normIncoming, normalizeTopic(alias))) {
        bestMatch = t;
        break;
      }
    }
    if (bestMatch) break;
  }

  if (bestMatch) {
    // Decide if incoming name is better
    const existingQuality = topicNameQuality(bestMatch.canonical_name);
    const incomingQuality = topicNameQuality(incoming);

    if (incomingQuality > existingQuality) {
      // Upgrade canonical name, demote old name to alias
      const aliases: string[] = JSON.parse(bestMatch.aliases || '[]');
      if (!aliases.includes(bestMatch.canonical_name)) {
        aliases.push(bestMatch.canonical_name);
      }
      if (!aliases.includes(incoming)) {
        // don't add the new canonical as alias
      }
      db.prepare("UPDATE entities SET canonical_name = ?, aliases = ?, last_seen_at = MAX(last_seen_at, ?), updated_at = ? WHERE id = ?")
        .run(incoming, JSON.stringify(aliases), now, now, bestMatch.id);
    } else {
      // Keep existing name, add incoming as alias
      const aliases: string[] = JSON.parse(bestMatch.aliases || '[]');
      if (!aliases.includes(incoming) && incoming.toLowerCase() !== bestMatch.canonical_name.toLowerCase()) {
        aliases.push(incoming);
        db.prepare("UPDATE entities SET aliases = ?, last_seen_at = MAX(last_seen_at, ?), updated_at = ? WHERE id = ?")
          .run(JSON.stringify(aliases), now, now, bestMatch.id);
      } else {
        db.prepare("UPDATE entities SET last_seen_at = MAX(last_seen_at, ?), updated_at = ? WHERE id = ?")
          .run(now, now, bestMatch.id);
      }
    }

    return { id: bestMatch.id };
  }

  // 3. No match — create new topic
  const topicId = ulid();
  db.prepare(`INSERT INTO entities (id, type, canonical_name, name_alt, aliases, attributes, confidence, status, merged_into, first_seen_at, last_seen_at, created_at, updated_at)
    VALUES (?, 'topic', ?, NULL, '[]', ?, 0.95, 'active', NULL, ?, ?, ?, ?)`)
    .run(topicId, incoming, JSON.stringify({ source: 'explicit_topic' }), now, now, now, now);
  return { id: topicId };
}

/**
 * Infer parent-child hierarchy among topics using LLM semantic understanding.
 * Falls back to name-containment heuristic if LLM is unavailable.
 */
async function inferTopicHierarchy(db: any): Promise<void> {
  const topics = db
    .prepare("SELECT id, canonical_name, parent_entity_id FROM entities WHERE type = 'topic' AND status != 'merged'")
    .all() as Array<{ id: string; canonical_name: string; parent_entity_id: string | null }>;

  if (topics.length < 2) return;

  // Only process orphan topics (no parent yet)
  const orphans = topics.filter(t => !t.parent_entity_id);
  if (orphans.length < 2) return;

  const proxyUrl = process.env.LLM_PROXY_URL;
  if (!proxyUrl) {
    throw new Error('LLM_PROXY_URL not set — topic hierarchy inference requires LLM');
  }

  await inferHierarchyWithLLM(db, orphans, proxyUrl);
}

async function inferHierarchyWithLLM(
  db: any,
  topics: Array<{ id: string; canonical_name: string }>,
  proxyUrl: string,
): Promise<void> {
  // Build numbered topic list for LLM
  const topicList = topics.map((t, i) => `${i + 1}. ${t.canonical_name}`).join('\n');

  const prompt = `Given these topics, organize them into a hierarchy. Some topics are sub-topics of others.
Return a JSON array where each item has "index" (1-based) and "parentIndex" (1-based, or null if top-level).

Rules:
- A topic is a parent if other topics are specific aspects/workstreams of it
- Only assign a parent when the relationship is clear and meaningful
- Most broad/general topics should be top-level (parentIndex: null)
- Be conservative: if unsure, leave as top-level

Topics:
${topicList}

Return ONLY valid JSON array, no prose. Example: [{"index":1,"parentIndex":null},{"index":2,"parentIndex":1}]`;

  const resp = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) return;

  const data = (await resp.json()) as { content?: string };
  const text = data.content ?? '';

  // Parse JSON from response
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1) return;

  const parsed = JSON.parse(text.slice(start, end + 1)) as Array<{ index: number; parentIndex: number | null }>;
  const now = Date.now();

  for (const item of parsed) {
    if (!item.parentIndex || item.parentIndex === item.index) continue;
    const child = topics[item.index - 1];
    const parent = topics[item.parentIndex - 1];
    if (!child || !parent) continue;

    db.prepare("UPDATE entities SET parent_entity_id = ?, updated_at = ? WHERE id = ?")
      .run(parent.id, now, child.id);
  }
}


// ---- ingest_item ----------------------------------------------------------

server.tool(
  'ingest_item',
  'Push a raw item (email, message, document, note) into MindFlow for processing. MindFlow will extract entities, build relationships, and index it. This is the primary way external agents inject data.',
  {
    channel: z.string().describe('Source channel (e.g. slack, email, imessage, file, telegram, notion, confluence)'),
    sourceUrl: z.string().describe('URL to the original content (Slack permalink, Confluence page, Jira ticket, email link, file path, etc.). Users will see an "Open Original" link in the UI.'),
    subject: z.string().nullable().optional().describe('Subject line (for emails) or title'),
    body: z.string().describe('The content body (plain text, HTML, or markdown)'),
    bodyFormat: z.nativeEnum(BodyFormat).optional().describe('Body format: plaintext, html, or markdown (default plaintext)'),
    sender: z.string().nullable().optional().describe('Sender name or identifier'),
    recipients: z.array(z.string()).optional().describe('Recipient names or identifiers'),
    externalId: z.string().optional().describe('External ID for deduplication (e.g., email message-id, slack ts)'),
    threadId: z.string().nullable().optional().describe('Thread/conversation ID for grouping related items'),
    topics: z.array(z.string()).optional().describe('Explicit topic names to file this item under (e.g. Slack channel name, project name). Each topic entity is created or matched and the item is linked to it. Only include topics that are clearly relevant.'),
    eventTime: z.number().optional().describe('When this event occurred (Unix ms). Defaults to now.'),
    metadata: z.record(z.unknown()).optional().describe('Arbitrary metadata (tags, etc.)'),
  },
  async ({ channel, sourceUrl, subject, body, bodyFormat, sender, recipients, externalId, threadId, topics, eventTime, metadata }) => {
    const eng = await getEngine();
    const now = Date.now();
    const contentHash = createHash('sha256').update(body).digest('hex');

    // Deduplicate by content hash
    const existing = eng.rawItems.findByHash(contentHash);
    if (existing) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'duplicate', existingId: existing.id }) }] };
    }

    const item: RawItem = {
      id: ulid(),
      sourceAdapter: SourceAdapterType.Filesystem, // generic; external source
      channel: channel,
      externalId: externalId ?? ulid(),
      threadId: threadId ?? null,
      senderEntityId: null,
      recipientEntityIds: [],
      subject: subject ?? null,
      body,
      bodyFormat: bodyFormat ?? BodyFormat.Plaintext,
      contentHash,
      language: null,
      eventTime: eventTime ?? now,
      ingestedAt: now,
      processingStatus: ProcessingStatus.Pending,
      attachments: [],
      metadata: {
        ...metadata,
        injectedBy: 'mcp',
        sourceUrl,
        sender: sender ?? undefined,
        recipients: recipients ?? undefined,
        topics: topics ?? undefined,
      },
    };

    eng.rawItems.insert(item);

    // Directly create/match explicit topic entities and link them to the item.
    // Uses smart fuzzy matching and picks the best canonical name.
    if (topics && topics.length > 0) {
      for (const topicName of topics) {
        if (!topicName || topicName.trim().length < 2) continue;
        const incoming = topicName.trim();

        const topicEntity = findOrCreateTopic(eng.db.db, incoming, now);

        // Link item to topic
        try {
          eng.db.db
            .prepare("INSERT OR IGNORE INTO entity_episodes (entity_id, raw_item_id, extraction_method, confidence) VALUES (?, ?, 'explicit_topic', 0.95)")
            .run(topicEntity.id, item.id);
        } catch { /* ignore duplicate */ }
      }

      // After all topics are linked, infer hierarchy using LLM or name heuristic
      await inferTopicHierarchy(eng.db.db);
    }

    // Enqueue for processing pipeline
    eng.jobs.enqueue({
      id: ulid(),
      rawItemId: item.id,
      stage: JobStage.Triage,
      status: 'pending' as any,
      attempts: 0,
      maxAttempts: 3,
      createdAt: now,
      updatedAt: now,
      error: null,
    });

    // Auto-process the ingested item (no need for a separate process_pending call)
    await eng.ingest();

    return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'ingested_and_processed', id: item.id, contentHash }) }] };
  },
);

// ---- process_pending ------------------------------------------------------

server.tool(
  'process_pending',
  'Process all pending ingested items through the extraction pipeline (entity extraction, relationship building, attention detection). Call this after ingesting items via ingest_item.',
  {},
  async () => {
    const eng = await getEngine();
    await eng.ingest(); // runs pipeline on queued jobs
    const stats = eng.getStats();
    return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'processed', stats }) }] };
  },
);

// ---- add_entity -----------------------------------------------------------

server.tool(
  'add_entity',
  'Manually add an entity (person, topic, action_item, key_fact, document) to the knowledge graph.',
  {
    type: z.nativeEnum(EntityType).describe('Entity type'),
    name: z.string().describe('Canonical name'),
    nameAlt: z.string().nullable().optional().describe('Alternative name (e.g., Chinese/English)'),
    attributes: z.record(z.unknown()).optional().describe('Extra attributes (email, role, etc.)'),
    aliases: z.array(z.string()).optional().describe('Known aliases for entity resolution'),
  },
  async ({ type, name, nameAlt, attributes, aliases }) => {
    const eng = await getEngine();
    const now = Date.now();
    const entity: Entity = {
      id: ulid(),
      type,
      canonicalName: name,
      nameAlt: nameAlt ?? null,
      aliases: aliases ?? [],
      attributes: attributes ?? {},
      confidence: 1.0,
      status: EntityStatus.Active,
      mergedInto: null,
      parentEntityId: null,
      firstSeenAt: now,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    };
    eng.entities.insert(entity);
    eng.eventBus.emit('entity:created', { entity });
    return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'created', id: entity.id, name: entity.canonicalName }) }] };
  },
);

// ---- add_relationship -----------------------------------------------------

server.tool(
  'add_relationship',
  'Create a relationship between two entities in the knowledge graph.',
  {
    fromEntityId: z.string().describe('Source entity ID'),
    toEntityId: z.string().describe('Target entity ID'),
    type: z.nativeEnum(RelationshipType).describe('Relationship type (discusses, communicates_with, assigned_to, etc.)'),
    strength: z.number().min(0).max(1).optional().describe('Relationship strength 0-1 (default 0.8)'),
    metadata: z.record(z.unknown()).optional().describe('Extra context about this relationship'),
  },
  async ({ fromEntityId, toEntityId, type, strength, metadata }) => {
    const eng = await getEngine();
    const now = Date.now();

    // Verify both entities exist
    const from = eng.getEntity(fromEntityId);
    const to = eng.getEntity(toEntityId);
    if (!from) return { content: [{ type: 'text' as const, text: `Entity ${fromEntityId} not found` }], isError: true };
    if (!to) return { content: [{ type: 'text' as const, text: `Entity ${toEntityId} not found` }], isError: true };

    const rel: Relationship = {
      id: ulid(),
      fromEntityId,
      toEntityId,
      type,
      strength: strength ?? 0.8,
      eventTime: now,
      ingestionTime: now,
      validFrom: now,
      validUntil: null,
      occurrenceCount: 1,
      sourceItemIds: [],
      metadata: metadata ?? {},
    };

    try {
      eng.relationships.insert(rel);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNIQUE constraint')) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'already_exists' }) }] };
      }
      throw err;
    }

    return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'created', id: rel.id, from: from.canonicalName, to: to.canonicalName, type }) }] };
  },
);

// ---- get_shortest_path ----------------------------------------------------

server.tool(
  'get_shortest_path',
  'Find the shortest connection path between two entities in the knowledge graph.',
  {
    fromId: z.string().describe('Source entity ID'),
    toId: z.string().describe('Target entity ID'),
    maxDepth: z.number().int().min(1).max(6).optional().describe('Max traversal depth (default 4)'),
  },
  async ({ fromId, toId, maxDepth }) => {
    const eng = await getEngine();
    const path = eng.graphOps.getShortestPath(fromId, toId, maxDepth ?? 4);
    return { content: [{ type: 'text' as const, text: JSON.stringify(path, null, 2) }] };
  },
);

// ---- cross_reference ------------------------------------------------------

server.tool(
  'cross_reference',
  'Find items where two entities appear together. Useful for understanding shared context between people or topics.',
  {
    entityId1: z.string().describe('First entity ID'),
    entityId2: z.string().describe('Second entity ID'),
  },
  async ({ entityId1, entityId2 }) => {
    const eng = await getEngine();
    const result = eng.graphOps.getCrossReference(entityId1, entityId2);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// ---- delete_item ----------------------------------------------------------

server.tool(
  'delete_item',
  'Delete a raw item (message, email, document) by ID',
  { id: z.string().describe('The raw item ID to delete') },
  async ({ id }) => {
    const eng = await getEngine();
    const existing = eng.rawItems.findById(id);
    if (!existing) {
      return { content: [{ type: 'text' as const, text: `Item ${id} not found` }], isError: true };
    }
    eng.rawItems.deleteById(id);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, id }) }] };
  },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('[mindflow-mcp] Fatal:', err);
  process.exit(1);
});
