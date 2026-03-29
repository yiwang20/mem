import { useNavigate } from 'react-router-dom';
import type { Entity } from '../lib/api.js';

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

interface PersonCardProps {
  entity: Entity;
}

export function PersonCard({ entity }: PersonCardProps) {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate(`/entity/${entity.id}`)}
      title={entity.canonicalName}
      style={{
        width: '120px',
        flexShrink: 0,
        background: 'var(--color-person-tint)',
        border: 'none',
        borderRadius: '16px',
        padding: '16px 8px 12px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
        scrollSnapAlign: 'start',
        textAlign: 'center',
        transition: 'box-shadow 0.15s, transform 0.15s',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.boxShadow = 'var(--shadow-sm)';
        (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.boxShadow = '';
        (e.currentTarget as HTMLButtonElement).style.transform = '';
      }}
    >
      {/* Avatar */}
      <div
        style={{
          width: '56px',
          height: '56px',
          borderRadius: '9999px',
          backgroundColor: 'var(--color-person)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          fontSize: '18px',
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {initials(entity.canonicalName)}
      </div>

      {/* Name */}
      <div
        style={{
          fontSize: '13px',
          fontWeight: 500,
          color: 'var(--text)',
          width: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {entity.canonicalName}
      </div>

      {/* Last seen */}
      <div
        style={{
          fontSize: '11px',
          color: 'var(--text-tertiary)',
          width: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {formatRelative(entity.lastSeenAt)}
      </div>
    </button>
  );
}

function formatRelative(ts: number): string {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
