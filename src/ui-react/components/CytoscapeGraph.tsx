import {
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from 'react';
import cytoscape from 'cytoscape';
import type { Core, NodeDataDefinition, StylesheetStyle, NodeSingular } from 'cytoscape';
import { api } from '../lib/api.js';
import { NavigationStateManager } from '../lib/navigation.js';
import type { LayerEntry, ChildNodeData } from '../lib/navigation.js';
import { buildLayerElements } from '../lib/layer-builder.js';
import type { GroupLabel } from '../lib/layer-builder.js';
import { transitionLayers, updateGroupLabels } from '../lib/transition.js';

// ----------------------------------------------------------------------------
// Node type color palette — muted pastels per design spec
// ----------------------------------------------------------------------------

interface TypePalette {
  bg: string;
  glow: string;
  ring: string;
}

const TYPE_COLORS: Record<string, TypePalette> = {
  person:      { bg: '#8B7EC8', glow: 'rgba(139,126,200,0.35)', ring: '#A89FD6' },
  topic:       { bg: '#6B9E8A', glow: 'rgba(107,158,138,0.35)', ring: '#8CBCAA' },
  document:    { bg: '#C4A86B', glow: 'rgba(196,168,107,0.35)', ring: '#D4BF8A' },
  action_item: { bg: '#C47A7A', glow: 'rgba(196,122,122,0.35)', ring: '#D49A9A' },
  pending:     { bg: '#C47A7A', glow: 'rgba(196,122,122,0.35)', ring: '#D49A9A' },
  key_fact:    { bg: '#6B8EC4', glow: 'rgba(107,142,196,0.35)', ring: '#8BAAD4' },
  thread:      { bg: '#8A8A8A', glow: 'rgba(138,138,138,0.25)', ring: '#AAAAAA' },
  root:        { bg: '#8B7EC8', glow: 'rgba(139,126,200,0.40)', ring: '#B0A5D8' },
  category:    { bg: '#8B7EC8', glow: 'rgba(139,126,200,0.35)', ring: '#A89FD6' },
  community:    { bg: '#6B9E8A', glow: 'rgba(107,158,138,0.35)', ring: '#8CBCAA' },
  __show_more__: { bg: 'transparent', glow: 'rgba(0,0,0,0)',     ring: '#9A9A9A' },
};

function colorFor(type: string): TypePalette {
  return TYPE_COLORS[type] ?? TYPE_COLORS['thread']!;
}

// ----------------------------------------------------------------------------
// Cytoscape stylesheet builder
// ----------------------------------------------------------------------------

function buildStylesheet(isDark: boolean): StylesheetStyle[] {
  const labelColor  = isDark ? '#A1A1AA' : '#6B6B6B';
  const labelActive = isDark ? '#ECECF1' : '#1A1A1A';
  const edgeColor   = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
  const edgeActive  = isDark ? 'rgba(139,126,200,0.25)' : 'rgba(139,126,200,0.20)';

  return [
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 8,
        'text-wrap': 'ellipsis',
        'text-max-width': '80px',
        'font-size': '10px',
        'font-family': '"Inter", system-ui, -apple-system, sans-serif',
        'font-weight': '500',
        color: labelColor,
        'background-color': (el: any) => colorFor(el.data('type') as string).bg,
        'background-opacity': 0.92,
        'border-width': 0,
        width: 44,
        height: 44,
        'overlay-padding': 6,
        'overlay-opacity': 0,
        'shadow-blur': 0,
        'shadow-color': (el: any) => colorFor(el.data('type') as string).glow,
        'shadow-offset-x': 0,
        'shadow-offset-y': 0,
        'shadow-opacity': 0,
        'transition-property': 'width, height, opacity, shadow-blur, shadow-opacity, background-opacity',
        'transition-duration': '300ms',
        'transition-timing-function': 'ease-out',
      } as unknown as cytoscape.Css.Node,
    },
    {
      selector: 'node.active-path',
      style: {
        'shadow-blur': 18,
        'shadow-opacity': 0.5,
        'border-width': 2,
        'border-color': (el: any) => colorFor(el.data('type') as string).ring,
        'border-opacity': 0.5,
      } as unknown as cytoscape.Css.Node,
    },
    {
      selector: 'node.selected-node',
      style: {
        width: 56,
        height: 56,
        'shadow-blur': 24,
        'shadow-opacity': 0.75,
        'border-width': 2.5,
        'border-color': (el: any) => colorFor(el.data('type') as string).ring,
        'border-opacity': 0.75,
        'font-size': '11px',
        'font-weight': '600',
        color: labelActive,
        'background-opacity': 1,
      } as unknown as cytoscape.Css.Node,
    },
    // Parent node — top of tree for every layer
    {
      selector: 'node.parent-node',
      style: {
        width: 52,
        height: 52,
        'font-size': '11px',
        'font-weight': '600',
        color: labelActive,
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 8,
        'shadow-blur': 20,
        'shadow-opacity': 0.5,
        'border-width': 2,
        'border-color': (el: any) => colorFor(el.data('type') as string).ring,
        'border-opacity': 0.6,
      } as unknown as cytoscape.Css.Node,
    },
    {
      selector: 'node.hover-highlight',
      style: {
        'shadow-blur': 20,
        'shadow-opacity': 0.65,
        'background-opacity': 1,
        width: 50,
        height: 50,
        cursor: 'pointer',
      } as unknown as cytoscape.Css.Node,
    },
    // Ghost nodes — appear in multiple contexts
    {
      selector: 'node[alsoIn]',
      style: {
        'border-width': 1.5,
        'border-color': '#6B8EC4',
        'border-style': 'dashed',
        'border-opacity': 0.5,
      } as unknown as cytoscape.Css.Node,
    },
    // "Show more" pseudo-node — dashed border, transparent fill
    {
      selector: `node[type = "__show_more__"]`,
      style: {
        'background-color': 'transparent',
        'background-opacity': 0,
        'border-width': 2,
        'border-style': 'dashed',
        'border-color': 'var(--border-strong, #BBBBBB)',
        'border-opacity': 0.7,
        color: labelColor,
        'font-size': '10px',
        'font-weight': '500',
      } as unknown as cytoscape.Css.Node,
    },
    {
      selector: `node[type = "__show_more__"].hover-highlight`,
      style: {
        'border-opacity': 1,
        'border-color': labelColor,
        color: labelActive,
        width: 44,
        height: 44,
      } as unknown as cytoscape.Css.Node,
    },
    {
      selector: 'edge',
      style: {
        width: 1.5,
        'line-color': edgeColor,
        'curve-style': 'taxi',
        'taxi-direction': 'downward',
        'taxi-turn': '50%',
        'target-arrow-shape': 'none',
        opacity: 1,
        'transition-property': 'opacity, line-color',
        'transition-duration': '300ms',
      } as unknown as cytoscape.Css.Edge,
    },
    {
      selector: 'edge.active-edge',
      style: {
        'line-color': edgeActive,
        width: 1.5,
      } as unknown as cytoscape.Css.Edge,
    },
    {
      selector: 'node.path-highlight',
      style: {
        'border-width': 3,
        'border-color': '#8B7EC8',
        'border-opacity': 1,
        'shadow-blur': 28,
        'shadow-opacity': 0.8,
        'background-opacity': 1,
        width: 54,
        height: 54,
      } as unknown as cytoscape.Css.Node,
    },
    {
      selector: 'edge.path-highlight',
      style: {
        'line-color': '#8B7EC8',
        width: 3,
        opacity: 1,
      } as unknown as cytoscape.Css.Edge,
    },
  ];
}

// ----------------------------------------------------------------------------
// Node data shape
// ----------------------------------------------------------------------------

export interface GraphNodeData extends NodeDataDefinition {
  id: string;
  label: string;
  fullLabel?: string;
  type: string;
  badge?: number;
  isParent?: boolean;
  /** Array of other parent contexts this entity appears in */
  alsoIn?: Array<{ id: string; label: string }>;
  // xref message node fields (only present when id starts with 'xref-msg-')
  msgChannel?: string;
  msgEventTime?: number;
  msgBody?: string;
  msgSenderEntityId?: string | null;
}

// ----------------------------------------------------------------------------
// Imperative handle exposed to parent
// ----------------------------------------------------------------------------

export interface CytoscapeGraphHandle {
  loadRoot(): Promise<void>;
  drillDown(entityId: string, type: string, label: string): Promise<void>;
  navigateBack(toIndex: number): void;
  fitView(): void;
  zoomIn(): void;
  zoomOut(): void;
  /** Apply path-highlight class to the given node/edge IDs. */
  highlightPath(nodeIds: string[], edgeIds: string[]): void;
  /** Remove all path-highlight classes. */
  clearPathHighlight(): void;
  /** Front-end filter: show only nodes whose label matches the query (case-insensitive). Empty string shows all. */
  filterLayer(query: string): void;
}

// ----------------------------------------------------------------------------
// Props
// ----------------------------------------------------------------------------

export interface CytoscapeGraphProps {
  isDark: boolean;
  onNodeSelect: (data: GraphNodeData | null) => void;
  onBreadcrumbsChange: (crumbs: Array<{ id: string; label: string; type: string }>) => void;
  /** Entity ID to use as root for loadRoot(). Defaults to 'root'. */
  rootEntityId?: string;
  /** Called after each layer load with the total available child count. */
  onLayerLoaded?: (totalAvailable: number) => void;
}

// ----------------------------------------------------------------------------
// Dagre layout configuration
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// Group label computation from actual Cytoscape node positions
// ----------------------------------------------------------------------------

const TYPE_GROUP_LABELS: Record<string, { label: string; labelAlt: string }> = {
  topic:       { label: 'Sub-topics',   labelAlt: '子话题'   },
  action_item: { label: 'Action Items', labelAlt: '待办'     },
  key_fact:    { label: 'Key Facts',    labelAlt: '关键事实' },
  document:    { label: 'Documents',    labelAlt: '文档'     },
  person:      { label: 'People',       labelAlt: '相关人物' },
  thread:      { label: 'Threads',      labelAlt: '会话'     },
  category:    { label: 'Categories',   labelAlt: '分类'     },
  community:   { label: 'Groups',       labelAlt: '群组'     },
  pending:     { label: 'Pending',      labelAlt: '待处理'   },
};

/** 20px above the children row in model coordinates */
const GROUP_LABEL_Y_OFFSET = -20;

/**
 * After layout runs, read actual node positions from Cytoscape and derive
 * group label positions. Groups are identified by the `typeGroup` data field;
 * the label is centered horizontally over the group's nodes.
 */
function computeGroupLabels(cy: Core): GroupLabel[] {
  // Collect non-parent nodes grouped by typeGroup index
  const groupMap = new Map<number, { nodes: ReturnType<Core['nodes']>; type: string }>();

  cy.nodes('[!isParent]').forEach((node) => {
    const gi   = node.data('typeGroup') as number | undefined;
    const type = node.data('type') as string;
    if (gi === undefined) return;
    if (!groupMap.has(gi)) {
      groupMap.set(gi, { nodes: cy.collection() as ReturnType<Core['nodes']>, type });
    }
    groupMap.get(gi)!.nodes = groupMap.get(gi)!.nodes.union(node) as ReturnType<Core['nodes']>;
  });

  const labels: GroupLabel[] = [];

  groupMap.forEach(({ nodes, type }) => {
    if (nodes.length === 0) return;

    const xs  = nodes.map((n) => n.position('x'));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const cx   = (minX + maxX) / 2;
    // y position: above the children row (all children share the same y in preset layout)
    const y    = nodes.first().position('y') + GROUP_LABEL_Y_OFFSET;

    const meta = TYPE_GROUP_LABELS[type] ?? { label: type, labelAlt: type };
    labels.push({ label: meta.label, labelAlt: meta.labelAlt, cx, y, count: nodes.length });
  });

  // Sort by cx so labels render left-to-right
  labels.sort((a, b) => a.cx - b.cx);
  return labels;
}

// ----------------------------------------------------------------------------
// "Show More" pseudo-node helpers
// ----------------------------------------------------------------------------

const SHOW_MORE_NODE_ID = '__show_more__';

/** Append a dashed "Show more +N" node to a set of child nodes when truncated. */
function withShowMoreNode(
  childNodes: ChildNodeData[],
  totalAvailable: number,
): ChildNodeData[] {
  if (totalAvailable <= childNodes.length) return childNodes;
  const remaining = totalAvailable - childNodes.length;
  return [
    ...childNodes,
    {
      id:    SHOW_MORE_NODE_ID,
      label: `+${remaining} more`,
      type:  '__show_more__',
      badge: undefined,
    },
  ];
}

// ----------------------------------------------------------------------------
// Ghost node tooltip overlay
// ----------------------------------------------------------------------------

function buildAlsoInLabel(alsoIn: Array<{ id: string; label: string }>): string {
  return 'Also in: ' + alsoIn.map((a) => a.label).join(', ');
}

// ----------------------------------------------------------------------------
// CytoscapeGraph component
// ----------------------------------------------------------------------------

export const CytoscapeGraph = forwardRef<CytoscapeGraphHandle, CytoscapeGraphProps>(
  function CytoscapeGraph({ isDark, onNodeSelect, onBreadcrumbsChange, rootEntityId, onLayerLoaded }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const cyRef        = useRef<Core | null>(null);

    // Navigation state
    const navRef = useRef<NavigationStateManager>(new NavigationStateManager());

    // Badge DOM overlay
    const badgeLayerRef      = useRef<HTMLDivElement | null>(null);
    // Group label DOM overlay
    const groupLabelLayerRef = useRef<HTMLDivElement | null>(null);
    // Current group labels (kept for pan/zoom re-render)
    const currentGroupLabels = useRef<GroupLabel[]>([]);
    // Ghost tooltip overlay
    const tooltipRef         = useRef<HTMLDivElement | null>(null);

    // --------------------------------------------------------------------
    // Badge overlay helpers
    // --------------------------------------------------------------------

    const ensureBadgeLayer = useCallback(() => {
      if (!badgeLayerRef.current && containerRef.current) {
        const layer = document.createElement('div');
        layer.style.cssText =
          'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:5';
        containerRef.current.style.position = 'relative';
        containerRef.current.appendChild(layer);
        badgeLayerRef.current = layer;
      }
    }, []);

    const ensureGroupLabelLayer = useCallback(() => {
      if (!groupLabelLayerRef.current && containerRef.current) {
        const layer = document.createElement('div');
        layer.style.cssText =
          'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:6';
        containerRef.current.appendChild(layer);
        groupLabelLayerRef.current = layer;
      }
    }, []);

    const updateBadges = useCallback(() => {
      const cy = cyRef.current;
      const layer = badgeLayerRef.current;
      if (!cy || !layer) return;

      layer.innerHTML = '';
      const pan  = cy.pan();
      const zoom = cy.zoom();

      cy.nodes().forEach((node) => {
        const badge = node.data('badge') as number | null;
        if (badge == null || badge === 0) return;

        const pos = node.position();
        const w   = node.width() * zoom;
        const sx  = pos.x * zoom + pan.x + w / 2 - 4;
        const sy  = pos.y * zoom + pan.y - w / 2 - 4;

        const type      = node.data('type') as string;
        const isPending = type === 'action_item' || type === 'pending' || node.id() === 'pending';
        const bg        = isPending ? '#C47A7A' : '#8B7EC8';

        const el       = document.createElement('div');
        el.style.cssText =
          `position:absolute;left:${sx}px;top:${sy}px;` +
          `min-width:18px;height:18px;border-radius:9px;` +
          `background:${bg};color:#fff;font-size:9px;font-weight:700;` +
          `display:flex;align-items:center;justify-content:center;padding:0 5px;` +
          `box-shadow:0 1px 3px rgba(0,0,0,0.2);font-family:Inter,system-ui,sans-serif`;
        el.textContent = badge > 99 ? '99+' : String(badge);
        layer.appendChild(el);
      });
    }, []);

    // --------------------------------------------------------------------
    // Ghost tooltip helpers
    // --------------------------------------------------------------------

    const ensureTooltip = useCallback(() => {
      if (!tooltipRef.current && containerRef.current) {
        const tip = document.createElement('div');
        tip.style.cssText =
          'position:absolute;pointer-events:none;z-index:20;display:none;' +
          'padding:5px 8px;background:rgba(30,30,34,0.92);color:#ECECF1;' +
          'font-size:11px;font-family:Inter,system-ui,sans-serif;border-radius:6px;' +
          'box-shadow:0 2px 8px rgba(0,0,0,0.3);max-width:200px;white-space:nowrap;' +
          'overflow:hidden;text-overflow:ellipsis;';
        containerRef.current.appendChild(tip);
        tooltipRef.current = tip;
      }
    }, []);

    const showTooltip = useCallback((node: NodeSingular, text: string) => {
      const cy = cyRef.current;
      const tip = tooltipRef.current;
      if (!cy || !tip) return;

      const pos   = node.renderedPosition();
      const w     = (node.width() * cy.zoom()) / 2;
      tip.textContent = text;
      tip.style.left    = `${pos.x + w + 4}px`;
      tip.style.top     = `${pos.y - 14}px`;
      tip.style.display = 'block';
    }, []);

    const hideTooltip = useCallback(() => {
      if (tooltipRef.current) tooltipRef.current.style.display = 'none';
    }, []);

    // --------------------------------------------------------------------
    // Handle node click — focus swap drill-in
    // --------------------------------------------------------------------

    // Ref so handleNodeClick always sees current onLayerLoaded without being
    // re-created every render (avoids re-registering cy.on('tap') on every prop change)
    const onLayerLoadedRef = useRef(onLayerLoaded);
    onLayerLoadedRef.current = onLayerLoaded;

    // Tracks the entity ID of the currently displayed parent (for show-more re-fetch)
    const currentParentIdRef = useRef<string>('root');

    const handleNodeClick = useCallback(async (data: GraphNodeData): Promise<void> => {
      const cy  = cyRef.current;
      const nav = navRef.current;
      if (!cy) return;

      // Guard: ignore during transition
      if (nav.isTransitioning) return;

      const { id, type, label } = data;

      // Do not drill into the parent node (already at top of tree)
      if (data.isParent) {
        onNodeSelect(data);
        return;
      }

      // "Show More" pseudo-node: re-fetch current layer with more children
      if (id === SHOW_MORE_NODE_ID) {
        nav.setPhase('transitioning');
        try {
          const layerData = await api.getLayer(currentParentIdRef.current, 50);
          const childNodes: ChildNodeData[] = layerData.children.map((r) => ({
            id:     r.id,
            label:  r.label,
            type:   r.type,
            badge:  r.badge,
            alsoIn: r.alsoIn,
          }));
          const displayChildren = withShowMoreNode(childNodes, layerData.totalAvailable);
          const parentInfo = {
            id:    layerData.center.id,
            label: layerData.center.label,
            type:  layerData.center.type,
          };
          const elements = buildLayerElements(parentInfo, displayChildren);
          await transitionLayers(cy, elements, {
            direction:       'in',
            groupLabelLayer: groupLabelLayerRef.current!,
          });
          const labelsMore = computeGroupLabels(cy);
          currentGroupLabels.current = labelsMore;
          if (groupLabelLayerRef.current) updateGroupLabels(cy, groupLabelLayerRef.current, labelsMore);
          onLayerLoadedRef.current?.(layerData.totalAvailable);
          setTimeout(updateBadges, 50);
        } catch (err) {
          console.error('[CytoscapeGraph] showMore failed:', err);
        } finally {
          nav.setPhase('idle');
        }
        return;
      }

      nav.setPhase('transitioning');

      try {
        // Fetch the new layer from the API
        const layerData = await api.getLayer(id);
        currentParentIdRef.current = layerData.center.id;

        const childNodes: ChildNodeData[] = layerData.children.map((r) => ({
          id:     r.id,
          label:  r.label,
          type:   r.type,
          badge:  r.badge,
          alsoIn: r.alsoIn,
        }));

        const displayChildren = withShowMoreNode(childNodes, layerData.totalAvailable);
        const parentInfo = {
          id:    layerData.center.id,
          label: layerData.center.label,
          type:  layerData.center.type,
        };

        const elements = buildLayerElements(parentInfo, displayChildren);

        const targetNode = cy.getElementById(id) as NodeSingular;

        await transitionLayers(cy, elements, {
          direction:       'in',
          targetNode:      targetNode.length ? targetNode : undefined,
          groupLabelLayer: groupLabelLayerRef.current!,
        });
        // Compute labels from actual post-layout node positions
        const labels = computeGroupLabels(cy);
        currentGroupLabels.current = labels;
        if (groupLabelLayerRef.current) {
          updateGroupLabels(cy, groupLabelLayerRef.current, labels);
        }

        onLayerLoadedRef.current?.(layerData.totalAvailable);

        // Push the new layer entry (store original childNodes without show-more)
        const entry: LayerEntry = {
          parentId:      id,
          label:         (data.fullLabel as string | undefined) ?? label as string,
          type:          type as string,
          childNodes,
          totalAvailable: layerData.totalAvailable,
          fetchedAt:     Date.now(),
        };
        nav.pushLayer(entry);
        onBreadcrumbsChange(nav.breadcrumbs);

        setTimeout(updateBadges, 50);

        onNodeSelect({
          id,
          type:     type as string,
          label:    label as string,
          isParent: true,
        } as GraphNodeData);
      } catch (err) {
        console.error('[CytoscapeGraph] handleNodeClick failed:', err);
      } finally {
        nav.setPhase('idle');
      }
    }, [onNodeSelect, onBreadcrumbsChange, updateBadges]);

    // --------------------------------------------------------------------
    // Init Cytoscape
    // --------------------------------------------------------------------

    useEffect(() => {
      if (!containerRef.current) return;

      const cy = cytoscape({
        container: containerRef.current,
        style:     buildStylesheet(isDark) as cytoscape.StylesheetStyle[],
        elements:  [],
        layout:    { name: 'preset' },
        userZoomingEnabled:  true,
        userPanningEnabled:  true,
        boxSelectionEnabled: false,
        minZoom:         0.25,
        maxZoom:         3,
        wheelSensitivity: 0.25,
      });

      cyRef.current = cy;
      ensureBadgeLayer();
      ensureGroupLabelLayer();
      ensureTooltip();

      cy.on('tap', 'node', (evt) => {
        void handleNodeClick(evt.target.data() as GraphNodeData);
      });

      cy.on('mouseover', 'node', (evt) => {
        const node = evt.target as NodeSingular;

        // Ghost node tooltip
        const alsoIn = node.data('alsoIn') as Array<{ id: string; label: string }> | undefined;
        if (alsoIn && alsoIn.length > 0) {
          showTooltip(node, buildAlsoInLabel(alsoIn));
        }

        if (!node.hasClass('parent-node')) {
          node.addClass('hover-highlight');
          if (containerRef.current) containerRef.current.style.cursor = 'pointer';
        }
      });

      cy.on('mouseout', 'node', (evt) => {
        hideTooltip();
        evt.target.removeClass('hover-highlight');
        if (containerRef.current) containerRef.current.style.cursor = 'default';
      });

      cy.on('pan zoom', () => {
        updateBadges();
        hideTooltip();
        if (groupLabelLayerRef.current && currentGroupLabels.current.length > 0) {
          updateGroupLabels(cy, groupLabelLayerRef.current, currentGroupLabels.current);
        }
      });

      return () => {
        cy.destroy();
        cyRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // intentionally empty — init once, theme handled separately

    // Re-apply stylesheet on theme change
    useEffect(() => {
      const cy = cyRef.current;
      if (!cy) return;
      cy.style(buildStylesheet(isDark) as cytoscape.StylesheetStyle[]);
    }, [isDark]);

    // --------------------------------------------------------------------
    // Imperative handle
    // --------------------------------------------------------------------

    // Ref so loadRoot always reads the current rootEntityId without needing to
    // be re-created (it's used in useImperativeHandle which has a stable dep array)
    const rootEntityIdRef = useRef(rootEntityId);
    rootEntityIdRef.current = rootEntityId;

    const loadRoot = useCallback(async (): Promise<void> => {
      const cy  = cyRef.current;
      const nav = navRef.current;
      if (!cy) return;

      nav.reset();
      nav.setPhase('transitioning');

      try {
        const entityId = rootEntityIdRef.current ?? 'root';
        const layerData = await api.getLayer(entityId);
        currentParentIdRef.current = layerData.center.id;

        const parentInfo = {
          id:    layerData.center.id,
          label: layerData.center.label,
          type:  layerData.center.type,
        };

        const childNodes: ChildNodeData[] = layerData.children.map((r) => ({
          id:     r.id,
          label:  r.label,
          type:   r.type,
          badge:  r.badge,
          alsoIn: r.alsoIn,
        }));

        const displayChildren = withShowMoreNode(childNodes, layerData.totalAvailable);
        const elements = buildLayerElements(parentInfo, displayChildren);

        // Initial load: add elements at preset positions, fade in
        cy.elements().remove();
        cy.add([...elements.nodes, ...elements.edges]);
        cy.elements().style('opacity', 0);
        cy.layout({ name: 'preset' }).run();
        cy.fit(undefined, 60);
        cy.elements().animate(
          { style: { opacity: 1 } as never },
          { duration: 400, easing: 'ease-out-cubic' },
        );
        // Compute labels from actual node positions after layout + fit
        setTimeout(() => {
          updateBadges();
          const labels = computeGroupLabels(cy);
          currentGroupLabels.current = labels;
          if (groupLabelLayerRef.current) {
            updateGroupLabels(cy, groupLabelLayerRef.current, labels);
          }
        }, 450);

        onLayerLoadedRef.current?.(layerData.totalAvailable);

        const entry: LayerEntry = {
          parentId:       parentInfo.id,
          label:          parentInfo.label,
          type:           parentInfo.type,
          childNodes, // store originals, not the show-more variant
          totalAvailable: layerData.totalAvailable,
          fetchedAt:      Date.now(),
        };
        nav.pushLayer(entry);
        onBreadcrumbsChange(nav.breadcrumbs);

        onNodeSelect({
          id:       parentInfo.id,
          type:     parentInfo.type,
          label:    parentInfo.label,
          isParent: true,
        } as GraphNodeData);
      } catch (err) {
        console.error('[CytoscapeGraph] loadRoot failed:', err);
      } finally {
        nav.setPhase('idle');
      }
    }, [onNodeSelect, onBreadcrumbsChange, updateBadges]);

    const navigateBack = useCallback((toIndex: number): void => {
      const cy  = cyRef.current;
      const nav = navRef.current;
      if (!cy) return;
      if (nav.isTransitioning) return;

      nav.setPhase('transitioning');

      void (async () => {
        try {
          // toIndex -1 means go back to root (index 0 in stack)
          const targetStackIndex = toIndex < 0 ? 0 : toIndex;

          // Check if we can use cached layer data
          let targetEntry = nav.getCachedLayer(targetStackIndex);

          if (!targetEntry) {
            // Cache stale — re-fetch
            const stackEntry = nav.breadcrumbs[targetStackIndex];
            if (!stackEntry) return;

            const layerData = await api.getLayer(stackEntry.id);
            const childNodes: ChildNodeData[] = layerData.children.map((r) => ({
              id:     r.id,
              label:  r.label,
              type:   r.type,
              badge:  r.badge,
              alsoIn: r.alsoIn,
            }));

            // Update the cached entry with fresh data
            targetEntry = {
              parentId:   layerData.center.id,
              label:      layerData.center.label,
              type:       layerData.center.type,
              childNodes,
              fetchedAt:  Date.now(),
            };
          }

          const parentInfo = {
            id:    targetEntry.parentId,
            label: targetEntry.label,
            type:  targetEntry.type,
          };

          // Re-add show-more node if original fetch was truncated
          const displayChildren = withShowMoreNode(
            targetEntry.childNodes,
            targetEntry.totalAvailable ?? targetEntry.childNodes.length,
          );
          const elements = buildLayerElements(parentInfo, displayChildren);
          currentParentIdRef.current = parentInfo.id;

          await transitionLayers(cy, elements, {
            direction:       'out',
            groupLabelLayer: groupLabelLayerRef.current!,
          });
          const labelsBack = computeGroupLabels(cy);
          currentGroupLabels.current = labelsBack;
          if (groupLabelLayerRef.current) {
            updateGroupLabels(cy, groupLabelLayerRef.current, labelsBack);
          }

          onLayerLoadedRef.current?.(targetEntry.totalAvailable ?? targetEntry.childNodes.length);

          nav.popTo(targetStackIndex);
          onBreadcrumbsChange(nav.breadcrumbs);

          setTimeout(updateBadges, 50);

          onNodeSelect({
            id:       parentInfo.id,
            type:     parentInfo.type,
            label:    parentInfo.label,
            isParent: true,
          } as GraphNodeData);
        } catch (err) {
          console.error('[CytoscapeGraph] navigateBack failed:', err);
        } finally {
          nav.setPhase('idle');
        }
      })();
    }, [onNodeSelect, onBreadcrumbsChange, updateBadges]);

    useImperativeHandle(ref, () => ({
      loadRoot,
      drillDown: async (entityId: string, type: string, label: string) => {
        const cy  = cyRef.current;
        const nav = navRef.current;
        if (!cy) return;
        if (nav.isTransitioning) return;

        nav.setPhase('transitioning');
        try {
          const layerData = await api.getLayer(entityId);
          currentParentIdRef.current = layerData.center.id;
          const childNodes: ChildNodeData[] = layerData.children.map((r) => ({
            id:     r.id,
            label:  r.label,
            type:   r.type,
            badge:  r.badge,
            alsoIn: r.alsoIn,
          }));
          const displayChildren = withShowMoreNode(childNodes, layerData.totalAvailable);
          const parentInfo = {
            id:    layerData.center.id,
            label: layerData.center.label,
            type:  layerData.center.type,
          };
          const elements = buildLayerElements(parentInfo, displayChildren);

          await transitionLayers(cy, elements, {
            direction:       'in',
            groupLabelLayer: groupLabelLayerRef.current!,
          });
          const labelsDrill = computeGroupLabels(cy);
          currentGroupLabels.current = labelsDrill;
          if (groupLabelLayerRef.current) {
            updateGroupLabels(cy, groupLabelLayerRef.current, labelsDrill);
          }

          onLayerLoadedRef.current?.(layerData.totalAvailable);

          const entry: LayerEntry = {
            parentId:       entityId,
            label,
            type,
            childNodes,
            totalAvailable: layerData.totalAvailable,
            fetchedAt:      Date.now(),
          };
          nav.pushLayer(entry);
          onBreadcrumbsChange(nav.breadcrumbs);
          setTimeout(updateBadges, 50);

          onNodeSelect({ id: entityId, type, label, isParent: true } as GraphNodeData);
        } catch (err) {
          console.error('[CytoscapeGraph] drillDown failed:', err);
        } finally {
          nav.setPhase('idle');
        }
      },
      navigateBack,
      fitView: () => { cyRef.current?.fit(undefined, 50); },
      zoomIn:  () => { cyRef.current?.zoom((cyRef.current.zoom() ?? 1) * 1.25); },
      zoomOut: () => { cyRef.current?.zoom((cyRef.current.zoom() ?? 1) * 0.8);  },
      highlightPath: (nodeIds: string[], edgeIds: string[]) => {
        const cy = cyRef.current;
        if (!cy) return;
        cy.nodes().removeClass('path-highlight');
        cy.edges().removeClass('path-highlight');
        for (const id of nodeIds) cy.getElementById(id).addClass('path-highlight');
        for (const id of edgeIds) cy.getElementById(id).addClass('path-highlight');
      },
      clearPathHighlight: () => {
        const cy = cyRef.current;
        if (!cy) return;
        cy.nodes().removeClass('path-highlight');
        cy.edges().removeClass('path-highlight');
      },
      filterLayer: (query: string) => {
        const cy = cyRef.current;
        if (!cy) return;
        const q = query.trim().toLowerCase();
        if (!q) {
          // Show all nodes
          cy.nodes().style('opacity', 1);
          cy.edges().style('opacity', 1);
        } else {
          cy.nodes().forEach((node) => {
            if (node.hasClass('parent-node')) {
              node.style('opacity', 1);
              return;
            }
            const label = ((node.data('fullLabel') ?? node.data('label')) as string).toLowerCase();
            const match = label.includes(q);
            node.style('opacity', match ? 1 : 0.15);
          });
          cy.edges().forEach((edge) => {
            const target = cy.getElementById(edge.data('target') as string);
            const targetOpacity = parseFloat(target.style('opacity') as string);
            edge.style('opacity', targetOpacity > 0.5 ? 1 : 0.05);
          });
        }
        updateBadges();
      },
    }), [loadRoot, navigateBack, onNodeSelect, onBreadcrumbsChange, updateBadges]);

    return (
      <div
        ref={containerRef}
        style={{
          width:  '100%',
          height: '100%',
          background: `var(--bg) radial-gradient(ellipse at 50% 50%, rgba(124,92,252,0.02) 0%, transparent 70%)`,
        }}
      />
    );
  },
);
