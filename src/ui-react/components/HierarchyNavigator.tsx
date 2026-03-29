import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import type { TopicAncestorNode, TopicChildNode } from '../lib/api.js';

// ---------------------------------------------------------------------------
// Styles injected once
// ---------------------------------------------------------------------------

const CSS = `
.mf-hn-scroll {
  position: relative;
  overflow-x: auto;
  overflow-y: visible;
  background: var(--bg-subtle);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  padding: 16px 20px;
  scroll-behavior: smooth;
  scrollbar-width: none;
}
.mf-hn-scroll::-webkit-scrollbar { display: none; }

.mf-hn-scroll::before,
.mf-hn-scroll::after {
  content: '';
  position: absolute;
  top: 0; bottom: 0;
  width: 24px;
  pointer-events: none;
  z-index: 3;
  transition: opacity 150ms;
}
.mf-hn-scroll::before {
  left: 0;
  background: linear-gradient(to right, var(--bg-subtle), transparent);
  opacity: var(--fade-left, 0);
}
.mf-hn-scroll::after {
  right: 0;
  background: linear-gradient(to left, var(--bg-subtle), transparent);
  opacity: var(--fade-right, 0);
}

.mf-hn-container {
  display: flex;
  align-items: center;
  position: relative;
  width: max-content;
}

.mf-hn-svg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  overflow: visible;
}

.mf-hn-ancestor {
  height: 28px;
  padding: 0 12px;
  border-radius: 9999px;
  background: transparent;
  border: 1px dashed var(--border-strong);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  position: relative;
  z-index: 2;
}
.mf-hn-ancestor:hover {
  background: var(--color-topic-tint);
  border: 1px solid rgba(107,158,138,0.4);
  color: var(--text);
  transform: translateY(-1px);
  box-shadow: var(--shadow-xs);
}
.mf-hn-ancestor:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.mf-hn-ellipsis {
  height: 28px;
  padding: 0 8px;
  border-radius: 9999px;
  background: transparent;
  border: 1px dashed var(--text-ghost);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-ghost);
  cursor: default;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  position: relative;
  z-index: 2;
}

.mf-hn-gap { flex-shrink: 0; }

.mf-hn-current {
  padding: 12px 20px;
  border-radius: 14px;
  background: var(--color-topic-tint);
  border: 2px solid var(--color-topic);
  min-width: 180px;
  max-width: 280px;
  cursor: default;
  box-shadow: var(--shadow-sm);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  position: relative;
  z-index: 2;
}
.mf-hn-current-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 6px;
}
.mf-hn-current-alt {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 1px;
}
.mf-hn-current-stats {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mf-hn-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--color-topic);
  flex-shrink: 0;
}
.mf-hn-status {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  flex-shrink: 0;
}
.mf-hn-status-active  { color: var(--color-topic); }
.mf-hn-status-dormant { color: var(--text-ghost); }

.mf-hn-children {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  flex-shrink: 0;
  position: relative;
  z-index: 2;
  overflow: hidden;
  transition: max-height 250ms cubic-bezier(0.16, 1, 0.3, 1);
}
.mf-hn-children.expanded {
  max-height: 200px;
  overflow-y: auto;
  scrollbar-width: none;
}
.mf-hn-children.expanded::-webkit-scrollbar { display: none; }

.mf-hn-child {
  height: 26px;
  padding: 0 10px;
  border-radius: 9999px;
  background: var(--surface);
  border: 1px solid var(--border);
  font-size: 12px;
  font-weight: 400;
  color: var(--text-secondary);
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
  flex-shrink: 0;
  display: flex;
  align-items: center;
}
.mf-hn-child:hover {
  background: var(--color-topic-tint);
  border: 1px solid rgba(107,158,138,0.5);
  color: var(--text);
  box-shadow: var(--shadow-xs);
  transform: translateX(2px);
}
.mf-hn-child:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.mf-hn-child-count {
  margin-left: 6px;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-tertiary);
}

.mf-hn-more {
  height: 26px;
  padding: 0 10px;
  border-radius: 9999px;
  background: transparent;
  border: 1px dashed var(--border-strong);
  font-size: 11px;
  font-weight: 500;
  color: var(--text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: background 120ms ease, color 120ms ease;
}
.mf-hn-more:hover {
  background: var(--bg-subtle);
  color: var(--text-secondary);
}

@keyframes mf-hn-draw {
  to { stroke-dashoffset: 0; }
}
@keyframes mf-hn-tooltip-in {
  from { opacity: 0; transform: translateX(-50%) translateY(4px); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .mf-hn-ancestor, .mf-hn-child, .mf-hn-more, .mf-hn-children { transition: none; }
}
`;

let cssInjected = false;
function injectCss() {
  if (cssInjected) return;
  cssInjected = true;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}

// ---------------------------------------------------------------------------
// SVG drawing — imperative, no React state
// ---------------------------------------------------------------------------

function getRelRect(el: Element, container: Element) {
  const er = el.getBoundingClientRect();
  const cr = container.getBoundingClientRect();
  return {
    left:  er.left  - cr.left,
    right: er.right - cr.left,
    midY:  er.top + er.height / 2 - cr.top,
  };
}

function bezierH(x1: number, y1: number, x2: number, y2: number, cp = 20): string {
  return `M ${x1},${y1} C ${x1 + cp},${y1} ${x2 - cp},${y2} ${x2},${y2}`;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

interface PathSpec {
  id: string;
  d: string;
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  opacity: number;
  animate: boolean;
}

function drawPaths(svg: SVGSVGElement, container: HTMLElement, specs: PathSpec[]) {
  // Size SVG to container scroll width
  svg.setAttribute('width',  String(container.scrollWidth));
  svg.setAttribute('height', String(container.offsetHeight));

  // Reconcile: remove paths not in specs
  const existingIds = new Set(specs.map((s) => s.id));
  for (const el of Array.from(svg.querySelectorAll('path'))) {
    if (!existingIds.has(el.getAttribute('data-id') ?? '')) el.remove();
  }

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  for (const spec of specs) {
    let el = svg.querySelector<SVGPathElement>(`path[data-id="${spec.id}"]`);
    const isNew = !el;
    if (!el) {
      el = document.createElementNS(SVG_NS, 'path') as SVGPathElement;
      el.setAttribute('data-id', spec.id);
      el.setAttribute('stroke-linecap', 'round');
      el.setAttribute('fill', 'none');
      svg.appendChild(el);
    }
    el.setAttribute('d', spec.d);
    el.setAttribute('stroke', spec.stroke);
    el.setAttribute('stroke-width', String(spec.strokeWidth));
    el.setAttribute('opacity', String(spec.opacity));
    if (spec.strokeDasharray) {
      el.setAttribute('stroke-dasharray', spec.strokeDasharray);
    } else {
      el.removeAttribute('stroke-dasharray');
    }

    // Animate new connector paths
    if (isNew && spec.animate && !reduced && !spec.strokeDasharray) {
      requestAnimationFrame(() => {
        if (!el) return;
        const len = (el as SVGPathElement).getTotalLength();
        el.style.strokeDasharray  = String(len);
        el.style.strokeDashoffset = String(len);
        el.style.animation = `mf-hn-draw 400ms ease-out forwards`;
      });
    }
  }
}

function buildPathSpecs(container: HTMLElement): PathSpec[] {
  const specs: PathSpec[] = [];

  const ellipsisEl = container.querySelector<HTMLElement>('.mf-hn-ellipsis');
  const currentEl  = container.querySelector<HTMLElement>('.mf-hn-current');
  const ancestorEls = Array.from(container.querySelectorAll<HTMLElement>('[data-anc-id]'));
  const childEls    = Array.from(container.querySelectorAll<HTMLElement>('[data-child-id]'));
  const moreEl      = container.querySelector<HTMLElement>('.mf-hn-more');

  // Build ordered list: [ellipsis?, ...ancestors]
  const chain: Array<{ id: string; el: HTMLElement }> = [];
  if (ellipsisEl) chain.push({ id: '__ellipsis__', el: ellipsisEl });
  for (const el of ancestorEls) {
    chain.push({ id: el.getAttribute('data-anc-id') ?? '', el });
  }

  // Ancestor-to-ancestor
  for (let i = 0; i < chain.length - 1; i++) {
    const from = chain[i];
    const to   = chain[i + 1];
    const fr = getRelRect(from.el, container);
    const tr = getRelRect(to.el,   container);
    const isEllConn = from.id === '__ellipsis__';
    specs.push({
      id: `anc-${from.id}-${to.id}`,
      d:  bezierH(fr.right, fr.midY, tr.left, tr.midY, 16),
      stroke: 'var(--text-ghost)',
      strokeWidth: isEllConn ? 1 : 1.5,
      strokeDasharray: isEllConn ? '4 4' : undefined,
      opacity: isEllConn ? 0.5 : 0.7,
      animate: !isEllConn,
    });
  }

  // Last ancestor → current
  if (chain.length > 0 && currentEl) {
    const from = chain[chain.length - 1];
    const fr = getRelRect(from.el, container);
    const cr = getRelRect(currentEl, container);
    specs.push({
      id: 'anc-to-current',
      d:  bezierH(fr.right, fr.midY, cr.left, cr.midY, 20),
      stroke: 'var(--color-topic)',
      strokeWidth: 2,
      opacity: 0.4,
      animate: true,
    });
  }

  // Current → children
  if (currentEl) {
    const cr = getRelRect(currentEl, container);
    for (const el of childEls) {
      const childId = el.getAttribute('data-child-id') ?? '';
      const tr = getRelRect(el, container);
      specs.push({
        id: `cur-${childId}`,
        d:  bezierH(cr.right, cr.midY, tr.left, tr.midY, 24),
        stroke: 'var(--color-topic)',
        strokeWidth: 1.5,
        opacity: 0.3,
        animate: true,
      });
    }
    // Current → +N more
    if (moreEl) {
      const tr = getRelRect(moreEl, container);
      specs.push({
        id: 'cur-more',
        d:  bezierH(cr.right, cr.midY, tr.left, tr.midY, 24),
        stroke: 'var(--color-topic)',
        strokeWidth: 1.5,
        opacity: 0.2,
        animate: false,
      });
    }
  }

  return specs;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ANCESTORS = 3;
const MAX_CHILDREN  = 4;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface Props {
  entityId: string;
  entityLabel: string;
  entityLabelAlt?: string | null;
  entityStatus?: string;
  messageCount?: number;
  lastSeenAgo?: string;
  topicCount?: number;
  pendingCount?: number;
}

export function HierarchyNavigator({
  entityId,
  entityLabel,
  entityLabelAlt,
  entityStatus = 'active',
  messageCount,
  lastSeenAgo,
  topicCount,
  pendingCount,
}: Props) {
  useEffect(() => { injectCss(); }, []);

  const navigate  = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef       = useRef<SVGSVGElement>(null);

  const [expanded, setExpanded] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['topic-ancestors', entityId],
    queryFn:  () => api.getTopicAncestors(entityId),
    staleTime: 60_000,
  });

  // Derived
  const rawAncestors = (data?.path ?? []).filter((a) => a.id !== entityId);
  const children     = data?.children ?? [];
  const showEllipsis = rawAncestors.length > MAX_ANCESTORS;
  const visibleAncestors = showEllipsis ? rawAncestors.slice(-MAX_ANCESTORS) : rawAncestors;
  const hiddenAncestorPath = showEllipsis
    ? rawAncestors.slice(0, rawAncestors.length - MAX_ANCESTORS).map((a) => a.label).join(' > ')
    : '';
  const visibleChildren  = expanded ? children : children.slice(0, MAX_CHILDREN);
  const hiddenChildCount = children.length - MAX_CHILDREN;
  const showMore = !expanded && hiddenChildCount > 0;
  const showLess = expanded  && hiddenChildCount > 0;
  const hasPath     = rawAncestors.length > 0;
  const hasChildren = children.length > 0;

  // Imperatively redraw connectors after DOM settles
  useLayoutEffect(() => {
    const container = containerRef.current;
    const svg       = svgRef.current;
    if (!container || !svg || !data) return;

    const specs = buildPathSpecs(container);
    drawPaths(svg, container, specs);
  });

  // ResizeObserver — redraws imperatively, no state change
  useEffect(() => {
    const container = containerRef.current;
    const svg       = svgRef.current;
    if (!container || !svg) return;

    const ro = new ResizeObserver(() => {
      const specs = buildPathSpecs(container);
      drawPaths(svg, container, specs);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Auto-scroll current node to center
  useEffect(() => {
    if (!data) return;
    const currentEl = containerRef.current?.querySelector<HTMLElement>('.mf-hn-current');
    currentEl?.scrollIntoView({ inline: 'center', behavior: 'smooth' });
  }, [data]);

  // Fade edge masks
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function update() {
      if (!el) return;
      el.style.setProperty('--fade-left',  el.scrollLeft <= 4 ? '0' : '1');
      el.style.setProperty('--fade-right', el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 ? '0' : '1');
    }
    update();
    el.addEventListener('scroll', update, { passive: true });
    return () => el.removeEventListener('scroll', update);
  }, [data]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="mf-hn-scroll" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: '240px', height: '80px', borderRadius: '14px', background: 'var(--bg)', opacity: 0.5 }} />
      </div>
    );
  }

  // Always render if we have entity data — the current node card is the topic header
  if (!data) return null;

  return (
    <div className="mf-hn-scroll" ref={scrollRef}>
      <div className="mf-hn-container" ref={containerRef}>
        {/* SVG overlay — drawn imperatively */}
        <svg ref={svgRef} className="mf-hn-svg" aria-hidden="true" />

        {/* Ellipsis pill */}
        {showEllipsis && (
          <>
            <div className="mf-hn-ellipsis" title={hiddenAncestorPath}>...</div>
            <div className="mf-hn-gap" style={{ width: 32 }} />
          </>
        )}

        {/* Ancestor pills */}
        {visibleAncestors.map((anc, i) => (
          <AncestorPill
            key={anc.id}
            ancestor={anc}
            isLast={i === visibleAncestors.length - 1}
            onNavigate={() => navigate(`/entity/${anc.id}`)}
          />
        ))}

        {/* Gap before current */}
        {hasPath && <div className="mf-hn-gap" style={{ width: 40 }} />}

        {/* Current node — rich card */}
        <div className="mf-hn-current">
          <div className="mf-hn-current-name">
            <div className="mf-hn-dot" aria-hidden="true" />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
              {entityLabel}
            </span>
            {entityStatus === 'active' && (
              <span className="mf-hn-status mf-hn-status-active">Active 活跃</span>
            )}
            {entityStatus === 'dormant' && (
              <span className="mf-hn-status mf-hn-status-dormant">Dormant 休眠</span>
            )}
          </div>
          {entityLabelAlt && (
            <div className="mf-hn-current-alt">{entityLabelAlt}</div>
          )}
          {(messageCount !== undefined || lastSeenAgo || topicCount !== undefined || pendingCount !== undefined) && (
            <div className="mf-hn-current-stats">
              {[
                messageCount !== undefined ? `${messageCount} messages` : null,
                lastSeenAgo ? lastSeenAgo : null,
                topicCount ? `${topicCount} topics` : null,
                pendingCount ? `${pendingCount} pending` : null,
              ].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>

        {/* Gap before children */}
        {hasChildren && <div className="mf-hn-gap" style={{ width: 48 }} />}

        {/* Children column */}
        {hasChildren && (
          <div className={`mf-hn-children${expanded ? ' expanded' : ''}`}>
            {visibleChildren.map((child) => (
              <ChildPill
                key={child.id}
                child={child}
                onNavigate={() => navigate(`/entity/${child.id}`)}
              />
            ))}
            {showMore && (
              <button className="mf-hn-more" onClick={() => setExpanded(true)}>
                +{hiddenChildCount} more 更多
              </button>
            )}
            {showLess && (
              <button className="mf-hn-more" onClick={() => setExpanded(false)}>
                Show less 收起
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components — use data-* attrs so buildPathSpecs can find them
// ---------------------------------------------------------------------------

function AncestorPill({
  ancestor,
  isLast,
  onNavigate,
}: {
  ancestor: TopicAncestorNode;
  isLast: boolean;
  onNavigate: () => void;
}) {
  const [tooltip, setTooltip] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
    <>
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <button
          className="mf-hn-ancestor"
          data-anc-id={ancestor.id}
          onClick={onNavigate}
          onMouseEnter={() => { timer.current = setTimeout(() => setTooltip(true), 500); }}
          onMouseLeave={() => { if (timer.current) clearTimeout(timer.current); setTooltip(false); }}
        >
          {ancestor.label}
        </button>
        {tooltip && <Tooltip label={ancestor.label} detail="Topic" />}
      </div>
      {!isLast && <div className="mf-hn-gap" style={{ width: 40 }} />}
    </>
  );
}

function ChildPill({
  child,
  onNavigate,
}: {
  child: TopicChildNode;
  onNavigate: () => void;
}) {
  const [tooltip, setTooltip] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        className="mf-hn-child"
        data-child-id={child.id}
        onClick={onNavigate}
        onMouseEnter={() => { timer.current = setTimeout(() => setTooltip(true), 500); }}
        onMouseLeave={() => { if (timer.current) clearTimeout(timer.current); setTooltip(false); }}
      >
        {child.label}
        {child.messageCount > 0 && (
          <span className="mf-hn-child-count">{child.messageCount}</span>
        )}
      </button>
      {tooltip && (
        <Tooltip label={child.label} detail={`${child.status} · ${child.messageCount} messages`} />
      )}
    </div>
  );
}

function Tooltip({ label, detail }: { label: string; detail: string }) {
  return (
    <div style={{
      position: 'absolute',
      bottom: 'calc(100% + 8px)',
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'var(--surface-raised, var(--surface))',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      padding: '8px 12px',
      boxShadow: 'var(--shadow-sm)',
      maxWidth: '220px',
      zIndex: 70,
      pointerEvents: 'none',
      animation: 'mf-hn-tooltip-in 120ms ease-out',
    }}>
      <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '196px' }}>
        {label}
      </div>
      <div style={{ fontSize: '11px', fontWeight: 400, color: 'var(--text-tertiary)', marginTop: '2px', whiteSpace: 'nowrap' }}>
        {detail}
      </div>
    </div>
  );
}
