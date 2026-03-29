import type Database from 'better-sqlite3';
import type { AttentionItem } from '../types/index.js';
import { AttentionItemType, ResolutionType } from '../types/index.js';
import type {
  AttentionItemRepository,
  EntityRepository,
  RawItemRepository,
} from '../storage/repositories.js';
import { detectUnansweredRequests } from './rules/unanswered.js';
import { detectApproachingDeadlines } from './rules/deadlines.js';
import { detectStaleConversations } from './rules/stale.js';
import { detectUnreviewedDocuments } from './rules/unreviewed-docs.js';
import { detectRepeatedMentions } from './rules/repeated-mentions.js';

export interface AttentionEngineOptions {
  /** Window in ms for unanswered-request detection. Default: 48 hours. */
  unansweredWindowMs?: number;
  /** Staleness threshold in ms for stale-conversation detection. Default: 7 days. */
  staleThresholdMs?: number;
  /** Point-in-time to use for all "now" calculations. Defaults to Date.now(). */
  now?: number;
}

/**
 * AttentionEngine orchestrates all detection rules, deduplicates results
 * against existing open attention items, and persists new items.
 *
 * It is called after each ingestion cycle by the core engine.
 */
export class AttentionEngine {
  private readonly db: Database.Database;

  constructor(
    db: Database.Database,
    private readonly attentionItems: AttentionItemRepository,
    // repositories are accepted but not directly called — engine uses raw SQL
    // for cross-table queries that don't fit the repo query patterns
    _entities: EntityRepository,
    _rawItems: RawItemRepository,
  ) {
    this.db = db;
  }

  /**
   * Run all detection rules, deduplicate against existing open items, and
   * persist any newly detected attention items.
   *
   * Returns the list of newly created items.
   */
  detectAll(options: AttentionEngineOptions = {}): AttentionItem[] {
    const now = options.now ?? Date.now();

    // Load existing open attention items for deduplication
    const existingOpen = this.attentionItems.findPending(now);

    // Build dedup indexes
    const existingByRawItemId = new Set<string>(
      existingOpen.filter((i) => i.rawItemId !== null).map((i) => i.rawItemId!),
    );

    // Map: entityId -> list of AttentionItemTypes already open for that entity
    const existingByEntityId = new Map<string, AttentionItemType[]>();
    for (const item of existingOpen) {
      if (item.entityId !== null) {
        const existing = existingByEntityId.get(item.entityId) ?? [];
        existing.push(item.type);
        existingByEntityId.set(item.entityId, existing);
      }
    }

    const newItems: AttentionItem[] = [];

    // --- Rule 1: Unanswered requests ---
    try {
      const unanswered = detectUnansweredRequests(this.db, existingByRawItemId, {
        windowMs: options.unansweredWindowMs,
        now,
      });
      newItems.push(...unanswered);
    } catch (err) {
      console.error('[AttentionEngine] unanswered-request rule failed:', err);
    }

    // --- Rule 2: Approaching deadlines ---
    try {
      const deadlines = detectApproachingDeadlines(this.db, existingByEntityId, { now });
      newItems.push(...deadlines);
    } catch (err) {
      console.error('[AttentionEngine] deadline rule failed:', err);
    }

    // --- Rule 3: Stale conversations ---
    try {
      const stale = detectStaleConversations(this.db, existingByEntityId, {
        staleThresholdMs: options.staleThresholdMs,
        now,
      });
      newItems.push(...stale);
    } catch (err) {
      console.error('[AttentionEngine] stale-conversation rule failed:', err);
    }

    // --- Rule 4: Unreviewed documents ---
    try {
      const unreviewed = detectUnreviewedDocuments(this.db, existingByEntityId, { now });
      newItems.push(...unreviewed);
    } catch (err) {
      console.error('[AttentionEngine] unreviewed-documents rule failed:', err);
    }

    // --- Rule 5: Repeated mentions ---
    try {
      const repeated = detectRepeatedMentions(this.db, existingByEntityId, { now });
      newItems.push(...repeated);
    } catch (err) {
      console.error('[AttentionEngine] repeated-mentions rule failed:', err);
    }

    // Persist new items
    const persisted: AttentionItem[] = [];
    for (const item of newItems) {
      try {
        this.attentionItems.insert(item);
        persisted.push(item);
      } catch (err) {
        console.error('[AttentionEngine] failed to persist attention item:', err);
      }
    }

    // Auto-expire items that are now past their relevance window
    this.expireStale(now);

    return persisted;
  }

  /**
   * Mark open attention items as expired if they are older than 30 days and
   * still unresolved — they are unlikely to be actionable at that age.
   */
  private expireStale(now: number): void {
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const cutoff = now - thirtyDaysMs;
    try {
      this.db
        .prepare(
          `UPDATE attention_items
           SET resolved_at = ?, resolution_type = ?
           WHERE resolved_at IS NULL
             AND dismissed_at IS NULL
             AND detected_at < ?`,
        )
        .run(now, ResolutionType.Expired, cutoff);
    } catch (err) {
      console.error('[AttentionEngine] expire-stale step failed:', err);
    }
  }
}
