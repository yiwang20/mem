import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';

// ---------------------------------------------------------------------------
// Inject org-chart connector CSS once
// ---------------------------------------------------------------------------

const ORG_CSS = `
/* ── Tree layout ── */
.mf-org {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 24px;
  overflow-x: auto;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  background: var(--bg-subtle);
}

.mf-org-level {
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* ── Connectors ── */

/* Vertical stem below a node that has children */
.mf-org-stem-down {
  width: 2px;
  height: 20px;
  background: var(--text-ghost);
  flex-shrink: 0;
}

/* Children row container */
.mf-org-children-row {
  display: flex;
  position: relative;
  padding-top: 20px;
  gap: 12px;
}

/* Horizontal crossbar above children — spans between first and last child centers */
.mf-org-children-row::before {
  content: '';
  position: absolute;
  top: 0;
  height: 2px;
  background: var(--text-ghost);
  /* From center of first child to center of last child */
  left: var(--bar-left, 50%);
  right: var(--bar-right, 50%);
}

/* Single child: no crossbar needed (just vertical stem) */
.mf-org-children-row.mf-single-child::before {
  display: none;
}

/* Each child column */
.mf-org-child {
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* Vertical stem above each child (connects to crossbar) */
.mf-org-child::before {
  content: '';
  display: block;
  width: 2px;
  height: 20px;
  background: var(--text-ghost);
  flex-shrink: 0;
}

/* ── Ancestor path (vertical) ── */
.mf-org-ancestor {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.mf-org-ancestor-stem {
  width: 2px;
  height: 16px;
  background: var(--text-ghost);
  opacity: 0.5;
  flex-shrink: 0;
}

/* ── Node cards ── */
.mf-org-card {
  border-radius: 10px;
  padding: 8px 18px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-xs);
  white-space: nowrap;
  cursor: pointer;
  transition: box-shadow 150ms, transform 150ms;
  text-align: center;
  min-width: 80px;
}
.mf-org-card:hover {
  box-shadow: var(--shadow-sm);
  transform: translateY(-1px);
}

/* Ancestor cards: smaller, muted */
.mf-org-card-ancestor {
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 400;
  color: var(--text-secondary);
  background: var(--bg);
  border: 1px dashed var(--border);
  box-shadow: none;
  opacity: 0.7;
}
.mf-org-card-ancestor:hover {
  opacity: 1;
  box-shadow: var(--shadow-xs);
}

/* Current node: highlighted */
.mf-org-card-current {
  border: 2px solid var(--color-topic);
  background: var(--color-topic-tint);
  font-weight: 600;
  font-size: 14px;
  padding: 10px 22px;
  box-shadow: var(--shadow-sm);
  cursor: default;
}
.mf-org-card-current:hover {
  transform: none;
  box-shadow: var(--shadow-sm);
}

/* Child cards */
.mf-org-card-child {
  padding: 7px 14px;
  font-size: 12px;
}
.mf-org-card-child .mf-org-msg-count {
  margin-left: 6px;
  font-size: 10px;
  color: var(--text-tertiary);
  font-weight: 400;
}
`;

let cssInjected = false;
function injectCss() {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement('style');
  style.textContent = ORG_CSS;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// MiniOrgChart
// ---------------------------------------------------------------------------

interface MiniOrgChartProps {
  entityId: string;
  entityLabel: string;
}

export function MiniOrgChart({ entityId, entityLabel }: MiniOrgChartProps) {
  useEffect(() => { injectCss(); }, []);

  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['topic-ancestors', entityId],
    queryFn:  () => api.getTopicAncestors(entityId),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="mf-org" style={{ minHeight: '80px' }}>
        <div style={{ width: '160px', height: '36px', borderRadius: '10px', background: 'var(--bg)', animation: 'shimmer 1.5s infinite' }} />
      </div>
    );
  }

  if (!data) return null;

  const { path, children } = data;
  const hasPath     = path.length > 0;
  const hasChildren = children.length > 0;

  if (!hasPath && !hasChildren) return null;

  // Crossbar should span from center of first child to center of last child.
  // With equal-width flex children, each child occupies 1/N of the row.
  // The center of the first child is at 50%/N from left, and symmetric for last.

  return (
    <div className="mf-org">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 'max-content' }}>

        {/* ── Ancestor chain (vertical) ── */}
        {hasPath && path.map((ancestor, i) => (
          <div key={ancestor.id} className="mf-org-ancestor">
            {i > 0 && <div className="mf-org-ancestor-stem" />}
            <button
              className="mf-org-card mf-org-card-ancestor"
              onClick={() => navigate(`/entity/${ancestor.id}`)}
            >
              {ancestor.label}
            </button>
          </div>
        ))}

        {/* Stem from last ancestor to current node */}
        {hasPath && <div className="mf-org-ancestor-stem" />}

        {/* ── Current node ── */}
        <div className="mf-org-level">
          <div className="mf-org-card mf-org-card-current">
            {entityLabel}
          </div>

          {/* Stem down to children */}
          {hasChildren && <div className="mf-org-stem-down" />}

          {/* ── Children row ── */}
          {hasChildren && (
            <div
              className={`mf-org-children-row${children.length === 1 ? ' mf-single-child' : ''}`}
              style={children.length > 1 ? {
                // Each child is a flex item. Crossbar spans from center of first to center of last.
                // With equal flex items and 12px gap, first child center ≈ half first child width,
                // last child center ≈ same from right. Use calc based on child count.
                '--bar-left': `calc(100% / ${children.length} / 2)`,
                '--bar-right': `calc(100% / ${children.length} / 2)`,
              } as React.CSSProperties : undefined}
            >
              {children.map((child) => (
                <div key={child.id} className="mf-org-child">
                  <button
                    className="mf-org-card mf-org-card-child"
                    onClick={() => navigate(`/entity/${child.id}`)}
                    title={`${child.status} · ${child.messageCount} messages`}
                  >
                    {child.label}
                    {child.messageCount > 0 && (
                      <span className="mf-org-msg-count">{child.messageCount}</span>
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
