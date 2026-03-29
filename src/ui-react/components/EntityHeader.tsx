import React, { useState, useCallback } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Dialog from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import type { Entity, EntityStats } from '../lib/api.js';
import { api } from '../lib/api.js';

// ---------------------------------------------------------------------------
// Color helpers (matching design-spec entity type colors)
// ---------------------------------------------------------------------------

export const ENTITY_COLORS: Record<Entity['type'], { color: string; tint: string }> = {
  person:      { color: '#8B7EC8', tint: '#F0EDF8' },
  topic:       { color: '#6B9E8A', tint: '#EDF5F0' },
  document:    { color: '#C4A86B', tint: '#F8F3EA' },
  action_item: { color: '#C47A7A', tint: '#F8EDEC' },
  key_fact:    { color: '#6B8EC4', tint: '#EDF1F8' },
  thread:      { color: '#8A8A8A', tint: '#F2F2F0' },
};

const TYPE_LABELS: Record<Entity['type'], string> = {
  person:      'Person',
  topic:       'Topic',
  document:    'Document',
  action_item: 'Action Item',
  key_fact:    'Key Fact',
  thread:      'Thread',
};

const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
  active:   { color: '#6B9E8A', bg: 'rgba(107,158,138,0.12)' },
  dormant:  { color: '#C4A86B', bg: 'rgba(196,168,107,0.12)' },
  archived: { color: '#9A9A9A', bg: 'rgba(154,154,154,0.12)' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeDate(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function extractEmail(entity: Entity): string | null {
  if (typeof entity.attributes['email'] === 'string') return entity.attributes['email'];
  const emailAlias = entity.aliases.find((a) => a.includes('@'));
  return emailAlias ?? null;
}

function extractPhone(entity: Entity): string | null {
  if (typeof entity.attributes['phone'] === 'string') return entity.attributes['phone'];
  const phoneAlias = entity.aliases.find((a) => /^\+?[\d\s\-().]{7,}$/.test(a));
  return phoneAlias ?? null;
}

// ---------------------------------------------------------------------------
// Shared dialog overlay + content styles
// ---------------------------------------------------------------------------

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.45)',
  backdropFilter: 'blur(4px)',
  zIndex: 100,
};

const dialogContentStyle: React.CSSProperties = {
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%,-50%)',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: '16px',
  padding: '24px',
  width: '360px',
  zIndex: 101,
  boxShadow: 'var(--shadow-md)',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: '14px',
  outline: 'none',
  boxSizing: 'border-box',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: '8px',
  border: 'none',
  background: 'var(--accent)',
  color: '#fff',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  background: 'none',
  color: 'var(--text-secondary)',
  fontSize: '13px',
  cursor: 'pointer',
};

const dialogTitleStyle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 600,
  color: 'var(--text)',
  marginBottom: '16px',
};

// ---------------------------------------------------------------------------
// EntityActionsMenu
// ---------------------------------------------------------------------------

type DialogMode = 'none' | 'rename' | 'merge' | 'split';

function EntityActionsMenu({ entity }: { entity: Entity }) {
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<DialogMode>('none');
  const [renameValue, setRenameValue] = useState(entity.canonicalName);
  const [mergeSearch, setMergeSearch] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['entity', entity.id] });
    void qc.invalidateQueries({ queryKey: ['entities'] });
  }, [qc, entity.id]);

  const handleRename = useCallback(async () => {
    if (!renameValue.trim() || renameValue === entity.canonicalName) {
      setDialog('none');
      return;
    }
    try {
      await api.renameEntity(entity.id, renameValue.trim());
      invalidate();
      setDialog('none');
      setStatus(null);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Rename failed');
    }
  }, [renameValue, entity, invalidate]);

  const handleMerge = useCallback(async () => {
    if (!mergeTargetId.trim()) {
      setStatus('Enter an entity ID to merge with');
      return;
    }
    try {
      await api.mergeEntities(entity.id, mergeTargetId.trim());
      invalidate();
      setDialog('none');
      setMergeSearch('');
      setMergeTargetId('');
      setStatus(null);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Merge failed');
    }
  }, [mergeTargetId, entity, invalidate]);

  const handleSplit = useCallback(async () => {
    try {
      await api.splitEntity(entity.id);
      invalidate();
      setDialog('none');
      setStatus(null);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Split failed');
    }
  }, [entity, invalidate]);

  const openDialog = useCallback((mode: DialogMode) => {
    setStatus(null);
    if (mode === 'rename') setRenameValue(entity.canonicalName);
    if (mode === 'merge') { setMergeSearch(''); setMergeTargetId(''); }
    setDialog(mode);
  }, [entity.canonicalName]);

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            aria-label="Entity actions"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              background: 'none',
              color: 'var(--text-tertiary)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
            onMouseOver={(e) => { e.currentTarget.style.background = 'var(--bg-subtle)'; }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'none'; }}
          >
            {/* Heroicon: ellipsis-horizontal */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="bottom"
            align="end"
            sideOffset={6}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              padding: '4px',
              minWidth: '160px',
              boxShadow: 'var(--shadow-md)',
              zIndex: 50,
            }}
          >
            {(['rename', 'merge'] as const).map((action) => (
              <DropdownMenu.Item
                key={action}
                onSelect={() => openDialog(action)}
                style={{
                  padding: '7px 12px',
                  borderRadius: '7px',
                  fontSize: '13px',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  outline: 'none',
                  userSelect: 'none',
                  textTransform: 'capitalize',
                }}
                onMouseOver={(e) => { e.currentTarget.style.background = 'var(--bg-subtle)'; e.currentTarget.style.color = 'var(--text)'; }}
                onMouseOut={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
              >
                {action === 'rename' ? 'Rename' : 'Merge with\u2026'}
              </DropdownMenu.Item>
            ))}
            {entity.mergedInto === null && (
              <DropdownMenu.Item
                onSelect={() => openDialog('split')}
                style={{
                  padding: '7px 12px',
                  borderRadius: '7px',
                  fontSize: '13px',
                  color: '#C47A7A',
                  cursor: 'pointer',
                  outline: 'none',
                  userSelect: 'none',
                }}
                onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(196,122,122,0.08)'; }}
                onMouseOut={(e) => { e.currentTarget.style.background = 'none'; }}
              >
                Split (undo merge)
              </DropdownMenu.Item>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {/* --- Rename dialog --- */}
      <Dialog.Root open={dialog === 'rename'} onOpenChange={(o) => !o && setDialog('none')}>
        <Dialog.Portal>
          <Dialog.Overlay style={overlayStyle} />
          <Dialog.Content style={dialogContentStyle}>
            <Dialog.Title style={dialogTitleStyle}>Rename entity</Dialog.Title>
            <input
              style={inputStyle}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleRename(); }}
              autoFocus
            />
            {status && <p style={{ fontSize: '12px', color: '#C47A7A', marginTop: '8px' }}>{status}</p>}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button style={secondaryBtnStyle} onClick={() => setDialog('none')}>Cancel</button>
              <button style={primaryBtnStyle} onClick={() => void handleRename()}>Save</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* --- Merge dialog --- */}
      <Dialog.Root open={dialog === 'merge'} onOpenChange={(o) => !o && setDialog('none')}>
        <Dialog.Portal>
          <Dialog.Overlay style={overlayStyle} />
          <Dialog.Content style={dialogContentStyle}>
            <Dialog.Title style={dialogTitleStyle}>Merge with another entity</Dialog.Title>
            <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '12px', lineHeight: 1.5 }}>
              Enter the ID of the entity to merge into <strong style={{ color: 'var(--text)' }}>{entity.canonicalName}</strong>.
              The other entity will be absorbed and marked as merged.
            </p>
            <input
              style={inputStyle}
              placeholder="Entity ID (e.g. 01J...)"
              value={mergeSearch}
              onChange={(e) => { setMergeSearch(e.target.value); setMergeTargetId(e.target.value); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleMerge(); }}
              autoFocus
            />
            {status && <p style={{ fontSize: '12px', color: '#C47A7A', marginTop: '8px' }}>{status}</p>}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button style={secondaryBtnStyle} onClick={() => setDialog('none')}>Cancel</button>
              <button style={{ ...primaryBtnStyle, background: '#C47A7A' }} onClick={() => void handleMerge()}>
                Merge
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* --- Split dialog --- */}
      <Dialog.Root open={dialog === 'split'} onOpenChange={(o) => !o && setDialog('none')}>
        <Dialog.Portal>
          <Dialog.Overlay style={overlayStyle} />
          <Dialog.Content style={dialogContentStyle}>
            <Dialog.Title style={dialogTitleStyle}>Split entity (undo merge)</Dialog.Title>
            <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '12px', lineHeight: 1.5 }}>
              This will undo the most recent merge for{' '}
              <strong style={{ color: 'var(--text)' }}>{entity.canonicalName}</strong> and restore
              the absorbed entity. This cannot be undone.
            </p>
            {status && <p style={{ fontSize: '12px', color: '#C47A7A', marginTop: '8px' }}>{status}</p>}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button style={secondaryBtnStyle} onClick={() => setDialog('none')}>Cancel</button>
              <button style={{ ...primaryBtnStyle, background: '#C47A7A' }} onClick={() => void handleSplit()}>
                Split
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

// ---------------------------------------------------------------------------
// EntityHeader
// ---------------------------------------------------------------------------

interface EntityHeaderProps {
  entity: Entity;
  stats: EntityStats;
  pendingCount?: number;
  topicCount?: number;
}

export function EntityHeader({ entity, stats, pendingCount = 0, topicCount = 0 }: EntityHeaderProps) {
  const { color, tint } = ENTITY_COLORS[entity.type];
  const initial = entity.canonicalName.charAt(0).toUpperCase();
  const email = extractEmail(entity);
  const phone = extractPhone(entity);
  const isTopic = entity.type === 'topic';
  const statusStyle = STATUS_COLORS[entity.status] ?? STATUS_COLORS['active']!;

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '16px',
        padding: '20px',
        marginBottom: '24px',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {/* Top row: avatar + name + badges + actions menu */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', marginBottom: '16px' }}>
        {/* Avatar */}
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '9999px',
            background: color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            color: '#fff',
            fontSize: '20px',
            fontWeight: 600,
          }}
        >
          {initial}
        </div>

        {/* Name + badges */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
            <h1
              style={{
                fontSize: '22px',
                fontWeight: 600,
                color: 'var(--text)',
                letterSpacing: '-0.02em',
                lineHeight: 1.3,
                margin: 0,
              }}
            >
              {entity.canonicalName}
            </h1>
            {entity.nameAlt && (
              <span style={{ fontSize: '14px', color: 'var(--text-tertiary)' }}>
                {entity.nameAlt}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            {/* Type badge */}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '2px 8px',
                borderRadius: '9999px',
                background: tint,
                color,
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.04em',
              }}
            >
              {TYPE_LABELS[entity.type]}
            </span>

            {/* Status badge for topics */}
            {isTopic && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  background: statusStyle.bg,
                  color: statusStyle.color,
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'capitalize',
                }}
              >
                {entity.status}
              </span>
            )}
          </div>
        </div>

        {/* Actions menu */}
        <EntityActionsMenu entity={entity} />
      </div>

      {/* Contact info */}
      {(email || phone) && (
        <div
          style={{
            display: 'flex',
            gap: '16px',
            flexWrap: 'wrap',
            marginBottom: '16px',
            fontSize: '13px',
            color: 'var(--text-tertiary)',
          }}
        >
          {email && (
            <a
              href={`mailto:${email}`}
              style={{
                color: 'var(--text-tertiary)',
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
              onMouseOver={(e) => (e.currentTarget.style.color = 'var(--accent)')}
              onMouseOut={(e) => (e.currentTarget.style.color = 'var(--text-tertiary)')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="20" height="16" x="2" y="4" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
              {email}
            </a>
          )}
          {phone && (
            <a
              href={`tel:${phone}`}
              style={{
                color: 'var(--text-tertiary)',
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
              onMouseOver={(e) => (e.currentTarget.style.color = 'var(--accent)')}
              onMouseOut={(e) => (e.currentTarget.style.color = 'var(--text-tertiary)')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2.18h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.12 6.12l1.09-.89a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
              {phone}
            </a>
          )}
        </div>
      )}

      {/* Stats row */}
      <div
        style={{
          display: 'flex',
          gap: '6px',
          flexWrap: 'wrap',
          fontSize: '13px',
          color: 'var(--text-secondary)',
        }}
      >
        <StatChip label={String(stats.messageCount)} sublabel="messages" />
        <StatDivider />
        <StatChip
          label={stats.lastSeenAt ? formatRelativeDate(stats.lastSeenAt) : 'never'}
          sublabel="last contact"
        />
        {topicCount > 0 && (
          <>
            <StatDivider />
            <StatChip label={String(topicCount)} sublabel="topics" />
          </>
        )}
        {pendingCount > 0 && (
          <>
            <StatDivider />
            <StatChip label={String(pendingCount)} sublabel="pending" urgent />
          </>
        )}
      </div>
    </div>
  );
}

function StatDivider() {
  return (
    <span style={{ color: 'var(--border-strong)', userSelect: 'none' }}>·</span>
  );
}

function StatChip({ label, sublabel, urgent }: { label: string; sublabel: string; urgent?: boolean }) {
  return (
    <span style={{ color: urgent ? '#C47A7A' : 'var(--text-secondary)' }}>
      <span style={{ fontWeight: 500 }}>{label}</span>
      {' '}
      <span style={{ color: 'var(--text-tertiary)' }}>{sublabel}</span>
    </span>
  );
}
