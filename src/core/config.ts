import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { MindFlowConfig } from '../types/index.js';
import { PrivacyMode } from '../types/index.js';

// ----------------------------------------------------------------------------
// Zod schemas
// ----------------------------------------------------------------------------

const LLMConfigSchema = z.object({
  extractionProvider: z.string().default('claude'),
  answerProvider: z.string().default('claude'),
  monthlyBudgetCap: z.number().min(0).default(0),
  providers: z.record(z.record(z.unknown())).default({}),
});

const GmailSourceConfigSchema = z.object({
  enabled: z.boolean().default(false),
  auth: z.object({
    type: z.literal('imap'),
    host: z.string(),
    port: z.number(),
    user: z.string(),
    password: z.string(),
    tls: z.boolean().default(true),
  }),
  folders: z.array(z.string()).default(['INBOX']),
  excludeLabels: z.array(z.string()).default([]),
});

const IMessageSourceConfigSchema = z.object({
  enabled: z.boolean().default(false),
  dbPath: z.string().default(
    join(homedir(), 'Library/Messages/chat.db'),
  ),
  excludeHandles: z.array(z.string()).default([]),
});

const FilesystemSourceConfigSchema = z.object({
  enabled: z.boolean().default(false),
  watchPaths: z.array(z.string()).default([]),
  extensions: z
    .array(z.string())
    .default(['.md', '.txt', '.pdf', '.docx']),
  ignorePatterns: z.array(z.string()).default(['node_modules', '.git']),
});

const SourceConfigsSchema = z.object({
  gmail: GmailSourceConfigSchema.optional(),
  imessage: IMessageSourceConfigSchema.optional(),
  filesystem: FilesystemSourceConfigSchema.optional(),
});

const ExclusionConfigSchema = z.object({
  contacts: z.array(z.string()).default([]),
  emailLabels: z.array(z.string()).default([]),
  patterns: z.array(z.string()).default([]),
});

export const MindFlowConfigSchema = z.object({
  dataDir: z.string().default(join(homedir(), '.mindflow')),
  dbPath: z
    .string()
    .default(join(homedir(), '.mindflow', 'data', 'mindflow.db')),
  ingestionIntervalMs: z.number().min(60_000).default(900_000),
  ingestionBatchSize: z.number().min(1).default(100),
  privacyMode: z
    .nativeEnum(PrivacyMode)
    .default(PrivacyMode.ContentAware),
  llm: LLMConfigSchema.default({}),
  sources: SourceConfigsSchema.default({}),
  exclusions: ExclusionConfigSchema.default({}),
  initialScanDepth: z
    .enum(['month', '6months', 'year', 'all'])
    .default('month'),
});

// ----------------------------------------------------------------------------
// Default config
// ----------------------------------------------------------------------------

export const DEFAULT_CONFIG: MindFlowConfig = MindFlowConfigSchema.parse({});

// ----------------------------------------------------------------------------
// Config manager — persists to/from the SQLite config table
// ----------------------------------------------------------------------------

import type Database from 'better-sqlite3';

export class ConfigManager {
  constructor(private readonly db: Database.Database) {}

  get<K extends keyof MindFlowConfig>(key: K): MindFlowConfig[K] | undefined {
    const row = this.db
      .prepare('SELECT value FROM config WHERE key = ?')
      .get(String(key)) as { value: string } | undefined;

    if (!row) return undefined;

    try {
      return JSON.parse(row.value) as MindFlowConfig[K];
    } catch {
      return row.value as unknown as MindFlowConfig[K];
    }
  }

  set<K extends keyof MindFlowConfig>(key: K, value: MindFlowConfig[K]): void {
    this.db
      .prepare(
        `INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(String(key), JSON.stringify(value), Date.now());
  }

  /** Load the full config from the database, falling back to defaults for missing keys. */
  load(): MindFlowConfig {
    const rows = this.db
      .prepare('SELECT key, value FROM config')
      .all() as Array<{ key: string; value: string }>;

    const stored: Partial<Record<string, unknown>> = {};
    for (const row of rows) {
      try {
        stored[row.key] = JSON.parse(row.value);
      } catch {
        stored[row.key] = row.value;
      }
    }

    return MindFlowConfigSchema.parse(stored);
  }

  /** Persist all keys of a config object to the database. */
  save(config: Partial<MindFlowConfig>): void {
    const now = Date.now();
    const saveAll = this.db.transaction(() => {
      for (const [key, value] of Object.entries(config)) {
        this.db
          .prepare(
            `INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          )
          .run(key, JSON.stringify(value), now);
      }
    });
    saveAll();
  }
}
