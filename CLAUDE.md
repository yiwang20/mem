# MindFlow — Project Conventions

## Overview

MindFlow is a local-first, platform-agnostic personal knowledge engine. It indexes email, iMessage, and documents into a unified knowledge graph with entity extraction, cross-channel linking, and layered visual exploration.

## Architecture

Three-layer architecture: **Storage Layer** (SQLite + sqlite-vec + FTS5) → **Core Engine** (ingestion, processing, graph, query, attention) → **Platform Adapters** (CLI, HTTP, OpenClaw).

The core engine is a standalone library with zero platform dependencies. Platform integrations are thin adapter shells.

## Tech Stack

- **Runtime**: Node.js 20+, TypeScript (strict mode), ES modules
- **Database**: SQLite via `better-sqlite3`, raw SQL with numbered migrations (no ORM)
- **IDs**: ULIDs everywhere (time-sortable, unique)
- **Timestamps**: Unix epoch integers (milliseconds)
- **Validation**: Zod schemas at system boundaries
- **HTTP**: Fastify
- **CLI**: Commander
- **Testing**: Vitest

## Directory Structure

```
src/
  core/           # Core engine, event bus, public API
  storage/        # Database connection, migrations, repositories
  ingestion/      # Source adapter interface + implementations (Gmail, iMessage, filesystem)
  processing/     # Pipeline stages (triage, NER, LLM extraction), job queue
  graph/          # Entity resolution (4-stage), graph operations
  query/          # Query engine, hybrid search (FTS5 + vector + graph)
  attention/      # Attention engine, pending item detection
  llm/            # LLM provider abstraction (Claude, OpenAI, Ollama)
  adapters/       # Platform adapters
    cli/          # CLI adapter (Commander)
    http/         # HTTP API (Fastify) + static SPA serving
    openclaw/     # OpenClaw MCP plugin adapter
  ui/             # Static SPA files (Cytoscape.js graph UI)
  utils/          # Shared utilities (ULID generation, hashing, date helpers)
  types/          # Shared TypeScript type definitions
tests/
  unit/           # Unit tests
  integration/    # Integration tests (hit real SQLite)
migrations/       # Numbered SQL migration files (001_initial_schema.sql, etc.)
```

## Conventions

### Code Style

- Use named exports, not default exports
- Use `type` imports for type-only imports: `import type { Foo } from './foo.js'`
- File extensions in imports: always use `.js` extension (NodeNext resolution)
- One module per file; keep files focused and under 300 lines when possible
- Prefer functions over classes unless state management requires it

### Database

- All SQL is raw — no ORM, no query builder
- Migrations are plain `.sql` files in `migrations/`, applied in numeric order
- Schema changes require a new migration file, never edit existing ones
- Use parameterized queries exclusively — never interpolate values into SQL
- Wrap multi-statement operations in transactions

### Error Handling

- Use typed error classes extending `Error` for domain errors
- Let unexpected errors propagate — don't swallow them
- Log errors with context (source adapter, entity ID, etc.)

### Testing

- Unit tests: `tests/unit/<module>.test.ts` — test pure logic, mock I/O boundaries
- Integration tests: `tests/integration/<feature>.test.ts` — hit real SQLite (in-memory or temp file)
- Run: `npm test` (unit), `npm run test:integration` (integration)

### Event Bus

- All cross-module communication goes through typed events
- Event names follow `domain:action` pattern (e.g., `items:ingested`, `entity:created`)
- Adapters subscribe to events; they never call core internals directly

### LLM Integration

- All LLM calls go through the `LLMProvider` interface
- Content-aware privacy routing decides local vs. cloud per item
- Structured output via Zod schemas for extraction results

## Commands

- `npm run build` — compile TypeScript
- `npm run dev` — run CLI in watch mode
- `npm run serve` — start HTTP server
- `npm test` — run unit tests
- `npm run test:integration` — run integration tests
- `npm run typecheck` — type-check without emitting
