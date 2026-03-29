// ============================================================================
// MindFlow API Client
// ============================================================================

const API_BASE = '/api';

// ---------------------------------------------------------------------------
// WebSocket client with auto-reconnect
// ---------------------------------------------------------------------------

const _eventListeners = new Map(); // eventType -> Set<callback>
let _wsSocket = null;
let _wsReconnectDelay = 1000; // start at 1s, doubles up to 30s
let _wsReconnectTimer = null;
let _wsStopped = false;

function _wsDispatch(eventType, data) {
  const listeners = _eventListeners.get(eventType);
  if (listeners) {
    for (const cb of listeners) {
      try { cb(data); } catch { /* ignore listener errors */ }
    }
  }
}

function _wsConnect() {
  if (_wsStopped) return;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}/api/ws`;

  const sock = new WebSocket(url);
  _wsSocket = sock;

  sock.addEventListener('open', () => {
    _wsReconnectDelay = 1000; // reset on successful connect
  });

  sock.addEventListener('message', (ev) => {
    let parsed;
    try { parsed = JSON.parse(ev.data); } catch { return; }
    if (parsed && typeof parsed.event === 'string') {
      _wsDispatch(parsed.event, parsed.data);
    }
  });

  sock.addEventListener('close', () => {
    _wsSocket = null;
    if (_wsStopped) return;
    // Exponential backoff, cap at 30s
    _wsReconnectTimer = setTimeout(() => {
      _wsReconnectDelay = Math.min(_wsReconnectDelay * 2, 30000);
      _wsConnect();
    }, _wsReconnectDelay);
  });

  sock.addEventListener('error', () => {
    // 'error' is always followed by 'close', so reconnect is handled there
    sock.close();
  });
}

export function connectWebSocket() {
  _wsStopped = false;
  clearTimeout(_wsReconnectTimer);
  _wsConnect();
}

export function onEvent(eventType, callback) {
  if (!_eventListeners.has(eventType)) {
    _eventListeners.set(eventType, new Set());
  }
  _eventListeners.get(eventType).add(callback);
}

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

export const api = {
  /** GET /api/graph/root — L0 root with category counts */
  getGraphRoot() {
    return request('/graph/root');
  },

  /** GET /api/graph/:entityId?depth=1 — subgraph around entity */
  getGraphEntity(entityId, depth = 1) {
    return request(`/graph/${encodeURIComponent(entityId)}?depth=${depth}`);
  },

  /** GET /api/entities?type=person&limit=20&sort=recent */
  getEntities(params = {}) {
    const qs = new URLSearchParams();
    if (params.type) qs.set('type', params.type);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.sort) qs.set('sort', params.sort);
    const q = qs.toString();
    return request(`/entities${q ? '?' + q : ''}`);
  },

  /** GET /api/entities/:id */
  getEntity(id) {
    return request(`/entities/${encodeURIComponent(id)}`);
  },

  /** GET /api/entities/:id/timeline */
  getEntityTimeline(id) {
    return request(`/entities/${encodeURIComponent(id)}/timeline`);
  },

  /** GET /api/entities/:id1/crossref/:id2 */
  getCrossRef(id1, id2) {
    return request(`/entities/${encodeURIComponent(id1)}/crossref/${encodeURIComponent(id2)}`);
  },

  /** POST /api/query */
  query(queryText) {
    return request('/query', {
      method: 'POST',
      body: JSON.stringify({ query: queryText }),
    });
  },

  /** GET /api/attention */
  getAttention() {
    return request('/attention');
  },

  /** POST /api/attention/:id/dismiss */
  dismissAttention(id) {
    return request(`/attention/${encodeURIComponent(id)}/dismiss`, { method: 'POST' });
  },

  /** POST /api/attention/:id/resolve */
  resolveAttention(id) {
    return request(`/attention/${encodeURIComponent(id)}/resolve`, { method: 'POST' });
  },

  /** POST /api/attention/:id/snooze */
  snoozeAttention(id, until) {
    return request(`/attention/${encodeURIComponent(id)}/snooze`, { method: 'POST', body: JSON.stringify({ until }) });
  },

  /** POST /api/ingest — trigger ingestion cycle */
  triggerIngest() {
    return request('/ingest', { method: 'POST' });
  },

  /** GET /api/stats */
  getStats() {
    return request('/stats');
  },

  /** GET /api/graph/groups — list all detected communities */
  getCommunities() {
    return request('/graph/groups');
  },

  /** GET /api/graph/groups/:id — community with member entity details */
  getCommunity(id) {
    return request(`/graph/groups/${encodeURIComponent(id)}`);
  },
};
