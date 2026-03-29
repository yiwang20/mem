import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../lib/store.js';

// ---------------------------------------------------------------------------
// Icons (inline SVG — heroicons outline style)
// ---------------------------------------------------------------------------

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// TopBar component
// ---------------------------------------------------------------------------

export function TopBar() {
  const navigate = useNavigate();
  const { openCommandPalette } = useAppStore();
  const [searchValue, setSearchValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && searchValue.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchValue.trim())}`);
      setSearchValue('');
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      setSearchValue('');
      inputRef.current?.blur();
    }
  }

  return (
    <header
      style={{
        height: '52px',
        backgroundColor: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        boxShadow: 'var(--shadow-xs)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: '12px',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}
    >
      {/* Logo */}
      <button
        onClick={() => navigate('/')}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '4px 8px',
          borderRadius: '8px',
          color: 'var(--text)',
          textDecoration: 'none',
        }}
      >
        <div
          style={{
            width: '28px',
            height: '28px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #A78BFA 0%, #6366F1 50%, #8B5CF6 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            color: 'white',
            fontWeight: 700,
            fontSize: '15px',
            letterSpacing: '-0.03em',
          }}
        >
          M
        </div>
        <span style={{ fontWeight: 600, fontSize: '15px', letterSpacing: '-0.01em' }}>
          MindFlow
        </span>
      </button>

      {/* Search input — Enter navigates, Cmd+K opens command palette */}
      <div
        style={{
          flex: 1,
          maxWidth: '480px',
          height: '34px',
          background: 'var(--bg-subtle)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '0 12px',
        }}
      >
        <SearchIcon />
        <input
          ref={inputRef}
          type="text"
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder="Search anything..."
          style={{
            flex: 1,
            background: 'none',
            border: 'none',
            outline: 'none',
            fontSize: '13px',
            color: 'var(--text)',
            caretColor: 'var(--accent)',
          }}
        />
        <button
          onClick={openCommandPalette}
          title="Open command palette (⌘K)"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <kbd
            style={{
              fontSize: '11px',
              background: 'var(--surface)',
              border: '1px solid var(--border-strong)',
              borderRadius: '4px',
              padding: '1px 5px',
              fontFamily: 'inherit',
              color: 'var(--text-tertiary)',
              cursor: 'pointer',
            }}
          >
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />
    </header>
  );
}
