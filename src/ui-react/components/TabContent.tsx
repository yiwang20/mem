import { useNavigate } from 'react-router-dom';
import type { Entity, GraphEdge, GraphNode } from '../lib/api.js';
import { ENTITY_COLORS } from './EntityHeader.js';

// ---------------------------------------------------------------------------
// Key Facts Tab
// ---------------------------------------------------------------------------

interface KeyFactsTabProps {
  keyFacts: Entity[];
}

export function KeyFactsTab({ keyFacts }: KeyFactsTabProps) {
  if (keyFacts.length === 0) {
    return (
      <div
        style={{
          textAlign: 'center',
          padding: '48px 24px',
          color: 'var(--text-tertiary)',
          fontSize: '14px',
        }}
      >
        No key facts extracted yet.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {keyFacts.map((fact) => (
        <div
          key={fact.id}
          style={{
            border: '1px solid var(--border)',
            borderRadius: '12px',
            padding: '14px 16px',
            background: 'var(--surface)',
          }}
        >
          <div
            style={{
              fontSize: '14px',
              fontWeight: 500,
              color: 'var(--text)',
              marginBottom: fact.nameAlt ? '4px' : 0,
            }}
          >
            {fact.canonicalName}
          </div>
          {fact.nameAlt && (
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              {fact.nameAlt}
            </div>
          )}
          {/* Render any key attributes */}
          {Object.entries(fact.attributes).length > 0 && (
            <div
              style={{
                marginTop: '8px',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '6px',
              }}
            >
              {Object.entries(fact.attributes)
                .filter(([, v]) => v !== null && v !== undefined && v !== '')
                .slice(0, 5)
                .map(([k, v]) => (
                  <span
                    key={k}
                    style={{
                      fontSize: '11px',
                      padding: '2px 7px',
                      borderRadius: '9999px',
                      background: ENTITY_COLORS.key_fact.tint,
                      color: ENTITY_COLORS.key_fact.color,
                      fontWeight: 600,
                    }}
                  >
                    {k}: {String(v)}
                  </span>
                ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Relationships Tab
// ---------------------------------------------------------------------------

const RELATIONSHIP_LABELS: Record<string, string> = {
  communicates_with: 'Communicates with',
  discusses:         'Discusses',
  member_of:         'Member of',
  continues_in:      'Continues in',
  references:        'References',
  created_by:        'Created by',
  relates_to:        'Relates to',
};

interface RelationshipsTabProps {
  entityId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function RelationshipsTab({ entityId, nodes, edges }: RelationshipsTabProps) {
  const navigate = useNavigate();
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const myEdges = edges.filter(
    (e) => e.source === entityId || e.target === entityId,
  );

  if (myEdges.length === 0) {
    return (
      <div
        style={{
          textAlign: 'center',
          padding: '48px 24px',
          color: 'var(--text-tertiary)',
          fontSize: '14px',
        }}
      >
        No relationships found.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {myEdges.map((edge) => {
        const otherId = edge.source === entityId ? edge.target : edge.source;
        const other = nodeMap.get(otherId);
        if (!other) return null;

        const type = (other.type as Entity['type']) || 'person';
        const { color, tint } = ENTITY_COLORS[type] ?? ENTITY_COLORS.person;
        const initial = other.label.charAt(0).toUpperCase();
        const label =
          RELATIONSHIP_LABELS[edge.type] ?? edge.type.replace(/_/g, ' ');

        return (
          <div
            key={edge.id}
            style={{
              border: '1px solid var(--border)',
              borderRadius: '12px',
              padding: '12px 14px',
              background: 'var(--surface)',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            {/* Relationship type label */}
            <div
              style={{
                fontSize: '11px',
                color: 'var(--text-tertiary)',
                textTransform: 'capitalize',
                minWidth: '120px',
                flexShrink: 0,
              }}
            >
              {label}
            </div>

            {/* Strength bar */}
            <div
              style={{
                width: '40px',
                height: '3px',
                borderRadius: '2px',
                background: 'var(--border)',
                flexShrink: 0,
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  height: '100%',
                  width: `${Math.round(edge.strength * 100)}%`,
                  background: color,
                  borderRadius: '2px',
                }}
              />
            </div>

            {/* Other entity */}
            <button
              onClick={() => navigate(`/entity/${other.id}`)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flex: 1,
                border: 'none',
                background: 'none',
                padding: 0,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '9999px',
                  background: color,
                  color: '#fff',
                  fontSize: '12px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {initial}
              </div>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text)' }}>
                  {other.label}
                </div>
                <span
                  style={{
                    fontSize: '11px',
                    padding: '1px 6px',
                    borderRadius: '9999px',
                    background: tint,
                    color,
                    fontWeight: 600,
                  }}
                >
                  {other.type.replace('_', ' ')}
                </span>
              </div>
            </button>
          </div>
        );
      })}
    </div>
  );
}
