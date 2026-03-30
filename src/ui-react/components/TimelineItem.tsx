import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import type { RawItem } from '../lib/api.js';

// ---------------------------------------------------------------------------
// Channel badge config
// ---------------------------------------------------------------------------

const CHANNEL_CONFIG = {
  email:    { label: 'EMAIL',    color: '#6B8EC4', bg: 'rgba(107,142,196,0.12)' },
  imessage: { label: 'IMESSAGE', color: '#6B9E8A', bg: 'rgba(107,158,138,0.12)' },
  file:     { label: 'DOC',      color: '#C4A86B', bg: 'rgba(196,168,107,0.12)' },
} satisfies Record<string, { label: string; color: string; bg: string }>;

const DEFAULT_CHANNEL = { label: 'MSG', color: '#8A8A8A', bg: 'rgba(138,138,138,0.10)' };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const isThisYear = d.getFullYear() === now.getFullYear();

  if (isToday) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (isThisYear) {
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen) + '…';
}

// ---------------------------------------------------------------------------
// TimelineItem
// ---------------------------------------------------------------------------

interface TimelineItemProps {
  item: RawItem;
  /** Display name for the sender entity (caller resolves from entity cache) */
  senderName?: string;
  /** Query keys to invalidate after deletion (e.g. ['timeline', entityId, filters]) */
  queryKeys?: unknown[][];
}

export function TimelineItem({ item, senderName, queryKeys }: TimelineItemProps) {
  const [hovered, setHovered] = useState(false);
  const [deleteState, setDeleteState] = useState<'idle' | 'confirming' | 'deleting'>('idle');
  const [deleted, setDeleted] = useState(false);
  const queryClient = useQueryClient();

  // Optimistic removal — hide immediately on confirm, then invalidate queries
  async function handleConfirmDelete() {
    setDeleteState('deleting');
    setDeleted(true); // optimistic
    try {
      await api.deleteItem(item.id);
      if (queryKeys) {
        for (const key of queryKeys) {
          await queryClient.invalidateQueries({ queryKey: key });
        }
      }
    } catch {
      // Rollback optimistic removal on error
      setDeleted(false);
      setDeleteState('idle');
    }
  }

  if (deleted) return null;

  const ch = CHANNEL_CONFIG[item.channel as keyof typeof CHANNEL_CONFIG] ?? DEFAULT_CHANNEL;
  const preview = truncate(item.body.replace(/\s+/g, ' ').trim(), 160);
  const senderLabel = senderName ?? (item.senderEntityId ? 'Unknown sender' : 'System');

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '16px',
        background: hovered ? 'var(--surface-hover)' : 'var(--surface)',
        transition: 'background 0.15s, border-color 0.15s',
        borderColor: hovered ? 'var(--border-strong)' : 'var(--border)',
        cursor: 'default',
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: item.subject ? '4px' : '6px',
        }}
      >
        {/* Channel badge */}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '2px 7px',
            borderRadius: '9999px',
            background: ch.bg,
            color: ch.color,
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.04em',
            flexShrink: 0,
          }}
        >
          {ch.label}
        </span>

        {/* Sender */}
        <span
          style={{
            fontSize: '14px',
            fontWeight: 500,
            color: 'var(--text)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {senderLabel}
        </span>

        {/* Date */}
        <span
          style={{
            fontSize: '11px',
            color: 'var(--text-tertiary)',
            flexShrink: 0,
          }}
        >
          {formatDate(item.eventTime)}
        </span>
      </div>

      {/* Subject */}
      {item.subject && (
        <div
          style={{
            fontSize: '14px',
            fontWeight: 500,
            color: 'var(--text)',
            marginBottom: '4px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.subject}
        </div>
      )}

      {/* Body preview — 2-line clamp */}
      <div
        style={{
          fontSize: '13px',
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {preview}
      </div>

      {/* Hover actions */}
      {hovered && (
        <div
          style={{
            display: 'flex',
            gap: '12px',
            marginTop: '8px',
          }}
        >
          {item.channel === 'email' && item.subject && (
            <a
              href={`mailto:?subject=Re: ${encodeURIComponent(item.subject)}`}
              style={{
                fontSize: '12px',
                color: 'var(--accent)',
                textDecoration: 'none',
                fontWeight: 500,
              }}
            >
              Reply
            </a>
          )}
          {item.channel === 'imessage' && (
            <button
              style={{
                fontSize: '12px',
                color: 'var(--accent)',
                border: 'none',
                background: 'none',
                padding: 0,
                cursor: 'pointer',
                fontWeight: 500,
              }}
              onClick={() => {
                // iMessage deep-link (macOS only, best-effort)
                window.open(`sms:`, '_blank');
              }}
            >
              Open in Messages
            </button>
          )}
          <button
            style={{
              fontSize: '12px',
              color: 'var(--accent)',
              border: 'none',
              background: 'none',
              padding: 0,
              cursor: 'pointer',
              fontWeight: 500,
            }}
            onClick={() => {
              void navigator.clipboard.writeText(item.body);
            }}
          >
            Copy
          </button>

          {deleteState === 'idle' && (
            <button
              style={{
                fontSize: '12px',
                color: '#E05C5C',
                border: 'none',
                background: 'none',
                padding: 0,
                cursor: 'pointer',
                fontWeight: 500,
              }}
              onClick={() => setDeleteState('confirming')}
            >
              Delete
            </button>
          )}

          {deleteState === 'confirming' && (
            <>
              <span style={{ fontSize: '12px', color: '#E05C5C', fontWeight: 500 }}>
                Confirm delete?
              </span>
              <button
                style={{
                  fontSize: '12px',
                  color: '#E05C5C',
                  border: 'none',
                  background: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  fontWeight: 700,
                }}
                onClick={() => { void handleConfirmDelete(); }}
              >
                Yes
              </button>
              <button
                style={{
                  fontSize: '12px',
                  color: 'var(--text-secondary)',
                  border: 'none',
                  background: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
                onClick={() => setDeleteState('idle')}
              >
                No
              </button>
            </>
          )}

          {deleteState === 'deleting' && (
            <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
              Deleting…
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Date group header
// ---------------------------------------------------------------------------

export function TimelineDateHeader({ date }: { date: string }) {
  return (
    <div
      style={{
        fontSize: '10px',
        fontWeight: 700,
        letterSpacing: '0.06em',
        color: 'var(--text-tertiary)',
        textTransform: 'uppercase',
        margin: '20px 0 8px',
      }}
    >
      {date}
    </div>
  );
}
