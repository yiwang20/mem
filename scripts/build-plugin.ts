#!/usr/bin/env tsx
/**
 * Build script for the @mindflow/openclaw distributable package.
 * Produces packages/openclaw-plugin/ from monorepo source.
 *
 * Steps:
 *   1. Build server bundle (esbuild)
 *   2. Build plugin bundle (esbuild)
 *   3. Build React SPA (Vite)
 *   4. Copy SQL migrations
 *   5. Copy skill files
 *   6. Copy hook files
 *   7. Copy manifests (package.json + openclaw.plugin.json)
 */

import { build } from 'esbuild';
import {
  cpSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'packages', 'openclaw-plugin');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

function log(step: string) {
  console.log(`\n[build:plugin] ${step}`);
}

// ---------------------------------------------------------------------------
// Clean output directory
// ---------------------------------------------------------------------------

log('Cleaning output directory');
if (existsSync(OUT)) {
  rmSync(OUT, { recursive: true, force: true });
}

// Create directory structure
ensureDir(join(OUT, 'dist', 'server', 'migrations'));
ensureDir(join(OUT, 'dist', 'plugin'));
ensureDir(join(OUT, 'dist', 'ui'));
ensureDir(join(OUT, 'skills', 'mindflow-setup'));
ensureDir(join(OUT, 'hooks', 'mindflow-ingest'));

// ---------------------------------------------------------------------------
// Step 1: Build server bundle
// ---------------------------------------------------------------------------

log('Building server bundle (esbuild)');

const sharedExternals = [
  'better-sqlite3',
  '@anthropic-ai/sdk',
  'openclaw/plugin-sdk/plugin-entry',
  'openclaw/plugin-sdk/*',
  '@sinclair/typebox',
];

await build({
  entryPoints: [join(ROOT, 'src', 'adapters', 'http', 'server-entry.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: join(OUT, 'dist', 'server', 'index.js'),
  external: sharedExternals,
  treeShaking: true,
  minify: true,
  sourcemap: true,
});

// ---------------------------------------------------------------------------
// Step 2: Build plugin bundle
// ---------------------------------------------------------------------------

log('Building plugin bundle (esbuild)');

await build({
  entryPoints: [join(ROOT, 'src', 'adapters', 'openclaw', 'plugin', 'index.js')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: join(OUT, 'dist', 'plugin', 'index.js'),
  external: sharedExternals,
  treeShaking: true,
  minify: true,
  sourcemap: true,
});

// ---------------------------------------------------------------------------
// Step 3: Build React SPA (Vite) and copy output
// ---------------------------------------------------------------------------

log('Building React SPA (Vite)');

execSync('npm run build:ui', { cwd: ROOT, stdio: 'inherit' });

// Vite writes to dist/ui relative to repo root (see vite.config.ts outDir: '../../dist/ui')
const viteSpaOut = join(ROOT, 'dist', 'ui');
cpSync(viteSpaOut, join(OUT, 'dist', 'ui'), { recursive: true });

// ---------------------------------------------------------------------------
// Step 4: Copy SQL migrations
// ---------------------------------------------------------------------------

log('Copying SQL migrations');

const migrationsDir = join(ROOT, 'migrations');
for (const file of readdirSync(migrationsDir)) {
  if (file.endsWith('.sql')) {
    copyFileSync(
      join(migrationsDir, file),
      join(OUT, 'dist', 'server', 'migrations', file),
    );
  }
}

// ---------------------------------------------------------------------------
// Step 5: Copy skill files
// ---------------------------------------------------------------------------

log('Copying skill files');

cpSync(
  join(ROOT, 'src', 'adapters', 'openclaw', 'skill'),
  join(OUT, 'skills', 'mindflow-setup'),
  { recursive: true },
);

// ---------------------------------------------------------------------------
// Step 6: Copy hook files
// ---------------------------------------------------------------------------

log('Copying hook files');

// The hooks directory lives at hooks/mindflow-ingest/ (written by this build)
// We copy from the hooks source directory in src/adapters/openclaw/hooks/ if it
// exists; otherwise the hook files are written directly to OUT by this script.
const hooksSourceDir = join(ROOT, 'src', 'adapters', 'openclaw', 'hooks');
if (existsSync(hooksSourceDir)) {
  cpSync(hooksSourceDir, join(OUT, 'hooks', 'mindflow-ingest'), { recursive: true });
} else {
  // Hook files are authored in packages/openclaw-plugin/hooks/mindflow-ingest/
  // and were already created by this repo. Nothing to copy.
  console.log('  (no hooks source dir — hook files already in place)');
}

// ---------------------------------------------------------------------------
// Step 7: Copy manifests
// ---------------------------------------------------------------------------

log('Copying manifests');

copyFileSync(
  join(ROOT, 'src', 'adapters', 'openclaw', 'plugin', 'openclaw.plugin.json'),
  join(OUT, 'openclaw.plugin.json'),
);

copyFileSync(
  join(ROOT, 'packages', 'openclaw-plugin-package.json'),
  join(OUT, 'package.json'),
);

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

log('Build complete');
console.log(`\n  Output: ${OUT}\n`);
