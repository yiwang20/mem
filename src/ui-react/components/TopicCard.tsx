import { useNavigate } from 'react-router-dom';
import type { Entity } from '../lib/api.js';

// Arrow icon for top-right corner
function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17L17 7" />
      <path d="M7 7h10v10" />
    </svg>
  );
}

function formatRelative(ts: number): string {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface TopicCardProps {
  entity: Entity;
}

export function TopicCard({ entity }: TopicCardProps) {
  const navigate = useNavigate();
  const status = entity.status;

  return (
    <button
      onClick={() => navigate(`/entity/${entity.id}`)}
      style={{
        backgroundColor: 'var(--color-topic-tint)',
        borderRadius: '20px',
        padding: '20px',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        boxShadow: 'var(--shadow-card)',
        position: 'relative',
        transition: 'box-shadow 0.15s, transform 0.15s',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.boxShadow = 'var(--shadow-sm)';
        (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.boxShadow = 'var(--shadow-card)';
        (e.currentTarget as HTMLButtonElement).style.transform = '';
      }}
    >
      {/* Arrow icon top-right */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          right: '16px',
          color: 'var(--text-secondary)',
        }}
      >
        <ArrowIcon />
      </div>

      {/* Topic name */}
      <div
        style={{
          fontSize: '18px',
          fontWeight: 500,
          color: 'var(--text)',
          lineHeight: 1.4,
          paddingRight: '24px',
        }}
      >
        {entity.canonicalName}
      </div>

      {/* Status badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span
          style={{
            fontSize: '10px',
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: status === 'active' ? 'var(--color-topic)' : 'var(--text-tertiary)',
            backgroundColor: status === 'active' ? 'var(--color-topic-tint)' : 'var(--bg-subtle)',
            borderRadius: '9999px',
            padding: '2px 8px',
            border: `1px solid ${status === 'active' ? 'var(--color-topic)' : 'var(--border)'}`,
          }}
        >
          {status}
        </span>
      </div>

      {/* Stats: people + messages */}
      {(() => {
        const peopleCount = typeof entity.attributes.peopleCount === 'number' ? entity.attributes.peopleCount : null;
        const messageCount = typeof entity.attributes.messageCount === 'number' ? entity.attributes.messageCount : null;
        if (peopleCount !== null || messageCount !== null) {
          return (
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', display: 'flex', gap: '8px' }}>
              {peopleCount !== null && <span>{peopleCount} {peopleCount === 1 ? 'person' : 'people'}</span>}
              {messageCount !== null && <span>{messageCount} {messageCount === 1 ? 'message' : 'messages'}</span>}
            </div>
          );
        }
        return null;
      })()}

      {/* Last activity */}
      <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
        Last: {formatRelative(entity.lastSeenAt)}
      </div>
    </button>
  );
}
