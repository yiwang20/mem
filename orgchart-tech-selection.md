# Org Chart Component — Tech Selection Report

**Date**: 2026-03-29
**Context**: MindFlow Topic detail page — horizontal (left-to-right) org chart showing topic hierarchy

---

## 1. Current Implementation Analysis

The existing `MiniOrgChart.tsx` uses a **pure CSS approach** with `::before`/`::after` pseudo-elements for connectors. It has a **vertical** layout (top-to-bottom), not the required horizontal layout.

**Current problems:**
- Crossbar positioning uses `calc(100% / N / 2)` which doesn't account for variable child widths or flex gap — connectors misalign when children have different label lengths
- No expand/collapse support
- Vertical layout only — requirement is horizontal (left-to-right)
- CSS injected via JS string rather than proper stylesheet
- No responsive handling beyond `overflow-x: auto`

---

## 2. Options Evaluated

### Option A: React Org Chart Libraries

| Library | npm weekly | Last publish | Horizontal | Customizable nodes | Bundle size | Notes |
|---------|-----------|--------------|------------|-------------------|-------------|-------|
| `react-organizational-chart` | ~15k | 2023 | No (vertical only) | Yes (render prop) | ~3 KB | **Disqualified** — no horizontal layout |
| `react-org-tree` | ~1k | 2021 | Yes | Limited | ~8 KB | Unmaintained, no React 18/19 support |
| `@balkangraph/orgchart.js` | ~3k | Active | Yes | Yes | ~300 KB | Commercial license, canvas-based (disqualified — requirement is HTML/CSS) |

**Verdict**: No existing React library satisfies all constraints (horizontal layout, HTML/CSS rendering, React 19 compatible, actively maintained, customizable node rendering). The ecosystem for this niche is thin.

### Option B: Pure CSS Connectors (Improved)

Classic approach: use `border` + `::before`/`::after` pseudo-elements on a nested `<ul>/<li>` tree structure rotated for horizontal layout.

**Horizontal CSS pattern:**
```css
.tree { display: flex; flex-direction: row; }
.tree li { display: flex; flex-direction: column; align-items: center; }
/* Connectors via border-top/border-left on ::before */
```

**Pros:**
- Zero dependencies
- Full design-token integration (uses CSS vars directly)
- Small footprint, fast rendering
- Accessible (semantic HTML)

**Cons:**
- Connector alignment is fragile with variable-width nodes — the root cause of the current bugs
- Horizontal layout with CSS-only connectors requires careful math for the horizontal crossbar spanning between first and last child centers
- Expand/collapse requires additional JS state but is straightforward
- Hard to get pixel-perfect connectors when node sizes vary — pseudo-elements are positioned relative to the element box, not the rendered center

**The fundamental problem**: CSS pseudo-elements position relative to their parent element's box model. When children have different widths, calculating the crossbar span from "center of first child to center of last child" cannot be done in pure CSS without knowing the actual rendered widths. This is exactly the bug in the current implementation.

### Option C: SVG Connectors + HTML Nodes (Hybrid)

Render nodes as regular HTML/React components. Draw connectors as SVG `<path>` elements in an absolutely-positioned SVG overlay. Use `useRef` + `getBoundingClientRect()` (or `ResizeObserver`) to compute actual node positions, then draw paths between them.

**Architecture:**
```
<div style="position: relative">
  <svg style="position: absolute; inset: 0; pointer-events: none">
    <path d="M x1,y1 C cx1,cy1 cx2,cy2 x2,y2" />  <!-- bezier curves -->
  </svg>
  <div class="nodes-container" style="display: flex; flex-direction: row">
    <!-- HTML node cards, laid out with flexbox -->
  </div>
</div>
```

**Pros:**
- **Connectors are always pixel-perfect** — computed from actual DOM positions, not CSS approximations
- Nodes are standard HTML — full design-system integration, accessible, interactive
- Bezier curves look polished and match the "organic/warm" aesthetic better than right-angle borders
- Trivial to add animations (SVG path transitions)
- Horizontal layout is just `flex-direction: row` on the node container
- Expand/collapse: animate path opacity/length, show/hide child nodes
- No external dependencies

**Cons:**
- Requires a `useLayoutEffect` + `ResizeObserver` to measure node positions and redraw paths on resize
- Slightly more code than pure CSS (~50-80 lines for the connector logic)
- SVG overlay needs `pointer-events: none` so HTML nodes remain interactive

---

## 3. Recommendation: Option C — SVG Connectors + HTML Nodes

**This is the clear winner for MindFlow's requirements.** Here's why:

### Why not CSS (Option B)?
The current implementation already demonstrates the core failure mode: CSS connectors break when node widths vary. Switching to horizontal layout makes this worse, not better. The crossbar-span problem is fundamentally unsolvable in pure CSS without fixed-width nodes, which conflicts with variable-length topic labels.

### Why not a library (Option A)?
No library meets all constraints. The closest candidates are either unmaintained, vertical-only, canvas-based, or commercially licensed. Adding a dependency for something this specialized creates maintenance risk with no real benefit.

### Why SVG hybrid works
1. **Correctness by construction**: Connectors are drawn from measured DOM positions. Variable-width nodes, dynamic content, responsive layouts — all handled automatically.
2. **Design coherence**: Bezier curves feel organic and warm, matching MindFlow's aesthetic. Right-angle CSS borders feel more like a corporate org chart tool.
3. **Zero dependencies**: ~80 lines of custom code, fully under our control.
4. **Expand/collapse**: Toggle child visibility + animate SVG paths. Clean and simple.
5. **Responsive**: Container uses `overflow-x: auto`. SVG redraws on resize via `ResizeObserver`.

---

## 4. Implementation Outline

### Data Flow
```
TopicDetailPage
  └─ useQuery(['topic-hierarchy', entityId])  // fetches { path: Ancestor[], children: Child[] }
      └─ <HorizontalOrgChart path={...} current={...} children={...} />
           ├─ <svg> connector paths (absolutely positioned overlay)
           ├─ Ancestor nodes (flex row, left to right)
           ├─ Current node (highlighted)
           └─ Children column (flex column, vertically stacked to the right of current)
```

### Layout Structure (left-to-right)
```
[Grandparent] ──── [Parent] ──── [CURRENT] ──┬── [Child 1]
                                              ├── [Child 2]
                                              └── [Child 3]
```

- Ancestors: horizontal chain flowing left-to-right
- Current node: emphasized (topic-tint background, thicker border)
- Children: vertical stack to the right of current node
- Connectors: SVG bezier curves between node centers

### Key Implementation Details

1. **Node refs**: Each node gets a `ref`. Store refs in a `Map<string, HTMLElement>`.

2. **Path computation** (in `useLayoutEffect`):
   ```ts
   function computePaths(nodeRefs: Map<string, HTMLElement>, containerRef: HTMLElement): string[] {
     // For each parent-child edge:
     const parentRect = nodeRefs.get(parentId)!.getBoundingClientRect();
     const childRect = nodeRefs.get(childId)!.getBoundingClientRect();
     const containerRect = containerRef.getBoundingClientRect();
     // Convert to container-relative coords
     const x1 = parentRect.right - containerRect.left;
     const y1 = parentRect.top + parentRect.height / 2 - containerRect.top;
     const x2 = childRect.left - containerRect.left;
     const y2 = childRect.top + childRect.height / 2 - containerRect.top;
     // Bezier control points (horizontal emphasis)
     const cx = (x1 + x2) / 2;
     return `M ${x1},${y1} C ${cx},${y1} ${cx},${y2} ${x2},${y2}`;
   }
   ```

3. **ResizeObserver**: Attach to the container element. On resize, recompute paths.

4. **Expand/collapse**: State `expanded: boolean` on the component. When collapsed, hide children and their connector paths with a CSS transition.

5. **Styling**: Node cards use the existing design tokens (`--surface`, `--border`, `--shadow-xs`, `--color-topic`, `--color-topic-tint`). SVG paths use `stroke: var(--text-ghost)` with `stroke-width: 2` and `fill: none`.

### Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/ui-react/components/HorizontalOrgChart.tsx` | Create | New component replacing MiniOrgChart |
| `src/ui-react/components/MiniOrgChart.tsx` | Delete | Replaced by HorizontalOrgChart |
| `src/ui-react/pages/EntityDetailPage.tsx` (or equivalent) | Modify | Import HorizontalOrgChart instead of MiniOrgChart |

### Acceptance Criteria

- Horizontal left-to-right layout showing ancestors -> current -> children
- Connectors are pixel-perfect bezier curves, never misaligned regardless of label length
- Current node visually highlighted with topic color
- Ancestor nodes smaller/muted (dashed border, reduced opacity)
- Children clickable, navigating to their entity page
- Expand/collapse toggle for children section
- Horizontal scroll when content exceeds container width
- Works in both light and dark themes
- No new dependencies added to package.json
- Respects `prefers-reduced-motion` (disable path animations)
