// ---------------------------------------------------------------------------
// StatusBadge — entity status + urgency variants
// ---------------------------------------------------------------------------

// Entity status variant
const STATUS_CONFIG = {
  active: { label: 'Active', dotColor: '#6B9E8A', textColor: '#6B9E8A', bg: 'rgba(107,158,138,0.12)' },
  dormant: { label: 'Dormant', dotColor: '#C4A86B', textColor: '#C4A86B', bg: 'rgba(196,168,107,0.12)' },
  archived: { label: 'Archived', dotColor: '#8A8A8A', textColor: '#8A8A8A', bg: 'rgba(138,138,138,0.10)' },
  merged: { label: 'Merged', dotColor: '#8B7EC8', textColor: '#8B7EC8', bg: 'rgba(139,126,200,0.12)' },
} as const;

// Urgency variant
const URGENCY_CONFIG = {
  high: { label: 'High', dotColor: '#C47A7A', textColor: '#C47A7A', bg: 'rgba(196,122,122,0.12)' },
  medium: { label: 'Medium', dotColor: '#C4A86B', textColor: '#C4A86B', bg: 'rgba(196,168,107,0.12)' },
  low: { label: 'Low', dotColor: '#6B9E8A', textColor: '#6B9E8A', bg: 'rgba(107,158,138,0.12)' },
} as const;

type StatusType = keyof typeof STATUS_CONFIG;
type UrgencyType = keyof typeof URGENCY_CONFIG;

interface StatusBadgeProps {
  variant: 'status' | 'urgency';
  value: StatusType | UrgencyType;
}

export function StatusBadge({ variant, value }: StatusBadgeProps) {
  const config =
    variant === 'status'
      ? STATUS_CONFIG[value as StatusType]
      : URGENCY_CONFIG[value as UrgencyType];

  if (!config) return null;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        borderRadius: '9999px',
        backgroundColor: config.bg,
        color: config.textColor,
        fontSize: '10px',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        padding: '2px 8px',
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '9999px',
          backgroundColor: config.dotColor,
          flexShrink: 0,
        }}
      />
      {config.label}
    </span>
  );
}
