import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MindFlowEngine } from '../../../core/engine.js';
import { ulid } from '../../../utils/ulid.js';

// ---------------------------------------------------------------------------
// Exclusion types and storage
//
// Exclusions are stored under the config key "exclusions_list" as a JSON
// array of ExclusionEntry objects, separate from the MindFlowConfig.exclusions
// field (which only has flat string arrays). This allows per-entry IDs for
// deletion.
// ---------------------------------------------------------------------------

const EXCLUSIONS_CONFIG_KEY = 'exclusions_list';

const ExclusionTypeSchema = z.enum(['contact', 'label', 'conversation']);

const AddExclusionBodySchema = z.object({
  type: ExclusionTypeSchema,
  value: z.string().min(1),
});

const ExclusionIdParamsSchema = z.object({
  id: z.string().min(1),
});

export interface ExclusionEntry {
  id: string;
  type: 'contact' | 'label' | 'conversation';
  value: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Helpers — read/write exclusion list from config table
// ---------------------------------------------------------------------------

function loadExclusions(db: import('better-sqlite3').Database): ExclusionEntry[] {
  const row = db
    .prepare('SELECT value FROM config WHERE key = ?')
    .get(EXCLUSIONS_CONFIG_KEY) as { value: string } | undefined;
  if (!row) return [];
  try {
    return JSON.parse(row.value) as ExclusionEntry[];
  } catch {
    return [];
  }
}

function saveExclusions(
  db: import('better-sqlite3').Database,
  entries: ExclusionEntry[],
): void {
  db.prepare(
    `INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(EXCLUSIONS_CONFIG_KEY, JSON.stringify(entries), Date.now());
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function registerConfigRoutes(
  app: FastifyInstance,
  engine: MindFlowEngine,
): Promise<void> {
  const db = engine.db.db;

  // GET /api/config/exclusions — list all exclusions
  app.get('/api/config/exclusions', async (_req, reply) => {
    const exclusions = loadExclusions(db);
    return reply.send({ exclusions });
  });

  // POST /api/config/exclusions — add an exclusion
  app.post('/api/config/exclusions', async (req, reply) => {
    const body = AddExclusionBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    const exclusions = loadExclusions(db);

    // Prevent exact duplicates
    const duplicate = exclusions.find(
      (e) => e.type === body.data.type && e.value === body.data.value,
    );
    if (duplicate) {
      return reply.status(409).send({ error: 'Exclusion already exists', exclusion: duplicate });
    }

    const entry: ExclusionEntry = {
      id: ulid(),
      type: body.data.type,
      value: body.data.value,
      createdAt: Date.now(),
    };

    exclusions.push(entry);
    saveExclusions(db, exclusions);

    return reply.status(201).send({ exclusion: entry });
  });

  // DELETE /api/config/exclusions/:id — remove an exclusion by id
  app.delete<{ Params: { id: string } }>(
    '/api/config/exclusions/:id',
    async (req, reply) => {
      const params = ExclusionIdParamsSchema.safeParse(req.params);
      if (!params.success) {
        return reply.status(400).send({ error: 'Invalid exclusion id' });
      }

      const exclusions = loadExclusions(db);
      const idx = exclusions.findIndex((e) => e.id === params.data.id);

      if (idx === -1) {
        return reply.status(404).send({ error: 'Exclusion not found' });
      }

      exclusions.splice(idx, 1);
      saveExclusions(db, exclusions);

      return reply.status(204).send();
    },
  );
}
