/**
 * Integration tests for the exclusion management API:
 * - Direct ConfigManager/DB tests for the exclusion storage
 * - HTTP route tests via Fastify inject
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { MindFlowEngine } from '../../src/core/engine.js';
import {
  registerConfigRoutes,
  type ExclusionEntry,
} from '../../src/adapters/http/routes/config.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let engine: MindFlowEngine;
let app: FastifyInstance;

beforeEach(async () => {
  engine = new MindFlowEngine({ dbPath: ':memory:' });
  app = Fastify({ logger: false });
  await registerConfigRoutes(app, engine);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  engine.close();
});

// ---------------------------------------------------------------------------
// GET /api/config/exclusions
// ---------------------------------------------------------------------------

describe('GET /api/config/exclusions', () => {
  it('returns an empty list when no exclusions exist', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/config/exclusions' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { exclusions: unknown[] };
    expect(body.exclusions).toEqual([]);
  });

  it('returns existing exclusions', async () => {
    // Add one first
    await app.inject({
      method: 'POST',
      url: '/api/config/exclusions',
      payload: { type: 'contact', value: 'spam@example.com' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/config/exclusions' });
    const body = res.json() as { exclusions: ExclusionEntry[] };
    expect(body.exclusions).toHaveLength(1);
    expect(body.exclusions[0]!.value).toBe('spam@example.com');
  });
});

// ---------------------------------------------------------------------------
// POST /api/config/exclusions
// ---------------------------------------------------------------------------

describe('POST /api/config/exclusions', () => {
  it('creates a contact exclusion', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/config/exclusions',
      payload: { type: 'contact', value: 'noreply@spam.com' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { exclusion: ExclusionEntry };
    expect(body.exclusion.type).toBe('contact');
    expect(body.exclusion.value).toBe('noreply@spam.com');
    expect(body.exclusion.id).toBeTruthy();
    expect(body.exclusion.createdAt).toBeGreaterThan(0);
  });

  it('creates a label exclusion', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/config/exclusions',
      payload: { type: 'label', value: 'Promotions' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { exclusion: ExclusionEntry };
    expect(body.exclusion.type).toBe('label');
    expect(body.exclusion.value).toBe('Promotions');
  });

  it('creates a conversation exclusion', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/config/exclusions',
      payload: { type: 'conversation', value: '+15551234567' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('rejects invalid type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/config/exclusions',
      payload: { type: 'invalid_type', value: 'foo' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects missing value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/config/exclusions',
      payload: { type: 'contact' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects empty value string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/config/exclusions',
      payload: { type: 'contact', value: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 409 for exact duplicate', async () => {
    const payload = { type: 'contact', value: 'dup@example.com' };
    await app.inject({ method: 'POST', url: '/api/config/exclusions', payload });
    const res = await app.inject({ method: 'POST', url: '/api/config/exclusions', payload });
    expect(res.statusCode).toBe(409);
  });

  it('persists multiple exclusions across requests', async () => {
    await app.inject({
      method: 'POST', url: '/api/config/exclusions',
      payload: { type: 'contact', value: 'a@example.com' },
    });
    await app.inject({
      method: 'POST', url: '/api/config/exclusions',
      payload: { type: 'label', value: 'Newsletters' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/config/exclusions' });
    const body = res.json() as { exclusions: ExclusionEntry[] };
    expect(body.exclusions).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/config/exclusions/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/config/exclusions/:id', () => {
  it('removes an exclusion by id', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/config/exclusions',
      payload: { type: 'contact', value: 'delete-me@example.com' },
    });
    const { exclusion } = createRes.json() as { exclusion: ExclusionEntry };

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/config/exclusions/${exclusion.id}`,
    });
    expect(deleteRes.statusCode).toBe(204);

    // Verify it's gone
    const listRes = await app.inject({ method: 'GET', url: '/api/config/exclusions' });
    const body = listRes.json() as { exclusions: ExclusionEntry[] };
    expect(body.exclusions.find((e) => e.id === exclusion.id)).toBeUndefined();
  });

  it('returns 404 for a non-existent id', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/config/exclusions/no-such-id',
    });
    expect(res.statusCode).toBe(404);
  });

  it('does not remove other exclusions when deleting one', async () => {
    const r1 = await app.inject({
      method: 'POST', url: '/api/config/exclusions',
      payload: { type: 'contact', value: 'keep@example.com' },
    });
    const r2 = await app.inject({
      method: 'POST', url: '/api/config/exclusions',
      payload: { type: 'label', value: 'Remove' },
    });
    const { exclusion: toKeep } = r1.json() as { exclusion: ExclusionEntry };
    const { exclusion: toDelete } = r2.json() as { exclusion: ExclusionEntry };

    await app.inject({ method: 'DELETE', url: `/api/config/exclusions/${toDelete.id}` });

    const listRes = await app.inject({ method: 'GET', url: '/api/config/exclusions' });
    const body = listRes.json() as { exclusions: ExclusionEntry[] };
    expect(body.exclusions).toHaveLength(1);
    expect(body.exclusions[0]!.id).toBe(toKeep.id);
  });
});
