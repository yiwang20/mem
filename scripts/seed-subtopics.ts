import Database from 'better-sqlite3';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ulid } from 'ulid';

const dbPath = join(homedir(), '.mindflow', 'demo.db');
const db = new Database(dbPath);

const findTopic = (name: string) =>
  db.prepare("SELECT id FROM entities WHERE canonical_name = ? AND type = 'topic'").get(name) as { id: string } | undefined;

const now = Date.now();
const insert = db.prepare(`
  INSERT INTO entities (id, type, canonical_name, name_alt, confidence, status, first_seen_at, last_seen_at, parent_entity_id, attributes, created_at, updated_at)
  VALUES (?, 'topic', ?, ?, 0.9, 'active', ?, ?, ?, '{}', ?, ?)
`);

const q3 = findTopic('Q3 Budget');
const pl = findTopic('Product Launch');
const vs = findTopic('Vendor Selection');

if (!q3 || !pl) { console.log('Topics not found'); process.exit(1); }

// Sub-topics for Q3 Budget
for (const [name, alt] of [['Marketing Budget', '市场预算'], ['R&D Budget', '研发预算'], ['Budget Review', '预算评审'], ['Headcount Budget', '人力预算']]) {
  insert.run(ulid(), name, alt, now, now, q3.id, now, now);
}

// Sub-topics for Product Launch
for (const [name, alt] of [['Design Review', '设计评审'], ['Marketing Campaign Plan', '营销计划'], ['Beta Testing', '内测']]) {
  insert.run(ulid(), name, alt, now, now, pl.id, now, now);
}

// Sub-topics for Vendor Selection
if (vs) {
  for (const [name, alt] of [['Vendor Comparison', '供应商对比'], ['Contract Negotiation', '合同谈判']]) {
    insert.run(ulid(), name, alt, now, now, vs.id, now, now);
  }
}

// Sub-sub-topic: Marketing Budget -> Social Media, Advertising
const mb = findTopic('Marketing Budget');
if (mb) {
  insert.run(ulid(), 'Social Media Budget', '社媒预算', now, now, mb.id, now, now);
  insert.run(ulid(), 'Advertising Budget', '广告预算', now, now, mb.id, now, now);
}

console.log('Sub-topics created. Tree:');

const tree = db.prepare(`
  WITH RECURSIVE topic_tree AS (
    SELECT id, canonical_name, parent_entity_id, 0 as depth
    FROM entities WHERE type = 'topic' AND parent_entity_id IS NULL AND status != 'merged'
    UNION ALL
    SELECT e.id, e.canonical_name, e.parent_entity_id, tt.depth + 1
    FROM entities e JOIN topic_tree tt ON e.parent_entity_id = tt.id
    WHERE e.type = 'topic' AND e.status != 'merged' AND tt.depth < 4
  )
  SELECT * FROM topic_tree ORDER BY depth, canonical_name
`).all() as Array<{ canonical_name: string; depth: number }>;

for (const t of tree) {
  console.log(`${'  '.repeat(t.depth)}${t.canonical_name}`);
}

db.close();
