import type Database from 'better-sqlite3';
import { LocalEmbeddingProvider } from '../llm/local-embedding-provider.js';
import { ulid } from '../utils/ulid.js';

// ---------------------------------------------------------------------------
// Step 1: Generate embeddings for new items
// ---------------------------------------------------------------------------

async function generateMissingEmbeddings(
  db: Database.Database,
  embeddingProvider: LocalEmbeddingProvider,
): Promise<number> {
  const missing = db.prepare(`
    SELECT ri.id, ri.subject, ri.body
    FROM raw_items ri
    LEFT JOIN item_embeddings ie ON ie.raw_item_id = ri.id
    WHERE ie.raw_item_id IS NULL
  `).all() as Array<{ id: string; subject: string | null; body: string }>;

  let succeeded = 0;
  for (const item of missing) {
    try {
      const text = [item.subject ?? '', item.body].join(' ').slice(0, 512);
      const embedding = await embeddingProvider.embed(text);
      db.prepare(`
        INSERT INTO item_embeddings (raw_item_id, embedding, model, dimensions, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        item.id,
        Buffer.from(embedding.buffer),
        embeddingProvider.modelName,
        embeddingProvider.dimensions,
        Date.now(),
        Date.now(),
      );
      succeeded++;
    } catch (err) {
      console.error(`[EmbeddingDiscovery] Failed to embed item ${item.id}:`, err);
      // Continue with remaining items
    }
  }

  return succeeded;
}

// ---------------------------------------------------------------------------
// Step 2: Compute topic centroids
// ---------------------------------------------------------------------------

async function computeTopicCentroids(
  db: Database.Database,
): Promise<Map<string, Float64Array>> {
  const topics = db
    .prepare(`SELECT id, canonical_name FROM entities WHERE type = 'topic' AND status != 'merged'`)
    .all() as Array<{ id: string; canonical_name: string }>;

  const centroids = new Map<string, Float64Array>();

  for (const topic of topics) {
    const rows = db.prepare(`
      SELECT ie.embedding, ie.dimensions
      FROM entity_episodes ee
      JOIN item_embeddings ie ON ie.raw_item_id = ee.raw_item_id
      WHERE ee.entity_id = ?
    `).all(topic.id) as Array<{ embedding: Buffer; dimensions: number }>;

    if (rows.length === 0) continue;
    const firstRow = rows[0];
    if (!firstRow) continue;

    const dim = firstRow.dimensions;
    const centroid = new Float64Array(dim);
    for (const row of rows) {
      // Use slice to ensure 8-byte alignment required by Float64Array
      const bytes = new Uint8Array(row.embedding);
      const emb = new Float64Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      for (let i = 0; i < dim; i++) {
        centroid[i] = (centroid[i] ?? 0) + (emb[i] ?? 0);
      }
    }
    for (let i = 0; i < dim; i++) {
      centroid[i] = (centroid[i] ?? 0) / rows.length;
    }

    centroids.set(topic.id, centroid);
  }

  return centroids;
}

// ---------------------------------------------------------------------------
// Step 3: Discover taxonomy issues
// ---------------------------------------------------------------------------

function cosineSimilarity(a: Float64Array, b: Float64Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

async function discoverTaxonomyIssues(
  db: Database.Database,
  centroids: Map<string, Float64Array>,
): Promise<void> {
  const topics = db
    .prepare(`SELECT id, canonical_name, parent_entity_id FROM entities WHERE type = 'topic' AND status != 'merged'`)
    .all() as Array<{ id: string; canonical_name: string; parent_entity_id: string | null }>;

  const topicMap = new Map(topics.map((t) => [t.id, t]));

  const issues: string[] = [];
  const topicIds = [...centroids.keys()];

  for (let i = 0; i < topicIds.length; i++) {
    for (let j = i + 1; j < topicIds.length; j++) {
      const idA = topicIds[i];
      const idB = topicIds[j];
      if (!idA || !idB) continue;
      const centroidA = centroids.get(idA);
      const centroidB = centroids.get(idB);
      if (!centroidA || !centroidB) continue;
      const sim = cosineSimilarity(centroidA, centroidB);
      const tA = topicMap.get(idA);
      const tB = topicMap.get(idB);
      if (!tA || !tB) continue;

      // High similarity but no hierarchy → suggest merge or hierarchy
      if (sim > 0.85 && tA.parent_entity_id !== tB.id && tB.parent_entity_id !== tA.id) {
        issues.push(
          `HIGH_SIMILARITY: "${tA.canonical_name}" ↔ "${tB.canonical_name}" (cos=${sim.toFixed(3)}) — consider merge or hierarchy`,
        );
        db.prepare(
          `INSERT INTO taxonomy_log (id, action, entity_id, reason, confidence, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          ulid(),
          'merge',
          tA.id,
          `Embedding similarity ${sim.toFixed(3)} with "${tB.canonical_name}"`,
          sim,
          'embedding_discovery',
          Date.now(),
        );
      }

      // Low similarity but has hierarchy → flag suspicious
      if (sim < 0.3 && (tA.parent_entity_id === tB.id || tB.parent_entity_id === tA.id)) {
        issues.push(
          `LOW_SIMILARITY_HIERARCHY: "${tA.canonical_name}" ↔ "${tB.canonical_name}" (cos=${sim.toFixed(3)}) — hierarchy may be wrong`,
        );
        db.prepare(
          `INSERT INTO taxonomy_log (id, action, entity_id, reason, confidence, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          ulid(),
          'set_parent',
          tA.parent_entity_id === tB.id ? tA.id : tB.id,
          `Low embedding similarity ${sim.toFixed(3)} with parent — possible misplacement`,
          sim,
          'embedding_discovery',
          Date.now(),
        );
      }
    }
  }

  // Find uncovered items (no topic link at all)
  const uncovered = db.prepare(`
    SELECT ri.id FROM raw_items ri
    LEFT JOIN entity_episodes ee ON ee.raw_item_id = ri.id
    LEFT JOIN entities e ON e.id = ee.entity_id AND e.type = 'topic'
    WHERE e.id IS NULL
  `).all() as Array<{ id: string }>;

  if (uncovered.length > 0) {
    issues.push(`UNCOVERED_ITEMS: ${uncovered.length} items not linked to any topic`);
  }

  console.log(`[EmbeddingDiscovery] Found ${issues.length} issues:`);
  for (const issue of issues) console.log(`  ${issue}`);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runEmbeddingDiscovery(db: Database.Database): Promise<void> {
  console.log('[EmbeddingDiscovery] Starting daily embedding discovery...');

  const provider = new LocalEmbeddingProvider();

  const embedded = await generateMissingEmbeddings(db, provider);
  console.log(`[EmbeddingDiscovery] Generated ${embedded} new embeddings`);

  const centroids = await computeTopicCentroids(db);
  console.log(`[EmbeddingDiscovery] Computed ${centroids.size} topic centroids`);

  await discoverTaxonomyIssues(db, centroids);

  console.log('[EmbeddingDiscovery] Daily discovery complete');
}
