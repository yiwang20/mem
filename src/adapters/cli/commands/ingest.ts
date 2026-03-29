import type { Command } from 'commander';
import { MindFlowEngine } from '../../../core/engine.js';
import { DEFAULT_CONFIG } from '../../../core/config.js';
import { divider, error, header, label, pc, Spinner, success, warn } from '../ui.js';

export function registerIngest(program: Command): void {
  program
    .command('ingest')
    .description('Run one ingestion cycle across all configured sources')
    .option('--db <path>', 'Database path override')
    .action(async (opts: { db?: string }) => {
      const engine = new MindFlowEngine(
        opts.db ? { dbPath: opts.db } : {},
      );
      await engine.init();

      header('Ingestion');

      const statsBefore = engine.getStats();
      const spinner = new Spinner('Running ingestion cycle…');
      spinner.start();

      let itemsBefore = statsBefore.rawItemCount;
      let entitiesBefore = statsBefore.entityCount;

      try {
        await engine.ingest();

        const statsAfter = engine.getStats();
        spinner.stop();
        divider();

        const newItems = statsAfter.rawItemCount - itemsBefore;
        const newEntities = statsAfter.entityCount - entitiesBefore;

        success('Ingestion complete');
        label('New items fetched', newItems);
        label('New entities created', newEntities);
        label('Pending jobs', statsAfter.pendingJobCount);
        label('Total items indexed', statsAfter.rawItemCount);
      } catch (err: unknown) {
        spinner.stop();
        const msg = err instanceof Error ? err.message : String(err);

        if (msg.includes('not yet implemented')) {
          warn('Ingestion module not yet available — run after Task #4 is complete.');
          warn('Current index stats:');
          label('Items indexed', statsBefore.rawItemCount);
          label('Entities', statsBefore.entityCount);
        } else {
          error('Ingestion failed: ' + msg);
          engine.close();
          process.exit(1);
        }
      }

      engine.close();
      console.log('');
    });
}
