import type { Command } from 'commander';
import { MindFlowEngine } from '../../../core/engine.js';
import { HttpServer } from '../../http/index.js';
import { error, header, info, pc, success } from '../ui.js';

export function registerServe(program: Command): void {
  program
    .command('serve')
    .description('Start the MindFlow HTTP server and web UI')
    .option('--port <n>', 'Port to listen on', '7123')
    .option('--db <path>', 'Database path override')
    .option('--open', 'Open browser automatically')
    .action(async (opts: { port: string; db?: string; open?: boolean }) => {
      const port = parseInt(opts.port, 10) || 7123;
      const url = `http://127.0.0.1:${port}`;

      header('MindFlow Server');

      const engine = new MindFlowEngine(opts.db ? { dbPath: opts.db } : {});
      await engine.init();

      const server = new HttpServer(engine, port);

      // Graceful shutdown
      const shutdown = async () => {
        info('Shutting down…');
        await server.stop();
        engine.close();
        process.exit(0);
      };
      process.on('SIGINT', () => void shutdown());
      process.on('SIGTERM', () => void shutdown());

      try {
        await server.start();
        success(`Server running at ${pc.cyan(url)}`);
        info('Press Ctrl+C to stop');

        if (opts.open) {
          const { exec } = await import('node:child_process');
          const cmd =
            process.platform === 'darwin'
              ? `open "${url}"`
              : process.platform === 'win32'
                ? `start "${url}"`
                : `xdg-open "${url}"`;
          exec(cmd);
        }
      } catch (err: unknown) {
        error('Server failed to start: ' + String(err instanceof Error ? err.message : err));
        engine.close();
        process.exit(1);
      }
    });
}
