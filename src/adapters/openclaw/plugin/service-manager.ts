/**
 * ServiceManager — manages the MindFlow HTTP server as a child process.
 *
 * Startup sequence (per design doc Section 4.3):
 * 1. Read ~/.mindflow/server.port to find a previously-started instance.
 * 2. Health-check that port — if valid MindFlow JSON (has rawItemCount), reuse it.
 * 3. If not healthy, spawn a new child process on the configured port.
 * 4. Poll health every 500ms up to 10s.
 * 5. Write PID and port files on successful start.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ServiceManagerConfig {
  /** Port to use for the MindFlow server (default: 3456). */
  port?: number;
  /** Data directory (default: ~/.mindflow). */
  dataDir?: string;
  /** Whether to auto-start the server on first call (default: true). */
  autoStart?: boolean;
}

const DEFAULT_PORT = 3456;
const HEALTH_POLL_INTERVAL_MS = 500;
const HEALTH_TIMEOUT_MS = 10_000;
const HEALTH_CHECK_TIMEOUT_MS = 1_000;

export class ServiceManager {
  private readonly configuredPort: number;
  private readonly dataDir: string;
  private readonly autoStart: boolean;
  private child: ChildProcess | null = null;
  private activePort: number | null = null;

  constructor(config: ServiceManagerConfig = {}) {
    this.configuredPort = config.port ?? DEFAULT_PORT;
    this.dataDir = config.dataDir ?? join(homedir(), '.mindflow');
    this.autoStart = config.autoStart ?? true;
  }

  /**
   * Ensure the server is running. Returns the base URL (e.g. http://127.0.0.1:3456).
   * Reads the port file first, health-checks it, and starts a new process if needed.
   */
  async ensureRunning(): Promise<string> {
    if (!this.autoStart) {
      throw new Error(
        'MindFlow is not configured yet. Run the setup wizard: /mindflow-setup',
      );
    }

    // 1. Try the port from the port file (covers cross-session reuse).
    const portFromFile = await this.readPortFile();
    if (portFromFile !== null) {
      if (await this.checkMindFlowHealth(portFromFile)) {
        this.activePort = portFromFile;
        return `http://127.0.0.1:${portFromFile}`;
      }
    }

    // 2. Try the configured port if different from the port file.
    if (portFromFile === null || portFromFile !== this.configuredPort) {
      if (await this.checkMindFlowHealth(this.configuredPort)) {
        this.activePort = this.configuredPort;
        await this.writePortFile(this.configuredPort);
        return `http://127.0.0.1:${this.configuredPort}`;
      }
    }

    // 3. If our own child is already alive, something is wrong — restart.
    if (this.child !== null && this.child.exitCode === null) {
      // Child is running but not responding — kill it and restart.
      this.child.kill('SIGTERM');
      this.child = null;
    }

    // 4. Start a fresh child process.
    await this.startChild();
    return `http://127.0.0.1:${this.configuredPort}`;
  }

  /** Stop the server gracefully by sending SIGTERM to the child. */
  async stop(): Promise<void> {
    if (this.child === null) return;
    const child = this.child;
    this.child = null;
    this.activePort = null;

    if (child.exitCode !== null) return; // Already exited.

    child.kill('SIGTERM');

    // Wait up to 5s for the child to exit.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
        resolve();
      }, 5_000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * Check if the server is responding with valid MindFlow JSON.
   * Does NOT start the server — just checks the current state.
   */
  async healthCheck(): Promise<boolean> {
    const port = this.activePort ?? this.configuredPort;
    return this.checkMindFlowHealth(port);
  }

  /** Return the current child process PID, or null if not running. */
  getPid(): number | null {
    if (this.child === null || this.child.exitCode !== null) return null;
    return this.child.pid ?? null;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Spawn the MindFlow server as a child process, pipe its output to the log
   * file, and poll health until ready or timeout.
   */
  private async startChild(): Promise<void> {
    const logsDir = join(this.dataDir, 'logs');
    const dataDir = join(this.dataDir, 'data');
    const dbPath = join(dataDir, 'mindflow.db');
    const logPath = join(logsDir, 'server.log');
    const pidPath = join(this.dataDir, 'server.pid');

    await mkdir(logsDir, { recursive: true });
    await mkdir(dataDir, { recursive: true });

    const logStream = createWriteStream(logPath, { flags: 'a' });

    // Server entry point: dist/server/index.js relative to the plugin directory.
    // At runtime the plugin lives in dist/plugin/index.js, server in dist/server/index.js.
    // From dist/plugin/ go one level up to dist/, then into server/.
    const serverEntry = join(__dirname, '../server/index.js');

    // Check whether the configured port is already occupied by a non-MindFlow process.
    const portOccupied = await this.isPortOccupied(this.configuredPort);
    if (portOccupied) {
      throw new Error(
        `Port ${this.configuredPort} is in use by another process. ` +
          `Configure a different port via plugins.entries.mindflow.config.port`,
      );
    }

    const child = spawn(
      process.execPath, // node binary
      [
        serverEntry,
        '--port',
        String(this.configuredPort),
        '--db',
        dbPath,
      ],
      {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          MINDFLOW_DATA_DIR: this.dataDir,
          MINDFLOW_PORT: String(this.configuredPort),
        },
      },
    );

    // Pipe stdout/stderr to the log file.
    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);

    this.child = child;

    // Write PID file immediately so external tools can find the process.
    if (child.pid !== undefined) {
      await writeFile(pidPath, String(child.pid), 'utf8');
    }

    // Handle unexpected child exit before health check passes.
    let childExitedEarly = false;
    child.once('exit', (code) => {
      if (code !== 0 && code !== null) {
        childExitedEarly = true;
      }
    });

    // Poll health until ready or timeout.
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (childExitedEarly) {
        this.child = null;
        throw new Error(
          `MindFlow server process exited unexpectedly during startup. ` +
            `Check logs at ${logPath}`,
        );
      }
      if (await this.checkMindFlowHealth(this.configuredPort)) {
        this.activePort = this.configuredPort;
        await this.writePortFile(this.configuredPort);
        return;
      }
      await sleep(HEALTH_POLL_INTERVAL_MS);
    }

    // Timed out — kill the child and report.
    this.child = null;
    child.kill('SIGTERM');
    throw new Error(
      `MindFlow server did not become healthy within ${HEALTH_TIMEOUT_MS / 1000}s. ` +
        `Check logs at ${logPath}`,
    );
  }

  /**
   * Return true if the port has something listening that is NOT MindFlow
   * (connection accepted but response is not valid MindFlow JSON, or a
   * non-HTTP service). Used to detect port conflicts before spawning.
   */
  private async isPortOccupied(port: number): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/stats`, {
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      });
      // Something responded on this port.
      if (!res.ok) return true; // Non-200 from an unknown service.
      const body = await res.json().catch(() => null);
      if (body && typeof body === 'object' && 'rawItemCount' in body) {
        // MindFlow is already running here — not a conflict.
        return false;
      }
      // HTTP server on this port but not MindFlow.
      return true;
    } catch {
      // ECONNREFUSED = port is free. Timeout = nothing listening. Either way: not occupied.
      return false;
    }
  }

  /**
   * Return true if a valid MindFlow server is responding on the given port
   * (response has rawItemCount field per design doc Section 4.4).
   */
  private async checkMindFlowHealth(port: number): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/stats`, {
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      });
      if (!res.ok) return false;
      const body = await res.json().catch(() => null);
      return body !== null && typeof body === 'object' && 'rawItemCount' in body;
    } catch {
      return false;
    }
  }

  private async readPortFile(): Promise<number | null> {
    try {
      const portFile = join(this.dataDir, 'server.port');
      const content = await readFile(portFile, 'utf8');
      const port = parseInt(content.trim(), 10);
      return Number.isFinite(port) && port > 0 ? port : null;
    } catch {
      return null;
    }
  }

  private async writePortFile(port: number): Promise<void> {
    try {
      await mkdir(this.dataDir, { recursive: true });
      await writeFile(join(this.dataDir, 'server.port'), String(port), 'utf8');
    } catch {
      // Non-fatal — the service still works, just won't be discoverable via file.
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
