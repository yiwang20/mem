import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { platform } from 'node:process';
import type {
  ContactInfo,
  IngestionBatch,
  IngestedItem,
  IMessageSourceConfig,
  SourceAdapter,
} from '../../types/index.js';
import { BodyFormat, SourceAdapterType } from '../../types/index.js';

// ----------------------------------------------------------------------------
// iMessage Adapter
// Reads from ~/Library/Messages/chat.db (macOS only, read-only).
// Handles the attributedBody NSAttributedString blob present in macOS Ventura+.
// ----------------------------------------------------------------------------

interface MessageRow {
  rowid: number;
  guid: string;
  text: string | null;
  attributedBody: Buffer | null;
  date: number; // nanoseconds since 2001-01-01 (Apple epoch) on macOS 13+,
  // seconds since 2001-01-01 on older macOS
  is_from_me: number;
  handle_id: number;
  chat_id: number | null;
  chat_guid: string | null;
}

interface HandleRow {
  rowid: number;
  id: string; // phone number or email
}

// Apple epoch is Jan 1 2001, offset from Unix epoch
const APPLE_EPOCH_OFFSET_MS = 978_307_200_000;

export class IMessageAdapter implements SourceAdapter {
  readonly name = SourceAdapterType.IMessage;

  private db: Database.Database | null = null;
  private config!: IMessageSourceConfig;
  private handleCache = new Map<number, string>();

  async initialize(config: Record<string, unknown>): Promise<void> {
    if (platform !== 'darwin') {
      throw new Error('iMessage adapter is only available on macOS');
    }

    this.config = {
      enabled: true,
      dbPath:
        (config['dbPath'] as string | undefined) ??
        `${homedir()}/Library/Messages/chat.db`,
      excludeHandles: (config['excludeHandles'] as string[] | undefined) ?? [],
    };

    try {
      this.db = new Database(this.config.dbPath, { readonly: true, fileMustExist: true });
      // Verify we can query — will throw SQLITE_AUTH if Full Disk Access not granted
      this.db.prepare('SELECT COUNT(*) FROM message LIMIT 1').get();
    } catch (err) {
      this.db = null;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('SQLITE_AUTH') || msg.includes('not authorized')) {
        throw new Error(
          'iMessage adapter: Full Disk Access not granted. ' +
            'Go to System Settings → Privacy & Security → Full Disk Access and enable access.',
        );
      }
      throw err;
    }

    this.handleCache.clear();
    this.loadHandles();
  }

  private loadHandles(): void {
    if (!this.db) return;
    const rows = this.db
      .prepare('SELECT ROWID as rowid, id FROM handle')
      .all() as HandleRow[];
    for (const row of rows) {
      this.handleCache.set(row.rowid, row.id);
    }
  }

  async fetchSince(
    checkpoint: Record<string, unknown> | null,
  ): Promise<IngestionBatch> {
    if (!this.db) {
      throw new Error('iMessage adapter not initialized');
    }

    // Refresh handle cache each cycle to pick up new contacts
    this.loadHandles();

    const lastRowId = (checkpoint?.['lastRowId'] as number | undefined) ?? 0;

    const rows = this.db
      .prepare(
        `SELECT
           m.ROWID        AS rowid,
           m.guid         AS guid,
           m.text         AS text,
           m.attributedBody AS attributedBody,
           m.date         AS date,
           m.is_from_me   AS is_from_me,
           m.handle_id    AS handle_id,
           c.ROWID        AS chat_id,
           c.guid         AS chat_guid
         FROM message m
         LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
         LEFT JOIN chat c ON c.ROWID = cmj.chat_id
         WHERE m.ROWID > ?
         ORDER BY m.ROWID ASC`,
      )
      .all(lastRowId) as MessageRow[];

    const items: IngestedItem[] = [];
    let maxRowId = lastRowId;

    for (const row of rows) {
      maxRowId = Math.max(maxRowId, row.rowid);

      const body = this.extractBody(row);
      if (!body.trim()) continue;

      const handleId = String(row.handle_id);
      const handleIdentifier = this.handleCache.get(row.handle_id) ?? handleId;

      // Respect excludeHandles config
      if (this.config.excludeHandles.includes(handleIdentifier)) continue;

      const sender: ContactInfo = row.is_from_me
        ? { name: 'Me', email: null, phone: null, handle: 'me' }
        : {
            name: null,
            email: handleIdentifier.includes('@') ? handleIdentifier : null,
            phone: handleIdentifier.includes('@') ? null : handleIdentifier,
            handle: handleIdentifier,
          };

      items.push({
        externalId: row.guid,
        threadId: row.chat_guid ?? null,
        sender,
        recipients: row.is_from_me
          ? [
              {
                name: null,
                email: handleIdentifier.includes('@') ? handleIdentifier : null,
                phone: handleIdentifier.includes('@') ? null : handleIdentifier,
                handle: handleIdentifier,
              },
            ]
          : [],
        subject: null,
        body,
        bodyFormat: BodyFormat.Plaintext,
        eventTime: appleTimestampToUnixMs(row.date),
        attachments: [],
        metadata: {
          rowid: row.rowid,
          is_from_me: row.is_from_me === 1,
          handle_id: row.handle_id,
          chat_id: row.chat_id,
        },
      });
    }

    return {
      items,
      checkpoint: { lastRowId: maxRowId },
      hasMore: false,
    };
  }

  async getCurrentCheckpoint(): Promise<Record<string, unknown>> {
    if (!this.db) return { lastRowId: 0 };
    const row = this.db
      .prepare('SELECT MAX(ROWID) AS maxRowId FROM message')
      .get() as { maxRowId: number | null };
    return { lastRowId: row.maxRowId ?? 0 };
  }

  async shutdown(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // --------------------------------------------------------------------------
  // attributedBody decoding
  //
  // macOS Ventura+ stores messages as NSAttributedString serialized via
  // NSKeyedArchiver (binary plist). The plain text is stored as a UTF-8 string
  // just after the "$objects" key in a predictable position in the binary plist.
  //
  // Strategy: scan the buffer for the bplist-encoded NSString that holds the
  // plain text. The string immediately follows a compact bplist header pattern.
  // We look for the UTF-8 content marker (0x5e = '^') or scan for readable
  // text between known offsets.
  //
  // Reference: https://github.com/reagentx/imessage-exporter (MIT)
  // --------------------------------------------------------------------------
  private extractBody(row: MessageRow): string {
    if (row.text) return row.text;
    if (!row.attributedBody) return '';

    return extractTextFromAttributedBody(row.attributedBody);
  }
}

// ----------------------------------------------------------------------------
// NSAttributedString (bplist) text extraction
// ----------------------------------------------------------------------------

/**
 * Extracts plain text from an NSAttributedString stored as a binary plist
 * (NSKeyedArchiver). The plain text string is present in the plist's object
 * table. We locate it by:
 * 1. Verifying the bplist magic bytes.
 * 2. Scanning the object table for the longest UTF-8 string that looks like
 *    human-readable message text.
 *
 * This avoids a full bplist parser while being robust enough for production.
 */
export function extractTextFromAttributedBody(buf: Buffer): string {
  // bplist magic: 62 70 6c 69 73 74 = "bplist"
  if (buf.length < 8) return '';
  if (buf.slice(0, 6).toString('ascii') !== 'bplist') return '';

  // The plist trailer is the last 32 bytes
  if (buf.length < 32) return '';

  const trailer = buf.slice(buf.length - 32);
  const offsetTableOffsetSize = trailer[6] ?? 1;
  const objectRefSize = trailer[7] ?? 1;
  const numObjects = readBigInt(trailer, 8, 8);
  const topObject = readBigInt(trailer, 16, 8);
  const offsetTableOffset = readBigInt(trailer, 24, 8);

  if (
    numObjects > 100_000 ||
    offsetTableOffset >= buf.length ||
    offsetTableOffset < 0
  ) {
    return fallbackTextScan(buf);
  }

  // Read offset table
  const offsets: number[] = [];
  for (let i = 0; i < numObjects; i++) {
    const pos = offsetTableOffset + i * offsetTableOffsetSize;
    if (pos + offsetTableOffsetSize > buf.length) break;
    offsets.push(readBigInt(buf, pos, offsetTableOffsetSize));
  }

  // Walk objects looking for UTF-8 / ASCII strings
  let bestString = '';

  for (const offset of offsets) {
    if (offset >= buf.length) continue;
    const marker = buf[offset];
    if (marker === undefined) continue;
    const typeNibble = (marker & 0xf0) >> 4;
    const infoNibble = marker & 0x0f;

    // 0x5 = ASCII string, 0x6 = UTF-16 string
    if (typeNibble === 0x5) {
      const len = infoNibble === 0x0f
        ? readVarLen(buf, offset + 1)
        : { len: infoNibble, bytesRead: 0 };
      const start = offset + 1 + len.bytesRead;
      const end = start + len.len;
      if (end > buf.length) continue;
      const str = buf.slice(start, end).toString('utf8');
      if (str.length > bestString.length && isProbablyMessageText(str)) {
        bestString = str;
      }
    } else if (typeNibble === 0x6) {
      const len = infoNibble === 0x0f
        ? readVarLen(buf, offset + 1)
        : { len: infoNibble, bytesRead: 0 };
      const start = offset + 1 + len.bytesRead;
      const byteLen = len.len * 2;
      const end = start + byteLen;
      if (end > buf.length) continue;
      const str = buf.slice(start, end).toString('utf16le');
      if (str.length > bestString.length && isProbablyMessageText(str)) {
        bestString = str;
      }
    }
  }

  if (bestString) return bestString;
  return fallbackTextScan(buf);
}

function readBigInt(buf: Buffer, offset: number, size: number): number {
  let val = 0;
  for (let i = 0; i < size && offset + i < buf.length; i++) {
    val = val * 256 + (buf[offset + i] ?? 0);
  }
  return val;
}

function readVarLen(
  buf: Buffer,
  offset: number,
): { len: number; bytesRead: number } {
  // Variable-length encoding: next byte has type 0x1* (int marker)
  const marker = buf[offset];
  if (marker === undefined) return { len: 0, bytesRead: 0 };
  const typeNibble = (marker & 0xf0) >> 4;
  if (typeNibble !== 0x1) return { len: 0, bytesRead: 0 };
  const bytePow = marker & 0x0f;
  const byteCount = 1 << bytePow;
  const len = readBigInt(buf, offset + 1, byteCount);
  return { len, bytesRead: 1 + byteCount };
}

/**
 * Heuristic: a string looks like message text if it contains at least one
 * printable character and is not a class name or key string.
 */
function isProbablyMessageText(s: string): boolean {
  if (s.length < 1) return false;
  // Skip known NSKeyedArchiver keys/class names
  const skipPrefixes = [
    'NS', '$', 'IM', 'com.apple', 'NSAS', 'NSAT',
    'NSFont', 'NSColor', 'NSParagraph',
  ];
  for (const p of skipPrefixes) {
    if (s.startsWith(p)) return false;
  }
  // Must contain at least one alphanumeric or CJK character
  return /[\p{L}\p{N}]/u.test(s);
}

/**
 * Fallback: scan the raw bytes for ASCII/UTF-8 text runs that resemble
 * message content. Used when the plist structure cannot be parsed.
 */
function fallbackTextScan(buf: Buffer): string {
  // Look for sequences of printable ASCII bytes (>= 4 chars)
  let best = '';
  let current = '';
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i] ?? 0;
    if (b >= 0x20 && b <= 0x7e) {
      current += String.fromCharCode(b);
    } else {
      if (current.length > best.length && isProbablyMessageText(current)) {
        best = current;
      }
      current = '';
    }
  }
  if (current.length > best.length && isProbablyMessageText(current)) {
    best = current;
  }
  return best;
}

// ----------------------------------------------------------------------------
// Timestamp conversion
// ----------------------------------------------------------------------------

/**
 * Convert an Apple CoreData timestamp to Unix milliseconds.
 *
 * Apple stores timestamps as nanoseconds since Jan 1 2001 on macOS 13+,
 * and as seconds on older versions. We detect which by value magnitude.
 */
function appleTimestampToUnixMs(appleTs: number): number {
  if (appleTs === 0) return Date.now();

  let seconds: number;
  // If value > 1e10, it's in nanoseconds (macOS 13+ stores ns since 2001)
  if (appleTs > 1e10) {
    seconds = appleTs / 1e9;
  } else {
    seconds = appleTs;
  }

  return Math.round(seconds * 1000) + APPLE_EPOCH_OFFSET_MS;
}
