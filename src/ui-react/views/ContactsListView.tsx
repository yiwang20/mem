import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import type { Entity } from '../lib/api.js';
import { PersonCard } from '../components/PersonCard.js';

// ---------------------------------------------------------------------------
// Group people by community attribute
// ---------------------------------------------------------------------------

interface Group {
  label: string;
  people: Entity[];
}

function groupPeople(people: Entity[]): Group[] {
  const groups = new Map<string, Entity[]>();

  for (const p of people) {
    const community =
      typeof p.attributes.community === 'string' && p.attributes.community.trim()
        ? p.attributes.community.trim()
        : typeof p.attributes.organization === 'string' && p.attributes.organization.trim()
          ? p.attributes.organization.trim()
          : null;

    const key = community ?? '其他 Other';
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }

  // Sort: named groups first (alphabetically), "Other" last
  const OTHER = '其他 Other';
  const sorted = [...groups.entries()].sort(([a], [b]) => {
    if (a === OTHER) return 1;
    if (b === OTHER) return -1;
    return a.localeCompare(b);
  });

  return sorted.map(([label, ps]) => ({ label, people: ps }));
}

// ---------------------------------------------------------------------------
// Collapsible section
// ---------------------------------------------------------------------------

interface SectionProps {
  label: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function Section({ label, count, defaultOpen = true, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{ marginBottom: '24px' }}>
      {/* Section header */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '4px 0',
          marginBottom: '12px',
          width: '100%',
          textAlign: 'left',
        }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 200ms ease',
            color: 'var(--text-tertiary)',
            flexShrink: 0,
          }}
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
        <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
          {label}
        </span>
        <span
          style={{
            fontSize: '10px',
            fontWeight: 600,
            color: 'var(--text-ghost)',
            background: 'var(--bg-subtle)',
            borderRadius: '9999px',
            padding: '1px 7px',
            border: '1px solid var(--border)',
          }}
        >
          {count}
        </span>
      </button>

      {/* Content — animate open/close */}
      <div
        style={{
          overflow: 'hidden',
          maxHeight: open ? '10000px' : '0',
          opacity: open ? 1 : 0,
          transition: 'max-height 200ms ease, opacity 200ms ease',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ContactsListView
// ---------------------------------------------------------------------------

export function ContactsListView() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['entities', 'person', 'recent'],
    queryFn: () => api.listEntities({ type: 'person', limit: 100, sort: 'recent' }),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div style={{ padding: '32px 24px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              style={{ width: '120px', height: '140px', borderRadius: '16px', background: 'var(--bg-subtle)' }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '14px' }}>
        Failed to load contacts.
      </div>
    );
  }

  if (data.entities.length === 0) {
    return (
      <div style={{ padding: '64px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: '14px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>
          No contacts yet. 还没有联系人。
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-ghost)' }}>
          Start by indexing your email or messages.
        </div>
      </div>
    );
  }

  const groups = groupPeople(data.entities);

  // If there's only one group (everyone in "Other"), skip group headers and render flat
  const isFlat = groups.length === 1 && groups[0]?.label === '其他 Other';

  if (isFlat) {
    return (
      <div style={{ padding: '16px 24px 32px', display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
        {data.entities.map((p) => (
          <PersonCard key={p.id} entity={p} />
        ))}
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 24px 32px' }}>
      {groups.map((group) => (
        <Section key={group.label} label={group.label} count={group.people.length} defaultOpen>
          {group.people.map((p) => (
            <PersonCard key={p.id} entity={p} />
          ))}
        </Section>
      ))}
    </div>
  );
}
