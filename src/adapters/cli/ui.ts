// Lightweight UI helpers for CLI output.
// Uses picocolors (already a transitive dep) — no new dependencies needed.
import pc from 'picocolors';

export { pc };

export function header(text: string): void {
  console.log('\n' + pc.bold(pc.cyan(text)));
}

export function success(text: string): void {
  console.log(pc.green('✔ ') + text);
}

export function warn(text: string): void {
  console.log(pc.yellow('⚠ ') + text);
}

export function error(text: string): void {
  console.error(pc.red('✖ ') + text);
}

export function info(text: string): void {
  console.log(pc.dim('  ') + text);
}

export function label(key: string, value: string | number): void {
  console.log(`  ${pc.bold(key.padEnd(22))} ${value}`);
}

export function divider(): void {
  console.log(pc.dim('─'.repeat(50)));
}

/** Format a Unix epoch ms timestamp as a human-readable string. */
export function formatDate(ts: number | null): string {
  if (!ts) return pc.dim('never');
  return new Date(ts).toLocaleString();
}

/** Format a channel/adapter tag for display. */
export function channelBadge(channel: string): string {
  const map: Record<string, string> = {
    email: pc.blue('[email]'),
    imessage: pc.green('[iMessage]'),
    file: pc.magenta('[file]'),
  };
  return map[channel] ?? pc.dim(`[${channel}]`);
}

/** Simple spinner using process.stdout for single-line updates. */
export class Spinner {
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private idx = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private message: string;

  constructor(message: string) {
    this.message = message;
  }

  start(): void {
    if (!process.stdout.isTTY) {
      process.stdout.write(this.message + '...\n');
      return;
    }
    this.interval = setInterval(() => {
      const frame = this.frames[this.idx++ % this.frames.length] ?? '⠋';
      process.stdout.write(`\r${pc.cyan(frame)} ${this.message}`);
    }, 80);
  }

  update(message: string): void {
    this.message = message;
  }

  stop(finalMessage?: string): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (process.stdout.isTTY) {
      process.stdout.write('\r' + ' '.repeat(this.message.length + 4) + '\r');
    }
    if (finalMessage) {
      success(finalMessage);
    }
  }
}
