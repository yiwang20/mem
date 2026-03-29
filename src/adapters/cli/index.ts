#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerInit } from './commands/init.js';
import { registerIngest } from './commands/ingest.js';
import { registerQuery } from './commands/query.js';
import { registerServe } from './commands/serve.js';
import { registerStatus } from './commands/status.js';
import { registerExport } from './commands/export.js';
import { error } from './ui.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '../../../package.json'), 'utf8'),
    ) as { version: string };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

const program = new Command();

program
  .name('mindflow')
  .description('Local-first personal knowledge engine')
  .version(getVersion(), '-v, --version')
  .addHelpText(
    'after',
    `
Examples:
  $ mindflow init               Run setup wizard
  $ mindflow ingest             Index new messages and documents
  $ mindflow query "What did Wang Zong say about the budget?"
  $ mindflow status             Show index statistics
  $ mindflow serve              Start web UI server
  $ mindflow export --output ./export.json  Export knowledge graph as JSON-LD
`,
  );

registerInit(program);
registerIngest(program);
registerQuery(program);
registerServe(program);
registerStatus(program);
registerExport(program);

// Global error handler for unhandled promise rejections in commands
process.on('unhandledRejection', (reason) => {
  error(String(reason instanceof Error ? reason.message : reason));
  process.exit(1);
});

program.parseAsync(process.argv).catch((err: unknown) => {
  error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
