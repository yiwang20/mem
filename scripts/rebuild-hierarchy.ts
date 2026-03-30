#!/usr/bin/env npx tsx
/**
 * Re-run topic hierarchy inference on existing data.
 * Clears all parent_entity_id, then uses LLM to infer hierarchy.
 * Usage: LLM_PROXY_URL=http://localhost:18787/llm/complete npx tsx scripts/rebuild-hierarchy.ts
 */

import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';

const DB_PATH = process.env.MINDFLOW_DB_PATH || join(homedir(), '.mindflow', 'data', 'mindflow.db');
const PROXY_URL = process.env.LLM_PROXY_URL || 'http://localhost:18787/llm/complete';

async function main() {
  const db = new Database(DB_PATH);

  // 1. Clear all existing parent assignments
  const cleared = db.prepare("UPDATE entities SET parent_entity_id = NULL WHERE type = 'topic' AND parent_entity_id IS NOT NULL").run();
  console.log(`Cleared ${cleared.changes} parent assignments`);

  // 2. Get all active topics
  const topics = db
    .prepare("SELECT id, canonical_name FROM entities WHERE type = 'topic' AND status != 'merged' ORDER BY canonical_name")
    .all() as Array<{ id: string; canonical_name: string }>;

  console.log(`\nFound ${topics.length} topics:`);
  topics.forEach((t, i) => console.log(`  ${i + 1}. ${t.canonical_name}`));

  if (topics.length < 2) {
    console.log('\nNot enough topics for hierarchy.');
    return;
  }

  // 3. Ask LLM to organize into hierarchy
  const topicList = topics.map((t, i) => `${i + 1}. ${t.canonical_name}`).join('\n');
  const prompt = `Given these topics, organize them into a hierarchy. Some topics are sub-topics of others.
Return a JSON array where each item has "index" (1-based) and "parentIndex" (1-based, or null if top-level).

Rules:
- A topic is a parent if other topics are specific aspects/workstreams of it
- Only assign a parent when the relationship is clear and meaningful
- Most broad/general topics should be top-level (parentIndex: null)
- Be conservative: if unsure, leave as top-level

Topics:
${topicList}

Return ONLY valid JSON array, no prose. Example: [{"index":1,"parentIndex":null},{"index":2,"parentIndex":1}]`;

  console.log('\nAsking LLM to infer hierarchy...');

  const resp = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!resp.ok) {
    throw new Error(`LLM proxy error: ${resp.status} ${await resp.text()}`);
  }

  const data = (await resp.json()) as { content?: string };
  const text = data.content ?? '';

  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1) {
    console.log('LLM response:', text);
    throw new Error('No JSON array in LLM response');
  }

  const parsed = JSON.parse(text.slice(start, end + 1)) as Array<{ index: number; parentIndex: number | null }>;

  // 4. Apply hierarchy
  const now = Date.now();
  let assigned = 0;

  for (const item of parsed) {
    if (!item.parentIndex || item.parentIndex === item.index) continue;
    const child = topics[item.index - 1];
    const parent = topics[item.parentIndex - 1];
    if (!child || !parent) continue;

    db.prepare("UPDATE entities SET parent_entity_id = ?, updated_at = ? WHERE id = ?")
      .run(parent.id, now, child.id);
    console.log(`  ${child.canonical_name} -> parent: ${parent.canonical_name}`);
    assigned++;
  }

  console.log(`\nAssigned ${assigned} parent-child relationships.`);

  // 5. Show final tree
  console.log('\n=== Topic Tree ===');
  const roots = db
    .prepare("SELECT id, canonical_name FROM entities WHERE type = 'topic' AND status != 'merged' AND parent_entity_id IS NULL ORDER BY canonical_name")
    .all() as Array<{ id: string; canonical_name: string }>;

  for (const root of roots) {
    console.log(`${root.canonical_name}`);
    const children = db
      .prepare("SELECT canonical_name FROM entities WHERE parent_entity_id = ? AND status != 'merged' ORDER BY canonical_name")
      .all(root.id) as Array<{ canonical_name: string }>;
    for (const child of children) {
      console.log(`  └── ${child.canonical_name}`);
    }
  }

  db.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
