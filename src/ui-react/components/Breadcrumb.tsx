// ============================================================================
// Breadcrumb — navigation trail for Focus Swap layer stack
// ============================================================================

const TYPE_COLORS: Record<string, string> = {
  person:      '#8B7EC8',
  topic:       '#6B9E8A',
  document:    '#C4A86B',
  action_item: '#C47A7A',
  pending:     '#C47A7A',
  key_fact:    '#6B8EC4',
  thread:      '#8A8A8A',
  root:        '#8B7EC8',
  category:    '#8B7EC8',
  community:   '#6B9E8A',
};

function dotColor(type: string): string {
  return TYPE_COLORS[type] ?? '#8A8A8A';
}

export interface BreadcrumbProps {
  crumbs: Array<{ id: string; label: string; type: string }>;
  /** Called with the index in the crumbs array to navigate to. -1 = root (Me). */
  onNavigate: (index: number) => void;
}

export function Breadcrumb({ crumbs, onNavigate }: BreadcrumbProps) {
  return (
    <div
      style={{
        position:        'absolute',
        top:             16,
        left:            16,
        display:         'flex',
        alignItems:      'center',
        gap:             4,
        padding:         '6px 10px',
        background:      'var(--surface)',
        backdropFilter:  'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        borderRadius:    8,
        boxShadow:       'var(--shadow-sm)',
        border:          '1px solid var(--border)',
        zIndex:          20,
        maxWidth:        '60vw',
        overflow:        'hidden',
      }}
    >
      {/* Root segment — always "Me" */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span
          style={{
            display:      'inline-block',
            width:        6,
            height:       6,
            borderRadius: '50%',
            background:   '#8B7EC8',
            flexShrink:   0,
          }}
        />
        <button
          onClick={() => onNavigate(-1)}
          style={{
            background:  'none',
            border:      'none',
            padding:     0,
            cursor:      crumbs.length === 0 ? 'default' : 'pointer',
            color:       crumbs.length === 0 ? 'var(--text)' : 'var(--text-secondary)',
            fontSize:    12,
            fontWeight:  crumbs.length === 0 ? 600 : 400,
            fontFamily:  'Inter, system-ui, sans-serif',
            whiteSpace:  'nowrap',
          }}
        >
          Me
        </button>
      </span>

      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={crumb.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                color:      'var(--border-strong)',
                fontSize:   12,
                userSelect: 'none',
              }}
            >
              /
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span
                style={{
                  display:      'inline-block',
                  width:        6,
                  height:       6,
                  borderRadius: '50%',
                  background:   dotColor(crumb.type),
                  flexShrink:   0,
                }}
              />
              <button
                onClick={() => !isLast && onNavigate(i)}
                style={{
                  background:   'none',
                  border:       'none',
                  padding:      0,
                  cursor:       isLast ? 'default' : 'pointer',
                  color:        isLast ? 'var(--text)' : 'var(--text-secondary)',
                  fontSize:     12,
                  fontWeight:   isLast ? 600 : 400,
                  fontFamily:   'Inter, system-ui, sans-serif',
                  whiteSpace:   'nowrap',
                  maxWidth:     120,
                  overflow:     'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {crumb.label}
              </button>
            </span>
          </span>
        );
      })}
    </div>
  );
}
