import { ImapFlow, type FetchMessageObject } from 'imapflow';
import type {
  ContactInfo,
  GmailSourceConfig,
  IngestionBatch,
  IngestedItem,
  SourceAdapter,
} from '../../types/index.js';
import { BodyFormat, SourceAdapterType } from '../../types/index.js';

// ----------------------------------------------------------------------------
// Gmail IMAP Adapter
// ----------------------------------------------------------------------------

export class GmailAdapter implements SourceAdapter {
  readonly name = SourceAdapterType.Gmail;

  private config!: GmailSourceConfig;
  private client: ImapFlow | null = null;

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.config = config as unknown as GmailSourceConfig;
    // Verify connectivity
    await this.withConnection(async () => {
      // no-op: just checks we can connect
    });
  }

  async fetchSince(
    checkpoint: Record<string, unknown> | null,
  ): Promise<IngestionBatch> {
    const lastUid = (checkpoint?.['lastUid'] as number | undefined) ?? 0;
    const items: IngestedItem[] = [];
    let maxUid = lastUid;

    await this.withConnection(async () => {
      for (const folder of this.config.folders) {
        const folderItems = await this.fetchFolder(folder, lastUid);
        for (const item of folderItems.items) {
          items.push(item);
        }
        if (folderItems.maxUid > maxUid) {
          maxUid = folderItems.maxUid;
        }
      }
    });

    return {
      items,
      checkpoint: { lastUid: maxUid },
      hasMore: false,
    };
  }

  async getCurrentCheckpoint(): Promise<Record<string, unknown>> {
    let maxUid = 0;

    await this.withConnection(async () => {
      for (const folder of this.config.folders) {
        if (!this.client) break;
        const lock = await this.client.getMailboxLock(folder);
        try {
          const mailbox = this.client.mailbox;
          if (mailbox && typeof mailbox === 'object' && 'uidNext' in mailbox) {
            const uidNext = (mailbox as { uidNext?: number }).uidNext;
            if (uidNext && uidNext - 1 > maxUid) {
              maxUid = uidNext - 1;
            }
          }
        } finally {
          lock.release();
        }
      }
    });

    return { lastUid: maxUid };
  }

  async shutdown(): Promise<void> {
    if (this.client) {
      await this.client.logout();
      this.client = null;
    }
  }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  private async withConnection(fn: () => Promise<void>): Promise<void> {
    const client = new ImapFlow({
      host: this.config.auth.host,
      port: this.config.auth.port,
      secure: this.config.auth.tls,
      auth: {
        user: this.config.auth.user,
        pass: this.config.auth.password,
      },
      logger: false,
    });

    this.client = client;
    try {
      await client.connect();
      await fn();
    } finally {
      try {
        await client.logout();
      } catch {
        // ignore logout errors
      }
      this.client = null;
    }
  }

  private async fetchFolder(
    folder: string,
    lastUid: number,
  ): Promise<{ items: IngestedItem[]; maxUid: number }> {
    if (!this.client) return { items: [], maxUid: lastUid };

    const lock = await this.client.getMailboxLock(folder);
    const items: IngestedItem[] = [];
    let maxUid = lastUid;

    try {
      const searchQuery = lastUid > 0
        ? { uid: `${lastUid + 1}:*` as unknown as number }
        : {};

      for await (const msg of this.client.fetch(searchQuery, {
        uid: true,
        envelope: true,
        bodyStructure: true,
        headers: ['from', 'to', 'cc', 'message-id', 'in-reply-to', 'date', 'subject'],
        bodyParts: ['TEXT'],
      }) as AsyncIterable<FetchMessageObject>) {
        const uid = msg.uid;
        if (uid > maxUid) maxUid = uid;

        const item = await this.mapMessage(msg, folder);
        if (item) items.push(item);
      }
    } finally {
      lock.release();
    }

    return { items, maxUid };
  }

  private async mapMessage(
    msg: FetchMessageObject,
    folder: string,
  ): Promise<IngestedItem | null> {
    const envelope = msg.envelope;
    if (!envelope) return null;

    const messageId = envelope.messageId ?? String(msg.uid);
    const inReplyTo = envelope.inReplyTo ?? null;
    const subject = envelope.subject ?? null;
    const date = envelope.date ?? new Date();

    const sender = envelopeAddressToContact(
      envelope.from?.[0] ?? null,
    );

    const recipients: ContactInfo[] = [
      ...(envelope.to ?? []).map(envelopeAddressToContact),
      ...(envelope.cc ?? []).map(envelopeAddressToContact),
    ];

    // Extract plain text body
    let body = '';
    const textPart = msg.bodyParts?.get('TEXT');
    if (textPart) {
      body = textPart.toString('utf8');
    }

    // If no text part, try to get source
    if (!body && msg.source) {
      body = extractTextFromRfc822(msg.source.toString('utf8'));
    }

    if (!body.trim()) return null;

    return {
      externalId: messageId,
      threadId: inReplyTo ?? messageId, // use In-Reply-To as thread grouping
      sender,
      recipients,
      subject,
      body: stripHtmlIfNeeded(body),
      bodyFormat: BodyFormat.Plaintext,
      eventTime: date.getTime(),
      attachments: [],
      metadata: {
        uid: msg.uid,
        folder,
        messageId,
        inReplyTo,
        flags: msg.flags ? [...msg.flags] : [],
      },
    };
  }
}

// ----------------------------------------------------------------------------
// Address helpers
// ----------------------------------------------------------------------------

interface ImapAddress {
  name?: string;
  address?: string;
}

function envelopeAddressToContact(addr: ImapAddress | null): ContactInfo {
  if (!addr) return { name: null, email: null, phone: null, handle: null };
  return {
    name: addr.name ?? null,
    email: addr.address ?? null,
    phone: null,
    handle: null,
  };
}

// ----------------------------------------------------------------------------
// Body text extraction
// ----------------------------------------------------------------------------

/**
 * Strip HTML tags from a string, preserving whitespace structure.
 * Only applied when the body looks like HTML.
 */
function stripHtmlIfNeeded(body: string): string {
  const trimmed = body.trim();
  if (!trimmed.startsWith('<')) return body;
  // Remove tags and decode basic entities
  return trimmed
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Very lightweight RFC 822 body extraction — finds the body after the
 * blank-line separator and returns it as plain text.
 */
function extractTextFromRfc822(raw: string): string {
  const sep = raw.indexOf('\r\n\r\n');
  if (sep !== -1) return raw.slice(sep + 4);
  const sep2 = raw.indexOf('\n\n');
  if (sep2 !== -1) return raw.slice(sep2 + 2);
  return raw;
}
