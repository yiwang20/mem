import { useEffect, useRef, useState, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../lib/store.js';
import { api } from '../lib/api.js';
import type { BriefingResult, Entity } from '../lib/api.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ResultKind = 'person' | 'topic' | 'document' | 'action' | 'query';

interface CommandResult {
  id: string;
  kind: ResultKind;
  title: string;
  subtitle?: string;
  hint?: string;
  onSelect: () => void;
}

// ---------------------------------------------------------------------------
// Meeting Brief dialog
// ---------------------------------------------------------------------------

function BriefingDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { closeCommandPalette } = useAppStore();
  const [attendees, setAttendees] = useState('');
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setAttendees('');
      setTopic('');
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const names = attendees
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length === 0) {
      setError('Enter at least one attendee name.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result: BriefingResult = await api.getBriefing(names, topic.trim() || undefined);
      onClose();
      closeCommandPalette();
      // Navigate to search view with briefing data encoded in state
      navigate('/search', { state: { briefing: result, attendees: names, topic: topic.trim() } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate briefing.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.45)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            zIndex: 300,
          }}
        />
        <Dialog.Content
          aria-label="Prepare meeting brief"
          style={{
            position: 'fixed',
            top: '30vh',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '460px',
            maxWidth: '92vw',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '20px',
            boxShadow: 'var(--shadow-md)',
            zIndex: 301,
            padding: '24px',
            outline: 'none',
          }}
        >
          <Dialog.Title
            style={{
              margin: '0 0 4px',
              fontSize: '16px',
              fontWeight: 600,
              color: 'var(--text)',
              fontFamily: 'Inter, system-ui, sans-serif',
            }}
          >
            Meeting Brief
          </Dialog.Title>
          <Dialog.Description
            style={{
              margin: '0 0 20px',
              fontSize: '13px',
              color: 'var(--text-secondary)',
              fontFamily: 'Inter, system-ui, sans-serif',
            }}
          >
            Prepare a briefing on the attendees before your meeting.
          </Dialog.Description>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: 'var(--text-secondary)',
                  fontFamily: 'Inter, system-ui, sans-serif',
                  marginBottom: 6,
                }}
              >
                Attendees <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(comma-separated)</span>
              </label>
              <input
                ref={inputRef}
                value={attendees}
                onChange={(e) => setAttendees(e.target.value)}
                placeholder="Alice Chen, Bob Smith, Carol Wang"
                disabled={loading}
                style={{
                  width: '100%',
                  height: '40px',
                  padding: '0 12px',
                  fontSize: '14px',
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  color: 'var(--text)',
                  outline: 'none',
                  boxSizing: 'border-box',
                  fontFamily: 'Inter, system-ui, sans-serif',
                }}
              />
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: 'var(--text-secondary)',
                  fontFamily: 'Inter, system-ui, sans-serif',
                  marginBottom: 6,
                }}
              >
                Meeting topic <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Q3 budget review, product roadmap…"
                disabled={loading}
                style={{
                  width: '100%',
                  height: '40px',
                  padding: '0 12px',
                  fontSize: '14px',
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  color: 'var(--text)',
                  outline: 'none',
                  boxSizing: 'border-box',
                  fontFamily: 'Inter, system-ui, sans-serif',
                }}
              />
            </div>

            {error && (
              <p style={{ margin: 0, fontSize: '13px', color: '#C47A7A', fontFamily: 'Inter, system-ui, sans-serif' }}>
                {error}
              </p>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                style={{
                  height: '36px',
                  padding: '0 16px',
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  color: 'var(--text-secondary)',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: 'Inter, system-ui, sans-serif',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !attendees.trim()}
                style={{
                  height: '36px',
                  padding: '0 18px',
                  background: 'var(--accent)',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: loading || !attendees.trim() ? 'not-allowed' : 'pointer',
                  opacity: loading || !attendees.trim() ? 0.6 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontFamily: 'Inter, system-ui, sans-serif',
                }}
              >
                {loading && (
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      border: '2px solid rgba(255,255,255,0.4)',
                      borderTopColor: '#fff',
                      display: 'inline-block',
                      animation: 'spin 0.6s linear infinite',
                    }}
                  />
                )}
                {loading ? 'Preparing…' : 'Prepare Brief'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------------------
// Default commands (shown when input is empty)
// ---------------------------------------------------------------------------

function useDefaultCommands(onBrief: () => void): CommandResult[] {
  const navigate = useNavigate();
  const { openSettings, closeCommandPalette } = useAppStore();

  return [
    {
      id: 'cmd-pending',
      kind: 'action',
      title: 'Pending items',
      subtitle: 'View all attention items',
      hint: '',
      onSelect: () => { closeCommandPalette(); navigate('/search?q=pending+items'); },
    },
    {
      id: 'cmd-people',
      kind: 'action',
      title: 'People',
      subtitle: 'Browse all contacts',
      onSelect: () => { closeCommandPalette(); navigate('/search?q=people'); },
    },
    {
      id: 'cmd-topics',
      kind: 'action',
      title: 'Topics',
      subtitle: 'Browse active topics',
      onSelect: () => { closeCommandPalette(); navigate('/search?q=topics'); },
    },
    {
      id: 'cmd-brief',
      kind: 'action',
      title: 'Prepare meeting brief',
      subtitle: 'Briefing on attendees before a meeting',
      onSelect: onBrief,
    },
    {
      id: 'cmd-graph',
      kind: 'action',
      title: 'Graph',
      subtitle: 'Open knowledge graph',
      hint: '',
      onSelect: () => { closeCommandPalette(); navigate('/graph'); },
    },
    {
      id: 'cmd-settings',
      kind: 'action',
      title: 'Settings',
      subtitle: 'Open settings panel',
      onSelect: () => { closeCommandPalette(); openSettings(); },
    },
    {
      id: 'cmd-shortcuts',
      kind: 'action',
      title: 'Keyboard shortcuts',
      subtitle: 'View all shortcuts',
      onSelect: () => { closeCommandPalette(); openSettings(); },
    },
  ];
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function SearchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function CommandIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
    </svg>
  );
}

function AskIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function BriefIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

// Entity type colors and avatars
const TYPE_COLOR: Record<string, string> = {
  person: 'var(--color-person)',
  topic: 'var(--color-topic)',
  document: 'var(--color-document)',
  action_item: 'var(--color-action-item)',
  key_fact: 'var(--color-key-fact)',
  thread: 'var(--color-thread)',
};

const TYPE_TINT: Record<string, string> = {
  person: 'var(--tint-person)',
  topic: 'var(--tint-topic)',
  document: 'var(--tint-document)',
  action_item: 'var(--tint-action-item)',
  key_fact: 'var(--tint-key-fact)',
  thread: 'var(--tint-thread)',
};

function EntityAvatar({ entity, size = 24 }: { entity: Entity; size?: number }) {
  const initial = entity.canonicalName.charAt(0).toUpperCase();
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: TYPE_TINT[entity.type] ?? 'var(--bg-subtle)',
        color: TYPE_COLOR[entity.type] ?? 'var(--text-secondary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.45,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}

function TypeDot({ type }: { type: string }) {
  return (
    <div
      style={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: TYPE_COLOR[type] ?? 'var(--text-tertiary)',
        flexShrink: 0,
        margin: '0 7px',
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeader({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: '12px 20px 4px',
        fontSize: '10px',
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--text-tertiary)',
        userSelect: 'none',
      }}
    >
      {label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Result row
// ---------------------------------------------------------------------------

function ResultRow({
  result,
  isActive,
  onSelect,
  onHover,
}: {
  result: CommandResult;
  isActive: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  const isBrief = result.id === 'cmd-brief';
  return (
    <button
      onMouseEnter={onHover}
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        width: '100%',
        padding: '10px 20px',
        background: isActive ? 'var(--surface-hover)' : 'transparent',
        border: 'none',
        borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 80ms',
      }}
    >
      {/* Icon */}
      <div style={{ flexShrink: 0, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center' }}>
        {isBrief ? (
          <BriefIcon />
        ) : (result.kind === 'action' || result.kind === 'query') && (
          result.title.startsWith('Ask') ? <AskIcon /> : result.title.startsWith('Search') ? <SearchIcon /> : <CommandIcon />
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {result.title}
        </div>
        {result.subtitle && (
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {result.subtitle}
          </div>
        )}
      </div>

      {result.hint && (
        <kbd style={{
          fontSize: '11px',
          background: 'var(--surface)',
          border: '1px solid var(--border-strong)',
          borderRadius: '4px',
          padding: '1px 5px',
          color: 'var(--text-ghost)',
          flexShrink: 0,
        }}>
          {result.hint}
        </kbd>
      )}
    </button>
  );
}

function EntityResultRow({
  entity,
  isActive,
  onSelect,
  onHover,
}: {
  entity: Entity;
  isActive: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  const subtitle = entity.type === 'person'
    ? (entity.attributes['organization'] as string | undefined) ?? entity.type
    : entity.type.replace('_', ' ');

  return (
    <button
      onMouseEnter={onHover}
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        width: '100%',
        padding: '10px 20px',
        background: isActive ? 'var(--surface-hover)' : 'transparent',
        border: 'none',
        borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 80ms',
      }}
    >
      {entity.type === 'person' ? (
        <EntityAvatar entity={entity} size={24} />
      ) : (
        <TypeDot type={entity.type} />
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {entity.canonicalName}
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {subtitle}
        </div>
      </div>

      <span style={{ fontSize: '11px', color: 'var(--text-ghost)', flexShrink: 0 }}>
        ↵
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main CommandPalette component
// ---------------------------------------------------------------------------

export function CommandPalette() {
  const { commandPaletteOpen, closeCommandPalette } = useAppStore();
  const navigate = useNavigate();

  const [briefOpen, setBriefOpen] = useState(false);
  const defaultCommands = useDefaultCommands(() => setBriefOpen(true));

  const [query, setQuery] = useState('');
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state when palette opens
  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery('');
      setEntities([]);
      setActiveIndex(0);
      setBriefOpen(false);
      // Focus input on next tick after Dialog animation
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [commandPaletteOpen]);

  // Debounced entity search
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!query.trim()) {
      setEntities([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await api.listEntities({ limit: 6 });
        // Client-side filter since API doesn't have q= param yet
        const q = query.toLowerCase();
        const filtered = res.entities.filter(
          (e) =>
            e.canonicalName.toLowerCase().includes(q) ||
            (e.nameAlt?.toLowerCase().includes(q) ?? false) ||
            e.aliases.some((a) => a.toLowerCase().includes(q)),
        );
        setEntities(filtered.slice(0, 6));
      } catch {
        setEntities([]);
      } finally {
        setLoading(false);
      }
    }, 150);

    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, [query]);

  // Check if the query matches briefing keywords
  const isBriefQuery =
    query.trim().length > 0 &&
    /brief|meeting/i.test(query);

  // Build flat list of all selectable results for keyboard nav
  const isQuestion = query.includes('?');
  const hasQuery = query.trim().length > 0;

  const people = entities.filter((e) => e.type === 'person');
  const topics = entities.filter((e) => e.type === 'topic');
  const others = entities.filter((e) => e.type !== 'person' && e.type !== 'topic');

  // Flat index list: [people..., topics..., others..., actionCmds..., defaultCmds...]
  type FlatItem =
    | { kind: 'entity'; entity: Entity }
    | { kind: 'command'; result: CommandResult };

  const flatItems: FlatItem[] = [
    ...people.map((e): FlatItem => ({ kind: 'entity', entity: e })),
    ...topics.map((e): FlatItem => ({ kind: 'entity', entity: e })),
    ...others.map((e): FlatItem => ({ kind: 'entity', entity: e })),
  ];

  // Action commands when there's a query
  const queryCommands: CommandResult[] = [];
  if (hasQuery) {
    queryCommands.push({
      id: 'search-query',
      kind: 'query',
      title: `Search: "${query}"`,
      onSelect: () => {
        closeCommandPalette();
        navigate(`/search?q=${encodeURIComponent(query)}`);
      },
    });
    if (isQuestion) {
      queryCommands.push({
        id: 'ask-query',
        kind: 'query',
        title: `Ask: "${query}"`,
        subtitle: 'AI-powered answer',
        onSelect: () => {
          closeCommandPalette();
          navigate(`/search?q=${encodeURIComponent(query)}&ask=1`);
        },
      });
    }
    if (isBriefQuery) {
      queryCommands.push({
        id: 'brief-query',
        kind: 'action',
        title: 'Prepare meeting brief',
        subtitle: 'Briefing on attendees before a meeting',
        onSelect: () => setBriefOpen(true),
      });
    }
    queryCommands.forEach((cmd) => flatItems.push({ kind: 'command', result: cmd }));
  } else {
    defaultCommands.forEach((cmd) => flatItems.push({ kind: 'command', result: cmd }));
  }

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, flatItems.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = flatItems[activeIndex];
        if (item?.kind === 'entity') {
          closeCommandPalette();
          navigate(`/entity/${item.entity.id}`);
        } else if (item?.kind === 'command') {
          item.result.onSelect();
        }
      }
    },
    [flatItems, activeIndex, closeCommandPalette, navigate],
  );

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(0);
  }, [query, entities.length]);

  // Global Cmd+K / Ctrl+K listener
  useEffect(() => {
    function handleGlobal(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (commandPaletteOpen) {
          closeCommandPalette();
        } else {
          useAppStore.getState().openCommandPalette();
        }
      }
    }
    window.addEventListener('keydown', handleGlobal);
    return () => window.removeEventListener('keydown', handleGlobal);
  }, [commandPaletteOpen, closeCommandPalette]);

  // Render items helper
  let flatIdx = -1;

  function renderEntityRows(list: Entity[]) {
    return list.map((entity) => {
      flatIdx++;
      const idx = flatIdx;
      return (
        <EntityResultRow
          key={entity.id}
          entity={entity}
          isActive={activeIndex === idx}
          onHover={() => setActiveIndex(idx)}
          onSelect={() => {
            closeCommandPalette();
            navigate(`/entity/${entity.id}`);
          }}
        />
      );
    });
  }

  function renderCommandRows(cmds: CommandResult[]) {
    return cmds.map((cmd) => {
      flatIdx++;
      const idx = flatIdx;
      return (
        <ResultRow
          key={cmd.id}
          result={cmd}
          isActive={activeIndex === idx}
          onHover={() => setActiveIndex(idx)}
          onSelect={cmd.onSelect}
        />
      );
    });
  }

  return (
    <>
      <BriefingDialog open={briefOpen} onClose={() => setBriefOpen(false)} />

      <Dialog.Root open={commandPaletteOpen} onOpenChange={(open) => !open && closeCommandPalette()}>
        <Dialog.Portal>
          {/* Backdrop */}
          <Dialog.Overlay
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0,0,0,0.3)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              zIndex: 200,
            }}
          />

          {/* Palette card */}
          <Dialog.Content
            onKeyDown={handleKeyDown}
            aria-label="Command palette"
            style={{
              position: 'fixed',
              top: '20vh',
              left: '50%',
              transform: 'translateX(-50%)',
              width: '520px',
              maxWidth: '90vw',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '24px',
              boxShadow: 'var(--shadow-md)',
              zIndex: 201,
              overflow: 'hidden',
              outline: 'none',
            }}
          >
            {/* Input row */}
            <div
              style={{
                height: '56px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '0 20px',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <span style={{ color: 'var(--text-tertiary)', display: 'flex', flexShrink: 0 }}>
                <SearchIcon size={16} />
              </span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type a name, question, or command..."
                style={{
                  flex: 1,
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  fontSize: '15px',
                  color: 'var(--text)',
                  fontFamily: 'inherit',
                }}
              />
              {loading && (
                <div
                  style={{
                    width: '14px',
                    height: '14px',
                    borderRadius: '50%',
                    border: '2px solid var(--border)',
                    borderTopColor: 'var(--accent)',
                    animation: 'spin 0.6s linear infinite',
                    flexShrink: 0,
                  }}
                />
              )}
              <kbd
                style={{
                  fontSize: '11px',
                  background: 'var(--bg-subtle)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '4px',
                  padding: '1px 5px',
                  color: 'var(--text-ghost)',
                  flexShrink: 0,
                }}
              >
                Esc
              </kbd>
            </div>

            {/* Results area */}
            <div
              style={{
                maxHeight: '360px',
                overflowY: 'auto',
                paddingBottom: '8px',
              }}
            >
              {/* Reset counter before rendering */}
              {(() => { flatIdx = -1; return null; })()}

              {!hasQuery ? (
                <>
                  <SectionHeader label="Actions" />
                  {renderCommandRows(defaultCommands)}
                </>
              ) : (
                <>
                  {people.length > 0 && (
                    <>
                      <SectionHeader label="People" />
                      {renderEntityRows(people)}
                    </>
                  )}
                  {topics.length > 0 && (
                    <>
                      <SectionHeader label="Topics" />
                      {renderEntityRows(topics)}
                    </>
                  )}
                  {others.length > 0 && (
                    <>
                      <SectionHeader label="Documents & more" />
                      {renderEntityRows(others)}
                    </>
                  )}
                  <SectionHeader label="Actions" />
                  {renderCommandRows(queryCommands)}

                  {entities.length === 0 && !loading && (
                    <div
                      style={{
                        padding: '32px 20px',
                        textAlign: 'center',
                        color: 'var(--text-tertiary)',
                        fontSize: '13px',
                      }}
                    >
                      No entities found
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Visually hidden title for a11y */}
            <Dialog.Title style={{ display: 'none' }}>Command Palette</Dialog.Title>
            <Dialog.Description style={{ display: 'none' }}>
              Search entities, topics, and run commands
            </Dialog.Description>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
