// ============================================================================
// MindFlow App — Main Controller
// ============================================================================

import { api, connectWebSocket, onEvent } from './api.js';
import { GraphManager } from './graph.js';
import { TimelinePanel } from './timeline.js';

const SEARCH_PLACEHOLDERS = [
  'What did Wang Zong say about the budget?',
  '\u8C01\u63D0\u8FC7\u5408\u540C\u7EED\u7B7E\uFF1F',
  "What's pending?",
  'Summarize my conversations with Lisa',
  'What was the Vendor B quote?',
  'Show me stale topics',
];

class MindFlowApp {
  constructor() {
    this.graph = null;
    this.timeline = null;
    this.searchInput = null;
    this.searchClear = null;
    this.breadcrumbsEl = null;
    this.attentionBadge = null;
    this._toastContainer = null;
    this._placeholderIdx = 0;
    this._placeholderTimer = null;
    this._shortcutsVisible = false;
    this._graphCollapsed = true; // default collapsed
    this._settingsOpen = false;
    this._cmdPaletteOpen = false;
  }

  async init() {
    this.searchInput = document.getElementById('search-input');
    this.searchClear = document.getElementById('search-clear');
    this.breadcrumbsEl = document.getElementById('breadcrumbs');
    const graphEl = document.getElementById('graph-container');
    const detailEl = document.getElementById('detail-panel');
    const searchForm = document.getElementById('search-form');

    // Timeline
    this.timeline = new TimelinePanel(detailEl, {
      onNavigate: (idOrType) => this._navigateToEntity(idOrType),
      onExpandGraph: () => this._setGraphCollapsed(false),
    });

    // Graph
    this.graph = new GraphManager(graphEl, (nodeData) => this.onNodeSelected(nodeData));
    this.graph.init();

    // Search
    searchForm.addEventListener('submit', (e) => { e.preventDefault(); this.handleSearch(); });

    // Clear search button (#17)
    this.searchInput.addEventListener('input', () => this._updateSearchClear());
    this.searchClear.addEventListener('click', () => {
      this.searchInput.value = '';
      this._updateSearchClear();
      this.searchInput.focus();
    });

    // Topbar buttons
    document.getElementById('theme-toggle').addEventListener('click', () => this.toggleTheme());
    document.getElementById('graph-toggle').addEventListener('click', () => this._toggleGraph());
    document.getElementById('settings-toggle').addEventListener('click', () => this._toggleSettings());
    document.getElementById('settings-close').addEventListener('click', () => this._toggleSettings(false));

    // Command palette backdrop click
    document.getElementById('cmd-palette').addEventListener('click', (e) => {
      if (e.target.id === 'cmd-palette') this._closeCmdPalette();
    });
    document.getElementById('cmd-input').addEventListener('input', (e) => this._onCmdInput(e.target.value));
    document.getElementById('cmd-input').addEventListener('keydown', (e) => this._onCmdKeydown(e));

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => this._handleKeydown(e));

    // System theme
    if (!localStorage.getItem('mindflow-theme')) {
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
        if (!localStorage.getItem('mindflow-theme')) this.setTheme(e.matches ? 'light' : 'dark');
      });
    }

    // Rotating placeholders
    this._startPlaceholderRotation();

    // Start collapsed (#2)
    this._setGraphCollapsed(true);

    await this.graph.loadRoot();
    this.renderBreadcrumbs();

    this.attentionBadge = document.getElementById('attention-badge');

    // WebSocket
    connectWebSocket();
    onEvent('entity:created', (data) => {
      if (this.graph?.hasNode?.(data?.id)) this.graph.loadRoot().catch(() => {});
    });
    onEvent('attention:created', () => this._refreshAttentionBadge());
    onEvent('items:ingested', (data) => {
      const count = data?.count ?? data?.itemCount ?? 0;
      if (count > 0) this.showToast(`${count} new item${count === 1 ? '' : 's'} indexed`);
    });
  }

  // == Keyboard ==============================================================
  _handleKeydown(e) {
    // Command palette
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      this._cmdPaletteOpen ? this._closeCmdPalette() : this._openCmdPalette();
      return;
    }

    if (this._cmdPaletteOpen && e.key === 'Escape') { this._closeCmdPalette(); return; }
    if (this._shortcutsVisible && (e.key === 'Escape' || e.key === '?')) { this._hideShortcuts(); return; }
    if (this._settingsOpen && e.key === 'Escape') { this._toggleSettings(false); return; }

    if (e.key === '?' && document.activeElement !== this.searchInput && !this._cmdPaletteOpen) {
      e.preventDefault(); this._showShortcuts(); return;
    }
    if (e.key === '/' && document.activeElement !== this.searchInput && !this._cmdPaletteOpen) {
      e.preventDefault(); this.searchInput.focus(); return;
    }
    if (e.key === 'Escape') {
      if (document.activeElement === this.searchInput) { this.searchInput.blur(); }
      else if (this.graph && this.graph.breadcrumbs.length > 1) {
        this.graph.navigateTo(this.graph.breadcrumbs.length - 2);
      }
    }
  }

  _showShortcuts() {
    if (this._shortcutsVisible) return;
    this._shortcutsVisible = true;
    const overlay = document.createElement('div');
    overlay.className = 'shortcuts-overlay'; overlay.id = 'shortcuts-overlay';
    overlay.innerHTML = `
      <div class="shortcuts-card">
        <h3>Keyboard shortcuts</h3>
        <div class="shortcut-row"><span>Focus search</span><kbd>/</kbd></div>
        <div class="shortcut-row"><span>Command palette</span><div><kbd>\u2318</kbd> <kbd>K</kbd></div></div>
        <div class="shortcut-row"><span>Go up one level</span><kbd>Esc</kbd></div>
        <div class="shortcut-row"><span>Show shortcuts</span><kbd>?</kbd></div>
      </div>`;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this._hideShortcuts(); });
    document.body.appendChild(overlay);
  }

  _hideShortcuts() {
    this._shortcutsVisible = false;
    document.getElementById('shortcuts-overlay')?.remove();
  }

  // == Search clear (#17) ====================================================
  _updateSearchClear() {
    const hasValue = this.searchInput.value.length > 0;
    this.searchClear.hidden = !hasValue;
    document.getElementById('search-kbd-hint').parentElement.style.display = hasValue ? 'none' : '';
  }

  // == Placeholder rotation ==================================================
  _startPlaceholderRotation() {
    this.searchInput.placeholder = SEARCH_PLACEHOLDERS[0];
    this._placeholderTimer = setInterval(() => {
      this._placeholderIdx = (this._placeholderIdx + 1) % SEARCH_PLACEHOLDERS.length;
      this.searchInput.placeholder = SEARCH_PLACEHOLDERS[this._placeholderIdx];
    }, 5000);
  }

  // == Graph toggle (#2) =====================================================
  _toggleGraph() {
    this._setGraphCollapsed(!this._graphCollapsed);
  }

  _setGraphCollapsed(collapsed) {
    this._graphCollapsed = collapsed;
    const panel = document.getElementById('graph-panel');
    const btn = document.getElementById('graph-toggle');
    if (collapsed) {
      panel.classList.add('collapsed');
      btn.classList.remove('active');
    } else {
      panel.classList.remove('collapsed');
      btn.classList.add('active');
      // Refit graph after expand
      setTimeout(() => {
        if (this.graph?.cy) {
          this.graph.cy.resize();
          this.graph.cy.fit(undefined, 50);
          this.graph._updateBadges();
        }
      }, 400);
    }
  }

  // == Theme =================================================================
  toggleTheme() {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    this.setTheme(next);
    localStorage.setItem('mindflow-theme', next);
  }

  setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (this.graph) this.graph.refreshTheme();
  }

  // == Settings panel (#12) ==================================================
  _toggleSettings(force) {
    this._settingsOpen = force ?? !this._settingsOpen;
    const panel = document.getElementById('settings-panel');
    if (this._settingsOpen) {
      panel.hidden = false;
      this._loadSettings();
    } else {
      panel.hidden = true;
    }
  }

  async _loadSettings() {
    const body = document.getElementById('settings-body');
    body.innerHTML = `<div class="loading-state" style="padding:20px"><div class="loading-spinner"></div></div>`;

    try {
      const stats = await api.getStats();
      const syncText = stats.lastSyncAt ? `Last sync ${new Date(stats.lastSyncAt).toLocaleString()}` : 'No sync yet';

      body.innerHTML = `
        <div class="settings-section">
          <div class="settings-section-title">Sync Status</div>
          <div class="settings-row"><span>Status</span><span class="settings-row-value">${syncText}</span></div>
          <div class="settings-row"><span>Items indexed</span><span class="settings-row-value">${stats.rawItemCount ?? 0}</span></div>
          <div class="settings-row"><span>Entities</span><span class="settings-row-value">${stats.entityCount ?? 0}</span></div>
          <div class="settings-row"><span>Relationships</span><span class="settings-row-value">${stats.relationshipCount ?? 0}</span></div>
          <div style="margin-top:12px">
            <button class="settings-btn settings-btn--primary" id="settings-ingest-btn">Run ingestion</button>
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-section-title">Navigation</div>
          <div class="settings-row"><span>Keyboard shortcuts</span>
            <button class="settings-btn" id="settings-shortcuts-btn">View</button>
          </div>
        </div>`;

      document.getElementById('settings-ingest-btn')?.addEventListener('click', async (e) => {
        const btn = e.target;
        btn.textContent = 'Running...'; btn.disabled = true;
        try { await api.triggerIngest(); this.showToast('Ingestion started'); } catch { this.showToast('Ingestion failed'); }
        btn.textContent = 'Run ingestion'; btn.disabled = false;
      });

      document.getElementById('settings-shortcuts-btn')?.addEventListener('click', () => {
        this._toggleSettings(false);
        this._showShortcuts();
      });
    } catch {
      body.innerHTML = `<div class="empty-state"><p class="empty-text">Could not load settings.</p></div>`;
    }
  }

  // == Command Palette (#18) =================================================
  _openCmdPalette() {
    this._cmdPaletteOpen = true;
    const el = document.getElementById('cmd-palette');
    el.hidden = false;
    const input = document.getElementById('cmd-input');
    input.value = '';
    input.focus();
    document.getElementById('cmd-results').innerHTML = this._cmdDefaultResults();
  }

  _closeCmdPalette() {
    this._cmdPaletteOpen = false;
    document.getElementById('cmd-palette').hidden = true;
  }

  _cmdDefaultResults() {
    return `
      <div class="cmd-result" data-cmd="pending"><span class="cmd-result-type" style="color:#F87171;background:rgba(248,113,113,0.12)">Nav</span><span class="cmd-result-label">Show pending items</span><span class="cmd-result-hint">attention</span></div>
      <div class="cmd-result" data-cmd="people"><span class="cmd-result-type" style="color:#8B5CF6;background:rgba(139,92,246,0.12)">Nav</span><span class="cmd-result-label">Browse people</span></div>
      <div class="cmd-result" data-cmd="topics"><span class="cmd-result-type" style="color:#14B8A6;background:rgba(20,184,166,0.12)">Nav</span><span class="cmd-result-label">Browse topics</span></div>
      <div class="cmd-result" data-cmd="settings"><span class="cmd-result-type" style="color:var(--text-tertiary);background:var(--surface-raised)">App</span><span class="cmd-result-label">Open settings</span></div>
      <div class="cmd-result" data-cmd="shortcuts"><span class="cmd-result-type" style="color:var(--text-tertiary);background:var(--surface-raised)">App</span><span class="cmd-result-label">Keyboard shortcuts</span><span class="cmd-result-hint">?</span></div>`;
  }

  _onCmdInput(value) {
    const q = value.trim();
    const results = document.getElementById('cmd-results');
    if (!q) { results.innerHTML = this._cmdDefaultResults(); return; }

    // If it looks like a question, show "Search" option
    const isQuestion = q.includes('?') || q.length > 15 || /^(what|who|when|where|how|show|find|list|\u8C01|\u4EC0\u4E48)/i.test(q);
    let html = '';
    if (isQuestion) {
      html += `<div class="cmd-result" data-cmd="query" data-query="${this._escAttr(q)}"><span class="cmd-result-type" style="color:var(--accent);background:var(--accent-soft)">Query</span><span class="cmd-result-label">Search: ${this._escHtml(q)}</span></div>`;
    }
    // Always offer navigate
    html += `<div class="cmd-result" data-cmd="search-nav" data-query="${this._escAttr(q)}"><span class="cmd-result-type" style="color:var(--text-tertiary);background:var(--surface-raised)">Nav</span><span class="cmd-result-label">Find entity: ${this._escHtml(q)}</span></div>`;

    // Static commands
    if ('pending'.includes(q.toLowerCase())) {
      html += `<div class="cmd-result" data-cmd="pending"><span class="cmd-result-type" style="color:#F87171;background:rgba(248,113,113,0.12)">Nav</span><span class="cmd-result-label">Show pending items</span></div>`;
    }
    if ('settings'.includes(q.toLowerCase())) {
      html += `<div class="cmd-result" data-cmd="settings"><span class="cmd-result-type" style="color:var(--text-tertiary);background:var(--surface-raised)">App</span><span class="cmd-result-label">Open settings</span></div>`;
    }

    results.innerHTML = html;
  }

  _onCmdKeydown(e) {
    if (e.key === 'Enter') {
      const active = document.querySelector('.cmd-result.active') || document.querySelector('.cmd-result');
      if (active) this._executeCmdResult(active);
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = [...document.querySelectorAll('.cmd-result')];
      const cur = items.findIndex(i => i.classList.contains('active'));
      items.forEach(i => i.classList.remove('active'));
      const next = e.key === 'ArrowDown' ? Math.min(cur + 1, items.length - 1) : Math.max(cur - 1, 0);
      items[next]?.classList.add('active');
    }
  }

  _executeCmdResult(el) {
    const cmd = el.dataset.cmd;
    this._closeCmdPalette();

    if (cmd === 'pending' || cmd === 'people' || cmd === 'topics' || cmd === 'documents') {
      this._navigateToEntity(cmd);
    } else if (cmd === 'settings') {
      this._toggleSettings(true);
    } else if (cmd === 'shortcuts') {
      this._showShortcuts();
    } else if (cmd === 'query') {
      this.searchInput.value = el.dataset.query || '';
      this._updateSearchClear();
      this.handleSearch();
    } else if (cmd === 'search-nav') {
      // Could search entities, but for now just populate search
      this.searchInput.value = el.dataset.query || '';
      this._updateSearchClear();
      this.searchInput.focus();
    }
  }

  // Click on cmd results
  _initCmdResultClicks() {} // handled via delegation below

  // == Navigation ============================================================
  _navigateToEntity(idOrType) {
    // Expand graph when navigating
    if (this._graphCollapsed) this._setGraphCollapsed(false);

    if (['people', 'topics', 'documents', 'pending'].includes(idOrType)) {
      if (this.graph?.cy) {
        const node = this.graph.cy.getElementById(idOrType);
        if (node.length) { this.graph.handleNodeClick(node.data()); return; }
      }
    }
    if (this.graph?.cy) {
      const node = this.graph.cy.getElementById(idOrType);
      if (node.length) this.graph.handleNodeClick(node.data());
    }
  }

  // == Callbacks =============================================================
  onNodeSelected(nodeData) {
    // Auto-expand graph when drilling into entities (#2)
    if (nodeData.type !== 'root' && this._graphCollapsed) {
      this._setGraphCollapsed(false);
    }
    this.renderBreadcrumbs();
    this.timeline.loadEntity(nodeData);
  }

  renderBreadcrumbs() {
    if (!this.graph || !this.breadcrumbsEl) return;
    const crumbs = this.graph.breadcrumbs;
    this.breadcrumbsEl.innerHTML = crumbs.map((c, i) => {
      const sep = i > 0
        ? '<svg class="breadcrumb-sep" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>'
        : '';
      if (i === crumbs.length - 1) return `${sep}<span class="breadcrumb-current">${this._escHtml(c.label)}</span>`;
      return `${sep}<a class="breadcrumb-link" data-index="${i}" href="#">${this._escHtml(c.label)}</a>`;
    }).join('');

    this.breadcrumbsEl.querySelectorAll('.breadcrumb-link').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        this.graph.navigateTo(parseInt(el.dataset.index, 10));
      });
    });
  }

  async handleSearch() {
    const q = this.searchInput.value.trim();
    if (!q) return;
    this.timeline.showLoading('Searching');
    this.searchInput.blur();
    try {
      const result = await api.query(q);
      this.timeline.renderQueryResult(result);
    } catch { this.timeline.showError('Search'); }
  }

  _escHtml(str) {
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
  }

  _escAttr(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // == Attention badge =======================================================
  async _refreshAttentionBadge() {
    if (!this.attentionBadge) return;
    try {
      const data = await api.getAttention();
      const count = Array.isArray(data) ? data.length : (data?.total ?? 0);
      this.attentionBadge.textContent = count > 0 ? String(count) : '';
      this.attentionBadge.hidden = count === 0;
    } catch {}
  }

  // == Toast =================================================================
  showToast(message) {
    if (!this._toastContainer) {
      const c = document.createElement('div');
      c.id = 'toast-container';
      c.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:9999;display:flex;flex-direction:column;gap:0.5rem;pointer-events:none';
      document.body.appendChild(c);
      this._toastContainer = c;
    }
    const t = document.createElement('div');
    t.textContent = message;
    t.style.cssText = 'background:var(--surface-raised);color:var(--text);border:1px solid var(--border);border-radius:var(--r-md);padding:0.5rem 0.875rem;font-size:0.8125rem;box-shadow:var(--shadow-md);transform:translateX(110%);transition:transform 0.25s ease';
    this._toastContainer.appendChild(t);
    requestAnimationFrame(() => requestAnimationFrame(() => { t.style.transform = 'translateX(0)'; }));
    setTimeout(() => {
      t.style.transform = 'translateX(110%)';
      t.addEventListener('transitionend', () => t.remove(), { once: true });
    }, 3000);
  }
}

// Boot + command palette result clicks
document.addEventListener('DOMContentLoaded', () => {
  const app = new MindFlowApp();

  // Delegate cmd palette clicks
  document.getElementById('cmd-results')?.addEventListener('click', (e) => {
    const result = e.target.closest('.cmd-result');
    if (result) app._executeCmdResult(result);
  });

  app.init().catch(err => console.error('Init failed:', err));
});
