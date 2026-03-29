import { MindFlowEngine } from '../src/core/engine.js';
import { HttpServer } from '../src/adapters/http/index.js';

async function main() {
  const dbPath = process.argv[2] || `${process.env.HOME}/.mindflow/demo.db`;
  const port = parseInt(process.argv[3] || '3456', 10);

  const engine = new MindFlowEngine({ dbPath });
  engine.init();

  const server = new HttpServer(engine, port);
  await server.start();
  console.log(`MindFlow server running at http://localhost:${port}`);
  console.log(`Database: ${dbPath}`);

  process.on('SIGINT', async () => {
    await server.stop();
    engine.close();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error('Failed to start:', e.message);
  process.exit(1);
});
