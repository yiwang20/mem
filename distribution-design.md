# MindFlow Distribution Architecture

**Version 1.0 -- March 29, 2026**

How MindFlow ships as a self-contained, installable OpenClaw plugin with zero manual setup.

---

## 1. Architecture Overview

MindFlow distributes as a **single npm package** that bundles:

1. **OpenClaw plugin adapter** -- MCP tools, message hook, cron setup
2. **MindFlow core engine** -- storage, ingestion, processing, graph, query, attention
3. **HTTP server** -- Fastify API + static React SPA
4. **SQL migrations** -- schema files applied automatically on first run
5. **Setup wizard skill** -- interactive first-run configuration
6. **Service manager** -- starts/stops/health-checks the MindFlow server child process

```
User installs via:
  openclaw plugins install mindflow

Which triggers:
  npm install @mindflow/openclaw → node_modules/

OpenClaw loads:
  plugin entry → registers tools, hooks, skill

On first tool call:
  service manager → starts MindFlow HTTP server as background child process

On every tool call:
  plugin → HTTP fetch → MindFlow API → SQLite knowledge graph
```

The plugin is a thin adapter that communicates with a local MindFlow server over HTTP. The server owns the database, runs ingestion, and serves the web UI. The plugin bridges MindFlow into OpenClaw's agent tools.

---

## 2. Package Architecture

### 2.1 What Ships

The published npm package `@mindflow/openclaw` contains:

```
@mindflow/openclaw/
  package.json                    # npm metadata + openclaw block
  openclaw.plugin.json            # OpenClaw manifest (config schema, skills, id)
  dist/
    plugin/
      index.js                    # Plugin entry (esbuild bundle, single file)
    server/
      index.js                    # MindFlow server entry (esbuild bundle, single file)
      migrations/
        001_initial_schema.sql    # SQL migrations (copied verbatim)
    ui/
      index.html                  # React SPA (Vite build output)
      assets/                     # JS/CSS chunks
  skills/
    mindflow-setup/
      SKILL.md                    # Setup wizard skill
  hooks/
    mindflow-ingest/
      HOOK.md                     # Hook metadata
      handler.js                  # Message hook handler (standalone)
```

### 2.2 What's Bundled vs Runtime-Resolved

| Component | Bundled in dist? | Rationale |
|-----------|-----------------|-----------|
| Plugin adapter code | Yes, esbuild single-file | Zero dependency resolution at load time |
| MindFlow core engine | Yes, bundled into server/index.js | Self-contained server binary |
| better-sqlite3 | **No** -- runtime dependency | Native addon; must match user's Node/OS/arch. Declared in package.json `dependencies`, npm installs the correct prebuilt binary |
| @anthropic-ai/sdk | **No** -- runtime dependency | User may not have an API key; tree-shaking won't help. Declared in `optionalDependencies` |
| Fastify + plugins | Yes, bundled into server/index.js | Pure JS, no native addons, safe to bundle |
| React SPA | Yes, pre-built static files | Vite build output, served as static files |
| SQL migrations | Yes, copied as plain .sql files | Read at runtime by the migration runner |
| Setup wizard skill | Yes, as SKILL.md | Text file, loaded by OpenClaw's skill system |
| Message hook | Yes, as standalone handler.js | Small handler, no imports from core |

### 2.3 The Native Addon Problem

`better-sqlite3` includes a C++ native addon that must be compiled for the user's platform (darwin-arm64, darwin-x64, linux-x64, etc.). This is the only component that cannot be bundled.

**Solution**: Declare `better-sqlite3` as a regular `dependencies` entry in package.json. When the user runs `openclaw plugins install mindflow`, npm installs the package and its dependencies, including downloading the correct prebuilt binary for `better-sqlite3` from npm. This is the standard pattern used by thousands of npm packages with native addons.

If the prebuilt binary is not available (rare edge case), npm falls back to building from source, which requires a C++ compiler. The setup wizard detects this and provides guidance.

---

## 3. Installation Flow

### 3.1 Step-by-Step

```
1. User runs:
   $ openclaw plugins install mindflow

2. OpenClaw resolver:
   - Checks ClawHub registry for "mindflow" → finds @mindflow/openclaw
   - Falls back to npm if not on ClawHub
   - Downloads the package tarball
   - Runs `npm install` in the plugin directory (installs better-sqlite3 prebuild)

3. OpenClaw discovers:
   - Reads openclaw.plugin.json → registers plugin id "mindflow"
   - Reads package.json openclaw.extensions → locates dist/plugin/index.js
   - Reads package.json openclaw.skills → locates skills/mindflow-setup/
   - Reads package.json openclaw.hooks → locates hooks/mindflow-ingest/

4. User restarts gateway (or auto-restart if config watch is on):
   $ openclaw gateway restart

5. OpenClaw loads the plugin:
   - Calls register(api) → registers 5 MCP tools + message hook
   - Skills system discovers mindflow-setup skill
   - Hook system discovers mindflow-ingest hook

6. First interaction — user says "search my emails" or runs /mindflow-setup:
   - If server not running → service manager auto-starts it
   - If not configured → agent detects and suggests running the setup wizard skill
```

### 3.2 First-Run Experience

The first time a MindFlow tool is called and the server is not configured:

1. Tool returns a helpful error: "MindFlow is not configured yet. Run the setup wizard: /mindflow-setup"
2. User invokes `/mindflow-setup` (or the agent suggests it).
3. The skill walks through:
   - **Data directory**: Confirm `~/.mindflow/` or customize
   - **Email source**: Gmail IMAP credentials (host, port, user, password)
   - **iMessage**: Confirm Full Disk Access is granted (macOS only)
   - **LLM provider**: Auto-detect first (see below), then manual if needed
   - **Privacy mode**: Full Local / Content-Aware / Minimal Cloud
   - **Initial scan depth**: Last 30 days / 6 months / 1 year / all
4. Credentials are saved to MindFlow's own config (not OpenClaw's config).
5. The MindFlow server starts.
6. Initial ingestion begins in the background.

**LLM credential auto-detection**: The codebase already has `src/llm/openclaw-provider.ts` which reads Anthropic credentials from OpenClaw's config (`~/.openclaw/openclaw.json`). The setup wizard should:
1. Call `detectOpenClawCredentials()` to check if OpenClaw already has a configured Anthropic provider.
2. If found: skip the LLM configuration step entirely. Tell the user "Using your existing Claude credentials from OpenClaw."
3. If not found: ask the user to provide a Claude API key, configure OpenAI, or select Ollama for fully local operation.

This means most OpenClaw users will have a zero-step LLM setup -- they already have Claude configured.

### 3.3 Web UI Access

The MindFlow server serves the React SPA at its root URL. Users access it by opening `http://127.0.0.1:{port}` in a browser. The URL is surfaced in three places:

1. **`mindflow_dashboard` MCP tool**: A fifth tool registered by the plugin that returns the server URL. The agent can proactively share this when the user asks to "see" or "browse" their knowledge graph.

```typescript
api.registerTool({
  name: "mindflow_dashboard",
  description: "Get the MindFlow web dashboard URL for visual knowledge graph exploration.",
  parameters: Type.Object({}),
  async execute(_id, _params) {
    const baseUrl = await serviceManager.ensureRunning();
    return {
      payloads: textPayload(`MindFlow dashboard: ${baseUrl}\n\nOpen this URL in your browser to explore your knowledge graph visually.`),
    };
  },
});
```

2. **Setup wizard completion**: The skill tells the user the URL after setup finishes (see Section 6.1 step 7).

3. **Digest tool output**: The `mindflow_digest` tool includes a footer line: `Dashboard: http://127.0.0.1:{port}`.

---

## 4. Service Lifecycle Management

### 4.1 Server as Child Process

MindFlow runs as a **child process** of the OpenClaw gateway. The plugin's service manager spawns the MindFlow HTTP server when needed and monitors it.

```
OpenClaw Gateway (parent process)
  └── MindFlow Plugin (in-process, registered via definePluginEntry)
        └── Service Manager
              └── MindFlow Server (child process, port 3456)
                    ├── Fastify HTTP API
                    ├── SQLite database
                    ├── Ingestion scheduler
                    └── Processing pipeline
```

### 4.2 Service Manager Design

The service manager is a module within the plugin adapter that handles:

```typescript
interface ServiceManager {
  /** Ensure the server is running. Starts it if not. Returns the API base URL. */
  ensureRunning(): Promise<string>;

  /** Stop the server gracefully. */
  stop(): Promise<void>;

  /** Check if the server is responding. */
  healthCheck(): Promise<boolean>;

  /** Get the current server PID, or null if not running. */
  getPid(): number | null;
}
```

**Startup flow**:

1. Check if a server is already running: `GET http://127.0.0.1:{port}/api/stats` with 1s timeout.
2. If responding → return the URL (another plugin instance or manual `mindflow serve` may have started it).
3. If not responding → spawn a new child process:
   ```
   node dist/server/index.js --port 3456 --db ~/.mindflow/data/mindflow.db
   ```
4. Wait for health check to pass (poll every 500ms, timeout after 10s).
5. If startup fails → throw descriptive error.

**Child process management**:

- Spawned with `child_process.spawn`, `detached: false`, `stdio: ['ignore', 'pipe', 'pipe']`.
- Not detached -- the child dies when the gateway dies. This is intentional: the server should not outlive its parent.
- stdout/stderr are piped to a log file at `~/.mindflow/logs/server.log` (rotated, max 5MB).
- The PID is written to `~/.mindflow/server.pid` for external tools to check.

**Auto-start**: Every MCP tool call goes through `ensureRunning()` before making the API call. This provides lazy startup -- the server only runs when needed.

**Shutdown**: The service manager sends `SIGTERM` to the child process when the gateway shuts down. Since the child is not detached (`detached: false`), it also dies automatically if the parent process exits unexpectedly. The plugin registers signal handlers for graceful cleanup:

```typescript
register(api) {
  const serviceManager = new ServiceManager(api.pluginConfig);

  // Graceful shutdown on gateway signals
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      serviceManager.stop();  // sends SIGTERM to child, synchronous-safe
    });
  }

  // ... register tools that use serviceManager.ensureRunning()
}
```

Note: `serviceManager.stop()` internally calls `child.kill('SIGTERM')` which is synchronous. The `stop()` method returns a Promise for callers that want to await graceful drain, but the signal handler does not need to await it -- the child process will terminate regardless when the parent exits.

### 4.3 Port Selection and Instance Reuse

Default port: `3456`. Configurable via plugin config:

```json
{
  "plugins": {
    "entries": {
      "mindflow": {
        "config": {
          "port": 3456
        }
      }
    }
  }
}
```

**`ensureRunning()` startup sequence**:

1. **Read port file**: Check `~/.mindflow/server.port`. If it exists, try that port first.
2. **Health check the port**: `GET http://127.0.0.1:{port}/api/stats` with 1s timeout.
   - If the response is valid MindFlow JSON (has `rawItemCount` field) → **reuse this instance**. This covers both: (a) the plugin's own child process from a previous gateway session, and (b) a manually started `mindflow serve`.
   - If the response is HTTP but not valid MindFlow JSON → the port is occupied by something else. Proceed to step 3.
   - If the connection is refused → the port is free. Proceed to step 3.
3. **Start a new instance** on the configured port. If that port is occupied (connection refused = false, i.e., something is listening), fail with a clear error: "Port {port} is in use by another process. Configure a different port via `plugins.entries.mindflow.config.port`."
4. **Write port file**: On successful start, write the actual port to `~/.mindflow/server.port`.

There is no port scanning. If the configured port is taken, the user must change the config. This avoids the complexity of port-hopping and makes the system predictable.

### 4.4 Health Check

The health check calls `GET /api/stats` and validates that the response contains `rawItemCount` (a field unique to MindFlow). This distinguishes a running MindFlow server from any other HTTP service on the same port.

No periodic background health check. The server is a child process -- if it dies, the next tool call's `ensureRunning()` will detect the dead process (via the PID file) and restart it. This is simpler than polling and sufficient for a local knowledge engine.

---

## 5. Configuration Architecture

### 5.1 Two Config Layers

MindFlow has two independent configuration layers:

| Layer | Location | What it stores | Who reads it |
|-------|----------|---------------|-------------|
| **OpenClaw plugin config** | `~/.openclaw/openclaw.json` under `plugins.entries.mindflow.config` | Plugin-level settings: port, API URL | The plugin adapter |
| **MindFlow app config** | `~/.mindflow/data/mindflow.db` (SQLite `config` table) | App-level settings: sources, LLM keys, privacy mode, exclusions | The MindFlow server |

This separation is intentional:
- OpenClaw config is managed by OpenClaw's config system (validation, doctor, etc.).
- MindFlow's own config contains credentials (IMAP passwords, API keys) that should NOT be in OpenClaw's JSON file, which may be synced or logged.

### 5.2 Plugin Manifest configSchema

The `openclaw.plugin.json` manifest declares the plugin-level config:

```json
{
  "id": "mindflow",
  "name": "MindFlow",
  "description": "Personal knowledge graph. Indexes email, iMessage, and documents into a searchable knowledge base with entity extraction and attention detection.",
  "version": "0.1.0",
  "skills": ["./skills/mindflow-setup"],
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "port": {
        "type": "integer",
        "minimum": 1024,
        "maximum": 65535,
        "description": "Port for the MindFlow HTTP server (default: 3456)"
      },
      "dataDir": {
        "type": "string",
        "description": "Data directory (default: ~/.mindflow)"
      },
      "autoStart": {
        "type": "boolean",
        "description": "Auto-start server on first tool call (default: true)"
      }
    }
  },
  "uiHints": {
    "port": {
      "label": "Server Port",
      "placeholder": "3456"
    },
    "dataDir": {
      "label": "Data Directory",
      "placeholder": "~/.mindflow",
      "help": "Where MindFlow stores its database, logs, and configuration"
    },
    "autoStart": {
      "label": "Auto-Start Server",
      "help": "Automatically start the MindFlow server when a tool is called"
    }
  }
}
```

### 5.3 Credential Handling

**LLM credentials**: MindFlow auto-detects Anthropic credentials from OpenClaw's existing provider configuration via `detectOpenClawCredentials()` (implemented in `src/llm/openclaw-provider.ts`). For most OpenClaw users, LLM setup requires zero configuration. Only if no OpenClaw credentials are found does the setup wizard ask for manual API key input.

**Data source credentials** (IMAP password, etc.): Stored in MindFlow's SQLite database, not in OpenClaw's JSON config. The setup wizard writes them via the MindFlow API:

```
Setup wizard → POST /api/config → MindFlow server → SQLite config table
```

The SQLite database is stored in `~/.mindflow/data/mindflow.db` which is owned by the user and not synced anywhere.

---

## 6. Skill & Hook Bundling

### 6.1 Setup Wizard Skill

The setup wizard is a standard OpenClaw skill bundled in the plugin:

**package.json**:
```json
{
  "openclaw": {
    "extensions": ["./dist/plugin/index.js"],
    "skills": ["./skills/mindflow-setup"]
  }
}
```

**skills/mindflow-setup/SKILL.md**:
```markdown
---
name: mindflow-setup
description: "Configure MindFlow data sources, LLM provider, and privacy settings"
metadata:
  openclaw:
    emoji: "🧠"
    requires:
      config:
        - plugins.entries.mindflow
---

# MindFlow Setup

Use this skill when the user wants to configure MindFlow for the first time,
add a new data source, or change their LLM provider settings.

## Steps

1. Check if MindFlow server is running. If not, start it via the mindflow_search tool (which auto-starts the server).
2. Check current configuration status via GET /api/stats.
3. **LLM provider auto-detection**: Check if OpenClaw already has Anthropic credentials configured. If yes, skip LLM setup and tell the user "Using your existing Claude credentials from OpenClaw." If not, ask for a Claude API key, OpenAI key, or suggest Ollama for fully local operation.
4. Walk the user through data source configuration:
   - Email source (Gmail IMAP): host, port, user, password
   - iMessage access (macOS only): verify Full Disk Access
   - Document directories: paths to watch
   - Privacy mode: Full Local / Content-Aware (default) / Minimal Cloud
   - Initial scan depth: 30 days / 6 months / 1 year / all
5. Save configuration via POST /api/config.
6. Trigger initial ingestion via POST /api/ingest.
7. Tell the user the Web UI URL: "Open http://127.0.0.1:{port} in your browser to explore your knowledge graph visually."
8. Report status and next steps.

## Important

- Store IMAP passwords and API keys via the MindFlow API, NOT in openclaw.json.
- The server must be running before configuration can be saved.
- Use the mindflow_digest tool after setup to verify everything works.
- For LLM credentials, always try auto-detecting OpenClaw's existing Anthropic provider first.
```

### 6.2 Message Hook

The message hook is bundled as a hook pack in the plugin:

**package.json**:
```json
{
  "openclaw": {
    "hooks": ["./hooks/mindflow-ingest"]
  }
}
```

**hooks/mindflow-ingest/HOOK.md**:
```markdown
---
name: mindflow-ingest
description: "Trigger MindFlow ingestion when messages are received or sent"
metadata:
  openclaw:
    emoji: "📥"
    events: ["message:received", "message:sent"]
    requires:
      config:
        - plugins.entries.mindflow
---

# MindFlow Ingestion Hook

Triggers a lightweight ingestion cycle in the MindFlow server whenever a message
is received or sent through any OpenClaw channel (Telegram, WhatsApp, etc.).

This captures real-time messaging data into the knowledge graph without waiting
for the next scheduled ingestion cycle.
```

**hooks/mindflow-ingest/handler.js**:
```javascript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function readServerPort() {
  try {
    const portFile = join(homedir(), ".mindflow", "server.port");
    const content = readFileSync(portFile, "utf8").trim();
    const port = parseInt(content, 10);
    return Number.isFinite(port) ? port : 3456;
  } catch {
    return 3456; // Fallback if port file doesn't exist yet
  }
}

const handler = async (event) => {
  if (event.type !== "message") return;

  const port = readServerPort();
  const url = `http://127.0.0.1:${port}/api/ingest`;

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Server not running or timeout — fail silently
  }
};

export default handler;
```

### 6.3 Cron Job for Scheduled Ingestion

Cron jobs cannot be registered programmatically by plugins. The setup wizard creates the ingestion cron via a tool call during first-run:

```
Setup wizard instructs the agent:
"Create a cron job for MindFlow ingestion that runs every 15 minutes"

Agent calls the cron tool:
{
  "name": "MindFlow Ingestion",
  "schedule": { "kind": "every", "interval": "15m" },
  "sessionTarget": "isolated",
  "payload": {
    "agentTurn": {
      "message": "Run MindFlow data ingestion by calling the mindflow_search tool with query 'ingestion status'. This ensures the server is alive and triggers any pending ingestion. Do not announce results unless there are errors."
    }
  }
}
```

This creates a persistent cron job that survives gateway restarts. The cron fires every 15 minutes, wakes an isolated agent session, and the agent triggers a lightweight server health check. The actual ingestion work is performed by the server's internal scheduler, which runs continuously once started. The cron's role is to ensure the server stays alive and to surface errors if ingestion has stalled.

---

## 7. Data Directory Design

### 7.1 Directory Structure

```
~/.mindflow/                      # MindFlow data root (configurable)
  data/
    mindflow.db                   # SQLite database (knowledge graph + config)
    mindflow.db-wal               # WAL journal
    mindflow.db-shm               # Shared memory
  logs/
    server.log                    # Server stdout/stderr (rotated, 5MB max)
  server.pid                      # Current server PID (if running)
  server.port                     # Actual port the server is listening on
```

### 7.2 Ownership

- `~/.mindflow/` is created by the MindFlow server on first startup.
- The directory is owned by the user, not by OpenClaw.
- OpenClaw's plugin directory (`~/.openclaw/plugins/mindflow/`) contains only the plugin code and dependencies -- no user data.
- This separation means uninstalling the plugin does not delete user data.

### 7.3 Platform-Specific Paths

| Platform | Default data dir | Notes |
|----------|-----------------|-------|
| macOS | `~/.mindflow/` | iMessage access requires Full Disk Access |
| Linux | `~/.mindflow/` | No iMessage support |
| Windows (WSL) | `~/.mindflow/` | No iMessage support |

The data directory is configurable via plugin config (`dataDir`) or MindFlow's own config.

---

## 8. Build Pipeline

### 8.1 Build Steps

The distributable is built from the monorepo source in `/Users/peter/dev/mem/`:

```bash
# 1. Build the MindFlow server (esbuild, single bundle)
esbuild src/adapters/http/server-entry.ts \
  --bundle \
  --platform=node \
  --target=node20 \
  --format=esm \
  --outfile=packages/openclaw-plugin/dist/server/index.js \
  --external:better-sqlite3 \
  --external:@anthropic-ai/sdk

# 2. Build the plugin adapter (esbuild, single bundle)
esbuild src/adapters/openclaw/plugin/index.js \
  --bundle \
  --platform=node \
  --target=node20 \
  --format=esm \
  --outfile=packages/openclaw-plugin/dist/plugin/index.js

# 3. Build the React SPA (Vite)
cd src/ui && npm run build
# Output: dist/ui/ → copy to packages/openclaw-plugin/dist/ui/

# 4. Copy SQL migrations
cp migrations/*.sql packages/openclaw-plugin/dist/server/migrations/

# 5. Copy skill and hook files
cp -r src/adapters/openclaw/skill/ packages/openclaw-plugin/skills/mindflow-setup/
cp -r src/adapters/openclaw/hooks/ packages/openclaw-plugin/hooks/mindflow-ingest/

# 6. Copy manifests
cp src/adapters/openclaw/plugin/openclaw.plugin.json packages/openclaw-plugin/
cp src/adapters/openclaw/plugin/package.json packages/openclaw-plugin/

# 7. Pack for npm
cd packages/openclaw-plugin && npm pack
```

### 8.2 esbuild Configuration

Key esbuild settings:

```javascript
{
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  // Mark native addons as external — they are npm dependencies, not bundled
  external: [
    'better-sqlite3',
    '@anthropic-ai/sdk',
    // OpenClaw SDK imports are resolved at runtime by the host
    'openclaw/plugin-sdk/plugin-entry',
    '@sinclair/typebox',
  ],
  // Tree-shake unused code
  treeShaking: true,
  // Minify for smaller package size
  minify: true,
  sourcemap: true,
}
```

### 8.3 Server Entry Point

The server bundle needs a dedicated entry point that:
1. Resolves the data directory from CLI args or environment.
2. Resolves the migrations directory relative to its own location.
3. Creates the MindFlow engine and HTTP server.
4. Starts listening.

```typescript
// src/adapters/http/server-entry.ts
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MindFlowEngine } from '../../core/engine.js';
import { HttpServer } from './server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const port = parseInt(process.env.MINDFLOW_PORT || process.argv[2] || '3456', 10);
const dataDir = process.env.MINDFLOW_DATA_DIR || process.argv[3] || join(homedir(), '.mindflow');
const dbPath = join(dataDir, 'data', 'mindflow.db');

// Override the migrations directory to point to the bundled migrations
process.env.MINDFLOW_MIGRATIONS_DIR = join(__dirname, 'migrations');

const engine = new MindFlowEngine({ dataDir, dbPath });
await engine.init();

const server = new HttpServer(engine, port);
await server.start();

console.log(`MindFlow server running on port ${port}`);
console.log(`Database: ${dbPath}`);

// Write port file for the plugin and hook to discover
mkdirSync(dataDir, { recursive: true });
writeFileSync(join(dataDir, 'server.port'), String(port));
```

### 8.4 Package.json for Distribution

```json
{
  "name": "@mindflow/openclaw",
  "version": "0.1.0",
  "description": "MindFlow — personal knowledge graph plugin for OpenClaw",
  "type": "module",
  "engines": {
    "node": ">=20.0.0"
  },
  "openclaw": {
    "extensions": ["./dist/plugin/index.js"],
    "skills": ["./skills/mindflow-setup"],
    "hooks": ["./hooks/mindflow-ingest"]
  },
  "dependencies": {
    "better-sqlite3": "^11.7.0"
  },
  "optionalDependencies": {
    "@anthropic-ai/sdk": "^0.80.0"
  },
  "files": [
    "dist/",
    "skills/",
    "hooks/",
    "openclaw.plugin.json"
  ]
}
```

---

## 9. Update Strategy

### 9.1 Plugin Updates

```bash
openclaw plugins update mindflow
# or
openclaw plugins update --all
```

This downloads the new package version and replaces the plugin files. The gateway restarts automatically.

### 9.2 Database Migration on Update

When the MindFlow server starts, it always runs the migration runner (already implemented in `src/storage/database.ts`):

1. Read `schema_version` table to find applied migrations.
2. Scan `migrations/` directory for unapplied `.sql` files.
3. Apply new migrations in numeric order, within a transaction.
4. Record each applied migration in `schema_version`.

This is idempotent and crash-safe. New plugin versions ship new migration files; they are applied automatically on the next server start.

### 9.3 Breaking Changes

If a new version requires a breaking schema change:

1. The migration handles the data transformation (ALTER TABLE, data backfill, etc.).
2. If the migration is irreversible, the previous version's data is backed up first: `cp mindflow.db mindflow.db.backup.{timestamp}`.
3. The server logs the migration outcome.

### 9.4 Version Pinning

OpenClaw's plugin system supports exact version installs:

```bash
openclaw plugins install @mindflow/openclaw@0.2.0
```

Users can pin to a specific version if needed.

---

## 10. Uninstall Strategy

### 10.1 Plugin Removal

```bash
openclaw plugins uninstall mindflow
```

This removes:
- Plugin code from `~/.openclaw/plugins/mindflow/`
- Plugin config entry from `openclaw.json`
- Stops the MindFlow server if running

This does NOT remove:
- User data at `~/.mindflow/` (database, logs)
- Cron jobs (must be removed separately)

### 10.2 Full Data Cleanup

If the user wants to remove everything:

```bash
# Remove plugin
openclaw plugins uninstall mindflow

# Remove data (user must explicitly choose this)
rm -rf ~/.mindflow/

# Remove cron jobs
openclaw cron list  # find MindFlow jobs
openclaw cron delete <job-id>
```

The setup wizard skill should mention this cleanup procedure in its help text.

### 10.3 Reinstall After Uninstall

If the user reinstalls after uninstalling (but kept `~/.mindflow/`):
- The existing database is reused.
- Migrations are re-checked (idempotent).
- Configuration is preserved.
- The knowledge graph is intact.

This is a key benefit of data separation: plugin code and user data have independent lifecycles.

---

## 11. Development Workflow

### 11.1 Local Development (Link Mode)

During development, use OpenClaw's link mode:

```bash
# From the monorepo root
cd /Users/peter/dev/mem

# Build the plugin for local use
npm run build:plugin  # runs the esbuild pipeline described in Section 8

# Link into OpenClaw (no copy, symlink)
openclaw plugins install --link ./packages/openclaw-plugin

# Restart gateway to pick up changes
openclaw gateway restart
```

Changes to the plugin source require rebuilding (`npm run build:plugin`) and restarting the gateway. Changes to the MindFlow server require rebuilding and restarting the server (the plugin's service manager detects the restart).

### 11.2 Fast Iteration on Plugin Code

For rapid iteration on the plugin adapter (tools, hooks), use the link mode with watch:

```bash
# Terminal 1: Watch and rebuild plugin
npm run build:plugin -- --watch

# Terminal 2: Restart gateway after each rebuild
openclaw gateway restart
```

### 11.3 Fast Iteration on Server Code

For server-side changes, run the server directly:

```bash
# Terminal 1: Run server in dev mode
npm run serve  # tsx watch mode, port 3456

# Terminal 2: Test via the plugin (already linked)
# The plugin's ensureRunning() will find the already-running server
```

### 11.4 What Ships vs What's Dev-Only

| Component | Ships in npm package | Dev-only |
|-----------|---------------------|----------|
| `dist/plugin/index.js` | Yes | Built from `src/adapters/openclaw/plugin/` |
| `dist/server/index.js` | Yes | Built from entire `src/` tree |
| `dist/ui/` | Yes | Built from `src/ui/` via Vite |
| `dist/server/migrations/` | Yes | Copied from `migrations/` |
| `skills/`, `hooks/` | Yes | Copied from `src/adapters/openclaw/` |
| `src/` | No | Source code, not distributed |
| `tests/` | No | Test files, not distributed |
| `node_modules/` | No | Dev deps, not distributed |
| `package.json` (root) | No | Monorepo root, not the plugin package |

---

## 12. Security Considerations

### 12.1 Trust Boundary

The MindFlow plugin runs in-process within the OpenClaw gateway. It has the same trust level as any other installed plugin. The MindFlow server is a child process with the same user permissions.

### 12.2 Network Exposure

The MindFlow HTTP server binds to `127.0.0.1` only. It is never exposed to the network. All communication between the plugin and server is localhost HTTP.

### 12.3 Credential Storage

- IMAP passwords and LLM API keys are stored in the SQLite database at `~/.mindflow/data/mindflow.db`.
- The database file permissions should be `600` (owner read/write only). The server sets this on creation.
- Future: SQLCipher encryption for the database (requires user passphrase).

### 12.4 npm Package Security

- The published package is built with `npm pack`, which respects the `files` whitelist in package.json.
- No source code, test fixtures, or development configuration ships.
- Dependencies are installed with `--ignore-scripts` by OpenClaw's plugin installer (Section 6.2 of hooks.md confirms this pattern). `better-sqlite3` uses prebuilt binaries and does not need install scripts.

---

## 13. Summary: Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Distribution format | npm package via ClawHub/npm | Standard OpenClaw pattern, widest reach |
| Bundle tool | esbuild | Fast, single-file output, tree-shaking |
| Native addon handling | Runtime dependency, not bundled | Must match user's Node/platform |
| Server model | Child process | Isolated, restartable, doesn't block OpenClaw gateway |
| Auto-start | Lazy on first tool call | No resource waste when MindFlow isn't needed |
| Config separation | Plugin config in OpenClaw, app config in SQLite | Credentials stay out of JSON files |
| Data separation | `~/.mindflow/` independent of plugin dir | Survives uninstall/reinstall |
| Migrations | SQL files, applied on server start | Standard, idempotent, crash-safe |
| Setup experience | Bundled skill (SKILL.md) | Interactive, agent-guided, no CLI required |
| Ingestion scheduling | OpenClaw cron job (created by setup wizard) | Persistent, survives restarts, agent-native |
| Real-time capture | Plugin hook on message events | Non-blocking, fire-and-forget |
