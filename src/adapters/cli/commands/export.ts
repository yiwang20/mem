import { resolve } from 'node:path';
import type { Command } from 'commander';
import { MindFlowEngine } from '../../../core/engine.js';
import { DataExporter } from '../../../core/export.js';
import { divider, error, header, label, Spinner, success } from '../ui.js';

export function registerExport(program: Command): void {
  program
    .command('export')
    .description('Export the full knowledge graph as JSON-LD')
    .option('--output <path>', 'Output file path', './mindflow-export.json')
    .option('--db <path>', 'Database path override')
    .action(async (opts: { output: string; db?: string }) => {
      const engine = new MindFlowEngine(opts.db ? { dbPath: opts.db } : {});
      await engine.init();

      const outputPath = resolve(opts.output);
      const exporter = new DataExporter(engine.db.db);

      header('Export');

      const spinner = new Spinner('Building JSON-LD export…');
      spinner.start();

      try {
        const doc = await exporter.exportJsonLd(outputPath);
        spinner.stop();
        divider();

        const graph = doc['@graph'] as unknown[];
        success('Export complete');
        label('Output file', outputPath);
        label('Graph nodes', graph.length);
      } catch (err: unknown) {
        spinner.stop();
        const msg = err instanceof Error ? err.message : String(err);
        error('Export failed: ' + msg);
        engine.close();
        process.exit(1);
      }

      engine.close();
      console.log('');
    });
}
