/**
 * Integration tests for GraphOperations.getShortestPath.
 *
 * Uses an in-memory SQLite database via MindFlowEngine to exercise the full
 * BFS recursive CTE path-finding logic.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MindFlowEngine } from '../../src/core/engine.js';
import {
  EntityStatus,
  EntityType,
  RelationshipType,
  SourceAdapterType,
  SourceChannel,
  BodyFormat,
  DetectedLanguage,
  ProcessingStatus,
} from '../../src/types/index.js';
import type { Entity, Relationship } from '../../src/types/index.js';
import { ulid } from '../../src/utils/ulid.js';
import { sha256 } from '../../src/utils/hash.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  const now = Date.now();
  return {
    id: ulid(),
    type: EntityType.Person,
    canonicalName: 'Entity',
    nameAlt: null,
    aliases: [],
    attributes: {},
    confidence: 1.0,
    status: EntityStatus.Active,
    mergedInto: null,
    firstSeenAt: now,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeRelationship(fromId: string, toId: string): Relationship {
  return {
    id: ulid(),
    fromEntityId: fromId,
    toEntityId: toId,
    type: RelationshipType.Discusses,
    strength: 0.8,
    eventTime: Date.now(),
    ingestionTime: Date.now(),
    validFrom: null,
    validUntil: null,
    occurrenceCount: 1,
    sourceItemIds: [],
    metadata: {},
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('GraphOperations.getShortestPath', () => {
  let engine: MindFlowEngine;

  beforeEach(() => {
    engine = new MindFlowEngine({ dbPath: ':memory:' });
  });

  afterEach(() => {
    engine.close();
  });

  it('returns the single node for trivial same-entity path', () => {
    const a = makeEntity({ canonicalName: 'Alpha' });
    engine.entities.insert(a);

    const { nodes, edges } = engine.graphOps.getShortestPath(a.id, a.id);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.id).toBe(a.id);
    expect(edges).toHaveLength(0);
  });

  it('finds a direct 1-hop path', () => {
    const a = makeEntity({ canonicalName: 'Alpha' });
    const b = makeEntity({ canonicalName: 'Beta' });
    engine.entities.insert(a);
    engine.entities.insert(b);

    const rel = makeRelationship(a.id, b.id);
    engine.relationships.insert(rel);

    const { nodes, edges } = engine.graphOps.getShortestPath(a.id, b.id);
    expect(nodes).toHaveLength(2);
    expect(nodes.map((n) => n.id)).toContain(a.id);
    expect(nodes.map((n) => n.id)).toContain(b.id);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.id).toBe(rel.id);
  });

  it('traverses the path in reverse direction', () => {
    // Edge is a → b; path query is b → a (undirected traversal)
    const a = makeEntity({ canonicalName: 'Alpha' });
    const b = makeEntity({ canonicalName: 'Beta' });
    engine.entities.insert(a);
    engine.entities.insert(b);
    engine.relationships.insert(makeRelationship(a.id, b.id));

    const { nodes, edges } = engine.graphOps.getShortestPath(b.id, a.id);
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
  });

  it('finds a 2-hop path through an intermediate node', () => {
    // a — b — c
    const a = makeEntity({ canonicalName: 'Alpha' });
    const b = makeEntity({ canonicalName: 'Beta' });
    const c = makeEntity({ canonicalName: 'Gamma' });
    engine.entities.insert(a);
    engine.entities.insert(b);
    engine.entities.insert(c);

    const rel1 = makeRelationship(a.id, b.id);
    const rel2 = makeRelationship(b.id, c.id);
    engine.relationships.insert(rel1);
    engine.relationships.insert(rel2);

    const { nodes, edges } = engine.graphOps.getShortestPath(a.id, c.id);
    expect(nodes).toHaveLength(3);
    expect(edges).toHaveLength(2);
    // Intermediate node must be included
    expect(nodes.map((n) => n.id)).toContain(b.id);
  });

  it('returns the shortest path when multiple routes exist', () => {
    // a — b — c   (2 hops)
    // a — c       (1 hop, direct shortcut)
    const a = makeEntity({ canonicalName: 'Alpha' });
    const b = makeEntity({ canonicalName: 'Beta' });
    const c = makeEntity({ canonicalName: 'Gamma' });
    engine.entities.insert(a);
    engine.entities.insert(b);
    engine.entities.insert(c);

    engine.relationships.insert(makeRelationship(a.id, b.id));
    engine.relationships.insert(makeRelationship(b.id, c.id));
    const directRel = makeRelationship(a.id, c.id);
    engine.relationships.insert(directRel);

    const { nodes, edges } = engine.graphOps.getShortestPath(a.id, c.id);
    // Shortest path is 1 hop: a → c
    expect(edges).toHaveLength(1);
    expect(nodes).toHaveLength(2);
    expect(edges[0]!.id).toBe(directRel.id);
  });

  it('returns empty when no path exists within maxDepth', () => {
    // a is isolated; b — c are connected but separate from a
    const a = makeEntity({ canonicalName: 'Alpha' });
    const b = makeEntity({ canonicalName: 'Beta' });
    const c = makeEntity({ canonicalName: 'Gamma' });
    engine.entities.insert(a);
    engine.entities.insert(b);
    engine.entities.insert(c);
    engine.relationships.insert(makeRelationship(b.id, c.id));

    const { nodes, edges } = engine.graphOps.getShortestPath(a.id, c.id);
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });

  it('respects maxDepth and returns empty when path is too long', () => {
    // a — b — c — d  (3 hops); limit to maxDepth=2
    const a = makeEntity({ canonicalName: 'Alpha' });
    const b = makeEntity({ canonicalName: 'Beta' });
    const c = makeEntity({ canonicalName: 'Gamma' });
    const d = makeEntity({ canonicalName: 'Delta' });
    engine.entities.insert(a);
    engine.entities.insert(b);
    engine.entities.insert(c);
    engine.entities.insert(d);

    engine.relationships.insert(makeRelationship(a.id, b.id));
    engine.relationships.insert(makeRelationship(b.id, c.id));
    engine.relationships.insert(makeRelationship(c.id, d.id));

    const { nodes, edges } = engine.graphOps.getShortestPath(a.id, d.id, 2);
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });

  it('finds a path exactly at maxDepth', () => {
    // a — b — c  (2 hops); maxDepth=2 should still find it
    const a = makeEntity({ canonicalName: 'Alpha' });
    const b = makeEntity({ canonicalName: 'Beta' });
    const c = makeEntity({ canonicalName: 'Gamma' });
    engine.entities.insert(a);
    engine.entities.insert(b);
    engine.entities.insert(c);

    engine.relationships.insert(makeRelationship(a.id, b.id));
    engine.relationships.insert(makeRelationship(b.id, c.id));

    const { nodes, edges } = engine.graphOps.getShortestPath(a.id, c.id, 2);
    expect(nodes).toHaveLength(3);
    expect(edges).toHaveLength(2);
  });

  it('does not traverse expired (valid_until set) relationships', () => {
    const a = makeEntity({ canonicalName: 'Alpha' });
    const b = makeEntity({ canonicalName: 'Beta' });
    engine.entities.insert(a);
    engine.entities.insert(b);

    // Insert an expired relationship directly via SQL
    const rel = makeRelationship(a.id, b.id);
    engine.db.db
      .prepare(
        `INSERT INTO relationships
         (id, from_entity_id, to_entity_id, type, strength, event_time,
          ingestion_time, valid_from, valid_until, occurrence_count, source_item_ids, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        rel.id, rel.fromEntityId, rel.toEntityId, rel.type, rel.strength,
        rel.eventTime, rel.ingestionTime, rel.validFrom,
        Date.now() - 1000, // expired: valid_until in the past
        rel.occurrenceCount, JSON.stringify(rel.sourceItemIds), JSON.stringify(rel.metadata),
      );

    const { nodes, edges } = engine.graphOps.getShortestPath(a.id, b.id);
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });

  it('node labels match canonical names', () => {
    const a = makeEntity({ canonicalName: 'Alice Chen' });
    const b = makeEntity({ canonicalName: 'Bob Smith' });
    engine.entities.insert(a);
    engine.entities.insert(b);
    engine.relationships.insert(makeRelationship(a.id, b.id));

    const { nodes } = engine.graphOps.getShortestPath(a.id, b.id);
    const labels = nodes.map((n) => n.label);
    expect(labels).toContain('Alice Chen');
    expect(labels).toContain('Bob Smith');
  });
});
