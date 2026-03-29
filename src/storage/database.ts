import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// MINDFLOW_MIGRATIONS_DIR allows the bundled server entry to override the path
// at runtime (the bundle lives at dist/server/index.js, not src/storage/).
const DEFAULT_MIGRATIONS_DIR = join(__dirname, '../../migrations');

export class MindFlowDatabase {
  readonly db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath);

    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -64000'); // 64MB page cache
    this.db.pragma('temp_store = MEMORY');

    this.loadSqliteVec();
    this.runMigrations();
  }

  private loadSqliteVec(): void {
    try {
      // sqlite-vec extension may or may not be installed; fail gracefully
      this.db.loadExtension('vec0');
    } catch {
      // Extension not available — vector search will be unavailable
    }
  }

  private runMigrations(): void {
    // Ensure schema_version table exists before querying it
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL,
        filename TEXT NOT NULL
      )
    `);

    const applied = new Set<number>(
      (
        this.db
          .prepare('SELECT version FROM schema_version ORDER BY version')
          .all() as Array<{ version: number }>
      ).map((r) => r.version),
    );

    const migrationsDir = process.env['MINDFLOW_MIGRATIONS_DIR'] ?? DEFAULT_MIGRATIONS_DIR;

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const filename of files) {
      const match = filename.match(/^(\d+)/);
      if (!match || !match[1]) continue;
      const version = parseInt(match[1], 10);

      if (applied.has(version)) continue;

      const sql = readFileSync(join(migrationsDir, filename), 'utf8');

      const applyMigration = this.db.transaction(() => {
        // Migration SQL files use CREATE TABLE IF NOT EXISTS for schema_version,
        // so it's safe to exec the entire file as-is.
        this.db.exec(sql);

        this.db
          .prepare(
            'INSERT INTO schema_version (version, applied_at, filename) VALUES (?, ?, ?)',
          )
          .run(version, Date.now(), filename);
      });

      applyMigration();
    }
  }

  close(): void {
    this.db.close();
  }
}
