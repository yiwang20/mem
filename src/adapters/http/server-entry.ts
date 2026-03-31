/**
 * MindFlow server entry point.
 *
 * Resolves the data directory and port from CLI args or environment variables,
 * creates the engine, starts the HTTP server, and writes the port file so the
 * plugin's ServiceManager can discover the running instance.
 *
 * CLI usage:
 *   node dist/server/index.js --port 3456 --db ~/.mindflow/data/mindflow.db
 *
 * Environment variables (override CLI args):
 *   MINDFLOW_PORT         — port number
 *   MINDFLOW_DATA_DIR     — data directory (db path derived from this if --db not given)
 *   MINDFLOW_MIGRATIONS_DIR — migrations directory (defaults to ./migrations relative to this file)
 */

import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MindFlowEngine } from '../../core/engine.js';
import { HttpServer } from './server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Parse CLI arguments
// ---------------------------------------------------------------------------

function parseArgs(): { port: number; dbPath: string; dataDir: string } {
  const args = process.argv.slice(2);
  let port = 3456;
  let dbPath: string | null = null;
  let dataDir: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port' && args[i + 1]) {
      port = parseInt(args[++i] as string, 10);
    } else if (arg === '--db' && args[i + 1]) {
      dbPath = (args[++i] as string);
    } else if (arg === '--data-dir' && args[i + 1]) {
      dataDir = (args[++i] as string);
    }
  }

  // Environment variables take precedence over CLI args.
  if (process.env['MINDFLOW_PORT']) {
    port = parseInt(process.env['MINDFLOW_PORT'], 10);
  }
  if (process.env['MINDFLOW_DATA_DIR']) {
    dataDir = process.env['MINDFLOW_DATA_DIR'];
  }

  const resolvedDataDir = dataDir ?? join(homedir(), '.mindflow');
  const resolvedDbPath = dbPath ?? join(resolvedDataDir, 'data', 'mindflow.db');

  return { port, dbPath: resolvedDbPath, dataDir: resolvedDataDir };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { port, dbPath, dataDir } = parseArgs();

// Ensure data and logs directories exist before the engine tries to open the db.
mkdirSync(join(dataDir, 'data'), { recursive: true });
mkdirSync(join(dataDir, 'logs'), { recursive: true });

// Override the migrations directory to point to the bundled migrations.
// When esbuild bundles this file to dist/server/index.js, __dirname resolves to
// dist/server/, and the migrations are copied to dist/server/migrations/.
// Only set if the bundled migrations directory actually exists; otherwise let
// database.ts resolve to the project-root migrations/ via its own __dirname.
if (!process.env['MINDFLOW_MIGRATIONS_DIR']) {
  const bundledMigrations = join(__dirname, 'migrations');
  try {
    const { readdirSync } = await import('fs');
    readdirSync(bundledMigrations);
    process.env['MINDFLOW_MIGRATIONS_DIR'] = bundledMigrations;
  } catch {
    // Not a bundled deployment — let database.ts use its default
  }
}

const engine = new MindFlowEngine({ dataDir, dbPath });
await engine.init();

const server = new HttpServer(engine, port);
await server.start();

console.log(`MindFlow server running on port ${port}`);
console.log(`Database: ${dbPath}`);

// Write port file so the plugin's ServiceManager and the hook handler can find us.
writeFileSync(join(dataDir, 'server.port'), String(port), 'utf8');

// Graceful shutdown
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, async () => {
    console.log(`\nMindFlow server shutting down (${sig})…`);
    try {
      await server.stop();
      engine.close();
    } catch (err) {
      console.error('Error during shutdown:', err);
    }
    process.exit(0);
  });
}
