#!/usr/bin/env npx tsx
/**
 * Daily taxonomy validation script.
 * Runs 5 checks on the topic hierarchy and prints a markdown report.
 *
 * Usage: npx tsx scripts/daily-taxonomy-check.ts
 *        LLM_PROXY_URL=http://localhost:18787/llm/complete npx tsx scripts/daily-taxonomy-check.ts
 */

import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';
import { ulid } from '../src/utils/ulid.js';

const DB_PATH = process.env['MINDFLOW_DB_PATH'] || join(homedir(), '.mindflow', 'data', 'mindflow.db');

function ensureMigration004(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(entities)").all() as Array<{ name: string }>;
  const colNames = new Set(cols.map(c => c.name));
  if (!colNames.has('depth')) {
    db.exec("ALTER TABLE entities ADD COLUMN depth INTEGER DEFAULT 0");
  }
  if (!colNames.has('path')) {
    db.exec("ALTER TABLE entities ADD COLUMN path TEXT DEFAULT ''");
  }
  db.exec(`
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

const SUBSUMPTION_THRESHOLD = 0.75;
const AUTO_FIX_THRESHOLD = 0.9;
const MERGE_THRESHOLD = 0.8;
const BROKEN_HIERARCHY_THRESHOLD = 0.5;
const GHOST_TOPIC_MIN_ITEMS = 3;
const GHOST_TOPIC_MIN_CONFIDENCE = 0.7;
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

function saveSnapshot(db: Database.Database, reason: string): void {
  const topics = db
    .prepare("SELECT id, canonical_name, parent_entity_id FROM entities WHERE type = 'topic' AND status != 'merged'")
    .all() as Array<{ id: string; canonical_name: string; parent_entity_id: string | null }>;

  db.prepare('INSERT INTO taxonomy_snapshot (id, snapshot_data, reason, created_at) VALUES (?, ?, ?, ?)')
    .run(ulid(), JSON.stringify(topics), reason, Date.now());
}

function logAction(
  db: Database.Database,
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
  db.prepare(`INSERT INTO taxonomy_log (id, action, entity_id, old_parent_id, new_parent_id, reason, confidence, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
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

function updateDepthAndPath(db: Database.Database): void {
  const allTopics = db
    .prepare("SELECT id, canonical_name, parent_entity_id FROM entities WHERE type = 'topic' AND status != 'merged'")
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

  const stmt = db.prepare("UPDATE entities SET depth = ?, path = ?, updated_at = ? WHERE id = ?");
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

/**
 * Get item set for a topic (from entity_episodes).
 */
function getItemSet(db: Database.Database, topicId: string): Set<string> {
  const rows = db
    .prepare("SELECT raw_item_id FROM entity_episodes WHERE entity_id = ?")
    .all(topicId) as Array<{ raw_item_id: string }>;
  return new Set(rows.map(r => r.raw_item_id));
}

/**
 * Compute subsumption confidence: how much of B's items appear in A.
 * Returns conf(B→A) = |A ∩ B| / |B|
 */
function subsumptionConf(setA: Set<string>, setB: Set<string>): number {
  if (setB.size === 0) return 0;
  let overlap = 0;
  for (const item of setB) {
    if (setA.has(item)) overlap++;
  }
  return overlap / setB.size;
}

// ---------------------------------------------------------------------------
// Check 1: Duplicate topics (mutual high confidence)
// ---------------------------------------------------------------------------
async function checkDuplicates(db: Database.Database): Promise<CheckResult> {
  const result: CheckResult = { name: 'Duplicate Topics', items: [], autoFixed: 0 };

  const topics = db
    .prepare("SELECT id, canonical_name FROM entities WHERE type = 'topic' AND status != 'merged'")
    .all() as Array<{ id: string; canonical_name: string }>;

  const itemSets = new Map<string, Set<string>>();
  for (const t of topics) {
    itemSets.set(t.id, getItemSet(db, t.id));
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

      const confAB = subsumptionConf(setA, setB);
      const confBA = subsumptionConf(setB, setA);
      const mutualConf = Math.min(confAB, confBA);

      if (mutualConf >= MERGE_THRESHOLD) {
        result.items.push({
          severity: 'HIGH',
          message: `"${a.canonical_name}" ↔ "${b.canonical_name}" — mutual confidence ${mutualConf.toFixed(2)} (items: ${setA.size}/${setB.size})`,
        });
        logAction(db, 'merge', a.id, {
          reason: `Duplicate candidate with "${b.canonical_name}" (mutual conf=${mutualConf.toFixed(2)})`,
          confidence: mutualConf,
          source: 'daily_check',
        });
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Check 2: Broken hierarchy (parent-child where confidence dropped below threshold)
// ---------------------------------------------------------------------------
async function checkBrokenHierarchy(db: Database.Database): Promise<CheckResult> {
  const result: CheckResult = { name: 'Broken Hierarchy', items: [], autoFixed: 0 };

  const childTopics = db
    .prepare("SELECT id, canonical_name, parent_entity_id FROM entities WHERE type = 'topic' AND status != 'merged' AND parent_entity_id IS NOT NULL")
    .all() as Array<{ id: string; canonical_name: string; parent_entity_id: string }>;

  for (const child of childTopics) {
    const parent = db
      .prepare("SELECT id, canonical_name FROM entities WHERE id = ?")
      .get(child.parent_entity_id) as { id: string; canonical_name: string } | undefined;

    if (!parent) {
      result.items.push({
        severity: 'HIGH',
        message: `"${child.canonical_name}" has orphaned parent_entity_id ${child.parent_entity_id} (parent not found)`,
      });
      continue;
    }

    const parentItems = getItemSet(db, parent.id);
    const childItems = getItemSet(db, child.id);

    if (childItems.size < 2) continue; // Not enough data

    const conf = subsumptionConf(parentItems, childItems);

    if (conf < BROKEN_HIERARCHY_THRESHOLD) {
      result.items.push({
        severity: 'MEDIUM',
        message: `"${child.canonical_name}" → "${parent.canonical_name}" confidence dropped to ${conf.toFixed(2)} (items: parent=${parentItems.size} child=${childItems.size})`,
      });
      logAction(db, 'set_parent', child.id, {
        oldParentId: parent.id,
        reason: `Subsumption confidence dropped to ${conf.toFixed(2)} (below ${BROKEN_HIERARCHY_THRESHOLD})`,
        confidence: conf,
        source: 'daily_check',
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Check 3: Missing hierarchy (root topics that should have a parent)
// ---------------------------------------------------------------------------
async function checkMissingHierarchy(db: Database.Database): Promise<CheckResult> {
  const result: CheckResult = { name: 'Missing Hierarchy', items: [], autoFixed: 0 };

  const rootTopics = db
    .prepare("SELECT id, canonical_name FROM entities WHERE type = 'topic' AND status != 'merged' AND parent_entity_id IS NULL")
    .all() as Array<{ id: string; canonical_name: string }>;

  const allTopics = db
    .prepare("SELECT id, canonical_name FROM entities WHERE type = 'topic' AND status != 'merged'")
    .all() as Array<{ id: string; canonical_name: string }>;

  const itemSets = new Map<string, Set<string>>();
  for (const t of allTopics) {
    itemSets.set(t.id, getItemSet(db, t.id));
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

      const conf = subsumptionConf(candidateItems, rootItems);
      if (conf >= SUBSUMPTION_THRESHOLD) {
        if (!bestParent || conf > bestParent.conf) {
          bestParent = { id: candidate.id, name: candidate.canonical_name, conf };
        }
      }
    }

    if (!bestParent) continue;

    if (bestParent.conf >= AUTO_FIX_THRESHOLD) {
      // Auto-fix
      db.prepare("UPDATE entities SET parent_entity_id = ?, updated_at = ? WHERE id = ?")
        .run(bestParent.id, now, root.id);
      logAction(db, 'set_parent', root.id, {
        newParentId: bestParent.id,
        reason: `Auto-fix: high confidence subsumption ${bestParent.conf.toFixed(2)} by "${bestParent.name}"`,
        confidence: bestParent.conf,
        source: 'daily_check',
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
      logAction(db, 'set_parent', root.id, {
        newParentId: bestParent.id,
        reason: `Suggestion: subsumption conf=${bestParent.conf.toFixed(2)} by "${bestParent.name}"`,
        confidence: bestParent.conf,
        source: 'daily_check',
      });
    }
  }

  if (result.autoFixed > 0) {
    updateDepthAndPath(db);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Check 4: Ghost topics (low-data, low-confidence, old)
// ---------------------------------------------------------------------------
async function checkGhostTopics(db: Database.Database): Promise<CheckResult> {
  const result: CheckResult = { name: 'Ghost Topics', items: [], autoFixed: 0 };

  const cutoff = Date.now() - GHOST_TOPIC_MIN_AGE_DAYS * 24 * 60 * 60 * 1000;

  const topics = db
    .prepare("SELECT id, canonical_name, confidence, created_at FROM entities WHERE type = 'topic' AND status != 'merged' AND created_at < ?")
    .all(cutoff) as Array<{ id: string; canonical_name: string; confidence: number; created_at: number }>;

  for (const topic of topics) {
    const itemCount = (db
      .prepare("SELECT COUNT(*) as n FROM entity_episodes WHERE entity_id = ?")
      .get(topic.id) as { n: number }).n;

    if (itemCount < GHOST_TOPIC_MIN_ITEMS && topic.confidence < GHOST_TOPIC_MIN_CONFIDENCE) {
      const ageDays = Math.floor((Date.now() - topic.created_at) / (24 * 60 * 60 * 1000));
      result.items.push({
        severity: 'LOW',
        message: `"${topic.canonical_name}" — ${itemCount} items, confidence=${topic.confidence.toFixed(2)}, age=${ageDays}d`,
      });
      logAction(db, 'delete', topic.id, {
        reason: `Ghost candidate: ${itemCount} items, conf=${topic.confidence.toFixed(2)}, age=${ageDays}d`,
        confidence: topic.confidence,
        source: 'daily_check',
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Check 5: Accumulated misplacements from taxonomy_log
// ---------------------------------------------------------------------------
async function checkAccumulatedMisplacements(db: Database.Database): Promise<CheckResult> {
  const result: CheckResult = { name: 'Accumulated Misplacements', items: [], autoFixed: 0 };

  // Count recent set_parent flags (last 7 days) that were logged but not yet resolved
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const counts = db
    .prepare(`
      SELECT entity_id, COUNT(*) as n, MAX(reason) as last_reason
      FROM taxonomy_log
      WHERE source IN ('ingest', 'daily_check')
        AND action = 'set_parent'
        AND new_parent_id IS NULL
        AND created_at > ?
      GROUP BY entity_id
      HAVING n >= 2
    `)
    .all(cutoff) as Array<{ entity_id: string; n: number; last_reason: string }>;

  for (const row of counts) {
    const entity = db
      .prepare("SELECT canonical_name FROM entities WHERE id = ?")
      .get(row.entity_id) as { canonical_name: string } | undefined;

    if (!entity) continue;

    result.items.push({
      severity: 'MEDIUM',
      message: `"${entity.canonical_name}" — ${row.n} misplacement flags in last 7 days. Last: ${row.last_reason}`,
    });
  }

  // Also count total misplacements by source
  const bySource = db
    .prepare(`
      SELECT source, COUNT(*) as n
      FROM taxonomy_log
      WHERE created_at > ?
      GROUP BY source
    `)
    .all(cutoff) as Array<{ source: string; n: number }>;

  for (const row of bySource) {
    result.items.push({
      severity: 'INFO',
      message: `Taxonomy changes in last 7 days from "${row.source}": ${row.n}`,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const db = new Database(DB_PATH);
  ensureMigration004(db);

  // Save snapshot before checks
  saveSnapshot(db, 'pre-daily-check');

  const checks: CheckResult[] = [];
  checks.push(await checkDuplicates(db));
  checks.push(await checkBrokenHierarchy(db));
  checks.push(await checkMissingHierarchy(db));
  checks.push(await checkGhostTopics(db));
  checks.push(await checkAccumulatedMisplacements(db));

  // Print markdown report
  const now = new Date().toISOString();
  console.log(`# MindFlow Daily Taxonomy Check — ${now}\n`);

  const totalIssues = checks.reduce((sum, c) => sum + c.items.filter(i => i.severity !== 'INFO').length, 0);
  const totalAutoFixed = checks.reduce((sum, c) => sum + c.autoFixed, 0);

  console.log(`**Summary:** ${totalIssues} issues found, ${totalAutoFixed} auto-fixed\n`);

  for (const check of checks) {
    console.log(`## ${check.name}`);
    if (check.items.length === 0) {
      console.log('_No issues found._\n');
      continue;
    }
    for (const item of check.items) {
      const badge =
        item.severity === 'HIGH' ? '🔴' :
        item.severity === 'MEDIUM' ? '🟡' :
        item.severity === 'LOW' ? '🔵' : 'ℹ️';
      console.log(`- ${badge} **${item.severity}**: ${item.message}`);
    }
    if (check.autoFixed > 0) {
      console.log(`\n_Auto-fixed: ${check.autoFixed}_`);
    }
    console.log();
  }

  // Final taxonomy stats
  const topicCount = (db.prepare("SELECT COUNT(*) as n FROM entities WHERE type = 'topic' AND status != 'merged'").get() as { n: number }).n;
  const withParent = (db.prepare("SELECT COUNT(*) as n FROM entities WHERE type = 'topic' AND status != 'merged' AND parent_entity_id IS NOT NULL").get() as { n: number }).n;
  const rootCount = topicCount - withParent;

  console.log('## Taxonomy Stats');
  console.log(`- Total topics: ${topicCount}`);
  console.log(`- Root-level: ${rootCount}`);
  console.log(`- With parent: ${withParent}`);
  console.log(`- Coverage: ${topicCount > 0 ? ((withParent / topicCount) * 100).toFixed(1) : 0}%`);

  db.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
