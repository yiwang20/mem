// ============================================================================
// TransitionAnimator — orchestrates the Focus Swap animation sequence
// ============================================================================

import type { Core, NodeSingular } from 'cytoscape';
import type { LayerElements } from './layer-builder.js';

export interface TransitionOptions {
  direction: 'in' | 'out';
  /** The child node being drilled into (for slide-down target) */
  targetNode?: NodeSingular;
  /**
   * DOM layer for group label overlays. Cleared on swap; labels are rendered
   * by the caller after transitionLayers() resolves (positions are then final).
   */
  groupLabelLayer: HTMLDivElement;
}

/**
 * Orchestrate the focus swap animation sequence.
 *
 * 5 phases + overlay:
 *   1. slide      200ms — pan viewport down (drill-in) or up (drill-out)
 *   2. fadeOut    150ms — fade all current elements to 0
 *   3. swap       instant — remove old, add new, run preset layout
 *   4. fadeIn     250ms — parent first, children staggered left-to-right
 *   5. settle     100ms — fit viewport
 *   6. overlay    instant — render group labels as DOM elements
 */
export async function transitionLayers(
  cy: Core,
  newElements: LayerElements,
  options: TransitionOptions,
): Promise<void> {
  const { direction, groupLabelLayer } = options;
  const slideDistance = 80; // px

  // Phase 1: Slide viewport (200ms)
  const currentPan = cy.pan();
  await animateCyPromise(cy, {
    pan: {
      x: currentPan.x,
      y: direction === 'in'
        ? currentPan.y - slideDistance
        : currentPan.y + slideDistance,
    },
    duration: 200,
    easing: 'ease-in-out',
  });

  // Phase 2: Fade out current elements (150ms)
  const currentEls = cy.elements();
  if (currentEls.length > 0) {
    await Promise.all(
      currentEls.map((el) =>
        animateElPromise(el, {
          style: { opacity: 0 } as never,
          duration: 150,
          easing: 'ease-in',
        }),
      ),
    );
  }

  // Phase 3: Swap — remove old, add new at preset positions (instant)
  cy.elements().remove();
  cy.add([...newElements.nodes, ...newElements.edges]);
  cy.elements().style('opacity', 0);
  // Positions are embedded in element data; preset layout applies them
  cy.layout({ name: 'preset' }).run();

  // Clear old group labels immediately
  groupLabelLayer.innerHTML = '';

  // Phase 4: Fade in new elements (250ms, staggered)
  const parentNode = cy.nodes('[?isParent]');
  const childNodes = cy.nodes('[!isParent]');
  const edgeEls    = cy.edges();

  // Parent fades in first (150ms)
  if (parentNode.length) {
    animateElPromise(parentNode, {
      style: { opacity: 1 } as never,
      duration: 150,
      easing: 'ease-out',
    });
  }

  // Children stagger left-to-right on drill-in, right-to-left on drill-out
  const sortedChildren = [...childNodes].sort((a, b) => {
    const diff = a.position('x') - b.position('x');
    return direction === 'in' ? diff : -diff;
  });

  const staggerDelay = Math.min(20, 300 / Math.max(sortedChildren.length, 1));

  const childPromises = sortedChildren.map(
    (node, i) =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          node.animate(
            { style: { opacity: 1 } as never },
            { duration: 200, easing: 'ease-out-cubic', complete: () => resolve() },
          );
        }, i * staggerDelay);
      }),
  );

  // Edges fade in alongside children
  if (edgeEls.length) {
    edgeEls.animate(
      { style: { opacity: 1 } as never },
      { duration: 250, easing: 'ease-out' },
    );
  }

  await Promise.all(childPromises);

  // Phase 5: Settle — fit viewport (100ms)
  await animateCyPromise(cy, {
    fit: { padding: 60 },
    duration: 100,
    easing: 'ease-out',
  });

  // Group labels are rendered by the caller after this function returns,
  // using computeGroupLabels(cy) to read actual post-layout positions.
}

// ---------------------------------------------------------------------------
// Group label DOM overlay rendering
// Exported so CytoscapeGraph can call it on pan/zoom events
// ---------------------------------------------------------------------------

export function updateGroupLabels(
  cy: Core,
  layer: HTMLDivElement,
  labels: GroupLabel[],
): void {
  layer.innerHTML = '';
  const pan  = cy.pan();
  const zoom = cy.zoom();
  const useChinese = navigator.language.startsWith('zh');

  for (const gl of labels) {
    const screenX = gl.cx * zoom + pan.x;
    const screenY = gl.y  * zoom + pan.y;

    const el = document.createElement('div');
    el.style.cssText =
      `position:absolute;left:${screenX}px;top:${screenY}px;` +
      `transform:translateX(-50%);` +
      `font-size:10px;font-weight:600;letter-spacing:0.5px;` +
      `text-transform:uppercase;color:var(--text-tertiary);` +
      `font-family:Inter,system-ui,sans-serif;` +
      `white-space:nowrap;pointer-events:none;opacity:0.6;user-select:none;`;
    el.textContent = useChinese ? gl.labelAlt : gl.label;
    layer.appendChild(el);
  }
}

// ---------------------------------------------------------------------------
// Helpers to promisify Cytoscape animations
// ---------------------------------------------------------------------------

function animateCyPromise(cy: Core, opts: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    cy.animate({ ...opts, complete: () => resolve() } as never);
  });
}

function animateElPromise(
  el: ReturnType<Core['elements']>,
  opts: Record<string, unknown>,
): Promise<void> {
  return new Promise((resolve) => {
    el.animate({ ...opts, complete: () => resolve() } as never);
  });
}
