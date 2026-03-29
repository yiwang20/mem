// ============================================================================
// LayerBuilder — pre-calculates grouped-row positions for a Focus Swap layer
// ============================================================================

import type { ElementDefinition } from 'cytoscape';
import type { ChildNodeData } from './navigation.js';

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const INTRA_GROUP_GAP    = 50;   // horizontal gap between nodes in the same group
const INTER_GROUP_GAP    = 80;   // horizontal gap between type groups
const PARENT_CHILD_GAP   = 120;  // vertical distance from parent to children row
const GROUP_LABEL_OFFSET = -20;  // y-offset of group label above children row

// ---------------------------------------------------------------------------
// Type group ordering and display labels
// ---------------------------------------------------------------------------

const TYPE_GROUPS: Array<{ type: string; label: string; labelAlt: string }> = [
  { type: 'topic',       label: 'Sub-topics',   labelAlt: '子话题'   },
  { type: 'action_item', label: 'Action Items', labelAlt: '待办事项' },
  { type: 'key_fact',    label: 'Key Facts',    labelAlt: '关键事实' },
  { type: 'document',    label: 'Documents',    labelAlt: '文档'     },
  { type: 'person',      label: 'People',       labelAlt: '相关人物' },
  { type: 'thread',      label: 'Threads',      labelAlt: '会话'     },
  { type: 'category',    label: 'Categories',   labelAlt: '分类'     },
  { type: 'community',   label: 'Groups',       labelAlt: '群组'     },
  { type: 'pending',      label: 'Pending',     labelAlt: '待处理'   },
  { type: '__show_more__', label: '',           labelAlt: ''          },
];

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface LayerElements {
  nodes: ElementDefinition[];
  edges: ElementDefinition[];
  /** Group label overlays to render as DOM elements above the children row */
  groupLabels: GroupLabel[];
}

export interface GroupLabel {
  label: string;
  labelAlt: string;
  /** Center x in Cytoscape model coordinates */
  cx: number;
  /** y in Cytoscape model coordinates (above the children row) */
  y: number;
  count: number;
}

// ---------------------------------------------------------------------------
// Build function
// ---------------------------------------------------------------------------

/**
 * Build Cytoscape element definitions for a single layer with grouped-row layout.
 *
 * Layout:
 *   - Parent node at (0, 0)
 *   - Children grouped by entity type, each group in a horizontal row below parent
 *   - Groups ordered: topic → action_item → key_fact → document → person → thread → …
 *   - Entire children row is centered under the parent
 *
 * All positions are pre-calculated. Use { name: 'preset' } layout in Cytoscape.
 */
export function buildLayerElements(
  parent: { id: string; label: string; type: string },
  children: ChildNodeData[],
): LayerElements {
  const nodes: ElementDefinition[] = [];
  const edges: ElementDefinition[] = [];
  const groupLabels: GroupLabel[]  = [];

  // Parent node at origin
  nodes.push({
    data: {
      id:       parent.id,
      label:    parent.label,
      type:     parent.type,
      isParent: true,
    },
    position: { x: 0, y: 0 },
    classes: 'parent-node',
  });

  if (children.length === 0) return { nodes, edges, groupLabels };

  // Group children by type, preserving recency order within each group
  const groupMap = new Map<string, ChildNodeData[]>();
  for (const child of children) {
    const list = groupMap.get(child.type) ?? [];
    list.push(child);
    groupMap.set(child.type, list);
  }

  // Order groups per TYPE_GROUPS, skipping empty types
  const orderedGroups: Array<{
    nodes: ChildNodeData[];
    meta: (typeof TYPE_GROUPS)[number];
  }> = [];
  for (const tg of TYPE_GROUPS) {
    const g = groupMap.get(tg.type);
    if (g && g.length > 0) orderedGroups.push({ nodes: g, meta: tg });
  }

  if (orderedGroups.length === 0) return { nodes, edges, groupLabels };

  // Width of each group: (n-1) * INTRA_GROUP_GAP
  const groupWidths = orderedGroups.map((g) => (g.nodes.length - 1) * INTRA_GROUP_GAP);
  const totalWidth =
    groupWidths.reduce((sum, w) => sum + w, 0) +
    (orderedGroups.length - 1) * INTER_GROUP_GAP;

  // Start x so the entire row is centered under parent at x=0
  let cursorX = -totalWidth / 2;
  const childY = PARENT_CHILD_GAP;

  for (let gi = 0; gi < orderedGroups.length; gi++) {
    const group       = orderedGroups[gi]!;
    const groupWidth  = groupWidths[gi]!;
    const groupStartX = cursorX;

    for (let ni = 0; ni < group.nodes.length; ni++) {
      const child = group.nodes[ni]!;
      const x     = cursorX + ni * INTRA_GROUP_GAP;

      const truncLabel =
        child.label.length > 14 ? child.label.slice(0, 13) + '\u2026' : child.label;

      const nodeData: Record<string, unknown> = {
        id:             child.id,
        label:          truncLabel,
        fullLabel:      child.label,
        type:           child.type,
        isParent:       false,
        typeGroup:      gi,
        typeGroupLabel: group.meta.label,
      };
      if (child.badge !== undefined && child.badge > 0) nodeData['badge']  = child.badge;
      if (child.alsoIn && child.alsoIn.length > 0)      nodeData['alsoIn'] = child.alsoIn;

      nodes.push({ data: nodeData, position: { x, y: childY } });
      edges.push({
        data: {
          id:     `${parent.id}-${child.id}`,
          source: parent.id,
          target: child.id,
        },
      });
    }

    // Group label centered above this group (skip pseudo-node groups with no label)
    if (group.meta.label) {
      groupLabels.push({
        label:    group.meta.label,
        labelAlt: group.meta.labelAlt,
        cx:       groupStartX + groupWidth / 2,
        y:        childY + GROUP_LABEL_OFFSET,
        count:    group.nodes.length,
      });
    }

    cursorX += groupWidth + INTER_GROUP_GAP;
  }

  return { nodes, edges, groupLabels };
}
