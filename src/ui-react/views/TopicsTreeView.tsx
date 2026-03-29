import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import type { TopicTreeNode } from '../lib/api.js';

// ---------------------------------------------------------------------------
// TopicListCard — one card per top-level topic
// ---------------------------------------------------------------------------

interface TopicListCardProps {
  node: TopicTreeNode;
}

function TopicListCard({ node }: TopicListCardProps) {
  const navigate = useNavigate();
  const isActive = node.status === 'active';
  const subCount = node.children.length;

  return (
    <button
      onClick={() => navigate(`/entity/${node.id}`)}
      style={{
        background: 'var(--color-topic-tint)',
        border: '1px solid var(--border)',
        borderRadius: '16px',
        padding: '16px 20px',
        cursor: 'pointer',
        textAlign: 'left',
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        boxShadow: 'var(--shadow-xs)',
        transition: 'box-shadow 150ms, transform 150ms',
        width: '100%',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.boxShadow = 'var(--shadow-sm)';
        (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.boxShadow = 'var(--shadow-xs)';
        (e.currentTarget as HTMLButtonElement).style.transform = '';
      }}
    >
      {/* Status dot */}
      <div
        style={{
          width: '10px',
          height: '10px',
          borderRadius: '9999px',
          backgroundColor: isActive ? 'var(--color-topic)' : 'var(--text-ghost)',
          flexShrink: 0,
        }}
      />

      {/* Name + alt */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: '15px',
            fontWeight: 500,
            color: 'var(--text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {node.label}
          {node.labelAlt && (
            <span style={{ marginLeft: '8px', fontSize: '13px', color: 'var(--text-tertiary)', fontWeight: 400 }}>
              {node.labelAlt}
            </span>
          )}
        </div>
        {node.messageCount > 0 && (
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '3px' }}>
            {node.messageCount} {node.messageCount === 1 ? 'message' : 'messages'}
          </div>
        )}
      </div>

      {/* Status badge */}
      <span
        style={{
          fontSize: '10px',
          fontWeight: 700,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: isActive ? 'var(--color-topic)' : 'var(--text-tertiary)',
          background: isActive ? 'var(--color-topic-tint)' : 'var(--bg-subtle)',
          border: `1px solid ${isActive ? 'var(--color-topic)' : 'var(--border)'}`,
          borderRadius: '9999px',
          padding: '2px 8px',
          flexShrink: 0,
        }}
      >
        {isActive ? 'Active' : 'Dormant'}
      </span>

      {/* Sub-topics badge */}
      {subCount > 0 && (
        <span
          style={{
            fontSize: '11px',
            fontWeight: 500,
            color: 'var(--text-tertiary)',
            background: 'var(--bg-subtle)',
            border: '1px solid var(--border)',
            borderRadius: '9999px',
            padding: '2px 8px',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          {subCount} sub-topic{subCount !== 1 ? 's' : ''}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// TopicsTreeView — flat list of root topics
// ---------------------------------------------------------------------------

export function TopicsTreeView() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['topics-tree'],
    queryFn:  () => api.getTopicTree(),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} style={{ height: '64px', borderRadius: '16px', background: 'var(--bg-subtle)' }} />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '14px' }}>
        Failed to load topics.
      </div>
    );
  }

  if (data.roots.length === 0) {
    return (
      <div style={{ padding: '64px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: '14px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>
          No topics yet. 还没有话题。
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-ghost)' }}>
          Topics are extracted automatically from your conversations.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 24px 32px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {data.roots.map((node: TopicTreeNode) => (
        <TopicListCard key={node.id} node={node} />
      ))}
    </div>
  );
}
