import { useNavigate } from 'react-router-dom';
import type { Entity, GraphEdge, GraphNode, AttentionItem } from '../lib/api.js';
import { ENTITY_COLORS } from './EntityHeader.js';

// ---------------------------------------------------------------------------
// Section label
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: '10px',
        fontWeight: 700,
        letterSpacing: '0.06em',
        color: 'var(--text-tertiary)',
        textTransform: 'uppercase',
        marginBottom: '10px',
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Related entity row
// ---------------------------------------------------------------------------

function RelatedEntityRow({ node, onClick }: { node: GraphNode; onClick: () => void }) {
  const type = (node.type as Entity['type']) || 'person';
  const { color } = ENTITY_COLORS[type] ?? ENTITY_COLORS.person;
  const initial = node.label.charAt(0).toUpperCase();

  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        border: 'none',
        background: 'none',
        padding: '5px 0',
        cursor: 'pointer',
        textAlign: 'left',
      }}
      onMouseOver={(e) => (e.currentTarget.style.background = 'none')}
    >
      {/* Mini avatar */}
      <div
        style={{
          width: '24px',
          height: '24px',
          borderRadius: '9999px',
          background: color,
          color: '#fff',
          fontSize: '11px',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {initial}
      </div>
      <span
        style={{
          fontSize: '13px',
          color: 'var(--text)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}
      >
        {node.label}
      </span>
      <span
        style={{
          fontSize: '11px',
          color: 'var(--text-tertiary)',
          flexShrink: 0,
          textTransform: 'capitalize',
        }}
      >
        {node.type.replace('_', ' ')}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Pending item row
// ---------------------------------------------------------------------------

const URGENCY_COLORS = {
  high:   { dot: '#C47A7A' },
  medium: { dot: '#C4A86B' },
  low:    { dot: '#6B9E8A' },
};

function PendingRow({ item }: { item: AttentionItem }) {
  const urgency = item.urgencyScore >= 0.8 ? 'high' : item.urgencyScore >= 0.5 ? 'medium' : 'low';
  const { dot } = URGENCY_COLORS[urgency];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
        padding: '4px 0',
      }}
    >
      <div
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '9999px',
          background: dot,
          marginTop: '5px',
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
        {item.title}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edge label
// ---------------------------------------------------------------------------

const EDGE_LABELS: Record<string, string> = {
  communicates_with: 'communicates with',
  discusses:         'discusses',
  member_of:         'member of',
  continues_in:      'continues in',
  references:        'references',
  created_by:        'created by',
};

// ---------------------------------------------------------------------------
// ContextPanel
// ---------------------------------------------------------------------------

interface ContextPanelProps {
  entityId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  pendingItems: AttentionItem[];
  keyFacts: Entity[];
}

export function ContextPanel({
  entityId,
  nodes,
  edges,
  pendingItems,
  keyFacts,
}: ContextPanelProps) {
  const navigate = useNavigate();

  // Separate related nodes by type
  const relatedNodes = nodes.filter((n) => n.id !== entityId);
  const people = relatedNodes.filter((n) => n.type === 'person');
  const topics = relatedNodes.filter((n) => n.type === 'topic');

  // Build relationship labels
  const relLabels = new Map<string, string>();
  for (const edge of edges) {
    const otherId = edge.source === entityId ? edge.target : edge.source;
    const label = EDGE_LABELS[edge.type] ?? edge.type.replace(/_/g, ' ');
    relLabels.set(otherId, label);
  }

  return (
    <aside
      style={{
        background: 'var(--bg-subtle)',
        borderLeft: '1px solid var(--border)',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
        overflowY: 'auto',
        height: '100%',
      }}
    >
      {/* Related People */}
      {people.length > 0 && (
        <section>
          <SectionLabel>Related People</SectionLabel>
          {people.slice(0, 8).map((node) => (
            <RelatedEntityRow
              key={node.id}
              node={node}
              onClick={() => navigate(`/entity/${node.id}`)}
            />
          ))}
        </section>
      )}

      {/* Connected Topics */}
      {topics.length > 0 && (
        <section>
          <SectionLabel>Connected Topics</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {topics.slice(0, 10).map((node) => (
              <button
                key={node.id}
                onClick={() => navigate(`/entity/${node.id}`)}
                style={{
                  padding: '3px 10px',
                  borderRadius: '9999px',
                  background: ENTITY_COLORS.topic.tint,
                  color: ENTITY_COLORS.topic.color,
                  border: 'none',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {node.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Pending items */}
      {pendingItems.length > 0 && (
        <section>
          <SectionLabel>Pending ({pendingItems.length})</SectionLabel>
          {pendingItems.slice(0, 6).map((item) => (
            <PendingRow key={item.id} item={item} />
          ))}
        </section>
      )}

      {/* Key facts */}
      {keyFacts.length > 0 && (
        <section>
          <SectionLabel>Key Facts</SectionLabel>
          <ul style={{ margin: 0, padding: '0 0 0 16px' }}>
            {keyFacts.slice(0, 8).map((fact) => (
              <li
                key={fact.id}
                style={{
                  fontSize: '13px',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.5,
                  marginBottom: '4px',
                }}
              >
                {fact.canonicalName}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* AI query input (stub — functionality in later task) */}
      <section style={{ marginTop: 'auto' }}>
        <input
          type="text"
          readOnly
          placeholder="Ask about this entity…"
          style={{
            width: '100%',
            height: '36px',
            padding: '0 12px',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            background: 'var(--surface)',
            color: 'var(--text-tertiary)',
            fontSize: '13px',
            boxSizing: 'border-box',
            cursor: 'text',
          }}
        />
      </section>
    </aside>
  );
}
