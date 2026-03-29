import type { Entity } from './api.js';

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

export function timeAgo(ts: number): string {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 30 * 86400) return `${Math.floor(diff / (7 * 86400))}w ago`;
  return formatDate(ts);
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: new Date(ts).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  });
}

export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------

export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + '…';
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// ---------------------------------------------------------------------------
// Entity color system
// ---------------------------------------------------------------------------

export interface EntityColorSet {
  color: string;       // CSS var for the main color
  tint: string;        // CSS var for the light background tint
  cssColor: string;    // literal color value for contexts where CSS vars aren't available
  cssTint: string;     // literal tint value
}

const ENTITY_COLORS: Record<Entity['type'], EntityColorSet> = {
  person: {
    color: 'var(--color-person)',
    tint: 'var(--color-person-tint)',
    cssColor: '#8B7EC8',
    cssTint: '#F0EDF8',
  },
  topic: {
    color: 'var(--color-topic)',
    tint: 'var(--color-topic-tint)',
    cssColor: '#6B9E8A',
    cssTint: '#EDF5F0',
  },
  document: {
    color: 'var(--color-document)',
    tint: 'var(--color-document-tint)',
    cssColor: '#C4A86B',
    cssTint: '#F8F3EA',
  },
  action_item: {
    color: 'var(--color-action-item)',
    tint: 'var(--color-action-item-tint)',
    cssColor: '#C47A7A',
    cssTint: '#F8EDEC',
  },
  key_fact: {
    color: 'var(--color-key-fact)',
    tint: 'var(--color-key-fact-tint)',
    cssColor: '#6B8EC4',
    cssTint: '#EDF1F8',
  },
  thread: {
    color: 'var(--color-thread)',
    tint: 'var(--color-thread-tint)',
    cssColor: '#8A8A8A',
    cssTint: '#F2F2F0',
  },
};

export function entityColor(type: Entity['type']): EntityColorSet {
  return ENTITY_COLORS[type];
}
