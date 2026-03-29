import { useState } from 'react';
import { useAppStore } from '../lib/store.js';
import type { ActiveTab, Theme } from '../lib/store.js';

// ---------------------------------------------------------------------------
// Icons (inline SVG — heroicons outline style, 20px viewport)
// ---------------------------------------------------------------------------

function ClipboardDocumentCheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
    </svg>
  );
}

function ChatBubbleLeftRightIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12c0 5 4 8 8 8a8.6 8.6 0 0 0 3-.5L17 21l-.5-3.5A7.9 7.9 0 0 0 18 12c0-4.42-3.58-8-8-8S2 7.58 2 12z" />
      <path d="M22 9c0 3.31-2.69 6-6 6a6.6 6.6 0 0 1-2-.3" strokeDasharray="2 2" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Tab configuration
// ---------------------------------------------------------------------------

interface TabDef {
  id: ActiveTab;
  tooltip: string;
  color: string;
  Icon: () => JSX.Element;
}

const TABS: TabDef[] = [
  {
    id: 'todo',
    tooltip: 'Todo 待办',
    color: '#C47A7A',
    Icon: ClipboardDocumentCheckIcon,
  },
  {
    id: 'contacts',
    tooltip: 'Contacts 联系人',
    color: '#8B7EC8',
    Icon: UsersIcon,
  },
  {
    id: 'topics',
    tooltip: 'Topics 话题',
    color: '#6B9E8A',
    Icon: ChatBubbleLeftRightIcon,
  },
];

// ---------------------------------------------------------------------------
// Tooltip (shown to the right of the button)
// ---------------------------------------------------------------------------

interface TooltipProps {
  text: string;
  visible: boolean;
}

function Tooltip({ text, visible }: TooltipProps) {
  if (!visible) return null;
  return (
    <div
      role="tooltip"
      style={{
        position: 'absolute',
        left: 'calc(100% + 8px)',
        top: '50%',
        transform: 'translateY(-50%)',
        whiteSpace: 'nowrap',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '6px',
        padding: '4px 10px',
        fontSize: '12px',
        color: 'var(--text)',
        boxShadow: 'var(--shadow-sm)',
        pointerEvents: 'none',
        zIndex: 200,
      }}
    >
      {text}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TabButton
// ---------------------------------------------------------------------------

interface TabButtonProps {
  tab: TabDef;
  isActive: boolean;
  onClick: () => void;
}

function TabButton({ tab, isActive, onClick }: TabButtonProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={tab.tooltip}
        aria-label={tab.tooltip}
        aria-pressed={isActive}
        style={{
          position: 'relative',
          width: '44px',
          height: '44px',
          borderRadius: '12px',
          background: isActive ? 'var(--accent-soft)' : hovered ? 'var(--surface-hover)' : 'transparent',
          border: isActive ? `2px solid var(--accent)` : '2px solid transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: isActive ? 'default' : 'pointer',
          color: isActive ? 'var(--accent)' : hovered ? 'var(--text-secondary)' : 'var(--text-tertiary)',
          transition: 'background 150ms ease, border-color 150ms ease, color 150ms ease',
          flexShrink: 0,
          overflow: 'visible',
        }}
      >
        {/* Colored left-edge bar when active */}
        {isActive && (
          <div
            style={{
              position: 'absolute',
              left: '-2px',
              top: '50%',
              transform: 'translateY(-50%)',
              width: '3px',
              height: '20px',
              borderRadius: '0 2px 2px 0',
              background: tab.color,
            }}
          />
        )}
        <tab.Icon />
      </button>
      <Tooltip text={tab.tooltip} visible={hovered && !isActive} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// BottomIconButton (settings / theme)
// ---------------------------------------------------------------------------

interface BottomIconButtonProps {
  tooltip: string;
  onClick: () => void;
  children: React.ReactNode;
}

function BottomIconButton({ tooltip, onClick, children }: BottomIconButtonProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={tooltip}
        aria-label={tooltip}
        style={{
          width: '44px',
          height: '44px',
          borderRadius: '12px',
          background: hovered ? 'var(--surface-hover)' : 'transparent',
          border: '2px solid transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: hovered ? 'var(--text-secondary)' : 'var(--text-tertiary)',
          transition: 'background 150ms ease, color 150ms ease',
        }}
      >
        {children}
      </button>
      <Tooltip text={tooltip} visible={hovered} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

export function Sidebar() {
  const { activeTab, setActiveTab, theme, setTheme, openSettings } = useAppStore();

  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  function cycleTheme() {
    const next: Theme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
    setTheme(next);
  }

  return (
    <nav
      aria-label="Main navigation"
      style={{
        width: '64px',
        minHeight: 'calc(100vh - 52px)',
        backgroundColor: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        padding: '8px 0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '4px',
        zIndex: 50,
        flexShrink: 0,
      }}
    >
      {/* Tab buttons */}
      {TABS.map((tab) => (
        <TabButton
          key={tab.id}
          tab={tab}
          isActive={activeTab === tab.id}
          onClick={() => setActiveTab(tab.id)}
        />
      ))}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Divider */}
      <div
        style={{
          width: 'calc(100% - 24px)',
          height: '1px',
          background: 'var(--border)',
          margin: '0 12px 8px',
        }}
      />

      {/* Settings */}
      <BottomIconButton tooltip="Settings 设置" onClick={openSettings}>
        <SettingsIcon />
      </BottomIconButton>

      {/* Theme toggle */}
      <BottomIconButton
        tooltip={`Theme: ${theme}. Click to cycle.`}
        onClick={cycleTheme}
      >
        {isDark ? <SunIcon /> : <MoonIcon />}
      </BottomIconButton>
    </nav>
  );
}
