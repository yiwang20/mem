import { useState, useCallback } from 'react';

export interface FilterState {
  channel: string;
  q: string;
}

/** Well-known channel display config. Unknown channels get a neutral style. */
const CHANNEL_DISPLAY: Record<string, { label: string; color: string }> = {
  email: { label: 'Email', color: '#6B8EC4' },
  imessage: { label: 'iMessage', color: '#6B9E8A' },
  file: { label: 'File', color: '#C4A86B' },
  slack: { label: 'Slack', color: '#E01E5A' },
  telegram: { label: 'Telegram', color: '#0088CC' },
  notion: { label: 'Notion', color: '#999' },
};

function getChannelDisplay(ch: string): { label: string; color: string } {
  return CHANNEL_DISPLAY[ch] ?? {
    label: ch.charAt(0).toUpperCase() + ch.slice(1),
    color: '#8A8A8A',
  };
}

interface TimelineFiltersProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  /** Available channel values from the system. When provided, only these are shown. */
  availableChannels?: string[];
}

export function TimelineFilters({ filters, onChange, availableChannels }: TimelineFiltersProps) {
  const [localQ, setLocalQ] = useState(filters.q);

  const handleChannelChange = useCallback(
    (channel: string) => {
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

  // Build channel pill list: "All" + available channels
  const channelList = (availableChannels ?? []).map(ch => ({
    value: ch,
    ...getChannelDisplay(ch),
  }));

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
        {/* "All" pill */}
        <button
          onClick={() => handleChannelChange('')}
          style={{
            padding: '4px 10px',
            borderRadius: '9999px',
            border: filters.channel === '' ? '1px solid var(--text-tertiary)' : '1px solid var(--border)',
            background: filters.channel === '' ? 'rgba(128,128,128,0.1)' : 'var(--surface)',
            color: filters.channel === '' ? 'var(--text-secondary)' : 'var(--text-tertiary)',
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.04em',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
        >
          ALL
        </button>
        {channelList.map(({ value, label, color }) => {
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
