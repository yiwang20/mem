/**
 * Integration tests for ServiceManager.
 *
 * All tests that need a real MindFlow server spawn it directly via tsx (using
 * the TypeScript source entry point). ServiceManager's "start child" code
 * targets the compiled dist path, so for tests requiring self-spawn we use a
 * TestableServiceManager subclass that overrides the server entry path.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { ServiceManager } from '../../src/adapters/openclaw/plugin/service-manager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TSX = join(__dirname, '../../node_modules/.bin/tsx');
const SERVER_ENTRY = join(__dirname, '../../src/adapters/http/server-entry.ts');
const MIGRATIONS_DIR = join(__dirname, '../../migrations');

// ---------------------------------------------------------------------------
// TestableServiceManager — overrides serverEntry to point at tsx + source
// ---------------------------------------------------------------------------

/**
 * Extends ServiceManager to spawn the server via `tsx <server-entry.ts>`
 * rather than `node dist/server/index.js`, enabling tests to run against
 * the TypeScript source without a build step.
 */
class TestableServiceManager extends ServiceManager {
  // Expose the spawn command for test-environment use.
  // We monkey-patch startChild by overriding the private node binary and args.
  // Since ServiceManager is a plain class with no DI for the entry path, we
  // override the protected _spawnArgs hook introduced below via prototype patch.
}

// Monkey-patch ServiceManager's private startChild to use tsx + source entry.
// We do this by patching the prototype's private method via bracket notation.
// TypeScript can't see it, but at runtime the method is just a property.
const originalStartChild = (ServiceManager.prototype as unknown as Record<string, (...args: unknown[]) => Promise<void>>)['startChild'];

function patchStartChild(sm: ServiceManager, dataDir: string, port: number) {
  (sm as unknown as Record<string, unknown>)['startChild'] = async function (this: ServiceManager) {
    const { createWriteStream } = await import('node:fs');
    const { writeFile } = await import('node:fs/promises');

    const logsDir = join(dataDir, 'logs');
    const dataSubDir = join(dataDir, 'data');
    const dbPath = join(dataSubDir, 'mindflow.db');
    const logPath = join(logsDir, 'server.log');
    const pidPath = join(dataDir, 'server.pid');

    await mkdir(logsDir, { recursive: true });
    await mkdir(dataSubDir, { recursive: true });

    const logStream = createWriteStream(logPath, { flags: 'a' });

    const child = spawn(
      TSX,
      [SERVER_ENTRY, '--port', String(port), '--db', dbPath],
      {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          MINDFLOW_DATA_DIR: dataDir,
          MINDFLOW_PORT: String(port),
          MINDFLOW_MIGRATIONS_DIR: MIGRATIONS_DIR,
        },
      },
    );

    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);

    (this as unknown as Record<string, unknown>)['child'] = child;

    if (child.pid !== undefined) {
      await writeFile(pidPath, String(child.pid), 'utf8');
    }

    let childExitedEarly = false;
    child.once('exit', (code) => {
      if (code !== 0 && code !== null) childExitedEarly = true;
    });

    const POLL_INTERVAL = 500;
    const TIMEOUT = 15_000;
    const deadline = Date.now() + TIMEOUT;

    while (Date.now() < deadline) {
      if (childExitedEarly) {
        (this as unknown as Record<string, unknown>)['child'] = null;
        throw new Error(`MindFlow server process exited unexpectedly. Check logs at ${logPath}`);
      }
      if (await (this as unknown as Record<string, (...args: unknown[]) => Promise<boolean>>)['checkMindFlowHealth'](port)) {
        (this as unknown as Record<string, unknown>)['activePort'] = port;
        await (this as unknown as Record<string, (...args: unknown[]) => Promise<void>>)['writePortFile'](port);
        return;
      }
      await sleep(POLL_INTERVAL);
    }

    (this as unknown as Record<string, unknown>)['child'] = null;
    child.kill('SIGTERM');
    throw new Error(`MindFlow server did not become healthy within ${TIMEOUT / 1000}s.`);
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomPort(): number {
  return 41000 + Math.floor(Math.random() * 8000);
}

async function waitForHealth(port: number, timeoutMs = 12_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/stats`, {
        signal: AbortSignal.timeout(500),
      });
      if (res.ok) {
        const body = await res.json() as Record<string, unknown>;
        if ('rawItemCount' in body) return true;
      }
    } catch {
      // not ready yet
    }
    await sleep(200);
  }
  return false;
}

async function spawnServer(port: number, dataDir: string): Promise<ChildProcess> {
  await mkdir(join(dataDir, 'data'), { recursive: true });
  await mkdir(join(dataDir, 'logs'), { recursive: true });

  const dbPath = join(dataDir, 'data', 'mindflow.db');
  const child = spawn(
    TSX,
    [SERVER_ENTRY, '--port', String(port), '--db', dbPath],
    {
      env: {
        ...process.env,
        MINDFLOW_DATA_DIR: dataDir,
        MINDFLOW_PORT: String(port),
        MINDFLOW_MIGRATIONS_DIR: MIGRATIONS_DIR,
      },
      stdio: 'pipe',
    },
  );
  return child;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function killChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) { resolve(); return; }
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
      resolve();
    }, 3000);
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpDirs: string[] = [];
let children: ChildProcess[] = [];
let managers: ServiceManager[] = [];

function makeTmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'mf-svc-test-'));
  tmpDirs.push(d);
  return d;
}

beforeEach(() => {
  tmpDirs = [];
  children = [];
  managers = [];
});

afterEach(async () => {
  for (const sm of managers) {
    await sm.stop().catch(() => undefined);
  }
  for (const child of children) {
    await killChild(child).catch(() => undefined);
  }
  for (const d of tmpDirs) {
    rmSync(d, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ServiceManager', () => {
  it('ensureRunning() starts child process, passes health check, returns URL', async () => {
    const port = randomPort();
    const dataDir = makeTmpDir();

    const sm = new ServiceManager({ port, dataDir, autoStart: true });
    patchStartChild(sm, dataDir, port);
    managers.push(sm);

    const url = await sm.ensureRunning();
    expect(url).toBe(`http://127.0.0.1:${port}`);

    const healthy = await sm.healthCheck();
    expect(healthy).toBe(true);

    const pid = sm.getPid();
    expect(pid).toBeGreaterThan(0);
  }, 30_000);

  it('reuses an already-running instance when port file exists and service is healthy', async () => {
    const port = randomPort();
    const dataDir = makeTmpDir();

    // Start server externally
    const child = await spawnServer(port, dataDir);
    children.push(child);
    const ready = await waitForHealth(port);
    expect(ready).toBe(true);

    // Write port file as the server would
    writeFileSync(join(dataDir, 'server.port'), String(port), 'utf8');

    const sm = new ServiceManager({ port, dataDir, autoStart: true });
    managers.push(sm);

    const url = await sm.ensureRunning();
    expect(url).toBe(`http://127.0.0.1:${port}`);

    // Externally started server should still be alive
    expect(child.exitCode).toBeNull();

    // ServiceManager should NOT have spawned its own child
    expect(sm.getPid()).toBeNull();
  }, 30_000);

  it('starts a new process when existing port file points to dead server', async () => {
    const port = randomPort();
    const dataDir = makeTmpDir();

    await mkdir(dataDir, { recursive: true });
    // Write port file pointing to a dead port
    const deadPort = randomPort();
    writeFileSync(join(dataDir, 'server.port'), String(deadPort), 'utf8');

    const sm = new ServiceManager({ port, dataDir, autoStart: true });
    patchStartChild(sm, dataDir, port);
    managers.push(sm);

    const url = await sm.ensureRunning();
    expect(url).toBe(`http://127.0.0.1:${port}`);

    const healthy = await sm.healthCheck();
    expect(healthy).toBe(true);
  }, 30_000);

  it('stop() terminates child process, getPid() returns null after stop', async () => {
    const port = randomPort();
    const dataDir = makeTmpDir();

    const sm = new ServiceManager({ port, dataDir, autoStart: true });
    patchStartChild(sm, dataDir, port);
    managers.push(sm);

    await sm.ensureRunning();
    expect(sm.getPid()).toBeGreaterThan(0);

    await sm.stop();
    expect(sm.getPid()).toBeNull();

    // Server should no longer be healthy
    const healthy = await sm.healthCheck();
    expect(healthy).toBe(false);
  }, 30_000);

  it('healthCheck() returns false before start and true after start', async () => {
    const port = randomPort();
    const dataDir = makeTmpDir();

    const sm = new ServiceManager({ port, dataDir, autoStart: true });
    patchStartChild(sm, dataDir, port);
    managers.push(sm);

    // Before starting
    expect(await sm.healthCheck()).toBe(false);

    await sm.ensureRunning();

    // After starting
    expect(await sm.healthCheck()).toBe(true);
  }, 30_000);

  it('falls back to configured port when port file contains invalid content', async () => {
    const port = randomPort();
    const dataDir = makeTmpDir();

    await mkdir(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'server.port'), 'not-a-port', 'utf8');

    const sm = new ServiceManager({ port, dataDir, autoStart: true });
    patchStartChild(sm, dataDir, port);
    managers.push(sm);

    const url = await sm.ensureRunning();
    expect(url).toBe(`http://127.0.0.1:${port}`);
    expect(await sm.healthCheck()).toBe(true);
  }, 30_000);
});
