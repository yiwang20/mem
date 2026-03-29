// ============================================================================
// MindFlow Timeline & Detail Panel
// ============================================================================

import { api } from './api.js';

const CHANNEL_BADGES = {
  email:    { label: 'Email',    color: '#60A5FA', bg: 'rgba(96,165,250,0.12)' },
  imessage: { label: 'iMessage', color: '#4ADE80', bg: 'rgba(74,222,128,0.12)' },
  meeting:  { label: 'Meeting',  color: '#A78BFA', bg: 'rgba(167,139,250,0.12)' },
  file:     { label: 'Document', color: '#FBBF24', bg: 'rgba(251,191,36,0.12)' },
  document: { label: 'Document', color: '#FBBF24', bg: 'rgba(251,191,36,0.12)' },
};

function channelBadge(ch) {
  const c = CHANNEL_BADGES[ch] || CHANNEL_BADGES.email;
  return `<span class="channel-badge" style="color:${c.color};background:${c.bg}">${c.label}</span>`;
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(typeof ts === 'number' ? ts : Date.parse(ts));
  const now = new Date();
  const diff = Math.floor((now - d) / 86400000);
  if (diff === 0) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function timeAgo(ts) {
  if (!ts) return '';
  const d = new Date(typeof ts === 'number' ? ts : Date.parse(ts));
  const diff = Date.now() - d.getTime();
  if (diff < 0) return 'just now';
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '1 day ago';
  if (days < 7) return `${days} days ago`;
  return `${Math.floor(days / 7)}w ago`;
}

function truncate(text, max = 160) {
  if (!text) return '';
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '\u2026' : s;
}

function esc(str) {
  if (!str) return '';
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

// ULID pattern: 26 alphanumeric chars
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

function isUlid(str) { return ULID_RE.test(str); }

function cleanTitle(title) {
  if (!title) return 'Attention needed';
  // If the title is just a raw ULID, replace with friendly text
  if (isUlid(title.trim())) return 'Unknown sender';
  return title;
}

const TYPE_COLORS = {
  person: '#8B5CF6', topic: '#14B8A6', document: '#F59E0B',
  action_item: '#F87171', key_fact: '#3B82F6', thread: '#71717A',
};

function urgencyColor(score) {
  if (score >= 0.7) return '#F87171';
  if (score >= 0.4) return '#FBBF24';
  return '#4ADE80';
}
function urgencyLabel(score) {
  if (score >= 0.7) return 'High';
  if (score >= 0.4) return 'Medium';
  return 'Low';
}

// ============================================================================
export class TimelinePanel {
  constructor(el, options = {}) {
    this.el = el;
    this.currentId = null;
    this.onNavigate = options.onNavigate || null;
    this.onExpandGraph = options.onExpandGraph || null;
    this.el.addEventListener('click', (e) => this._handleClick(e));
  }

  async loadEntity(data) {
    const { id, type, label } = data;
    this.currentId = id;

    if (type === 'root') { this.showMorningBrief(); return; }
    if (type === 'cross_ref' && data.crossRefData) {
      this.renderTimeline(label, type, data.crossRefData);
      return;
    }

    this.showLoading(label);

    if (type === 'person') {
      try {
        const [entity, tl] = await Promise.all([
          api.getEntity(id),
          api.getEntityTimeline(id),
        ]);
        if (this.currentId !== id) return;
        this.renderPersonDetail(entity, tl);
      } catch { this.showError(label); }
      return;
    }

    try {
      const tl = await api.getEntityTimeline(id);
      if (this.currentId !== id) return;
      this.renderTimeline(label, type, tl);
    } catch { this.showError(label); }
  }

  // == Morning Brief =========================================================
  async showMorningBrief() {
    this.showLoading('');
    try {
      const [stats, attnData] = await Promise.all([
        api.getStats(),
        api.getAttention().catch(() => ({ items: [] })),
      ]);

      // #5: Empty-state onboarding
      if ((stats.rawItemCount ?? 0) === 0) {
        this._showOnboarding();
        return;
      }

      const items = (attnData.items || attnData || []).slice(0, 5);
      const waitingCount = items.filter(i => i.type === 'unanswered_request').length;
      const staleCount = items.filter(i => i.type === 'stale_conversation').length;

      // #7: lastSyncAt fallback
      const syncText = stats.lastSyncAt ? `Last sync ${timeAgo(stats.lastSyncAt)}` : 'Sync status unavailable';

      let html = `<div class="brief-header">
        <h2 class="detail-title">Good ${this._dayPart()}</h2>
        <span class="brief-sync">${syncText}</span>
      </div>`;

      html += `<div class="brief-pills">`;
      if (waitingCount > 0) {
        html += `<button class="brief-pill brief-pill--pending" data-action="nav-type" data-type="pending">
          <span class="brief-pill-count">${waitingCount}</span> waiting for your reply
        </button>`;
      }
      if (staleCount > 0) {
        html += `<button class="brief-pill brief-pill--topic" data-action="nav-type" data-type="topics">
          <span class="brief-pill-count">${staleCount}</span> topic${staleCount > 1 ? 's' : ''} gone quiet
        </button>`;
      }
      if (stats.rawItemCount) {
        html += `<span class="brief-pill brief-pill--info">${stats.rawItemCount} items indexed</span>`;
      }
      html += `</div>`;

      if (items.length) {
        html += `<div class="brief-section-label">Needs attention</div><div class="attention-list">`;
        for (const item of items) html += this._renderAttentionItem(item);
        html += `</div>`;
      } else {
        html += `<div class="empty-state" style="padding:24px"><p class="empty-text">All clear. Nothing needs your attention.</p></div>`;
      }

      this.el.innerHTML = html;
    } catch {
      this._showFallbackStats();
    }
  }

  _dayPart() {
    const h = new Date().getHours();
    if (h < 12) return 'morning';
    if (h < 17) return 'afternoon';
    return 'evening';
  }

  // #5: Onboarding card
  _showOnboarding() {
    this.el.innerHTML = `
      <div class="welcome-card">
        <h2>Welcome to MindFlow</h2>
        <p>Your personal knowledge engine. Get started in three steps:</p>
        <ol class="welcome-steps">
          <li data-step="1.">Run <code>mindflow init</code> to configure data sources</li>
          <li data-step="2.">Run <code>mindflow ingest</code> to index your messages</li>
          <li data-step="3.">Explore your knowledge graph above</li>
        </ol>
      </div>`;
  }

  // #6: Clickable attention titles + #4: ULID fix
  _renderAttentionItem(item) {
    const urg = item.urgencyScore ?? 0.5;
    const color = urgencyColor(urg);
    const bgColor = color + '12';
    const title = cleanTitle(item.title || item.description);
    const entityId = item.entityId || '';
    const titleHtml = entityId
      ? `<span class="attention-title-link" data-action="navigate" data-entity-id="${esc(entityId)}">${esc(title)}</span>`
      : esc(title);

    return `
      <div class="attention-item" data-id="${esc(item.id)}">
        <div class="attention-urgency" style="background:${bgColor};color:${color}">${urgencyLabel(urg)}</div>
        <div class="attention-body">
          <div class="attention-title">${titleHtml}</div>
          <div class="attention-meta">${esc(item.type?.replace(/_/g, ' '))} &middot; ${timeAgo(item.detectedAt)}</div>
        </div>
        <div class="attention-actions">
          <button class="action-btn action-btn--ghost" data-action="snooze" data-id="${esc(item.id)}" title="Snooze 1 day" aria-label="Snooze 1 day">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </button>
          <button class="action-btn action-btn--ghost" data-action="dismiss" data-id="${esc(item.id)}" title="Dismiss" aria-label="Dismiss">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
          <button class="action-btn action-btn--resolve" data-action="resolve" data-id="${esc(item.id)}" title="Mark resolved" aria-label="Mark resolved">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
          </button>
        </div>
      </div>`;
  }

  async _showFallbackStats() {
    try {
      const s = await api.getStats();
      if ((s.rawItemCount ?? 0) === 0) { this._showOnboarding(); return; }
      this.el.innerHTML = `
        <div class="detail-header"><h2 class="detail-title">Overview</h2></div>
        <div class="stats-grid">
          ${this._stat('Items', s.rawItemCount ?? 0, '#818CF8')}
          ${this._stat('Entities', s.entityCount ?? 0, '#8B5CF6')}
          ${this._stat('Relationships', s.relationshipCount ?? 0, '#14B8A6')}
          ${this._stat('Attention', s.attentionItemCount ?? 0, '#F87171')}
        </div>`;
    } catch {
      this.el.innerHTML = `<div class="empty-state"><p class="empty-text">Select a node to explore.</p></div>`;
    }
  }

  _stat(label, value, color) {
    return `<div class="stat-card"><div class="stat-value" style="color:${color}">${value}</div><div class="stat-label">${label}</div></div>`;
  }

  // == Person Detail Card ====================================================
  renderPersonDetail(entity, tl) {
    const e = entity.entity || entity;
    const attrs = e.attributes || {};
    const aliases = e.aliases || [];
    const items = (tl.items || tl || []);
    const pendingCount = attrs.pendingCount ?? 0;
    const topics = (attrs.topics || []).slice(0, 5);

    let cardHtml = `<div class="entity-card">
      <div class="entity-card-header">
        <div class="entity-avatar" style="background:#8B5CF6">${(e.canonicalName || '?')[0].toUpperCase()}</div>
        <div class="entity-card-info">
          <h2 class="entity-card-name">${esc(e.canonicalName)}</h2>
          ${attrs.organization ? `<div class="entity-card-org">${esc(attrs.organization)}${attrs.role ? ' &middot; ' + esc(attrs.role) : ''}</div>` : ''}
        </div>
        ${pendingCount ? `<div class="entity-card-pending">${pendingCount} pending</div>` : ''}
      </div>
      <div class="entity-card-meta">`;

    const emailAlias = aliases.find(a => a.includes('@'));
    const phoneAlias = aliases.find(a => /^\+?\d[\d\s-]{6,}$/.test(a));
    if (emailAlias) cardHtml += `<span class="entity-meta-item">${esc(emailAlias)}</span>`;
    if (phoneAlias) cardHtml += `<span class="entity-meta-item">${esc(phoneAlias)}</span>`;

    const msgCount = items.length;
    const lastContact = items.length ? formatDate(items[0].eventTime || items[0].date) : 'N/A';
    cardHtml += `<span class="entity-meta-item">${msgCount} messages</span>`;
    cardHtml += `<span class="entity-meta-item">Last: ${lastContact}</span>`;
    cardHtml += `</div>`;

    if (topics.length) {
      cardHtml += `<div class="entity-topics">`;
      for (const t of topics) {
        const name = typeof t === 'string' ? t : (t.label || t.canonicalName || t.id);
        cardHtml += `<span class="topic-badge">${esc(name)}</span>`;
      }
      cardHtml += `</div>`;
    }
    cardHtml += `</div>`;

    const timelineHtml = this._buildTimelineHtml(items);
    this.el.innerHTML = cardHtml + (items.length
      ? `<div class="detail-section-label">Timeline</div><div class="timeline-list">${timelineHtml}</div>`
      : `<div class="empty-state" style="padding:20px"><p class="empty-text">No messages yet.</p></div>`);
  }

  // == Attention list ========================================================
  async showAttentionList() {
    this.showLoading('Pending');
    try {
      const data = await api.getAttention();
      const items = (data.items || data || []);
      if (!items.length) {
        this.el.innerHTML = `<div class="detail-header"><h2 class="detail-title">Pending</h2></div>
          <div class="empty-state"><p class="empty-text">Nothing pending.</p></div>`;
        return;
      }
      let html = `<div class="detail-header">
        <h2 class="detail-title">Pending</h2>
        <span class="detail-type-badge" style="color:#F87171;background:rgba(248,113,113,0.12)">${items.length} items</span>
      </div><div class="attention-list">`;
      for (const item of items) html += this._renderAttentionItem(item);
      html += `</div>`;
      this.el.innerHTML = html;
    } catch { this.showError('Pending'); }
  }

  // == Timeline rendering ====================================================
  renderTimeline(label, type, data) {
    const items = data.items || data || [];
    const typeColor = TYPE_COLORS[type] || '#71717A';
    const typeBg = typeColor + '12';
    const header = `<div class="detail-header">
      <h2 class="detail-title">${esc(label)}</h2>
      <span class="detail-type-badge" style="color:${typeColor};background:${typeBg}">${(type || '').replace(/_/g, ' ')}</span>
    </div>`;
    if (!items.length) {
      this.el.innerHTML = header + `<div class="empty-state"><p class="empty-text">No timeline items found.</p></div>`;
      return;
    }
    this.el.innerHTML = header + `<div class="timeline-list">${this._buildTimelineHtml(items)}</div>`;
  }

  // #8: Channel-aware action buttons
  _buildTimelineHtml(items) {
    return items.map(item => {
      const itemId = item.id || '';
      const channel = item.channel || item.sourceAdapter || 'email';
      const sender = item.senderName || item.sender || '';
      const subject = item.subject || '';
      const body = truncate(item.body || item.preview || item.summary || '');
      const date = formatDate(item.eventTime || item.date);

      let actions = '';
      if (channel === 'email' && sender) {
        actions += `<a class="action-link" href="mailto:${esc(sender)}" title="Reply via email">Reply</a>`;
      } else if (channel === 'imessage') {
        actions += `<span class="action-link" style="cursor:default;opacity:0.5" title="Open in Messages app">Open in Messages</span>`;
      }
      actions += `<button class="action-link" data-action="copy" data-text="${esc(body)}" title="Copy text">Copy</button>`;

      return `<div class="timeline-item" data-item-id="${esc(itemId)}">
        <div class="timeline-item-header">
          ${channelBadge(channel)}
          <span class="timeline-sender">${esc(sender)}</span>
          <span class="timeline-date">${date}</span>
        </div>
        ${subject ? `<div class="timeline-subject">${esc(subject)}</div>` : ''}
        <div class="timeline-preview">${esc(body)}</div>
        <div class="timeline-item-actions">${actions}</div>
      </div>`;
    }).join('');
  }

  // == Query results =========================================================
  renderQueryResult(result) {
    const answer = result.answer;
    if (!answer) {
      this.el.innerHTML = `<div class="detail-header"><h2 class="detail-title">Query</h2></div>
        <div class="empty-state"><p class="empty-text">No results found.</p></div>`;
      return;
    }

    const entities = result.entities || [];
    const sources = (result.items || []).slice(0, 5).map(item => {
      const entityId = item.senderEntityId || '';
      return `<div class="timeline-item">
        <div class="timeline-item-header">
          ${channelBadge(item.channel || 'email')}
          <span class="timeline-sender">${esc(item.senderName || item.sender || '')}</span>
          <span class="timeline-date">${formatDate(item.eventTime || item.date)}</span>
        </div>
        <div class="timeline-preview">${esc(truncate(item.body || item.preview || '', 120))}</div>
        ${entityId ? `<div class="timeline-item-actions"><button class="action-link" data-action="navigate" data-entity-id="${esc(entityId)}">View in graph &rarr;</button></div>` : ''}
      </div>`;
    }).join('');

    let entityChips = '';
    if (entities.length) {
      entityChips = `<div class="query-entities">${entities.slice(0, 8).map(e =>
        `<button class="topic-badge topic-badge--clickable" data-action="navigate" data-entity-id="${esc(e.id)}">${esc(e.canonicalName || e.id)}</button>`
      ).join('')}</div>`;
    }

    this.el.innerHTML = `
      <div class="detail-header"><h2 class="detail-title">Query</h2></div>
      <div class="query-answer"><p>${esc(answer.answer || answer)}</p></div>
      ${entityChips}
      ${sources ? `<div class="query-sources-label">Sources</div><div class="timeline-list">${sources}</div>` : ''}`;
  }

  // == States ================================================================
  showLoading(label) {
    this.el.innerHTML = `<div class="detail-header"><h2 class="detail-title">${esc(label || '')}</h2></div>
      <div class="loading-state"><div class="loading-spinner"></div><p class="loading-text">Loading...</p></div>`;
  }

  showError(label) {
    this.el.innerHTML = `<div class="detail-header"><h2 class="detail-title">${esc(label)}</h2></div>
      <div class="empty-state"><p class="empty-text">Could not load data.</p></div>`;
  }

  // == Action handlers (#3: wired to API) ====================================
  async _handleClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id = btn.dataset.id;

    if (action === 'dismiss' && id) {
      const item = btn.closest('.attention-item');
      if (item) { item.style.opacity = '0.4'; item.style.pointerEvents = 'none'; }
      try { await api.dismissAttention(id); } catch { /* still remove from DOM */ }
      item?.remove();
    }

    if (action === 'resolve' && id) {
      const item = btn.closest('.attention-item');
      if (item) { item.style.opacity = '0.4'; item.style.pointerEvents = 'none'; }
      try { await api.resolveAttention(id); } catch {}
    }

    if (action === 'snooze' && id) {
      const item = btn.closest('.attention-item');
      if (item) { item.style.opacity = '0.4'; item.style.pointerEvents = 'none'; }
      const until = Date.now() + 86400000; // 1 day
      try { await api.snoozeAttention(id, until); } catch {}
    }

    if (action === 'copy') {
      const text = btn.dataset.text || '';
      navigator.clipboard?.writeText(text);
      const orig = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = orig; }, 1200);
    }

    if (action === 'navigate' && btn.dataset.entityId && this.onNavigate) {
      this.onNavigate(btn.dataset.entityId);
    }

    if (action === 'nav-type' && btn.dataset.type && this.onNavigate) {
      this.onNavigate(btn.dataset.type);
    }
  }
}
