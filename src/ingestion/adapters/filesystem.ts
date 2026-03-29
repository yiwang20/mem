import chokidar, { type FSWatcher } from 'chokidar';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type {
  FilesystemSourceConfig,
  IngestionBatch,
  IngestedItem,
  SourceAdapter,
} from '../../types/index.js';
import { BodyFormat, SourceAdapterType } from '../../types/index.js';

// ----------------------------------------------------------------------------
// Filesystem Adapter
// Watches configured directories for .md and .txt changes via chokidar.
// Checkpoint: map of file path → last known mtime (ms).
// ----------------------------------------------------------------------------

export class FilesystemAdapter implements SourceAdapter {
  readonly name = SourceAdapterType.Filesystem;

  private config!: FilesystemSourceConfig;
  private watcher: FSWatcher | null = null;
  private pendingPaths = new Set<string>();

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.config = {
      enabled: true,
      watchPaths: (config['watchPaths'] as string[] | undefined) ?? [],
      extensions: (config['extensions'] as string[] | undefined) ?? ['.md', '.txt'],
      ignorePatterns: (config['ignorePatterns'] as string[] | undefined) ?? [
        'node_modules',
        '.git',
      ],
    };

    if (this.config.watchPaths.length === 0) return;

    const ignored = this.config.ignorePatterns.map(
      (p) => new RegExp(escapeRegExp(p)),
    );

    this.watcher = chokidar.watch(this.config.watchPaths, {
      ignored,
      persistent: false,
      ignoreInitial: false,
      usePolling: false,
    });

    // Collect changed paths for fetchSince to consume
    const handlePath = (filePath: string) => {
      if (this.isSupported(filePath)) {
        this.pendingPaths.add(filePath);
      }
    };

    this.watcher.on('add', handlePath);
    this.watcher.on('change', handlePath);

    // Wait for the initial scan to complete
    await new Promise<void>((resolve) => {
      if (!this.watcher) return resolve();
      this.watcher.once('ready', resolve);
    });
  }

  async fetchSince(
    checkpoint: Record<string, unknown> | null,
  ): Promise<IngestionBatch> {
    const mtimeMap: Record<string, number> = (checkpoint?.['mtimes'] as Record<string, number> | undefined) ?? {};

    // Collect paths from watcher + any already accumulated
    const pathsToProcess = new Set<string>(this.pendingPaths);
    this.pendingPaths.clear();

    const items: IngestedItem[] = [];
    const newMtimes: Record<string, number> = { ...mtimeMap };

    for (const filePath of pathsToProcess) {
      if (!this.isSupported(filePath)) continue;

      try {
        const stats = await stat(filePath);
        const mtime = stats.mtimeMs;

        // Skip if not modified since last checkpoint
        const knownMtime = mtimeMap[filePath];
        if (knownMtime !== undefined && mtime <= knownMtime) continue;

        const content = await readFile(filePath, 'utf8');
        if (!content.trim()) continue;

        newMtimes[filePath] = mtime;

        const ext = extname(filePath).toLowerCase();
        const bodyFormat: BodyFormat =
          ext === '.md' ? BodyFormat.Markdown : BodyFormat.Plaintext;

        items.push({
          externalId: filePath,
          threadId: null,
          sender: { name: null, email: null, phone: null, handle: null },
          recipients: [],
          subject: basename(filePath, ext),
          body: content,
          bodyFormat,
          eventTime: mtime,
          attachments: [],
          metadata: {
            filePath,
            mtime,
            size: stats.size,
          },
        });
      } catch (err) {
        // File may have been deleted between event and read — skip silently
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') throw err;
      }
    }

    return {
      items,
      checkpoint: { mtimes: newMtimes },
      hasMore: false,
    };
  }

  async getCurrentCheckpoint(): Promise<Record<string, unknown>> {
    return { mtimes: {} };
  }

  async shutdown(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  private isSupported(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase();
    return this.config.extensions.includes(ext);
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
