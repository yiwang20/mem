import type { Command } from 'commander';
import { MindFlowEngine } from '../../../core/engine.js';
import { channelBadge, divider, error, formatDate, header, pc, warn } from '../ui.js';

export function registerQuery(program: Command): void {
  program
    .command('query <text>')
    .description('Run a natural-language query against your knowledge base')
    .option('--db <path>', 'Database path override')
    .option('--limit <n>', 'Max results', '10')
    .action(async (text: string, opts: { db?: string; limit: string }) => {
      const engine = new MindFlowEngine(opts.db ? { dbPath: opts.db } : {});
      await engine.init();

      header(`Query: "${text}"`);

      try {
        const result = await engine.query({
          query: text,
          limit: parseInt(opts.limit, 10) || 10,
        });

        // Answer block
        if (result.answer) {
          divider();
          console.log(pc.bold('Answer:'));
          console.log('  ' + result.answer.answer);
          console.log('');
          console.log(
            pc.dim(
              `  Confidence: ${Math.round(result.answer.confidence * 100)}%`,
            ),
          );
        }

        // Relevant entities
        if (result.entities.length > 0) {
          divider();
          console.log(pc.bold(`Entities (${result.entities.length}):`));
          for (const e of result.entities) {
            console.log(
              `  ${pc.cyan(e.canonicalName)} ${pc.dim(`[${e.type}]`)}` +
                (e.nameAlt ? ` / ${pc.dim(e.nameAlt)}` : ''),
            );
          }
        }

        // Source items
        if (result.items.length > 0) {
          divider();
          console.log(pc.bold(`Sources (${result.items.length}):`));
          for (const item of result.items) {
            const dateStr = formatDate(item.eventTime);
            const badge = channelBadge(item.channel);
            const subject = item.subject ?? pc.dim('(no subject)');
            console.log(`  ${badge} ${pc.bold(subject)}`);
            console.log(`    ${pc.dim(dateStr)}`);
            if (item.body.length > 0) {
              const preview = item.body.slice(0, 120).replace(/\n/g, ' ');
              console.log(`    ${pc.dim(preview)}${item.body.length > 120 ? '…' : ''}`);
            }
            console.log('');
          }
        }

        if (!result.answer && result.entities.length === 0 && result.items.length === 0) {
          console.log(pc.dim('  No results found.'));
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('not yet implemented')) {
          warn('Query engine not yet available — run after Task #7 is complete.');
        } else {
          error('Query failed: ' + msg);
          engine.close();
          process.exit(1);
        }
      }

      engine.close();
      console.log('');
    });
}
