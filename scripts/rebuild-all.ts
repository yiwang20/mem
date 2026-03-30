#!/usr/bin/env npx tsx
/**
 * Rebuild all entities, relationships, and hierarchy from existing raw_items.
 * Keeps raw_items intact, re-runs the full pipeline on them.
 *
 * Usage: npx tsx scripts/rebuild-all.ts
 */

import { MindFlowEngine } from '../src/core/engine.js';
import { ulid } from '../src/utils/ulid.js';
import { JobStage } from '../src/types/index.js';

async function main() {
  console.log('Initializing engine...');
  const engine = new MindFlowEngine();
  await engine.init();

  const db = engine.db.db;

  // 1. Keep raw_items, clear everything derived
  const itemCount = (db.prepare('SELECT COUNT(*) as n FROM raw_items').get() as { n: number }).n;
  console.log(`\nFound ${itemCount} raw items to re-process`);

  console.log('Clearing derived data (entities, relationships, jobs, episodes, communities)...');
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('DELETE FROM entity_episodes');
  db.exec('DELETE FROM relationships');
  db.exec('DELETE FROM communities');
  db.exec('DELETE FROM job_queue');
  db.exec('DELETE FROM entities');
  db.exec('PRAGMA foreign_keys = ON');

  // 2. Reset all raw_items to pending and enqueue jobs
  db.exec("UPDATE raw_items SET processing_status = 'pending'");

  const items = db.prepare('SELECT id FROM raw_items').all() as Array<{ id: string }>;
  const now = Date.now();

  for (const item of items) {
    engine.jobs.enqueue({
      id: ulid(),
      rawItemId: item.id,
      stage: JobStage.Triage,
      status: 'pending' as any,
      attempts: 0,
      maxAttempts: 3,
      createdAt: now,
      updatedAt: now,
      error: null,
    });
  }

  console.log(`Enqueued ${items.length} items for processing`);

  // 3. Also re-create explicit topic entities from metadata.topics
  console.log('Re-creating explicit topics from metadata...');
  let topicCount = 0;
  for (const { id } of items) {
    const item = engine.rawItems.findById(id);
    if (!item) continue;
    const topics = Array.isArray(item.metadata?.topics) ? item.metadata.topics as string[] : [];
    for (const topicName of topics) {
      if (typeof topicName !== 'string' || topicName.trim().length < 2) continue;
      const trimmed = topicName.trim();

      // Exact match check
      const existing = db
        .prepare("SELECT id FROM entities WHERE type = 'topic' AND LOWER(canonical_name) = LOWER(?) AND status != 'merged' LIMIT 1")
        .get(trimmed) as { id: string } | undefined;

      let topicId: string;
      if (existing) {
        topicId = existing.id;
        db.prepare("UPDATE entities SET last_seen_at = MAX(last_seen_at, ?), updated_at = ? WHERE id = ?")
          .run(now, now, topicId);
      } else {
        topicId = ulid();
        db.prepare(`INSERT INTO entities (id, type, canonical_name, name_alt, aliases, attributes, confidence, status, merged_into, first_seen_at, last_seen_at, created_at, updated_at)
          VALUES (?, 'topic', ?, NULL, '[]', ?, 0.95, 'active', NULL, ?, ?, ?, ?)`)
          .run(topicId, trimmed, JSON.stringify({ source: 'explicit_topic' }), now, now, now, now);
        topicCount++;
      }

      try {
        db.prepare("INSERT OR IGNORE INTO entity_episodes (entity_id, raw_item_id, extraction_method, confidence) VALUES (?, ?, 'explicit_topic', 0.95)")
          .run(topicId, id);
      } catch { /* ignore */ }
    }
  }
  console.log(`Created ${topicCount} explicit topics`);

  // 4. Run the processing pipeline (NER, clustering, etc.)
  console.log('\nRunning processing pipeline...');
  await engine.ingest();

  // 5. Run hierarchy inference
  console.log('\nRunning LLM hierarchy inference...');
  const { execSync } = await import('child_process');
  execSync('npx tsx scripts/bootstrap-taxonomy.ts', {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: {
      ...process.env,
      LLM_PROXY_URL: process.env.LLM_PROXY_URL || 'http://localhost:18787/llm/complete',
    },
  });

  // 6. Final stats
  const stats = engine.getStats();
  console.log('\n=== Final Stats ===');
  console.log(`  Raw items:     ${stats.rawItemCount}`);
  console.log(`  Entities:      ${stats.entityCount}`);
  console.log(`  Relationships: ${stats.relationshipCount}`);
  console.log(`  Channels:      ${stats.channels.join(', ')}`);
  console.log('\nDone!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
