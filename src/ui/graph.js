// ============================================================================
// MindFlow Graph — Progressive Radial Expansion (Cytoscape.js)
// Theme-aware: reads CSS variables for edge/label colors
// ============================================================================

import { api } from './api.js';

// -- Color palette (node fills are constant across themes) --------------------
const TYPE_COLORS = {
  person:      { bg: '#8B5CF6', glow: 'rgba(139,92,246,0.35)', ring: '#A78BFA' },
  topic:       { bg: '#14B8A6', glow: 'rgba(20,184,166,0.35)',  ring: '#2DD4BF' },
  document:    { bg: '#F59E0B', glow: 'rgba(245,158,11,0.35)',  ring: '#FBBF24' },
  action_item: { bg: '#F87171', glow: 'rgba(248,113,113,0.35)', ring: '#FCA5A5' },
  pending:     { bg: '#F87171', glow: 'rgba(248,113,113,0.35)', ring: '#FCA5A5' },
  key_fact:    { bg: '#3B82F6', glow: 'rgba(59,130,246,0.35)',  ring: '#60A5FA' },
  thread:      { bg: '#71717A', glow: 'rgba(113,113,122,0.30)', ring: '#A1A1AA' },
  root:        { bg: '#A78BFA', glow: 'rgba(167,139,250,0.40)', ring: '#C4B5FD' },
  category:    { bg: '#818CF8', glow: 'rgba(129,140,248,0.35)', ring: '#A5B4FC' },
  community:   { bg: '#10B981', glow: 'rgba(16,185,129,0.35)',  ring: '#34D399' },
  cross_ref:   { bg: '#E879F9', glow: 'rgba(232,121,249,0.35)', ring: '#F0ABFC' },
};

function colorFor(type) {
  return TYPE_COLORS[type] || TYPE_COLORS.thread;
}

/** Read a CSS custom property from the document root */
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// -- Cytoscape stylesheet (uses cssVar for theme-dependent colors) -----------
function buildStylesheet() {
  // Read theme-dependent colors at build time; graph re-inits on theme change
  const labelColor = cssVar('--graph-label') || '#A1A1AA';
  const labelActive = cssVar('--graph-label-active') || '#ECECF1';
  const edgeColor = cssVar('--graph-edge') || 'rgba(255,255,255,0.06)';
  const edgeActive = cssVar('--graph-edge-active') || 'rgba(139,92,246,0.18)';

  return [
    {
      selector: 'node',
      style: {
        'label': 'data(label)',
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 8,
        'text-wrap': 'ellipsis',
        'text-max-width': '80px',
        'font-size': '10px',
        'font-family': '"Inter", system-ui, -apple-system, sans-serif',
        'font-weight': '500',
        'color': labelColor,
        'background-color': function(e) { return colorFor(e.data('type')).bg; },
        'background-opacity': 0.9,
        'border-width': 0,
        'width': 44,
        'height': 44,
        'overlay-padding': 6,
        'overlay-opacity': 0,
        'shadow-blur': 0,
        'shadow-color': function(e) { return colorFor(e.data('type')).glow; },
        'shadow-offset-x': 0,
        'shadow-offset-y': 0,
        'shadow-opacity': 0,
        'transition-property': 'width, height, opacity, shadow-blur, shadow-opacity, background-opacity',
        'transition-duration': '0.3s',
        'transition-timing-function': 'ease-out',
      },
    },
    {
      selector: 'node.active-path',
      style: {
        'shadow-blur': 18,
        'shadow-opacity': 0.6,
        'border-width': 2,
        'border-color': function(e) { return colorFor(e.data('type')).ring; },
        'border-opacity': 0.5,
      },
    },
    {
      selector: 'node.selected-node',
      style: {
        'width': 56,
        'height': 56,
        'shadow-blur': 24,
        'shadow-opacity': 0.8,
        'border-width': 2.5,
        'border-color': function(e) { return colorFor(e.data('type')).ring; },
        'border-opacity': 0.7,
        'font-size': '11px',
        'font-weight': '600',
        'color': labelActive,
        'background-opacity': 1,
      },
    },
    {
      selector: 'node.root-node',
      style: {
        'width': 52,
        'height': 52,
        'font-size': '11px',
        'font-weight': '600',
        'color': labelActive,
        'text-valign': 'center',
        'text-halign': 'center',
        'text-margin-y': 0,
        'shadow-blur': 20,
        'shadow-opacity': 0.5,
      },
    },
    {
      selector: 'node.dimmed',
      style: {
        'opacity': parseFloat(cssVar('--graph-dimmed')) || 0.3,
        'transition-duration': '0.4s',
      },
    },
    {
      selector: 'node.leaf',
      style: { 'cursor': 'pointer' },
    },
    {
      selector: 'node.has-badge',
      style: {
        // Badge nodes keep label below, badge is rendered as DOM overlay
      },
    },
    {
      selector: 'edge',
      style: {
        'width': 1,
        'line-color': edgeColor,
        'curve-style': 'unbundled-bezier',
        'control-point-distances': 20,
        'control-point-weights': 0.5,
        'opacity': 1,
        'transition-property': 'opacity, line-color',
        'transition-duration': '0.3s',
      },
    },
    {
      selector: 'edge.active-edge',
      style: {
        'line-color': edgeActive,
        'width': 1.5,
      },
    },
    {
      selector: 'edge.dimmed',
      style: { 'opacity': 0.15 },
    },
    {
      selector: 'node.hover-highlight',
      style: {
        'shadow-blur': 20,
        'shadow-opacity': 0.7,
        'background-opacity': 1,
        'width': 50,
        'height': 50,
      },
    },
  ];
}

// -- Graph Manager -----------------------------------------------------------
export class GraphManager {
  constructor(containerEl, onNodeSelect) {
    this.container = containerEl;
    this.onNodeSelect = onNodeSelect;
    this.cy = null;
    this.breadcrumbs = [];
    this.currentLayer = -1;
    this.expandedNodes = new Set();
    this.drillPath = [];
    this.childrenMap = new Map();
    this._savedState = null;
    this._badgeLayer = null; // DOM overlay for badge pills
  }

  init() {
    this.cy = cytoscape({
      container: this.container,
      style: buildStylesheet(),
      elements: [],
      layout: { name: 'preset' },
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
      minZoom: 0.3,
      maxZoom: 3,
      wheelSensitivity: 0.25,
    });

    this.cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      const id = node.id();
      if (this.expandedNodes.has(id) && this.drillPath[this.drillPath.length - 1] === id) return;
      this.handleNodeClick(node.data());
    });

    this.cy.on('mouseover', 'node', (evt) => {
      const node = evt.target;
      if (!node.hasClass('selected-node') && !node.hasClass('root-node')) {
        node.addClass('hover-highlight');
        this.container.style.cursor = 'pointer';
      }
      // #15: Show tooltip for truncated labels
      const fullLabel = node.data('fullLabel');
      if (fullLabel && fullLabel.length > 12) {
        this._showTooltip(node, fullLabel);
      }
    });

    this.cy.on('mouseout', 'node', (evt) => {
      evt.target.removeClass('hover-highlight');
      this.container.style.cursor = 'default';
      this._hideTooltip();
    });

    this._startBadgeUpdates();
  }

  /** Re-apply the stylesheet (called on theme change) */
  refreshTheme() {
    if (!this.cy) return;
    this.cy.style(buildStylesheet());
    this.cy.style().update();
  }

  // == Badge overlay ==========================================================
  _ensureBadgeLayer() {
    if (!this._badgeLayer) {
      this._badgeLayer = document.createElement('div');
      this._badgeLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:5';
      this.container.style.position = 'relative';
      this.container.appendChild(this._badgeLayer);
    }
  }

  _updateBadges() {
    this._ensureBadgeLayer();
    this._badgeLayer.innerHTML = '';
    if (!this.cy) return;

    const pan = this.cy.pan();
    const zoom = this.cy.zoom();

    this.cy.nodes().forEach((node) => {
      const badge = node.data('badge');
      if (badge == null || badge === 0) return;

      const pos = node.position();
      const w = node.width() * zoom;
      const screenX = pos.x * zoom + pan.x + w / 2 - 4;
      const screenY = pos.y * zoom + pan.y - w / 2 - 4;

      const type = node.data('type');
      const isPending = type === 'action_item' || type === 'pending' || node.id() === 'pending';
      const bgColor = isPending ? '#F87171' : 'var(--accent)';

      const el = document.createElement('div');
      el.style.cssText = `position:absolute;left:${screenX}px;top:${screenY}px;
        min-width:18px;height:18px;border-radius:9px;
        background:${bgColor};color:#fff;font-size:9px;font-weight:700;
        display:flex;align-items:center;justify-content:center;padding:0 5px;
        box-shadow:0 1px 3px rgba(0,0,0,0.3);font-family:var(--font)`;
      el.textContent = badge > 99 ? '99+' : badge;
      this._badgeLayer.appendChild(el);
    });
  }

  _startBadgeUpdates() {
    if (this.cy) {
      this.cy.on('pan zoom', () => { this._updateBadges(); this._hideTooltip(); });
    }
  }

  // == Tooltips (#15) ========================================================
  _showTooltip(node, text) {
    this._hideTooltip();
    const pan = this.cy.pan();
    const zoom = this.cy.zoom();
    const pos = node.position();
    const x = pos.x * zoom + pan.x;
    const y = pos.y * zoom + pan.y - (node.height() * zoom) / 2 - 8;

    const tip = document.createElement('div');
    tip.className = 'graph-tooltip';
    tip.textContent = text;
    tip.style.cssText = `position:absolute;left:${x}px;top:${y}px;transform:translate(-50%,-100%);
      background:var(--surface-raised);color:var(--text);border:1px solid var(--border);
      border-radius:var(--r-sm);padding:4px 8px;font-size:11px;font-family:var(--font);
      pointer-events:none;white-space:nowrap;z-index:6;box-shadow:var(--shadow-sm)`;
    this._ensureBadgeLayer();
    this._badgeLayer.appendChild(tip);
    this._tooltip = tip;
  }

  _hideTooltip() {
    if (this._tooltip) { this._tooltip.remove(); this._tooltip = null; }
  }

  // == Loading pulse on node (#10) ===========================================
  _pulseNode(id) {
    const node = this.cy?.getElementById(id);
    if (!node?.length) return;
    node.animate(
      { style: { 'shadow-blur': 30, 'shadow-opacity': 1 } },
      { duration: 300, complete: () => {
        node.animate(
          { style: { 'shadow-blur': 18, 'shadow-opacity': 0.6 } },
          { duration: 300 }
        );
      }}
    );
  }

  // == Load root =============================================================
  async loadRoot() {
    try {
      const data = await api.getGraphRoot();
      this.cy.elements().remove();
      this.expandedNodes.clear();
      this.childrenMap.clear();
      this.drillPath = ['root'];
      this.breadcrumbs = [{ id: 'root', label: 'Me', type: 'root', layer: 0 }];
      this.currentLayer = 0;

      const center = this.cy.add({
        data: { id: 'root', label: 'Me', type: 'root' },
        position: { x: 0, y: 0 },
      });
      center.addClass('root-node active-path');

      const categories = data.categories || [];
      const childIds = [];
      categories.forEach((cat, i) => {
        const angle = (i / categories.length) * 2 * Math.PI - Math.PI / 2;
        const r = 120;
        this.cy.add({
          data: {
            id: cat.id,
            label: cat.label,
            type: cat.type || 'category',
            badge: cat.count,
            parentRef: 'root',
          },
          position: { x: Math.cos(angle) * r, y: Math.sin(angle) * r },
        });
        this.cy.add({
          data: { id: `root-${cat.id}`, source: 'root', target: cat.id },
        });
        childIds.push(cat.id);
      });

      this.childrenMap.set('root', childIds);
      this.expandedNodes.add('root');

      const childEls = this.cy.nodes().not(center);
      childEls.style('opacity', 0);
      childEls.animate({ style: { opacity: 1 } }, { duration: 400, easing: 'ease-out-cubic' });

      this.cy.fit(undefined, 60);
      setTimeout(() => this._updateBadges(), 450);
      this.onNodeSelect({ id: 'root', type: 'root', label: 'Me' });
    } catch (err) {
      console.error('Failed to load root:', err);
      this.showEmpty('Could not connect to server');
    }
  }

  // == Handle node click =====================================================
  async handleNodeClick(nodeData) {
    const { id, type, label } = nodeData;
    const parentRef = nodeData.parentRef;

    if (this.drillPath.includes(id) && this.expandedNodes.has(id)) {
      this.selectNode(id);
      return;
    }

    if (parentRef && this.childrenMap.has(parentRef)) {
      const siblings = this.childrenMap.get(parentRef);
      for (const sibId of siblings) {
        if (sibId !== id && this.expandedNodes.has(sibId)) {
          this.collapseNode(sibId);
        }
      }
    }

    this.collapseDeeper(id);
    this._pulseNode(id);
    await this.expandNode(id, type, label);
  }

  // == Expand a node =========================================================
  async expandNode(id, type, label) {
    try {
      let children = [];

      if (type === 'category' || type === 'community' || (this.currentLayer === 0 && id !== 'root')) {
        const typeMap = { people: 'person', topics: 'topic', documents: 'document', pending: null, groups: null };
        const entityType = typeMap[id];

        if (id === 'pending') {
          const attn = await api.getAttention();
          children = (attn.items || attn || []).slice(0, 18).map(a => ({
            id: a.id, type: 'action_item',
            label: a.title || a.description || 'Pending',
          }));
        } else if (id === 'groups') {
          // L1: list all communities
          const result = await api.getCommunities();
          children = (result.communities || []).slice(0, 18).map(c => ({
            id: c.id, type: 'community',
            label: c.name || c.id,
            badge: c.memberCount,
          }));
        } else if (type === 'community') {
          // L2: drilling into a community — show its member entities
          const result = await api.getCommunity(id);
          const members = result.members || [];
          children = members.slice(0, 18).map(e => ({
            id: e.id, type: e.type || 'person',
            label: e.canonicalName || e.id,
          }));
        } else if (entityType) {
          const result = await api.getEntities({ type: entityType, limit: 18, sort: 'recent' });
          children = (result.entities || result || []).slice(0, 18).map(e => ({
            id: e.id, type: e.type,
            label: e.canonicalName || e.title || e.id,
          }));
        }
      } else if (id !== 'root') {
        const data = await api.getGraphEntity(id);
        const nodes = data.nodes || [];
        children = nodes.filter(n => n.id !== id).slice(0, 18).map(n => ({
          id: n.id, type: n.type,
          label: n.label || n.canonicalName || n.id,
          badge: n.attributes?.count,
        }));
      }

      if (!children.length) {
        this.selectNode(id);
        const newLayer = this.drillPath.length;
        if (!this.drillPath.includes(id)) {
          this.drillPath.push(id);
          this.breadcrumbs.push({ id, label, type, layer: newLayer });
          this.currentLayer = newLayer;
        }
        this.onNodeSelect({ id, type, label });
        return;
      }

      if (!this.drillPath.includes(id)) {
        this.drillPath.push(id);
        this.breadcrumbs.push({ id, label: label.split(' (')[0], type, layer: this.drillPath.length - 1 });
        this.currentLayer = this.drillPath.length - 1;
      }

      const parentNode = this.cy.getElementById(id);
      const parentPos = parentNode.position();

      const childIds = [];
      const parentAngle = this.getAngleFromParent(id);
      const arcSpan = Math.min(Math.PI * 1.2, children.length * 0.22);
      const startAngle = parentAngle - arcSpan / 2;
      const radius = 90 + Math.min(children.length * 3, 40);

      children.forEach((child, i) => {
        const angle = children.length === 1
          ? parentAngle
          : startAngle + (i / (children.length - 1)) * arcSpan;
        const x = parentPos.x + Math.cos(angle) * radius;
        const y = parentPos.y + Math.sin(angle) * radius;

        if (!this.cy.getElementById(child.id).length) {
          const nodeEl = this.cy.add({
            data: {
              id: child.id,
              label: child.label.length > 12 ? child.label.slice(0, 11) + '\u2026' : child.label,
              fullLabel: child.label,
              type: child.type,
              badge: child.badge,
              parentRef: id,
            },
            position: { x: parentPos.x, y: parentPos.y },
          });
          nodeEl.addClass('leaf');
          nodeEl.style('opacity', 0);

          nodeEl.animate(
            { position: { x, y }, style: { opacity: 1 } },
            { duration: 450, easing: 'ease-out-cubic' }
          );
        }

        const edgeId = `${id}-${child.id}`;
        if (!this.cy.getElementById(edgeId).length) {
          const edge = this.cy.add({
            data: { id: edgeId, source: id, target: child.id },
          });
          edge.style('opacity', 0);
          edge.animate({ style: { opacity: 1 } }, { duration: 450, easing: 'ease-out-cubic' });
        }

        childIds.push(child.id);
      });

      this.childrenMap.set(id, childIds);
      this.expandedNodes.add(id);

      this.selectNode(id);
      this.updateDimming();

      setTimeout(() => {
        this.cy.animate({ fit: { padding: 50 } }, { duration: 350, easing: 'ease-out-cubic' });
        setTimeout(() => this._updateBadges(), 400);
      }, 200);

      this.onNodeSelect({ id, type, label });
    } catch (err) {
      console.error('Expand failed:', err);
    }
  }

  // == Collapse node children ================================================
  collapseNode(id) {
    const children = this.childrenMap.get(id);
    if (!children) return;

    for (const childId of children) {
      if (this.expandedNodes.has(childId)) {
        this.collapseNode(childId);
      }
    }

    const parentNode = this.cy.getElementById(id);
    const parentPos = parentNode.length ? parentNode.position() : { x: 0, y: 0 };

    for (const childId of children) {
      const childNode = this.cy.getElementById(childId);
      if (childNode.length) {
        childNode.animate(
          { position: { ...parentPos }, style: { opacity: 0 } },
          { duration: 300, easing: 'ease-in-cubic', complete: () => { childNode.remove(); } }
        );
      }
      const edgeId = `${id}-${childId}`;
      const edge = this.cy.getElementById(edgeId);
      if (edge.length) {
        edge.animate(
          { style: { opacity: 0 } },
          { duration: 200, complete: () => { edge.remove(); } }
        );
      }
    }

    this.childrenMap.delete(id);
    this.expandedNodes.delete(id);
  }

  // == Collapse deeper =======================================================
  collapseDeeper(keepId) {
    const keepIdx = this.drillPath.indexOf(keepId);
    if (keepIdx >= 0) {
      const toCollapse = this.drillPath.slice(keepIdx + 1).reverse();
      for (const nid of toCollapse) {
        if (this.expandedNodes.has(nid)) this.collapseNode(nid);
      }
      this.drillPath = this.drillPath.slice(0, keepIdx + 1);
      this.breadcrumbs = this.breadcrumbs.slice(0, keepIdx + 1);
      this.currentLayer = keepIdx;
    }
  }

  // == Select node ===========================================================
  selectNode(id) {
    this.cy.nodes().removeClass('selected-node active-path');
    this.cy.edges().removeClass('active-edge');

    for (const pathId of this.drillPath) {
      this.cy.getElementById(pathId).addClass('active-path');
    }
    this.cy.getElementById(id).addClass('selected-node active-path');

    for (let i = 1; i < this.drillPath.length; i++) {
      const edgeId = `${this.drillPath[i - 1]}-${this.drillPath[i]}`;
      this.cy.getElementById(edgeId).addClass('active-edge');
    }

    this.updateDimming();
  }

  // == Dimming ===============================================================
  updateDimming() {
    const pathSet = new Set(this.drillPath);
    const lastExpanded = this.drillPath[this.drillPath.length - 1];
    const lastChildren = this.childrenMap.get(lastExpanded) || [];
    for (const cid of lastChildren) pathSet.add(cid);

    this.cy.nodes().forEach((node) => {
      node[pathSet.has(node.id()) ? 'removeClass' : 'addClass']('dimmed');
    });

    this.cy.edges().forEach((edge) => {
      const both = pathSet.has(edge.source().id()) && pathSet.has(edge.target().id());
      edge[both ? 'removeClass' : 'addClass']('dimmed');
    });
  }

  // == Navigate to breadcrumb ================================================
  async navigateTo(index) {
    if (index >= this.breadcrumbs.length - 1) return;

    const crumb = this.breadcrumbs[index];

    const toCollapse = [...this.drillPath].slice(index + 1).reverse();
    for (const nid of toCollapse) {
      if (this.expandedNodes.has(nid)) this.collapseNode(nid);
    }

    this.drillPath = this.drillPath.slice(0, index + 1);
    this.breadcrumbs = this.breadcrumbs.slice(0, index + 1);
    this.currentLayer = index;

    this.selectNode(crumb.id);
    this.updateDimming();

    setTimeout(() => {
      this.cy.animate({ fit: { padding: 50 } }, { duration: 350, easing: 'ease-out-cubic' });
    }, 350);

    this.onNodeSelect({ id: crumb.id, type: crumb.type, label: crumb.label });
  }

  // == Angle from parent =====================================================
  getAngleFromParent(nodeId) {
    const node = this.cy.getElementById(nodeId);
    if (!node.length) return 0;
    const parentRef = node.data('parentRef');
    if (!parentRef) return Math.PI / 2;
    const parent = this.cy.getElementById(parentRef);
    if (!parent.length) return Math.PI / 2;
    return Math.atan2(
      node.position('y') - parent.position('y'),
      node.position('x') - parent.position('x')
    );
  }

  // == Empty state ===========================================================
  showEmpty(message) {
    if (!this.cy) return;
    this.cy.elements().remove();
    this.cy.add({
      data: { id: 'empty', label: message, type: 'root' },
      position: { x: 0, y: 0 },
    });
    this.cy.getElementById('empty').addClass('root-node');
    this.cy.fit();
  }

  destroy() {
    if (this.cy) { this.cy.destroy(); this.cy = null; }
  }
}
