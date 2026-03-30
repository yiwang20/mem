#!/usr/bin/env npx tsx
/**
 * Reset all entities/relationships and re-run seed + ingest.
 */
import { MindFlowEngine } from '../src/core/engine.js';

async function main() {
  console.log('Initializing engine...');
  const engine = new MindFlowEngine();
  await engine.init();

  const db = engine.db.db;

  console.log('Clearing entities, relationships, job_queue, episodes, communities...');
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('DELETE FROM entity_episodes');
  db.exec('DELETE FROM relationships');
  db.exec('DELETE FROM communities');
  db.exec('DELETE FROM job_queue');
  db.exec('DELETE FROM entities');
  db.exec('DELETE FROM raw_items');
  db.exec('PRAGMA foreign_keys = ON');

  console.log('Done. Now run: npx tsx scripts/seed-mock-data.ts');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
