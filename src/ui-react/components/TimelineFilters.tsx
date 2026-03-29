import { useState, useCallback } from 'react';

export interface FilterState {
  channel: 'email' | 'imessage' | 'file' | '';
  q: string;
}

interface TimelineFiltersProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
}

export function TimelineFilters({ filters, onChange }: TimelineFiltersProps) {
  const [localQ, setLocalQ] = useState(filters.q);

  const handleChannelChange = useCallback(
    (channel: FilterState['channel']) => {
      onChange({ ...filters, channel });
    },
    [filters, onChange],
  );

  const handleQKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        onChange({ ...filters, q: localQ });
      }
    },
    [filters, localQ, onChange],
  );

  const channels: Array<{ value: FilterState['channel']; label: string; color: string }> = [
    { value: '', label: 'All', color: 'var(--text-tertiary)' },
    { value: 'email', label: 'Email', color: '#6B8EC4' },
    { value: 'imessage', label: 'iMessage', color: '#6B9E8A' },
    { value: 'file', label: 'File', color: '#C4A86B' },
  ];

  return (
    <div
      style={{
        display: 'flex',
        gap: '8px',
        alignItems: 'center',
        flexWrap: 'wrap',
        marginBottom: '16px',
      }}
    >
      {/* Channel filter pills */}
      <div style={{ display: 'flex', gap: '4px' }}>
        {channels.map(({ value, label, color }) => {
          const active = filters.channel === value;
          return (
            <button
              key={value}
              onClick={() => handleChannelChange(value)}
              style={{
                padding: '4px 10px',
                borderRadius: '9999px',
                border: active ? `1px solid ${color}` : '1px solid var(--border)',
                background: active ? `${color}1A` : 'var(--surface)',
                color: active ? color : 'var(--text-tertiary)',
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.04em',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {label.toUpperCase()}
            </button>
          );
        })}
      </div>

      {/* Keyword search */}
      <div style={{ flex: 1, minWidth: '160px', maxWidth: '280px', position: 'relative' }}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            position: 'absolute',
            left: '10px',
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-tertiary)',
            pointerEvents: 'none',
          }}
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          type="text"
          placeholder="Filter messages… (Enter)"
          value={localQ}
          onChange={(e) => setLocalQ(e.target.value)}
          onKeyDown={handleQKeyDown}
          onBlur={() => {
            if (localQ !== filters.q) onChange({ ...filters, q: localQ });
          }}
          style={{
            width: '100%',
            height: '30px',
            paddingLeft: '30px',
            paddingRight: '10px',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            background: 'var(--bg-subtle)',
            color: 'var(--text)',
            fontSize: '12px',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Clear button */}
      {(filters.channel || filters.q) && (
        <button
          onClick={() => {
            setLocalQ('');
            onChange({ channel: '', q: '' });
          }}
          style={{
            padding: '4px 8px',
            border: 'none',
            background: 'none',
            color: 'var(--text-tertiary)',
            fontSize: '12px',
            cursor: 'pointer',
          }}
        >
          Clear
        </button>
      )}
    </div>
  );
}
