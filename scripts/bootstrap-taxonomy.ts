#!/usr/bin/env npx tsx
/**
 * Bootstrap taxonomy from existing data using:
 * 1. Subsumption (co-occurrence) to propose candidate hierarchy
 * 2. Transitive reduction to remove redundant edges
 * 3. LLM review to validate/correct
 *
 * Usage: npx tsx scripts/bootstrap-taxonomy.ts
 *        LLM_PROXY_URL=http://localhost:18787/llm/complete npx tsx scripts/bootstrap-taxonomy.ts
 */

import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';
import { ulid } from '../src/utils/ulid.js';

const DB_PATH = process.env['MINDFLOW_DB_PATH'] || join(homedir(), '.mindflow', 'data', 'mindflow.db');
const PROXY_URL = process.env['LLM_PROXY_URL'] || 'http://localhost:18787/llm/complete';

/**
 * Ensure migration 004 tables and columns exist.
 * Safe to run multiple times (uses IF NOT EXISTS / checks columns).
 */
function ensureMigration004(db: Database.Database): void {
  // Add depth column if missing
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

// Minimum subsumption confidence threshold: conf(B→A) to say "A contains B"
const SUBSUMPTION_THRESHOLD = 0.75;
// Minimum item count for a topic to be considered as a parent
const MIN_PARENT_ITEMS = 3;
// Mutual subsumption threshold — topics that are actually the same concept
const MERGE_THRESHOLD = 0.5;

type TopicRow = {
  id: string;
  canonical_name: string;
  parent_entity_id: string | null;
  depth: number;
  path: string;
};

/**
 * Save a snapshot of the current taxonomy before making changes.
 */
function saveSnapshot(db: Database.Database, reason: string): string {
  const topics = db
    .prepare("SELECT id, canonical_name, parent_entity_id FROM entities WHERE type = 'topic' AND status != 'merged'")
    .all() as Array<{ id: string; canonical_name: string; parent_entity_id: string | null }>;

  const snapshotId = ulid();
  db.prepare('INSERT INTO taxonomy_snapshot (id, snapshot_data, reason, created_at) VALUES (?, ?, ?, ?)')
    .run(snapshotId, JSON.stringify(topics), reason, Date.now());

  console.log(`  Saved snapshot ${snapshotId} (${topics.length} topics)`);
  return snapshotId;
}

/**
 * Log a taxonomy action.
 */
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

/**
 * Recalculate depth and path for all topics using BFS from roots.
 */
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

  // BFS from roots
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
 * Compute subsumption candidates from co-occurrence data.
 * Returns edges: { parentId, childId, confChildGivenParent, confParentGivenChild }
 */
function computeSubsumption(db: Database.Database): Array<{
  parentId: string;
  parentName: string;
  childId: string;
  childName: string;
  confChildGivenParent: number;  // P(child_items | parent_items) — how much of child is in parent
  confParentGivenChild: number;  // P(parent_items | child_items)
  itemsParent: number;
  itemsChild: number;
  intersection: number;
}> {
  const topics = db
    .prepare("SELECT id, canonical_name FROM entities WHERE type = 'topic' AND status != 'merged'")
    .all() as Array<{ id: string; canonical_name: string }>;

  // Get item sets for each topic using DIRECT assignments only
  // (from metadata.topics, not propagated episodes) to avoid inflation
  const itemSets = new Map<string, Set<string>>();
  const topicNameToId = new Map<string, string>();
  for (const topic of topics) {
    itemSets.set(topic.id, new Set());
    topicNameToId.set(topic.canonical_name.toLowerCase(), topic.id);
  }

  // Build item sets from raw_item metadata.topics (direct assignments)
  const allItems = db
    .prepare("SELECT id, metadata FROM raw_items")
    .all() as Array<{ id: string; metadata: string }>;

  for (const item of allItems) {
    let meta: Record<string, unknown>;
    try { meta = JSON.parse(item.metadata); } catch { continue; }
    const metaTopics = Array.isArray(meta.topics) ? meta.topics as string[] : [];
    for (const t of metaTopics) {
      const tid = topicNameToId.get((typeof t === 'string' ? t : '').toLowerCase());
      if (tid) {
        itemSets.get(tid)!.add(item.id);
      }
    }
  }

  // Also include entity_episodes for topics created by NER (no metadata.topics entry)
  // but only for topics that have 0 direct assignments
  for (const topic of topics) {
    if (itemSets.get(topic.id)!.size === 0) {
      const items = db
        .prepare("SELECT raw_item_id FROM entity_episodes WHERE entity_id = ? AND extraction_method != 'ancestor_propagation'")
        .all(topic.id) as Array<{ raw_item_id: string }>;
      itemSets.set(topic.id, new Set(items.map(r => r.raw_item_id)));
    }
  }

  const candidates: ReturnType<typeof computeSubsumption> = [];

  for (let i = 0; i < topics.length; i++) {
    for (let j = 0; j < topics.length; j++) {
      if (i === j) continue;

      const topicA = topics[i]!;
      const topicB = topics[j]!;
      const itemsA = itemSets.get(topicA.id)!;
      const itemsB = itemSets.get(topicB.id)!;

      if (itemsA.size === 0 || itemsB.size === 0) continue;

      // Count intersection
      let intersection = 0;
      for (const item of itemsB) {
        if (itemsA.has(item)) intersection++;
      }

      if (intersection === 0) continue;

      const confBA = intersection / itemsB.size;  // conf(B→A): how much of B is in A
      const confAB = intersection / itemsA.size;  // conf(A→B): how much of A is in B

      // A is parent of B if: most of B's items appear in A (confBA >= threshold)
      // AND A has more items than B (A is broader)
      if (confBA >= SUBSUMPTION_THRESHOLD && itemsA.size > itemsB.size && itemsB.size >= MIN_PARENT_ITEMS) {
        candidates.push({
          parentId: topicA.id,
          parentName: topicA.canonical_name,
          childId: topicB.id,
          childName: topicB.canonical_name,
          confChildGivenParent: confBA,
          confParentGivenChild: confAB,
          itemsParent: itemsA.size,
          itemsChild: itemsB.size,
          intersection,
        });
      }
    }
  }

  return candidates;
}

/**
 * Apply transitive reduction: for each child with multiple candidate parents,
 * keep only the closest one (smallest item count = most specific).
 */
function transitiveReduction(
  candidates: ReturnType<typeof computeSubsumption>,
): ReturnType<typeof computeSubsumption> {
  // Group candidates by child
  const byChild = new Map<string, typeof candidates>();
  for (const c of candidates) {
    if (!byChild.has(c.childId)) byChild.set(c.childId, []);
    byChild.get(c.childId)!.push(c);
  }

  const result: typeof candidates = [];

  for (const [, edges] of byChild) {
    if (edges.length === 1) {
      result.push(edges[0]!);
      continue;
    }

    // Sort by itemsParent ascending — smallest parent (most specific) wins
    edges.sort((a, b) => a.itemsParent - b.itemsParent);

    // Keep the closest parent (most specific)
    result.push(edges[0]!);
  }

  return result;
}

/**
 * Separate merge candidates (mutual subsumption) from hierarchy candidates.
 */
function separateMergeAndHierarchy(candidates: ReturnType<typeof computeSubsumption>): {
  mergeCandidates: Array<{ aId: string; aName: string; bId: string; bName: string; confidence: number }>;
  hierarchyCandidates: ReturnType<typeof computeSubsumption>;
} {
  const mergeCandidates: ReturnType<typeof separateMergeAndHierarchy>['mergeCandidates'] = [];
  const hierarchyCandidates: ReturnType<typeof computeSubsumption> = [];
  const mergedPairs = new Set<string>();

  for (const c of candidates) {
    const pairKey = [c.parentId, c.childId].sort().join(':');
    if (mergedPairs.has(pairKey)) continue;

    // Check if mutual subsumption (both conf >= MERGE_THRESHOLD)
    if (c.confParentGivenChild >= MERGE_THRESHOLD) {
      mergedPairs.add(pairKey);
      mergeCandidates.push({
        aId: c.parentId,
        aName: c.parentName,
        bId: c.childId,
        bName: c.childName,
        confidence: Math.min(c.confChildGivenParent, c.confParentGivenChild),
      });
    } else {
      hierarchyCandidates.push(c);
    }
  }

  return { mergeCandidates, hierarchyCandidates };
}

type LLMVerdict = {
  child: string;
  parent: string;
  verdict: 'CORRECT' | 'WRONG' | 'REVERSE';
  reason: string;
};

/**
 * Ask LLM to review the candidate hierarchy.
 */
async function reviewWithLLM(
  candidates: ReturnType<typeof computeSubsumption>,
  proxyUrl: string,
): Promise<Map<string, LLMVerdict>> {
  if (candidates.length === 0) return new Map();

  const lines = candidates.map(c =>
    `- "${c.childName}" IS-A "${c.parentName}" [conf=${c.confChildGivenParent.toFixed(2)}, items: parent=${c.itemsParent} child=${c.itemsChild} overlap=${c.intersection}]`,
  );

  const prompt = `Review this proposed topic taxonomy. For each parent-child relationship, I'm providing data evidence (subsumption confidence and item counts).

Return a JSON array of verdicts ONLY for relationships that are WRONG or REVERSED.
If a relationship is correct, do NOT include it in the output (assume CORRECT by default).

Format: [{"child": "...", "parent": "...", "verdict": "WRONG|REVERSE", "reason": "..."}]
- WRONG: The relationship doesn't make sense
- REVERSE: The parent-child direction should be flipped

Proposed relationships:
${lines.join('\n')}

Return ONLY valid JSON array (empty array [] if all are correct), no prose.`;

  try {
    const resp = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!resp.ok) {
      console.warn(`  LLM review failed: ${resp.status}. Using data-only results.`);
      return new Map();
    }

    const data = (await resp.json()) as { content?: string };
    const text = data.content ?? '';
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start === -1 || end === -1) return new Map();

    const verdicts = JSON.parse(text.slice(start, end + 1)) as LLMVerdict[];
    const map = new Map<string, LLMVerdict>();
    for (const v of verdicts) {
      const key = `${v.child}::${v.parent}`;
      map.set(key, v);
    }
    return map;
  } catch (err) {
    console.warn(`  LLM review error: ${err}. Using data-only results.`);
    return new Map();
  }
}

async function main() {
  console.log('=== MindFlow Bootstrap Taxonomy ===\n');

  const db = new Database(DB_PATH);
  ensureMigration004(db);

  // 1. Save snapshot before changes
  console.log('Step 1: Saving pre-bootstrap snapshot...');
  saveSnapshot(db, 'pre-bootstrap');

  // 2. Clear existing hierarchy
  console.log('\nStep 2: Clearing existing hierarchy...');
  const cleared = db.prepare("UPDATE entities SET parent_entity_id = NULL, depth = 0, path = '' WHERE type = 'topic'").run();
  console.log(`  Cleared ${cleared.changes} topic parent assignments`);

  // 3. Compute subsumption
  console.log('\nStep 3: Computing subsumption from co-occurrence data...');
  const allCandidates = computeSubsumption(db);
  console.log(`  Found ${allCandidates.length} raw subsumption edges`);

  // 4. Separate merge candidates from hierarchy candidates
  const { mergeCandidates, hierarchyCandidates } = separateMergeAndHierarchy(allCandidates);
  console.log(`  Merge candidates (mutual subsumption): ${mergeCandidates.length}`);
  if (mergeCandidates.length > 0) {
    for (const m of mergeCandidates) {
      console.log(`    MERGE CANDIDATE: "${m.aName}" ↔ "${m.bName}" (conf=${m.confidence.toFixed(2)})`);
      // Log to taxonomy_log but don't auto-merge
      logAction(db, 'merge', m.aId, {
        reason: `Mutual subsumption with "${m.bName}" (conf=${m.confidence.toFixed(2)})`,
        confidence: m.confidence,
        source: 'bootstrap',
      });
    }
  }

  // 5. Transitive reduction
  console.log('\nStep 4: Applying transitive reduction...');
  const reduced = transitiveReduction(hierarchyCandidates);
  console.log(`  Reduced to ${reduced.length} hierarchy edges`);

  if (reduced.length === 0) {
    console.log('\nNo hierarchy candidates after reduction. Done.');
    updateDepthAndPath(db);
    db.close();
    return;
  }

  // 6. LLM review
  console.log('\nStep 5: Asking LLM to review candidates...');
  const verdicts = await reviewWithLLM(reduced, PROXY_URL);
  console.log(`  LLM flagged ${verdicts.size} relationships as WRONG or REVERSE`);

  // 7. Apply approved relationships
  console.log('\nStep 6: Applying approved relationships...');
  const now = Date.now();
  let applied = 0;
  let skippedWrong = 0;
  let appliedReversed = 0;

  for (const c of reduced) {
    const key = `${c.childName}::${c.parentName}`;
    const verdict = verdicts.get(key);

    if (verdict?.verdict === 'WRONG') {
      console.log(`  SKIP (LLM: WRONG): "${c.childName}" -> "${c.parentName}" — ${verdict.reason}`);
      skippedWrong++;
      logAction(db, 'set_parent', c.childId, {
        reason: `Skipped: LLM said WRONG — ${verdict.reason}`,
        confidence: c.confChildGivenParent,
        source: 'bootstrap',
      });
      continue;
    }

    if (verdict?.verdict === 'REVERSE') {
      // Apply reversed direction
      console.log(`  REVERSE: "${c.parentName}" -> parent: "${c.childName}" — ${verdict.reason}`);
      db.prepare("UPDATE entities SET parent_entity_id = ?, updated_at = ? WHERE id = ?")
        .run(c.childId, now, c.parentId);
      logAction(db, 'set_parent', c.parentId, {
        newParentId: c.childId,
        reason: `LLM reversed direction (was ${c.childName}→${c.parentName}): ${verdict.reason}`,
        confidence: c.confChildGivenParent,
        source: 'bootstrap',
      });
      appliedReversed++;
      applied++;
      continue;
    }

    // Apply as-is
    console.log(`  SET: "${c.childName}" -> parent: "${c.parentName}" (conf=${c.confChildGivenParent.toFixed(2)}, items: ${c.itemsChild}/${c.itemsParent})`);
    db.prepare("UPDATE entities SET parent_entity_id = ?, updated_at = ? WHERE id = ?")
      .run(c.parentId, now, c.childId);
    logAction(db, 'set_parent', c.childId, {
      newParentId: c.parentId,
      reason: `Subsumption conf=${c.confChildGivenParent.toFixed(2)}, overlap=${c.intersection}/${c.itemsChild}`,
      confidence: c.confChildGivenParent,
      source: 'bootstrap',
    });
    applied++;
  }

  console.log(`\n  Applied: ${applied} (${appliedReversed} reversed), Skipped (wrong): ${skippedWrong}`);

  // 8. LLM pass for remaining root topics
  console.log('\nStep 7: LLM pass for orphan root topics...');
  const rootTopics = db
    .prepare("SELECT id, canonical_name FROM entities WHERE type = 'topic' AND status != 'merged' AND parent_entity_id IS NULL ORDER BY canonical_name")
    .all() as Array<{ id: string; canonical_name: string }>;

  const nonRootTopics = db
    .prepare("SELECT id, canonical_name, parent_entity_id FROM entities WHERE type = 'topic' AND status != 'merged' AND parent_entity_id IS NOT NULL ORDER BY canonical_name")
    .all() as Array<{ id: string; canonical_name: string; parent_entity_id: string }>;

  if (rootTopics.length > 5) {
    // There are many orphan roots — ask LLM to organize them
    const allTopicNames = db
      .prepare("SELECT id, canonical_name, parent_entity_id FROM entities WHERE type = 'topic' AND status != 'merged'")
      .all() as Array<{ id: string; canonical_name: string; parent_entity_id: string | null }>;

    // Build current tree text for context
    const treeLines: string[] = [];
    for (const t of allTopicNames.filter(t => !t.parent_entity_id)) {
      treeLines.push(t.canonical_name);
      for (const c of allTopicNames.filter(c => c.parent_entity_id === t.id)) {
        treeLines.push(`  └── ${c.canonical_name}`);
      }
    }

    // Get sample item text for each root topic to give LLM semantic context
    const topicSamples: string[] = [];
    for (const rt of rootTopics) {
      const sample = db.prepare(
        `SELECT ri.body FROM entity_episodes ee JOIN raw_items ri ON ri.id = ee.raw_item_id WHERE ee.entity_id = ? LIMIT 1`
      ).get(rt.id) as { body: string } | undefined;
      const snippet = sample ? sample.body.slice(0, 150) : '(no items)';
      topicSamples.push(`- "${rt.canonical_name}" — sample: ${snippet}`);
    }

    const prompt2 = `You are organizing topics into a hierarchy for a personal knowledge base.
All these topics come from the SAME project/team — there should be very few root-level topics (ideally 1-3).

Current tree (topics with children shown indented):
${treeLines.join('\n')}

These ${rootTopics.length} topics are at root level with sample content:
${topicSamples.join('\n')}

IMPORTANT: Minimize root-level topics. Most of these topics are aspects/dimensions of a larger project and should be nested under an existing parent. Only leave a topic at root if it truly represents a distinct top-level category.

For each root topic, assign it under the most appropriate existing parent topic.

Return JSON array: [{"topic": "topic name", "parent": "parent topic name or null"}]
Only include entries where parent is NOT null.
Return ONLY valid JSON, no prose.`;

    try {
      const resp2 = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: prompt2 }] }),
        signal: AbortSignal.timeout(60_000),
      });

      if (resp2.ok) {
        const data2 = (await resp2.json()) as { content?: string };
        const text2 = data2.content ?? '';
        const s2 = text2.indexOf('[');
        const e2 = text2.lastIndexOf(']');
        if (s2 !== -1 && e2 !== -1) {
          const assignments = JSON.parse(text2.slice(s2, e2 + 1)) as Array<{ topic: string; parent: string | null }>;
          const nameToId = new Map<string, string>();
          for (const t of allTopicNames) nameToId.set(t.canonical_name.toLowerCase(), t.id);

          let llmAssigned = 0;
          for (const a of assignments) {
            if (!a.parent) continue;
            const childId = nameToId.get(a.topic.toLowerCase());
            const parentId = nameToId.get(a.parent.toLowerCase());
            if (!childId || !parentId || childId === parentId) continue;

            // Don't create cycles
            const currentParent = db.prepare("SELECT parent_entity_id FROM entities WHERE id = ?").get(childId) as { parent_entity_id: string | null };
            if (currentParent.parent_entity_id) continue;

            db.prepare("UPDATE entities SET parent_entity_id = ?, updated_at = ? WHERE id = ?")
              .run(parentId, now, childId);
            logAction(db, 'set_parent', childId, {
              newParentId: parentId,
              reason: `LLM semantic assignment under "${a.parent}"`,
              confidence: 0.8,
              source: 'bootstrap',
            });
            console.log(`  LLM: "${a.topic}" -> parent: "${a.parent}"`);
            llmAssigned++;
          }
          console.log(`  LLM assigned ${llmAssigned} additional parent-child relationships`);
        }
      }
    } catch (err) {
      console.warn(`  LLM orphan pass failed: ${err}`);
    }
  } else {
    console.log(`  Only ${rootTopics.length} root topics, skipping LLM pass`);
  }

  // 9. Compute depth and path
  console.log('\nStep 8: Computing depth and path for all topics...');
  updateDepthAndPath(db);

  // 10. Show final tree
  console.log('\n=== Final Taxonomy Tree ===');
  const roots = db
    .prepare("SELECT id, canonical_name, depth, path FROM entities WHERE type = 'topic' AND status != 'merged' AND parent_entity_id IS NULL ORDER BY canonical_name")
    .all() as Array<{ id: string; canonical_name: string; depth: number; path: string }>;

  function printChildren(parentId: string, indent: string): void {
    const children = db
      .prepare("SELECT id, canonical_name FROM entities WHERE type = 'topic' AND status != 'merged' AND parent_entity_id = ? ORDER BY canonical_name")
      .all(parentId) as Array<{ id: string; canonical_name: string }>;
    for (const child of children) {
      console.log(`${indent}└── ${child.canonical_name}`);
      printChildren(child.id, indent + '    ');
    }
  }

  for (const root of roots) {
    console.log(root.canonical_name);
    printChildren(root.id, '  ');
  }

  // Stats
  const stats = db.prepare("SELECT COUNT(*) as n FROM entities WHERE type = 'topic' AND status != 'merged' AND parent_entity_id IS NOT NULL").get() as { n: number };
  const total = db.prepare("SELECT COUNT(*) as n FROM entities WHERE type = 'topic' AND status != 'merged'").get() as { n: number };
  console.log(`\nTotal topics: ${total.n}, With parent: ${stats.n}, Root-level: ${roots.length}`);

  if (mergeCandidates.length > 0) {
    console.log(`\nMerge candidates logged (${mergeCandidates.length}) — review manually:`);
    for (const m of mergeCandidates) {
      console.log(`  - "${m.aName}" ↔ "${m.bName}"`);
    }
  }

  db.close();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
