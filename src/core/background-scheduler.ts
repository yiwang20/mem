import type Database from 'better-sqlite3';
import { ulid } from '../utils/ulid.js';

const SUBSUMPTION_THRESHOLD = 0.75;
const AUTO_FIX_THRESHOLD = 0.9;
const MERGE_THRESHOLD = 0.8;
const BROKEN_HIERARCHY_THRESHOLD = 0.5;
const GHOST_TOPIC_MIN_ITEMS = 3;
const GHOST_TOPIC_MIN_AGE_DAYS = 7;

type TopicRow = {
  id: string;
  canonical_name: string;
  parent_entity_id: string | null;
  depth: number;
  path: string;
  created_at: number;
};

type ReportItem = {
  severity: 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  message: string;
};

type CheckResult = {
  name: string;
  items: ReportItem[];
  autoFixed: number;
};

export class BackgroundScheduler {
  private hourlyTimer: NodeJS.Timeout | null = null;
  private dailyTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: Database.Database,
    private readonly llmProxyUrl?: string,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;

    // Phase 3: hourly taxonomy check (first run after 60s warmup)
    setTimeout(() => {
      this.runTaxonomyCheck().catch(err =>
        console.error('[BackgroundScheduler] taxonomy check error:', err),
      );
    }, 60_000);
    this.hourlyTimer = setInterval(() => {
      this.runTaxonomyCheck().catch(err =>
        console.error('[BackgroundScheduler] taxonomy check error:', err),
      );
    }, 60 * 60 * 1000);

    // Phase 4: daily embedding discovery (first run after 5min, placeholder for now)
    // Will be implemented separately with local embedding provider

    console.log('[BackgroundScheduler] Started (hourly taxonomy check active)');
  }

  stop(): void {
    this.running = false;
    if (this.hourlyTimer) {
      clearInterval(this.hourlyTimer);
      this.hourlyTimer = null;
    }
    if (this.dailyTimer) {
      clearInterval(this.dailyTimer);
      this.dailyTimer = null;
    }
    console.log('[BackgroundScheduler] Stopped');
  }

  /** Called by embedding discovery module to register the daily task */
  startDailyDiscovery(task: () => Promise<void>): void {
    if (this.dailyTimer) clearInterval(this.dailyTimer);
    // First run after 5 minutes
    setTimeout(
      () => task().catch(err => console.error('[BackgroundScheduler] daily discovery error:', err)),
      5 * 60 * 1000,
    );
    this.dailyTimer = setInterval(() => {
      task().catch(err => console.error('[BackgroundScheduler] daily discovery error:', err));
    }, 24 * 60 * 60 * 1000);
    console.log('[BackgroundScheduler] Daily discovery task registered');
  }

  /** Phase 3: Hourly taxonomy health check */
  private async runTaxonomyCheck(): Promise<void> {
    try {
      this.ensureTaxonomyTables();
      this.saveSnapshot('pre-hourly-check');

      const checks: CheckResult[] = [];
      checks.push(await this.checkDuplicates());
      checks.push(await this.checkBrokenHierarchy());
      checks.push(await this.checkMissingHierarchy());
      checks.push(await this.checkGhostTopics());
      checks.push(await this.checkAccumulatedMisplacements());

      const totalIssues = checks.reduce(
        (sum, c) => sum + c.items.filter(i => i.severity !== 'INFO').length,
        0,
      );
      const totalAutoFixed = checks.reduce((sum, c) => sum + c.autoFixed, 0);

      console.log(
        `[BackgroundScheduler] Taxonomy check complete: ${totalIssues} issues found, ${totalAutoFixed} auto-fixed`,
      );
    } catch (err) {
      console.error('[BackgroundScheduler] runTaxonomyCheck failed:', err);
    }
  }

  // --------------------------------------------------------------------------
  // Schema helpers
  // --------------------------------------------------------------------------

  private ensureTaxonomyTables(): void {
    const cols = this.db.prepare('PRAGMA table_info(entities)').all() as Array<{ name: string }>;
    const colNames = new Set(cols.map(c => c.name));
    if (!colNames.has('depth')) {
      this.db.exec('ALTER TABLE entities ADD COLUMN depth INTEGER DEFAULT 0');
    }
    if (!colNames.has('path')) {
      this.db.exec("ALTER TABLE entities ADD COLUMN path TEXT DEFAULT ''");
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS taxonomy_log (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        old_parent_id TEXT,
        new_parent_id TEXT,
        reason TEXT,
        confidence REAL,
        source TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS taxonomy_snapshot (
        id TEXT PRIMARY KEY,
        snapshot_data TEXT NOT NULL,
        reason TEXT,
        created_at INTEGER NOT NULL
      );
    `);
  }

  // --------------------------------------------------------------------------
  // Core helpers
  // --------------------------------------------------------------------------

  /** Get raw_item_ids for a topic, excluding ancestor-propagated episodes */
  private getItemSet(topicId: string): Set<string> {
    const rows = this.db
      .prepare(
        "SELECT raw_item_id FROM entity_episodes WHERE entity_id = ? AND extraction_method != 'ancestor_propagation'",
      )
      .all(topicId) as Array<{ raw_item_id: string }>;
    return new Set(rows.map(r => r.raw_item_id));
  }

  /** Compute subsumption confidence: conf(B→A) = |A ∩ B| / |B| */
  private subsumptionConf(setA: Set<string>, setB: Set<string>): number {
    if (setB.size === 0) return 0;
    let overlap = 0;
    for (const item of setB) {
      if (setA.has(item)) overlap++;
    }
    return overlap / setB.size;
  }

  private saveSnapshot(reason: string): void {
    const topics = this.db
      .prepare(
        "SELECT id, canonical_name, parent_entity_id FROM entities WHERE type = 'topic' AND status != 'merged'",
      )
      .all() as Array<{ id: string; canonical_name: string; parent_entity_id: string | null }>;

    this.db
      .prepare(
        'INSERT INTO taxonomy_snapshot (id, snapshot_data, reason, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(ulid(), JSON.stringify(topics), reason, Date.now());
  }

  private logAction(
    action: string,
    entityId: string,
    opts: {
      oldParentId?: string | null;
      newParentId?: string | null;
      reason?: string;
      confidence?: number;
      source: string;
    },
  ): void {
    this.db
      .prepare(
        `INSERT INTO taxonomy_log (id, action, entity_id, old_parent_id, new_parent_id, reason, confidence, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ulid(),
        action,
        entityId,
        opts.oldParentId ?? null,
        opts.newParentId ?? null,
        opts.reason ?? null,
        opts.confidence ?? null,
        opts.source,
        Date.now(),
      );
  }

  private updateDepthAndPath(): void {
    const allTopics = this.db
      .prepare(
        "SELECT id, canonical_name, parent_entity_id FROM entities WHERE type = 'topic' AND status != 'merged'",
      )
      .all() as TopicRow[];

    const byId = new Map<string, TopicRow>();
    const children = new Map<string | null, string[]>();

    for (const t of allTopics) {
      byId.set(t.id, t);
      const parentKey = t.parent_entity_id;
      if (!children.has(parentKey)) children.set(parentKey, []);
      children.get(parentKey)!.push(t.id);
    }

    const queue: Array<{ id: string; depth: number; path: string }> = [];
    const roots = children.get(null) ?? [];
    for (const rootId of roots) {
      const t = byId.get(rootId);
      if (!t) continue;
      queue.push({ id: rootId, depth: 0, path: '/' + t.canonical_name });
    }

    const stmt = this.db.prepare(
      'UPDATE entities SET depth = ?, path = ?, updated_at = ? WHERE id = ?',
    );
    const now = Date.now();

    while (queue.length > 0) {
      const item = queue.shift()!;
      stmt.run(item.depth, item.path, now, item.id);

      const childIds = children.get(item.id) ?? [];
      for (const childId of childIds) {
        const child = byId.get(childId);
        if (!child) continue;
        queue.push({
          id: childId,
          depth: item.depth + 1,
          path: item.path + '/' + child.canonical_name,
        });
      }
    }
  }

  // --------------------------------------------------------------------------
  // Check 1: Duplicate topics (mutual high confidence)
  // --------------------------------------------------------------------------
  private async checkDuplicates(): Promise<CheckResult> {
    const result: CheckResult = { name: 'Duplicate Topics', items: [], autoFixed: 0 };

    const topics = this.db
      .prepare(
        "SELECT id, canonical_name FROM entities WHERE type = 'topic' AND status != 'merged'",
      )
      .all() as Array<{ id: string; canonical_name: string }>;

    const itemSets = new Map<string, Set<string>>();
    for (const t of topics) {
      itemSets.set(t.id, this.getItemSet(t.id));
    }

    const seenPairs = new Set<string>();

    for (let i = 0; i < topics.length; i++) {
      for (let j = i + 1; j < topics.length; j++) {
        const a = topics[i]!;
        const b = topics[j]!;
        const pairKey = [a.id, b.id].sort().join(':');
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);

        const setA = itemSets.get(a.id)!;
        const setB = itemSets.get(b.id)!;

        const confAB = this.subsumptionConf(setA, setB);
        const confBA = this.subsumptionConf(setB, setA);
        const mutualConf = Math.min(confAB, confBA);

        if (mutualConf >= MERGE_THRESHOLD) {
          result.items.push({
            severity: 'HIGH',
            message: `"${a.canonical_name}" ↔ "${b.canonical_name}" — mutual confidence ${mutualConf.toFixed(2)} (items: ${setA.size}/${setB.size})`,
          });
          this.logAction('merge', a.id, {
            reason: `Duplicate candidate with "${b.canonical_name}" (mutual conf=${mutualConf.toFixed(2)})`,
            confidence: mutualConf,
            source: 'hourly_check',
          });
        }
      }
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // Check 2: Broken hierarchy (parent-child where confidence dropped below threshold)
  // --------------------------------------------------------------------------
  private async checkBrokenHierarchy(): Promise<CheckResult> {
    const result: CheckResult = { name: 'Broken Hierarchy', items: [], autoFixed: 0 };

    const childTopics = this.db
      .prepare(
        "SELECT id, canonical_name, parent_entity_id FROM entities WHERE type = 'topic' AND status != 'merged' AND parent_entity_id IS NOT NULL",
      )
      .all() as Array<{ id: string; canonical_name: string; parent_entity_id: string }>;

    for (const child of childTopics) {
      const parent = this.db
        .prepare('SELECT id, canonical_name FROM entities WHERE id = ?')
        .get(child.parent_entity_id) as { id: string; canonical_name: string } | undefined;

      if (!parent) {
        result.items.push({
          severity: 'HIGH',
          message: `"${child.canonical_name}" has orphaned parent_entity_id ${child.parent_entity_id} (parent not found)`,
        });
        continue;
      }

      const parentItems = this.getItemSet(parent.id);
      const childItems = this.getItemSet(child.id);

      if (childItems.size < 2) continue; // Not enough data

      const conf = this.subsumptionConf(parentItems, childItems);

      if (conf < BROKEN_HIERARCHY_THRESHOLD) {
        result.items.push({
          severity: 'MEDIUM',
          message: `"${child.canonical_name}" → "${parent.canonical_name}" confidence dropped to ${conf.toFixed(2)} (items: parent=${parentItems.size} child=${childItems.size})`,
        });
        this.logAction('set_parent', child.id, {
          oldParentId: parent.id,
          reason: `Subsumption confidence dropped to ${conf.toFixed(2)} (below ${BROKEN_HIERARCHY_THRESHOLD})`,
          confidence: conf,
          source: 'hourly_check',
        });
      }
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // Check 3: Missing hierarchy (root topics that should have a parent)
  // --------------------------------------------------------------------------
  private async checkMissingHierarchy(): Promise<CheckResult> {
    const result: CheckResult = { name: 'Missing Hierarchy', items: [], autoFixed: 0 };

    const rootTopics = this.db
      .prepare(
        "SELECT id, canonical_name FROM entities WHERE type = 'topic' AND status != 'merged' AND parent_entity_id IS NULL",
      )
      .all() as Array<{ id: string; canonical_name: string }>;

    const allTopics = this.db
      .prepare(
        "SELECT id, canonical_name FROM entities WHERE type = 'topic' AND status != 'merged'",
      )
      .all() as Array<{ id: string; canonical_name: string }>;

    const itemSets = new Map<string, Set<string>>();
    for (const t of allTopics) {
      itemSets.set(t.id, this.getItemSet(t.id));
    }

    const now = Date.now();

    for (const root of rootTopics) {
      const rootItems = itemSets.get(root.id)!;
      if (rootItems.size === 0) continue;

      // Look for potential parents: topics where conf(root→candidate) >= threshold
      // AND candidate has more items than root
      let bestParent: { id: string; name: string; conf: number } | null = null;

      for (const candidate of allTopics) {
        if (candidate.id === root.id) continue;
        const candidateItems = itemSets.get(candidate.id)!;
        if (candidateItems.size <= rootItems.size) continue;

        const conf = this.subsumptionConf(candidateItems, rootItems);
        if (conf >= SUBSUMPTION_THRESHOLD) {
          if (!bestParent || conf > bestParent.conf) {
            bestParent = { id: candidate.id, name: candidate.canonical_name, conf };
          }
        }
      }

      if (!bestParent) continue;

      if (bestParent.conf >= AUTO_FIX_THRESHOLD) {
        // Auto-fix
        this.db
          .prepare('UPDATE entities SET parent_entity_id = ?, updated_at = ? WHERE id = ?')
          .run(bestParent.id, now, root.id);
        this.logAction('set_parent', root.id, {
          newParentId: bestParent.id,
          reason: `Auto-fix: high confidence subsumption ${bestParent.conf.toFixed(2)} by "${bestParent.name}"`,
          confidence: bestParent.conf,
          source: 'hourly_check',
        });
        result.autoFixed++;
        result.items.push({
          severity: 'INFO',
          message: `AUTO-FIXED: "${root.canonical_name}" → parent: "${bestParent.name}" (conf=${bestParent.conf.toFixed(2)})`,
        });
      } else {
        result.items.push({
          severity: 'LOW',
          message: `SUGGESTION: "${root.canonical_name}" might belong under "${bestParent.name}" (conf=${bestParent.conf.toFixed(2)})`,
        });
        this.logAction('set_parent', root.id, {
          newParentId: bestParent.id,
          reason: `Suggestion: subsumption conf=${bestParent.conf.toFixed(2)} by "${bestParent.name}"`,
          confidence: bestParent.conf,
          source: 'hourly_check',
        });
      }
    }

    if (result.autoFixed > 0) {
      this.updateDepthAndPath();
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // Check 4: Ghost topics (low-data, old)
  // --------------------------------------------------------------------------
  private async checkGhostTopics(): Promise<CheckResult> {
    const result: CheckResult = { name: 'Ghost Topics', items: [], autoFixed: 0 };

    const cutoff = Date.now() - GHOST_TOPIC_MIN_AGE_DAYS * 24 * 60 * 60 * 1000;

    const topics = this.db
      .prepare(
        "SELECT id, canonical_name, confidence, created_at FROM entities WHERE type = 'topic' AND status != 'merged' AND created_at < ?",
      )
      .all(cutoff) as Array<{
      id: string;
      canonical_name: string;
      confidence: number;
      created_at: number;
    }>;

    for (const topic of topics) {
      const itemCount = (
        this.db
          .prepare(
            "SELECT COUNT(*) as n FROM entity_episodes WHERE entity_id = ? AND extraction_method != 'ancestor_propagation'",
          )
          .get(topic.id) as { n: number }
      ).n;

      if (itemCount < GHOST_TOPIC_MIN_ITEMS) {
        const ageDays = Math.floor((Date.now() - topic.created_at) / (24 * 60 * 60 * 1000));
        result.items.push({
          severity: 'LOW',
          message: `"${topic.canonical_name}" — ${itemCount} items, confidence=${topic.confidence.toFixed(2)}, age=${ageDays}d`,
        });
        this.logAction('delete', topic.id, {
          reason: `Ghost candidate: ${itemCount} items, conf=${topic.confidence.toFixed(2)}, age=${ageDays}d`,
          confidence: topic.confidence,
          source: 'hourly_check',
        });
      }
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // Check 5: Accumulated misplacements from taxonomy_log
  // --------------------------------------------------------------------------
  private async checkAccumulatedMisplacements(): Promise<CheckResult> {
    const result: CheckResult = { name: 'Accumulated Misplacements', items: [], autoFixed: 0 };

    // Count recent set_parent flags (last 24h) that were logged but not yet resolved
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;

    const counts = this.db
      .prepare(
        `
        SELECT entity_id, COUNT(*) as n, MAX(reason) as last_reason
        FROM taxonomy_log
        WHERE source IN ('ingest', 'hourly_check')
          AND action = 'set_parent'
          AND new_parent_id IS NULL
          AND created_at > ?
        GROUP BY entity_id
        HAVING n >= 2
      `,
      )
      .all(cutoff) as Array<{ entity_id: string; n: number; last_reason: string }>;

    for (const row of counts) {
      const entity = this.db
        .prepare('SELECT canonical_name FROM entities WHERE id = ?')
        .get(row.entity_id) as { canonical_name: string } | undefined;

      if (!entity) continue;

      result.items.push({
        severity: 'MEDIUM',
        message: `"${entity.canonical_name}" — ${row.n} misplacement flags in last 24h. Last: ${row.last_reason}`,
      });
    }

    // Also count total taxonomy changes by source in last 24h
    const bySource = this.db
      .prepare(
        `
        SELECT source, COUNT(*) as n
        FROM taxonomy_log
        WHERE created_at > ?
        GROUP BY source
      `,
      )
      .all(cutoff) as Array<{ source: string; n: number }>;

    for (const row of bySource) {
      result.items.push({
        severity: 'INFO',
        message: `Taxonomy changes in last 24h from "${row.source}": ${row.n}`,
      });
    }

    return result;
  }
}
