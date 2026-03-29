import type { Command } from 'commander';
import { MindFlowEngine } from '../../../core/engine.js';
import { SourceAdapterType } from '../../../types/index.js';
import {
  divider,
  error,
  formatDate,
  header,
  label,
  pc,
} from '../ui.js';

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Show system status: indexed items, entities, attention items')
    .option('--db <path>', 'Database path override')
    .option('--json', 'Output as JSON')
    .action(async (opts: { db?: string; json?: boolean }) => {
      const engine = new MindFlowEngine(opts.db ? { dbPath: opts.db } : {});
      await engine.init();

      try {
        const stats = engine.getStats();

        // Per-type entity breakdown
        const db = engine.db.db;
        const typeBreakdown = db
          .prepare(
            `SELECT type, COUNT(*) as n FROM entities WHERE status != 'merged' GROUP BY type ORDER BY n DESC`,
          )
          .all() as Array<{ type: string; n: number }>;

        // Last sync times per adapter
        const adapters = [
          SourceAdapterType.Gmail,
          SourceAdapterType.IMessage,
          SourceAdapterType.Filesystem,
        ];
        const syncTimes: Record<string, number | null> = {};
        for (const adapter of adapters) {
          const state = engine.syncState.get(adapter);
          syncTimes[adapter] = state ? state.lastSyncAt : null;
        }

        // Attention items
        const attention = engine.getAttentionItems();

        if (opts.json) {
          console.log(
            JSON.stringify({ stats, typeBreakdown, syncTimes, attentionItems: attention }, null, 2),
          );
          engine.close();
          return;
        }

        header('MindFlow Status');

        divider();
        console.log(pc.bold('Index'));
        label('Raw items', stats.rawItemCount.toLocaleString());
        label('Entities (active)', stats.entityCount.toLocaleString());
        label('Relationships (active)', stats.relationshipCount.toLocaleString());
        label('Pending jobs', stats.pendingJobCount.toLocaleString());

        if (typeBreakdown.length > 0) {
          divider();
          console.log(pc.bold('Entities by type'));
          for (const row of typeBreakdown) {
            label(row.type, row.n.toLocaleString());
          }
        }

        divider();
        console.log(pc.bold('Last sync'));
        for (const adapter of adapters) {
          label(adapter, formatDate(syncTimes[adapter] ?? null));
        }

        if (attention.length > 0) {
          divider();
          console.log(pc.bold(`Attention items (${attention.length})`));
          const top = attention.slice(0, 5);
          for (const item of top) {
            const urgency = Math.round(item.urgencyScore * 100);
            const urgencyStr =
              urgency >= 80
                ? pc.red(`${urgency}%`)
                : urgency >= 50
                  ? pc.yellow(`${urgency}%`)
                  : pc.dim(`${urgency}%`);
            console.log(
              `  ${urgencyStr} ${pc.bold(item.title)} ${pc.dim(`[${item.type}]`)}`,
            );
          }
          if (attention.length > 5) {
            console.log(pc.dim(`  … and ${attention.length - 5} more`));
          }
        } else {
          divider();
          console.log(pc.dim('  No pending attention items.'));
        }

        console.log('');
      } catch (err: unknown) {
        error(String(err instanceof Error ? err.message : err));
        engine.close();
        process.exit(1);
      }

      engine.close();
    });
}
