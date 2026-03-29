import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Entity, EntityStats } from '../lib/api.js';
import { api } from '../lib/api.js';
import type { GraphNodeData } from './CytoscapeGraph.js';

// ----------------------------------------------------------------------------
// Entity type color tokens (matches design spec muted palette)
// ----------------------------------------------------------------------------

const TYPE_COLOR: Record<string, string> = {
  person:      '#8B7EC8',
  topic:       '#6B9E8A',
  document:    '#C4A86B',
  action_item: '#C47A7A',
  key_fact:    '#6B8EC4',
  thread:      '#8A8A8A',
};

const TYPE_LABEL: Record<string, string> = {
  person:      'Person',
  topic:       'Topic',
  document:    'Document',
  action_item: 'Action Item',
  key_fact:    'Key Fact',
  thread:      'Thread',
};

function typeColor(type: string): string {
  return TYPE_COLOR[type] ?? '#8A8A8A';
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const sec  = Math.floor(diff / 1000);
  if (sec < 60)    return 'just now';
  const min  = Math.floor(sec / 60);
  if (min < 60)    return `${min}m ago`;
  const hr   = Math.floor(min / 60);
  if (hr < 24)     return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 30)   return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

// ----------------------------------------------------------------------------
// Message node card (xref-msg-* nodes)
// ----------------------------------------------------------------------------

const CHANNEL_LABEL: Record<string, string> = {
  email:    'Email',
  imessage: 'iMessage',
  file:     'Document',
};

interface MessageCardProps {
  data: GraphNodeData;
  visible: boolean;
}

function MessageCard({ data, visible }: MessageCardProps) {
  const channel  = data.msgChannel ?? 'message';
  const label    = CHANNEL_LABEL[channel] ?? channel;
  const date     = data.msgEventTime ? new Date(data.msgEventTime).toLocaleString() : null;
  const subject  = data.fullLabel ?? data.label;
  const body     = data.msgBody ?? '';
  const preview  = body.length > 200 ? body.slice(0, 200) + '…' : body;

  return (
    <div
      style={{
        position:  'absolute',
        bottom:    16,
        right:     16,
        width:     320,
        background: 'var(--surface)',
        borderRadius: 16,
        boxShadow: 'var(--shadow-md)',
        border:    '1px solid var(--border)',
        padding:   '16px',
        opacity:   visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(8px)',
        transition: 'opacity 200ms ease, transform 200ms ease',
        pointerEvents: visible ? 'auto' : 'none',
        zIndex:    10,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div
          style={{
            width:        36,
            height:       36,
            borderRadius: '50%',
            background:   '#8A8A8A',
            display:      'flex',
            alignItems:   'center',
            justifyContent: 'center',
            color:        '#fff',
            fontSize:     15,
            flexShrink:   0,
          }}
        >
          {channel === 'email' ? '✉' : channel === 'imessage' ? '💬' : '📄'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize:     14,
              fontWeight:   600,
              color:        'var(--text)',
              fontFamily:   'Inter, system-ui, sans-serif',
              whiteSpace:   'nowrap',
              overflow:     'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {subject}
          </div>
          <span
            style={{
              display:      'inline-block',
              marginTop:    3,
              padding:      '2px 8px',
              borderRadius: 99,
              background:   'rgba(138,138,138,0.15)',
              color:        '#8A8A8A',
              fontSize:     11,
              fontWeight:   500,
              fontFamily:   'Inter, system-ui, sans-serif',
            }}
          >
            {label}
          </span>
        </div>
      </div>

      {/* Date */}
      {date && (
        <div
          style={{
            fontSize:   12,
            color:      'var(--text-secondary)',
            fontFamily: 'Inter, system-ui, sans-serif',
            marginBottom: 8,
          }}
        >
          {date}
        </div>
      )}

      {/* Body preview */}
      {preview && (
        <div
          style={{
            fontSize:   13,
            color:      'var(--text-secondary)',
            fontFamily: 'Inter, system-ui, sans-serif',
            lineHeight: 1.5,
            wordBreak:  'break-word',
          }}
        >
          {preview}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Props
// ----------------------------------------------------------------------------

interface FloatingDetailCardProps {
  entityId: string | null;
  messageNode?: GraphNodeData | null;
}

// ----------------------------------------------------------------------------
// Component
// ----------------------------------------------------------------------------

export function FloatingDetailCard({ entityId, messageNode }: FloatingDetailCardProps) {
  const navigate = useNavigate();
  const [entity, setEntity] = useState<Entity | null>(null);
  const [stats,  setStats]  = useState<EntityStats | null>(null);
  const [visible, setVisible] = useState(false);

  // Message node (xref-msg-*): render inline without API call
  if (messageNode) {
    return <MessageCard data={messageNode} visible={true} />;
  }

  useEffect(() => {
    if (!entityId) {
      setVisible(false);
      return;
    }

    // Animate in after a minimal delay so the card renders first
    setVisible(false);
    setEntity(null);
    setStats(null);

    api.getEntity(entityId)
      .then(({ entity: e, stats: s }) => {
        setEntity(e);
        setStats(s);
        // Trigger slide-up animation
        requestAnimationFrame(() => {
          requestAnimationFrame(() => setVisible(true));
        });
      })
      .catch(() => {
        // Non-entity node (root, category) — hide card
        setVisible(false);
      });
  }, [entityId]);

  // Root / category nodes don't need a detail card
  if (!entityId || !entity) return null;

  const color = typeColor(entity.type);
  const initials = entity.canonicalName
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <div
      style={{
        position:  'absolute',
        bottom:    16,
        right:     16,
        width:     320,
        background: 'var(--surface)',
        borderRadius: 16,
        boxShadow: 'var(--shadow-md)',
        border:    '1px solid var(--border)',
        padding:   '16px',
        opacity:   visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(8px)',
        transition: 'opacity 200ms ease, transform 200ms ease',
        pointerEvents: visible ? 'auto' : 'none',
        zIndex:    10,
      }}
    >
      {/* Header row: avatar + name + type badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Avatar */}
        <div
          style={{
            width:        36,
            height:       36,
            borderRadius: '50%',
            background:   color,
            display:      'flex',
            alignItems:   'center',
            justifyContent: 'center',
            color:        '#fff',
            fontSize:     13,
            fontWeight:   600,
            flexShrink:   0,
            fontFamily:   'Inter, system-ui, sans-serif',
          }}
        >
          {initials || '?'}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize:     15,
              fontWeight:   600,
              color:        'var(--text)',
              fontFamily:   'Inter, system-ui, sans-serif',
              whiteSpace:   'nowrap',
              overflow:     'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {entity.canonicalName}
          </div>

          {/* Type badge */}
          <span
            style={{
              display:      'inline-block',
              marginTop:    3,
              padding:      '2px 8px',
              borderRadius: 99,
              background:   `${color}1A`,
              color,
              fontSize:     11,
              fontWeight:   500,
              fontFamily:   'Inter, system-ui, sans-serif',
            }}
          >
            {TYPE_LABEL[entity.type] ?? entity.type}
          </span>
        </div>
      </div>

      {/* Stats row */}
      {stats && (
        <div
          style={{
            marginTop:  12,
            display:    'flex',
            gap:        16,
            fontSize:   13,
            color:      'var(--text-secondary)',
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        >
          <span>
            <strong style={{ color: 'var(--text)', fontWeight: 600 }}>
              {stats.messageCount}
            </strong>{' '}
            messages
          </span>
          {stats.lastSeenAt && (
            <span>last {formatRelativeTime(stats.lastSeenAt)}</span>
          )}
        </div>
      )}

      {/* Open detail link */}
      <button
        onClick={() => navigate(`/entity/${entity.id}`)}
        style={{
          marginTop:   12,
          background:  'none',
          border:      'none',
          padding:     0,
          cursor:      'pointer',
          color:       'var(--accent)',
          fontSize:    13,
          fontWeight:  500,
          fontFamily:  'Inter, system-ui, sans-serif',
          display:     'flex',
          alignItems:  'center',
          gap:         4,
        }}
      >
        Open full page
        <span style={{ fontSize: 15, lineHeight: 1 }}>→</span>
      </button>
    </div>
  );
}
