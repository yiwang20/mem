import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import type { AttentionItem } from '../lib/api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ULID pattern: 26 uppercase alphanumeric chars (Crockford base32)
const ULID_RE = /\b[0-9A-HJKMNP-TV-Z]{26}\b/g;

function cleanTitle(title: string): string {
  return title.replace(ULID_RE, '').replace(/\s{2,}/g, ' ').trim();
}

function urgencyColor(score: number): string {
  if (score >= 0.7) return 'var(--color-urgency-high)';
  if (score >= 0.4) return 'var(--color-urgency-medium)';
  return 'var(--color-urgency-low)';
}

function urgencyLabel(score: number): string {
  if (score >= 0.7) return 'High';
  if (score >= 0.4) return 'Medium';
  return 'Low';
}

function timeAgo(ts: number): string {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

type EntityType = 'person' | 'topic' | 'action_item' | 'key_fact' | 'document' | 'thread';

function entityTintBg(type: EntityType | null | undefined): string {
  switch (type) {
    case 'person': return 'var(--color-person-tint)';
    case 'topic': return 'var(--color-topic-tint)';
    case 'action_item': return 'var(--color-action-item-tint)';
    case 'key_fact': return 'var(--color-key-fact-tint)';
    case 'document': return 'var(--color-document-tint)';
    case 'thread': return 'var(--color-thread-tint)';
    default: return 'var(--surface)';
  }
}

// ---------------------------------------------------------------------------
// Ghost action button
// ---------------------------------------------------------------------------

function ActionButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: 'none',
        border: '1px solid var(--border-strong)',
        borderRadius: '8px',
        padding: '4px 10px',
        fontSize: '12px',
        fontWeight: 500,
        color: disabled ? 'var(--text-ghost)' : 'var(--text-secondary)',
        cursor: disabled ? 'default' : 'pointer',
        transition: 'background 0.15s',
      }}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// AttentionCard
// ---------------------------------------------------------------------------

interface AttentionCardProps {
  item: AttentionItem;
}

export function AttentionCard({ item }: AttentionCardProps) {
  const queryClient = useQueryClient();
  const [done, setDone] = useState(false);

  // Fetch the related entity to get its type and canonical name
  const { data: entityData } = useQuery({
    queryKey: ['entity', item.entityId],
    queryFn: () => api.getEntity(item.entityId!),
    enabled: !!item.entityId,
    staleTime: 60_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['attention'] });
  };

  const resolveMut = useMutation({
    mutationFn: () => api.resolveAttention(item.id),
    onSuccess: () => { setDone(true); invalidate(); },
  });

  const dismissMut = useMutation({
    mutationFn: () => api.dismissAttention(item.id),
    onSuccess: () => { setDone(true); invalidate(); },
  });

  // Snooze 1 hour by default
  const snoozeMut = useMutation({
    mutationFn: () => api.snoozeAttention(item.id, Date.now() + 60 * 60 * 1000),
    onSuccess: () => { setDone(true); invalidate(); },
  });

  const busy = resolveMut.isPending || dismissMut.isPending || snoozeMut.isPending;

  if (done) return null;

  const entityType = entityData?.entity.type ?? null;
  const entityName = entityData?.entity.canonicalName ?? null;
  const bg = entityTintBg(entityType);
  const accent = urgencyColor(item.urgencyScore);

  // Use entity name to replace ULID in title if present, then clean remaining ULIDs
  let displayTitle = item.title;
  if (entityName) {
    displayTitle = displayTitle.replace(ULID_RE, entityName);
  }
  displayTitle = cleanTitle(displayTitle);

  return (
    <div
      style={{
        backgroundColor: bg,
        borderRadius: '20px',
        padding: '20px',
        boxShadow: 'var(--shadow-card)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        transition: 'box-shadow 0.15s, transform 0.15s',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.boxShadow = 'var(--shadow-sm)';
        el.style.transform = 'scale(1.01)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.boxShadow = 'var(--shadow-card)';
        el.style.transform = '';
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        {/* Urgency dot */}
        <div
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '9999px',
            backgroundColor: accent,
            flexShrink: 0,
            marginTop: '6px',
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Urgency label */}
          <div
            style={{
              fontSize: '10px',
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: accent,
              marginBottom: '4px',
            }}
          >
            {urgencyLabel(item.urgencyScore)}
          </div>
          {/* Title */}
          <div
            style={{
              fontSize: '15px',
              fontWeight: 500,
              color: 'var(--text)',
              lineHeight: 1.4,
            }}
          >
            {displayTitle}
          </div>
        </div>
      </div>

      {/* Description */}
      {item.description && (
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {item.description}
        </div>
      )}

      {/* Footer row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
          {timeAgo(item.detectedAt)}
        </span>
        <div style={{ display: 'flex', gap: '6px' }}>
          <ActionButton label="Snooze" onClick={() => snoozeMut.mutate()} disabled={busy} />
          <ActionButton label="Dismiss" onClick={() => dismissMut.mutate()} disabled={busy} />
          <ActionButton label="Resolve" onClick={() => resolveMut.mutate()} disabled={busy} />
        </div>
      </div>
    </div>
  );
}
