import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../lib/store.js';
import type { Theme } from '../lib/store.js';
import { api } from '../lib/api.js';

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function XIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function SyncIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={spinning ? { animation: 'spin 1s linear infinite' } : undefined}
    >
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Section label
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: '10px',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'var(--text-tertiary)',
        marginBottom: '10px',
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat row
// ---------------------------------------------------------------------------

function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '6px 0',
        borderBottom: '1px solid var(--border)',
        fontSize: '13px',
      }}
    >
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action button
// ---------------------------------------------------------------------------

function ActionButton({
  onClick,
  disabled,
  icon,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        padding: '10px 14px',
        background: disabled ? 'var(--bg-subtle)' : 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? 'var(--text-tertiary)' : 'var(--text-secondary)',
        fontSize: '13px',
        textAlign: 'left',
        opacity: disabled ? 0.7 : 1,
        marginBottom: '8px',
      }}
    >
      {icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Theme selector
// ---------------------------------------------------------------------------

function ThemeSelector() {
  const { theme, setTheme } = useAppStore();

  const options: { value: Theme; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' },
  ];

  return (
    <div style={{ display: 'flex', gap: '6px' }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setTheme(opt.value)}
          style={{
            flex: 1,
            padding: '7px 0',
            border: '1px solid',
            borderColor: theme === opt.value ? 'var(--accent)' : 'var(--border)',
            borderRadius: '8px',
            background: theme === opt.value ? 'var(--accent-subtle)' : 'var(--surface)',
            color: theme === opt.value ? 'var(--accent)' : 'var(--text-secondary)',
            fontSize: '12px',
            fontWeight: theme === opt.value ? 600 : 400,
            cursor: 'pointer',
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keyboard shortcut row
// ---------------------------------------------------------------------------

function ShortcutRow({ keys, description }: { keys: string[]; description: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '6px 0',
        borderBottom: '1px solid var(--border)',
        fontSize: '13px',
      }}
    >
      <span style={{ color: 'var(--text-secondary)' }}>{description}</span>
      <div style={{ display: 'flex', gap: '4px' }}>
        {keys.map((k, i) => (
          <kbd
            key={i}
            style={{
              fontSize: '11px',
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border-strong)',
              borderRadius: '4px',
              padding: '1px 5px',
              fontFamily: 'inherit',
              color: 'var(--text-secondary)',
            }}
          >
            {k}
          </kbd>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SettingsPanel
// ---------------------------------------------------------------------------

export function SettingsPanel() {
  const { settingsOpen, closeSettings } = useAppStore();
  const queryClient = useQueryClient();

  const [ingestFeedback, setIngestFeedback] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Stats query
  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.getStats(),
    enabled: settingsOpen,
    staleTime: 30_000,
  });

  // Trigger ingest mutation
  const ingestMutation = useMutation({
    mutationFn: () => api.triggerIngest(),
    onSuccess: (data) => {
      setIngestFeedback(data.message ?? 'Ingestion started');
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      setTimeout(() => setIngestFeedback(null), 4000);
    },
    onError: () => {
      setIngestFeedback('Failed to start ingestion');
      setTimeout(() => setIngestFeedback(null), 4000);
    },
  });

  // Escape to close
  useEffect(() => {
    if (!settingsOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeSettings();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsOpen, closeSettings]);

  // Click outside to close
  useEffect(() => {
    if (!settingsOpen) return;
    function onPointer(e: PointerEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        closeSettings();
      }
    }
    // delay so the open-click doesn't immediately close
    const id = setTimeout(() => document.addEventListener('pointerdown', onPointer), 50);
    return () => {
      clearTimeout(id);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [settingsOpen, closeSettings]);

  function handleExport() {
    window.open('/api/export', '_blank');
  }

  const lastSync = stats?.lastSyncAt
    ? new Date(stats.lastSyncAt).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Never';

  return (
    <>
      {/* Spin keyframe injection — only once */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Backdrop */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 199,
          pointerEvents: settingsOpen ? 'auto' : 'none',
          background: settingsOpen ? 'rgba(0,0,0,0.18)' : 'transparent',
          transition: 'background 200ms ease',
          backdropFilter: settingsOpen ? 'blur(2px)' : 'none',
        }}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: '360px',
          maxWidth: '90vw',
          zIndex: 200,
          background: 'var(--surface)',
          borderLeft: '1px solid var(--border)',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          transform: settingsOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 300ms ease-out',
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)' }}>Settings</span>
          <button
            onClick={closeSettings}
            aria-label="Close settings"
            style={{
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
            }}
          >
            <XIcon />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, padding: '0 20px 32px' }}>

          {/* Sync Status */}
          <div style={{ marginTop: '20px', marginBottom: '20px' }}>
            <SectionLabel>Sync Status</SectionLabel>
            <StatRow label="Last sync" value={lastSync} />
            <StatRow label="Pending jobs" value={stats?.pendingJobCount ?? '—'} />
            <StatRow label="Items indexed" value={stats?.rawItemCount ?? '—'} />
          </div>

          {/* Data Overview */}
          <div style={{ marginBottom: '20px' }}>
            <SectionLabel>Data Overview</SectionLabel>
            <StatRow label="Entities" value={stats?.entityCount ?? '—'} />
            <StatRow label="Relationships" value={stats?.relationshipCount ?? '—'} />
            <StatRow label="Attention items" value={stats?.attentionItemCount ?? '—'} />
          </div>

          {/* Actions */}
          <div style={{ marginBottom: '20px' }}>
            <SectionLabel>Actions</SectionLabel>
            <ActionButton
              onClick={() => ingestMutation.mutate()}
              disabled={ingestMutation.isPending}
              icon={<SyncIcon spinning={ingestMutation.isPending} />}
            >
              {ingestMutation.isPending ? 'Running ingestion…' : 'Run ingestion now'}
            </ActionButton>
            <ActionButton onClick={handleExport} icon={<DownloadIcon />}>
              Export data (JSON-LD)
            </ActionButton>
            {ingestFeedback && (
              <p
                style={{
                  fontSize: '12px',
                  color: ingestFeedback.startsWith('Failed') ? 'var(--color-error, #c0392b)' : 'var(--color-success, #27ae60)',
                  margin: '4px 0 0',
                }}
              >
                {ingestFeedback}
              </p>
            )}
          </div>

          {/* Appearance */}
          <div style={{ marginBottom: '20px' }}>
            <SectionLabel>Appearance</SectionLabel>
            <ThemeSelector />
          </div>

          {/* Keyboard Shortcuts */}
          <div>
            <SectionLabel>Keyboard Shortcuts</SectionLabel>
            <ShortcutRow keys={['⌘', 'K']} description="Open command palette" />
            <ShortcutRow keys={['⌘', '/']} description="Focus search" />
            <ShortcutRow keys={['Esc']} description="Close dialog / panel" />
            <ShortcutRow keys={['↑', '↓']} description="Navigate results" />
            <ShortcutRow keys={['Enter']} description="Confirm selection" />
            <ShortcutRow keys={['⌘', 'G']} description="Open graph view" />
          </div>
        </div>
      </div>
    </>
  );
}
