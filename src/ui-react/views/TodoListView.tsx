import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import type { AttentionItem } from '../lib/api.js';
import { AttentionCard } from '../components/AttentionCard.js';

// ---------------------------------------------------------------------------
// Urgency groups
// ---------------------------------------------------------------------------

interface UrgencyGroup {
  key: string;
  label: string;
  labelAlt: string;
  color: string;
  items: AttentionItem[];
}

function groupByUrgency(items: AttentionItem[]): UrgencyGroup[] {
  const overdue: AttentionItem[]   = [];
  const thisWeek: AttentionItem[]  = [];
  const upcoming: AttentionItem[]  = [];
  const noDate: AttentionItem[]    = [];

  const now = Date.now();
  const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

  for (const item of items) {
    // Skip already resolved/dismissed/snoozed items
    if (item.resolvedAt !== null || item.dismissedAt !== null) continue;
    if (item.snoozedUntil !== null && item.snoozedUntil > now) continue;

    // Use urgencyScore as a proxy for timing since AttentionItem has no dueAt
    if (item.urgencyScore >= 0.7) {
      overdue.push(item);
    } else if (item.urgencyScore >= 0.4) {
      thisWeek.push(item);
    } else if (item.urgencyScore > 0) {
      upcoming.push(item);
    } else {
      noDate.push(item);
    }
  }

  return [
    {
      key: 'overdue',
      label: 'Overdue',
      labelAlt: '逾期',
      color: 'var(--color-urgency-high, #C47A7A)',
      items: overdue,
    },
    {
      key: 'this-week',
      label: 'This Week',
      labelAlt: '本周',
      color: 'var(--color-urgency-medium, #C4A86B)',
      items: thisWeek,
    },
    {
      key: 'upcoming',
      label: 'Upcoming',
      labelAlt: '待处理',
      color: 'var(--color-urgency-low, #6B9E8A)',
      items: upcoming,
    },
    {
      key: 'no-date',
      label: 'No Due Date',
      labelAlt: '无截止日',
      color: 'var(--text-tertiary)',
      items: noDate,
    },
  ].filter((g) => g.items.length > 0);
}

// ---------------------------------------------------------------------------
// Collapsible section
// ---------------------------------------------------------------------------

interface SectionProps {
  group: UrgencyGroup;
  defaultOpen?: boolean;
}

function UrgencySection({ group, defaultOpen = true }: SectionProps) {
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

        {/* Urgency dot */}
        <div
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '9999px',
            backgroundColor: group.color,
            flexShrink: 0,
          }}
        />

        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: group.color,
          }}
        >
          {group.label} {group.labelAlt}
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
          {group.items.length}
        </span>
      </button>

      {/* Cards */}
      <div
        style={{
          overflow: 'hidden',
          maxHeight: open ? '10000px' : '0',
          opacity: open ? 1 : 0,
          transition: 'max-height 200ms ease, opacity 200ms ease',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {group.items.map((item) => (
            <AttentionCard key={item.id} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TodoListView
// ---------------------------------------------------------------------------

export function TodoListView() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['attention'],
    queryFn: () => api.getAttention(),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div style={{ padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {[1, 2, 3].map((i) => (
          <div key={i} style={{ height: '100px', borderRadius: '20px', background: 'var(--bg-subtle)' }} />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '14px' }}>
        Failed to load todos.
      </div>
    );
  }

  const groups = groupByUrgency(data.items);

  if (groups.length === 0) {
    return (
      <div style={{ padding: '64px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: '14px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>
          All clear. 没有待办事项。
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-ghost)' }}>
          Action items from your messages will appear here.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 24px 32px' }}>
      {groups.map((group) => (
        <UrgencySection key={group.key} group={group} defaultOpen />
      ))}
    </div>
  );
}
