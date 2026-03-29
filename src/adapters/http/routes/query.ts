import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MindFlowEngine } from '../../../core/engine.js';
import type { AttentionItem, Entity, RawItem } from '../../../types/index.js';
import { EntityType, SourceChannel } from '../../../types/index.js';

const QueryBodySchema = z.object({
  query: z.string().min(1).max(2000),
  filters: z
    .object({
      entityTypes: z.array(z.nativeEnum(EntityType)).optional(),
      channels: z.array(z.nativeEnum(SourceChannel)).optional(),
      dateRange: z
        .object({
          start: z.number(),
          end: z.number(),
        })
        .optional(),
      people: z.array(z.string()).optional(),
    })
    .optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const BriefingBodySchema = z.object({
  attendees: z.array(z.string().min(1)).min(1).max(20),
  topic: z.string().min(1).max(500).optional(),
});

// ---------------------------------------------------------------------------
// Briefing helpers
// ---------------------------------------------------------------------------

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Find Person entities that fuzzy-match a display name. */
function resolveAttendee(name: string, engine: MindFlowEngine): Entity | null {
  // FTS5 search first — handles partial matches
  const ftsResults = engine.entities.search(name, 5);
  const person = ftsResults.find(
    (e) => e.type === EntityType.Person && e.status !== 'merged',
  );
  if (person) return person;

  // Fall back to alias lookup (exact, case-insensitive)
  const byAlias = engine.entities.findByAlias(name);
  return byAlias.find((e) => e.type === EntityType.Person) ?? null;
}

/** Summarise attendee data for the LLM prompt. */
function summariseAttendee(
  entity: Entity,
  recentItems: RawItem[],
  pendingActions: AttentionItem[],
): string {
  const lines: string[] = [`## ${entity.canonicalName}`];
  if (recentItems.length > 0) {
    lines.push('Recent interactions:');
    for (const item of recentItems.slice(0, 5)) {
      const subj = item.subject ?? '(no subject)';
      const preview = item.body.replace(/<[^>]*>/g, '').slice(0, 100);
      lines.push(`  - [${item.channel}] ${subj}: ${preview}`);
    }
  } else {
    lines.push('No recent interactions in the last 30 days.');
  }
  if (pendingActions.length > 0) {
    lines.push('Pending actions:');
    for (const a of pendingActions.slice(0, 5)) {
      lines.push(`  - ${a.title}`);
    }
  }
  return lines.join('\n');
}

export async function registerQueryRoutes(
  app: FastifyInstance,
  engine: MindFlowEngine,
): Promise<void> {
  // POST /api/query
  app.post('/api/query', async (req, reply) => {
    const parsed = QueryBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const result = await engine.query(parsed.data);
    return reply.send(result);
  });

  // POST /api/briefing
  // Prepares a pre-meeting briefing for a list of attendees.
  app.post('/api/briefing', async (req, reply) => {
    const parsed = BriefingBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { attendees, topic } = parsed.data;
    const cutoff = Date.now() - THIRTY_DAYS_MS;

    // Resolve each attendee name → Person entity + recent items + pending actions
    const attendeeData = attendees.map((name) => {
      const entity = resolveAttendee(name, engine);
      if (!entity) {
        return { name, entity: null, recentItems: [] as RawItem[], pendingActions: [] as AttentionItem[] };
      }

      const timeline = engine.graphOps.getTimeline(entity.id, {
        after: cutoff,
        limit: 10,
      });

      const allPending = engine.attentionItems.findPending();
      const pendingActions = allPending.filter((a) => a.entityId === entity.id);

      return { name, entity, recentItems: timeline.items, pendingActions };
    });

    // Collect related facts and topics when a topic is supplied
    let relatedFacts: Entity[] = [];
    let relatedTopics: Entity[] = [];
    if (topic) {
      const topicEntities = engine.entities.search(topic, 10);
      relatedFacts = topicEntities.filter((e) => e.type === EntityType.KeyFact);
      relatedTopics = topicEntities.filter((e) => e.type === EntityType.Topic);
    }

    // Attempt LLM synthesis
    let summary: string | null = null;
    const llmAvailable = await engine['llmProvider'].isAvailable().catch(() => false);
    if (llmAvailable) {
      const sections: string[] = [];

      if (topic) {
        sections.push(`Meeting topic: ${topic}`);
      }

      for (const ad of attendeeData) {
        if (ad.entity) {
          sections.push(summariseAttendee(ad.entity, ad.recentItems, ad.pendingActions));
        } else {
          sections.push(`## ${ad.name}\nNo data found.`);
        }
      }

      if (relatedFacts.length > 0) {
        sections.push('Key facts:\n' + relatedFacts.map((f) => `  - ${f.canonicalName}`).join('\n'));
      }

      const prompt =
        'You are preparing a brief pre-meeting summary. Be concise and actionable.\n\n' +
        sections.join('\n\n');

      const result = await engine['llmProvider']
        .answer(prompt, { relevantItems: [], relevantEntities: [], relevantRelationships: [] })
        .catch(() => null);

      summary = result?.answer ?? null;
    }

    return reply.send({
      summary,
      attendees: attendeeData.map((ad) => ({
        name: ad.name,
        entity: ad.entity,
        recentItems: ad.recentItems,
        pendingActions: ad.pendingActions,
      })),
      relatedFacts,
      relatedTopics,
    });
  });
}
