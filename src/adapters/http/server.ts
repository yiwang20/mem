import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticFiles from '@fastify/static';
import websocket from '@fastify/websocket';
import type { MindFlowEngine } from '../../core/engine.js';
import { registerGraphRoutes } from './routes/graph.js';
import { registerEntityRoutes } from './routes/entities.js';
import { registerQueryRoutes } from './routes/query.js';
import { registerAttentionRoutes } from './routes/attention.js';
import { registerStatsRoutes } from './routes/stats.js';
import { registerWsRoutes } from './routes/ws.js';
import { registerExportRoutes } from './routes/export.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerIngestRoutes } from './routes/ingest.js';
import { registerTopicsRoutes } from './routes/topics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Prefer dist/ui (React build) over src/ui (legacy vanilla SPA)
const DIST_UI = join(__dirname, '../../../dist/ui');
const SRC_UI = join(__dirname, '../../ui');
const UI_DIR = existsSync(DIST_UI) ? DIST_UI : SRC_UI;

export class HttpServer {
  private readonly app = Fastify({ logger: false });
  private running = false;

  constructor(
    private readonly engine: MindFlowEngine,
    private readonly port = 3000,
  ) {}

  async start(): Promise<void> {
    if (this.running) return;

    // CORS — allow localhost on any port (dev + embedded browser)
    await this.app.register(cors, {
      origin: (origin, cb) => {
        if (!origin) {
          // Same-origin / non-browser requests
          cb(null, true);
          return;
        }
        const allowed =
          origin.startsWith('http://localhost') ||
          origin.startsWith('http://127.0.0.1');
        cb(null, allowed);
      },
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    });

    // WebSocket support
    await this.app.register(websocket);

    // Static file serving (SPA) — only if the ui directory exists
    if (existsSync(UI_DIR)) {
      await this.app.register(staticFiles, {
        root: UI_DIR,
        prefix: '/',
        decorateReply: false,
      });
    }

    // API routes
    await registerGraphRoutes(this.app, this.engine);
    await registerEntityRoutes(this.app, this.engine);
    await registerQueryRoutes(this.app, this.engine);
    await registerAttentionRoutes(this.app, this.engine);
    await registerStatsRoutes(this.app, this.engine);
    await registerWsRoutes(this.app, this.engine);
    await registerExportRoutes(this.app, this.engine);
    await registerConfigRoutes(this.app, this.engine);
    await registerIngestRoutes(this.app, this.engine);
    await registerTopicsRoutes(this.app, this.engine);

    // Fallback: serve index.html for SPA client-side routing
    if (existsSync(UI_DIR)) {
      const indexPath = join(UI_DIR, 'index.html');
      if (existsSync(indexPath)) {
        this.app.setNotFoundHandler((_req, reply) => {
          return reply.sendFile('index.html', UI_DIR);
        });
      }
    }

    const host = process.env.MINDFLOW_HOST || '127.0.0.1';
    await this.app.listen({ port: this.port, host });
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    await this.app.close();
    this.running = false;
  }

  /** The bound address (useful in tests to get the ephemeral port). */
  address(): string {
    return this.app.server.address()
      ? `http://127.0.0.1:${this.port}`
      : '';
  }
}
