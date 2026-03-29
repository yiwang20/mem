// ----------------------------------------------------------------------------
// GraphControls — floating control bar (top-right of graph viewport)
// Zoom in/out, fit-to-screen, reset buttons
// ----------------------------------------------------------------------------

interface GraphControlsProps {
  onZoomIn:     () => void;
  onZoomOut:    () => void;
  onFit:        () => void;
  onReset:      () => void;
  onFindPath:   () => void;
  findPathActive?: boolean;
}

function IconButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title:   string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        width:          32,
        height:         32,
        border:         'none',
        background:     'transparent',
        borderRadius:   6,
        cursor:         'pointer',
        color:          'var(--text-secondary)',
        fontSize:       13,
        fontWeight:     500,
        fontFamily:     'Inter, system-ui, sans-serif',
        transition:     'background 150ms ease, color 150ms ease',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)';
        (e.currentTarget as HTMLButtonElement).style.color      = 'var(--text)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        (e.currentTarget as HTMLButtonElement).style.color      = 'var(--text-secondary)';
      }}
    >
      {children}
    </button>
  );
}

function Divider() {
  return (
    <div
      style={{
        width:      1,
        height:     16,
        background: 'var(--border)',
        flexShrink: 0,
      }}
    />
  );
}

export function GraphControls({ onZoomIn, onZoomOut, onFit, onReset, onFindPath, findPathActive }: GraphControlsProps) {
  return (
    <div
      style={{
        position:        'absolute',
        top:             16,
        right:           16,
        display:         'flex',
        alignItems:      'center',
        gap:             2,
        padding:         4,
        background:      'var(--surface)',
        backdropFilter:  'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        borderRadius:    8,
        boxShadow:       'var(--shadow-sm)',
        border:          '1px solid var(--border)',
        zIndex:          20,
      }}
    >
      {/* Find Path button — active state uses accent color */}
      <button
        onClick={onFindPath}
        title={findPathActive ? 'Cancel path finder' : 'Find path between two entities'}
        style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          gap:            4,
          height:         32,
          padding:        '0 8px',
          border:         findPathActive ? '1px solid #8B7EC8' : 'none',
          background:     findPathActive ? 'rgba(139,126,200,0.12)' : 'transparent',
          borderRadius:   6,
          cursor:         'pointer',
          color:          findPathActive ? '#8B7EC8' : 'var(--text-secondary)',
          fontSize:       11,
          fontWeight:     findPathActive ? 600 : 500,
          fontFamily:     'Inter, system-ui, sans-serif',
          transition:     'background 150ms ease, color 150ms ease, border-color 150ms ease',
          whiteSpace:     'nowrap',
        }}
        onMouseEnter={(e) => {
          if (!findPathActive) {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)';
            (e.currentTarget as HTMLButtonElement).style.color      = 'var(--text)';
          }
        }}
        onMouseLeave={(e) => {
          if (!findPathActive) {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            (e.currentTarget as HTMLButtonElement).style.color      = 'var(--text-secondary)';
          }
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="5"  cy="5"  r="3" />
          <circle cx="19" cy="19" r="3" />
          <line x1="7.5" y1="7.5" x2="16.5" y2="16.5" />
        </svg>
        Find Path
      </button>

      <Divider />

      <IconButton onClick={onZoomIn} title="Zoom in">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
          <line x1="11" y1="8" x2="11" y2="14" />
          <line x1="8" y1="11" x2="14" y2="11" />
        </svg>
      </IconButton>

      <IconButton onClick={onZoomOut} title="Zoom out">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
          <line x1="8" y1="11" x2="14" y2="11" />
        </svg>
      </IconButton>

      <Divider />

      <IconButton onClick={onFit} title="Fit to screen">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3H5a2 2 0 0 0-2 2v3" />
          <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
          <path d="M3 16v3a2 2 0 0 0 2 2h3" />
          <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
        </svg>
      </IconButton>

      <Divider />

      <IconButton onClick={onReset} title="Reset to root">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </svg>
      </IconButton>
    </div>
  );
}
