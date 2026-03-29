import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/core/events.js';
import { EntityType, EntityStatus, SourceAdapterType } from '../../src/types/index.js';

function makeEntity() {
  const now = Date.now();
  return {
    id: 'ent-1',
    type: EntityType.Person,
    canonicalName: 'Alice',
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
  };
}

describe('EventBus', () => {
  it('calls registered handler when event is emitted', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('entity:created', handler);
    const entity = makeEntity();
    bus.emit('entity:created', { entity });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ entity });
  });

  it('off() removes the handler', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('entity:created', handler);
    bus.off('entity:created', handler);
    bus.emit('entity:created', { entity: makeEntity() });

    expect(handler).not.toHaveBeenCalled();
  });

  it('once() fires exactly once', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.once('entity:created', handler);
    bus.emit('entity:created', { entity: makeEntity() });
    bus.emit('entity:created', { entity: makeEntity() });

    expect(handler).toHaveBeenCalledOnce();
  });

  it('multiple handlers on same event all fire', () => {
    const bus = new EventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();

    bus.on('entity:created', h1);
    bus.on('entity:created', h2);
    bus.emit('entity:created', { entity: makeEntity() });

    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('different events do not cross-fire', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('entity:created', handler);
    bus.emit('entity:updated', { entity: makeEntity() });

    expect(handler).not.toHaveBeenCalled();
  });

  it('passes correct payload for items:ingested', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('items:ingested', handler);
    bus.emit('items:ingested', {
      count: 5,
      sourceAdapter: SourceAdapterType.Gmail,
    });

    expect(handler).toHaveBeenCalledWith({
      count: 5,
      sourceAdapter: SourceAdapterType.Gmail,
    });
  });

  it('entity:merged event carries surviving and merged IDs', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('entity:merged', handler);
    bus.emit('entity:merged', { survivingId: 'a', mergedId: 'b' });

    expect(handler).toHaveBeenCalledWith({ survivingId: 'a', mergedId: 'b' });
  });
});
