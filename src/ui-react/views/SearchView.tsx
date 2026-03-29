import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { ChannelBadge } from '../components/ChannelBadge.js';
import type { Entity, RawItem } from '../lib/api.js';

// ---------------------------------------------------------------------------
// Search history helpers (localStorage, max 5 entries)
// ---------------------------------------------------------------------------

const HISTORY_KEY = 'mindflow:search-history';
const HISTORY_MAX = 5;

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

function saveHistory(query: string, current: string[]): string[] {
  const trimmed = query.trim();
  if (!trimmed) return current;
  // Deduplicate and prepend
  const next = [trimmed, ...current.filter((h) => h !== trimmed)].slice(0, HISTORY_MAX);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // Storage quota exceeded — ignore
  }
  return next;
}

// ---------------------------------------------------------------------------
// Shimmer skeleton
// ---------------------------------------------------------------------------

function Shimmer({ width, height }: { width?: string; height?: string }) {
  return (
    <div
      style={{
        width: width ?? '100%',
        height: height ?? '16px',
        borderRadius: '6px',
        background: 'linear-gradient(90deg, var(--bg-subtle) 25%, var(--border) 50%, var(--bg-subtle) 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.4s ease-in-out infinite',
      }}
    />
  );
}

function AnswerShimmer() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '20px' }}>
      <Shimmer width="60%" height="14px" />
      <Shimmer width="90%" />
      <Shimmer width="80%" />
      <Shimmer width="70%" />
    </div>
  );
}

function ItemShimmer() {
  return (
    <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <Shimmer width="52px" height="18px" />
        <Shimmer width="120px" height="12px" />
      </div>
      <Shimmer width="95%" height="13px" />
      <Shimmer width="75%" height="13px" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI answer card
// ---------------------------------------------------------------------------

function AnswerCard({
  answer,
  confidence,
  loading,
}: {
  answer: string | null;
  confidence: number;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '16px',
          marginBottom: '20px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid var(--border)',
            fontSize: '11px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            color: 'var(--text-tertiary)',
          }}
        >
          AI Answer
        </div>
        <AnswerShimmer />
      </div>
    );
  }

  if (!answer) return null;

  const pct = Math.round(confidence * 100);

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '16px',
        marginBottom: '20px',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 20px',
          borderBottom: '1px solid var(--border)',
          fontSize: '11px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          color: 'var(--text-tertiary)',
        }}
      >
        <span>AI Answer</span>
        <span style={{ color: 'var(--text-tertiary)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
          {pct}% confidence
        </span>
      </div>
      <div
        style={{
          padding: '16px 20px',
          fontSize: '14px',
          lineHeight: 1.65,
          color: 'var(--text)',
          whiteSpace: 'pre-wrap',
        }}
      >
        {answer}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entity chip
// ---------------------------------------------------------------------------

const ENTITY_TYPE_COLOR: Record<string, string> = {
  person: 'var(--color-person)',
  topic: 'var(--color-topic)',
  action_item: 'var(--color-action-item)',
  key_fact: 'var(--color-key-fact)',
  document: 'var(--color-document)',
  thread: 'var(--color-thread)',
};

const ENTITY_TYPE_TINT: Record<string, string> = {
  person: 'var(--color-person-tint)',
  topic: 'var(--color-topic-tint)',
  action_item: 'var(--color-action-item-tint)',
  key_fact: 'var(--color-key-fact-tint)',
  document: 'var(--color-document-tint)',
  thread: 'var(--color-thread-tint)',
};

function EntityChip({ entity, onClick }: { entity: Entity; onClick: () => void }) {
  const color = ENTITY_TYPE_COLOR[entity.type] ?? 'var(--text-tertiary)';
  const tint = ENTITY_TYPE_TINT[entity.type] ?? 'var(--bg-subtle)';
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding: '3px 10px',
        borderRadius: '9999px',
        border: 'none',
        background: tint,
        cursor: 'pointer',
        fontSize: '12px',
        color: 'var(--text-secondary)',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
        }}
      />
      {entity.canonicalName}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Source item card
// ---------------------------------------------------------------------------

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function SourceItem({
  item,
  entities,
  onEntityClick,
}: {
  item: RawItem;
  entities: Entity[];
  onEntityClick: (id: string) => void;
}) {
  const preview = item.body.replace(/<[^>]*>/g, '').slice(0, 280);
  const timestamp = formatRelativeTime(item.eventTime);

  return (
    <div
      style={{
        padding: '16px 20px',
        borderBottom: '1px solid var(--border)',
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '8px',
          flexWrap: 'wrap',
        }}
      >
        <ChannelBadge channel={item.channel} size="sm" />
        {item.subject && (
          <span
            style={{
              fontSize: '13px',
              fontWeight: 600,
              color: 'var(--text)',
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.subject}
          </span>
        )}
        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', flexShrink: 0 }}>
          {timestamp}
        </span>
      </div>

      {/* Body preview */}
      <p
        style={{
          margin: '0 0 10px',
          fontSize: '13px',
          color: 'var(--text-secondary)',
          lineHeight: 1.55,
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {preview}
      </p>

      {/* Entity chips */}
      {entities.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {entities.map((e) => (
            <EntityChip key={e.id} entity={e} onClick={() => onEntityClick(e.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search history dropdown
// ---------------------------------------------------------------------------

function SearchHistory({
  history,
  onSelect,
  onClear,
}: {
  history: string[];
  onSelect: (q: string) => void;
  onClear: () => void;
}) {
  if (history.length === 0) return null;
  return (
    <div
      style={{
        position:   'absolute',
        top:        '100%',
        left:       0,
        right:      0,
        marginTop:  4,
        background: 'var(--surface)',
        border:     '1px solid var(--border)',
        borderRadius: 8,
        boxShadow:  'var(--shadow-sm)',
        zIndex:     50,
        overflow:   'hidden',
      }}
    >
      <div
        style={{
          display:    'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding:    '8px 12px 4px',
        }}
      >
        <span
          style={{
            fontSize:      '10px',
            fontWeight:    700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color:         'var(--text-tertiary)',
          }}
        >
          Recent searches
        </span>
        <button
          onClick={onClear}
          style={{
            background: 'none',
            border:     'none',
            cursor:     'pointer',
            fontSize:   '11px',
            color:      'var(--text-tertiary)',
            padding:    '0 2px',
          }}
        >
          Clear
        </button>
      </div>
      {history.map((item) => (
        <button
          key={item}
          onClick={() => onSelect(item)}
          style={{
            display:    'flex',
            alignItems: 'center',
            gap:        8,
            width:      '100%',
            padding:    '8px 12px',
            background: 'transparent',
            border:     'none',
            borderLeft: '2px solid transparent',
            cursor:     'pointer',
            textAlign:  'left',
            fontSize:   '13px',
            color:      'var(--text-secondary)',
            fontFamily: 'Inter, system-ui, sans-serif',
            transition: 'background 80ms',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)';
            (e.currentTarget as HTMLButtonElement).style.borderLeftColor = 'var(--accent)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            (e.currentTarget as HTMLButtonElement).style.borderLeftColor = 'transparent';
          }}
        >
          {/* Clock icon */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: 'var(--text-tertiary)' }}>
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item}
          </span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SearchView
// ---------------------------------------------------------------------------

export function SearchView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const q = searchParams.get('q') ?? '';
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState(q);
  const [history, setHistory] = useState<string[]>(loadHistory);
  const [showHistory, setShowHistory] = useState(false);

  // Sync input value when URL param changes (e.g. navigate from command palette)
  useEffect(() => {
    setInputValue(q);
  }, [q]);

  const enabled = q.trim().length > 0;

  // Fast path: entity name search — returns quickly from FTS index
  const entityQuery = useQuery({
    queryKey: ['entity-search', q],
    queryFn: () => api.searchEntities(q, 12),
    enabled,
    staleTime: 60_000,
  });

  // Slow path: full AI query — may take 1–5 seconds
  const aiQuery = useQuery({
    queryKey: ['search', q],
    queryFn: () => api.query(q),
    enabled,
    staleTime: 60_000,
  });

  const runSearch = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setHistory((prev) => saveHistory(trimmed, prev));
    setShowHistory(false);
    setSearchParams({ q: trimmed });
  }, [setSearchParams]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    runSearch(inputValue);
  }

  function handleEntityClick(entityId: string) {
    navigate(`/entity/${entityId}`);
  }

  function handleHistorySelect(item: string) {
    setInputValue(item);
    runSearch(item);
  }

  function handleHistoryClear() {
    localStorage.removeItem(HISTORY_KEY);
    setHistory([]);
    setShowHistory(false);
  }

  // Build entity map from AI results for linking to source items
  const aiEntityMap = new Map<string, Entity>((aiQuery.data?.entities ?? []).map((e) => [e.id, e]));

  const sourceItems = aiQuery.data?.items ?? [];

  // Combine entities: fast entity search results first, then any from AI result
  // Deduplicate by id
  const fastEntities = entityQuery.data?.entities ?? [];
  const aiEntities = aiQuery.data?.entities ?? [];
  const allEntitiesMap = new Map<string, Entity>();
  for (const e of [...fastEntities, ...aiEntities]) allEntitiesMap.set(e.id, e);
  const allEntities = Array.from(allEntitiesMap.values());

  const aiLoading = aiQuery.isLoading || aiQuery.isFetching;
  const anyError = aiQuery.isError && entityQuery.isError;

  // Show "no results" only when both queries have settled with nothing
  const hasResults =
    allEntities.length > 0 || sourceItems.length > 0 || aiQuery.data?.answer != null;
  const noResults =
    !aiLoading &&
    !anyError &&
    enabled &&
    !entityQuery.isLoading &&
    !hasResults;

  // Whether to show the "View in graph" link
  const showGraphLink = !aiLoading && hasResults;

  return (
    <>
      <div
        style={{
          maxWidth: '720px',
          margin: '0 auto',
          padding: '28px 24px',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        {/* Search input */}
        <form onSubmit={handleSubmit} style={{ marginBottom: '28px' }}>
          <div
            style={{
              display: 'flex',
              gap: '10px',
              alignItems: 'center',
            }}
          >
            {/* Input wrapper — relative so history dropdown can be positioned */}
            <div style={{ flex: 1, position: 'relative' }}>
              <input
                ref={inputRef}
                autoFocus
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onFocus={() => { if (!inputValue.trim()) setShowHistory(true); }}
                onBlur={() => {
                  // Delay so click on history item fires before hide
                  setTimeout(() => setShowHistory(false), 150);
                }}
                placeholder="Ask anything about your knowledge graph…"
                style={{
                  width:    '100%',
                  height:   '44px',
                  padding:  '0 16px',
                  fontSize: '14px',
                  background: 'var(--surface)',
                  border:   '1px solid var(--border)',
                  borderRadius: '8px',
                  color:    'var(--text)',
                  outline:  'none',
                  boxSizing: 'border-box',
                }}
              />
              {showHistory && !inputValue.trim() && (
                <SearchHistory
                  history={history}
                  onSelect={handleHistorySelect}
                  onClear={handleHistoryClear}
                />
              )}
            </div>
            <button
              type="submit"
              disabled={!inputValue.trim()}
              style={{
                height: '44px',
                padding: '0 20px',
                background: 'var(--accent)',
                border: 'none',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '14px',
                fontWeight: 600,
                cursor: inputValue.trim() ? 'pointer' : 'not-allowed',
                opacity: inputValue.trim() ? 1 : 0.6,
                flexShrink: 0,
              }}
            >
              Search
            </button>
          </div>
        </form>

        {/* No query yet */}
        {!q.trim() && (
          <p style={{ color: 'var(--text-tertiary)', fontSize: '14px', textAlign: 'center', marginTop: '60px' }}>
            Search your personal knowledge graph, ask a question, or find people and topics.
          </p>
        )}

        {/* Error state — only shown when both queries failed */}
        {anyError && (
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              padding: '20px',
              textAlign: 'center',
              color: 'var(--text-secondary)',
              fontSize: '14px',
            }}
          >
            Failed to run search. Check that the server is running and try again.
          </div>
        )}

        {/* Entity matches — fast results, shown as soon as entity search settles */}
        {enabled && allEntities.length > 0 && (
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '16px',
              overflow: 'hidden',
              marginBottom: '20px',
            }}
          >
            <div
              style={{
                padding: '12px 20px',
                borderBottom: '1px solid var(--border)',
                fontSize: '11px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.07em',
                color: 'var(--text-tertiary)',
              }}
            >
              Matching Entities
            </div>
            <div style={{ padding: '12px 20px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {allEntities.map((entity) => (
                <EntityChip
                  key={entity.id}
                  entity={entity}
                  onClick={() => handleEntityClick(entity.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* AI answer card — shimmer while loading, result when ready */}
        {enabled && (aiLoading || aiQuery.data?.answer != null) && (
          <AnswerCard
            answer={aiQuery.data?.answer ?? null}
            confidence={aiQuery.data?.confidence ?? 0}
            loading={aiLoading}
          />
        )}

        {/* Source items — shimmer while AI loads, results when ready */}
        {enabled && (aiLoading || sourceItems.length > 0) && (
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '16px',
              overflow: 'hidden',
              marginBottom: '20px',
            }}
          >
            <div
              style={{
                padding: '12px 20px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.07em',
                  color: 'var(--text-tertiary)',
                }}
              >
                Sources
              </span>
              {!aiLoading && (
                <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                  {sourceItems.length} item{sourceItems.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {aiLoading ? (
              <>
                <ItemShimmer />
                <ItemShimmer />
                <ItemShimmer />
              </>
            ) : (
              sourceItems.map((item) => {
                const linkedEntities: Entity[] = [];
                if (item.senderEntityId && aiEntityMap.has(item.senderEntityId)) {
                  linkedEntities.push(aiEntityMap.get(item.senderEntityId)!);
                }
                for (const rid of item.recipientEntityIds ?? []) {
                  if (aiEntityMap.has(rid)) linkedEntities.push(aiEntityMap.get(rid)!);
                }
                return (
                  <SourceItem
                    key={item.id}
                    item={item}
                    entities={linkedEntities.slice(0, 5)}
                    onEntityClick={handleEntityClick}
                  />
                );
              })
            )}
          </div>
        )}

        {/* View in graph link */}
        {showGraphLink && (
          <div style={{ textAlign: 'center', marginTop: '8px' }}>
            <button
              onClick={() => navigate('/graph')}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--accent)',
                fontSize: '13px',
                padding: '6px 12px',
              }}
            >
              View in graph &rarr;
            </button>
          </div>
        )}

        {/* No results */}
        {noResults && (
          <div
            style={{
              textAlign: 'center',
              padding: '48px 24px',
              color: 'var(--text-tertiary)',
              fontSize: '14px',
            }}
          >
            <p style={{ margin: '0 0 8px', fontSize: '16px', color: 'var(--text-secondary)' }}>
              No results found
            </p>
            <p style={{ margin: 0 }}>Try different keywords or check that your data has been ingested.</p>
          </div>
        )}
      </div>
    </>
  );
}
