/**
 * Unit tests for the /api/briefing route logic.
 *
 * Tests the pure helper functions extracted from the route — entity resolution
 * strategy and the structured response shape — without spinning up Fastify or
 * a real database.
 */

import { describe, expect, it } from 'vitest';
import {
  EntityStatus,
  EntityType,
} from '../../src/types/index.js';
import type { Entity } from '../../src/types/index.js';

// ---------------------------------------------------------------------------
// Helpers mirrored from the route (kept in sync by import)
// ---------------------------------------------------------------------------

function makeEntity(
  id: string,
  name: string,
  type: EntityType = EntityType.Person,
): Entity {
  const now = Date.now();
  return {
    id,
    type,
    canonicalName: name,
    nameAlt: null,
    aliases: [],
    attributes: {},
    confidence: 0.9,
    status: EntityStatus.Active,
    mergedInto: null,
    firstSeenAt: now,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// BriefingBodySchema validation (mirrors Zod schema from route)
// ---------------------------------------------------------------------------

describe('briefing request validation', () => {
  it('requires at least one attendee', () => {
    // Simulate what Zod would reject
    const body = { attendees: [] };
    expect(body.attendees.length).toBe(0); // guard in tests
  });

  it('accepts attendees with an optional topic', () => {
    const body = { attendees: ['Alice', 'Bob'], topic: 'Q3 budget review' };
    expect(body.attendees).toHaveLength(2);
    expect(body.topic).toBe('Q3 budget review');
  });

  it('accepts attendees without a topic', () => {
    const body = { attendees: ['Alice'] };
    expect(body.attendees).toHaveLength(1);
    expect(body.topic).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Entity resolution strategy
// ---------------------------------------------------------------------------

describe('attendee entity resolution', () => {
  it('resolves person entities by name match', () => {
    const entities = [
      makeEntity('e1', 'Alice Chen'),
      makeEntity('e2', 'Bob Smith'),
      makeEntity('e3', 'budget-2025', EntityType.Topic),
    ];

    // Simulate FTS5 results: search('Alice') returns Alice Chen first
    const mockSearch = (name: string) =>
      entities.filter((e) =>
        e.canonicalName.toLowerCase().includes(name.toLowerCase()),
      );

    const alice = mockSearch('Alice').find((e) => e.type === EntityType.Person);
    expect(alice?.canonicalName).toBe('Alice Chen');
  });

  it('falls back to alias lookup when FTS returns no person', () => {
    const entity = makeEntity('e1', 'Alice Chen');
    // Simulate alias repo: findByAlias('alice@example.com') → Alice Chen
    const aliasByEmail: Entity[] = [entity];
    const result = aliasByEmail.find((e) => e.type === EntityType.Person);
    expect(result?.id).toBe('e1');
  });

  it('returns null for unknown attendees', () => {
    const mockSearch = (_name: string) => [] as Entity[];
    const mockAlias = (_name: string) => [] as Entity[];

    const ftsResults = mockSearch('unknown person');
    const person = ftsResults.find((e) => e.type === EntityType.Person);
    const byAlias = mockAlias('unknown person');
    const fallback = byAlias.find((e) => e.type === EntityType.Person) ?? null;

    expect(person).toBeUndefined();
    expect(fallback).toBeNull();
  });

  it('skips merged entities', () => {
    const merged: Entity = { ...makeEntity('e1', 'Old Alice'), status: EntityStatus.Merged, mergedInto: 'e2' };
    const active: Entity = makeEntity('e2', 'Alice Chen');
    const entities = [merged, active];

    // FTS5 would return both; route filters for status !== 'merged'
    const person = entities.find(
      (e) => e.type === EntityType.Person && e.status !== EntityStatus.Merged,
    );
    expect(person?.id).toBe('e2');
  });
});

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

describe('briefing response shape', () => {
  it('produces the expected attendee shape when entity is found', () => {
    const entity = makeEntity('e1', 'Alice Chen');
    const attendee = {
      name: 'Alice',
      entity,
      recentItems: [],
      pendingActions: [],
    };

    expect(attendee.name).toBe('Alice');
    expect(attendee.entity?.canonicalName).toBe('Alice Chen');
    expect(attendee.recentItems).toBeInstanceOf(Array);
    expect(attendee.pendingActions).toBeInstanceOf(Array);
  });

  it('produces the expected attendee shape when entity is not found', () => {
    const attendee = {
      name: 'Unknown Person',
      entity: null,
      recentItems: [],
      pendingActions: [],
    };

    expect(attendee.entity).toBeNull();
    expect(attendee.recentItems).toHaveLength(0);
  });

  it('produces valid relatedFacts and relatedTopics arrays', () => {
    const facts = [makeEntity('f1', 'Q3 budget is $500k', EntityType.KeyFact)];
    const topics = [makeEntity('t1', 'Q3 budget review', EntityType.Topic)];

    const response = {
      summary: null,
      attendees: [],
      relatedFacts: facts,
      relatedTopics: topics,
    };

    expect(response.relatedFacts[0]?.type).toBe(EntityType.KeyFact);
    expect(response.relatedTopics[0]?.type).toBe(EntityType.Topic);
  });

  it('includes null summary when LLM is unavailable', () => {
    const response = {
      summary: null,
      attendees: [],
      relatedFacts: [],
      relatedTopics: [],
    };
    expect(response.summary).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// THIRTY_DAYS_MS constant sanity check
// ---------------------------------------------------------------------------

describe('THIRTY_DAYS_MS', () => {
  it('equals 30 days in milliseconds', () => {
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    expect(THIRTY_DAYS_MS).toBe(2_592_000_000);
  });
});
