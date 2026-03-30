// ---------------------------------------------------------------------------
// Channel badge — pill indicator for email / iMessage / meeting / document
// ---------------------------------------------------------------------------

const CHANNEL_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  email: { label: 'Email', color: '#6B8EC4', bg: 'rgba(107,142,196,0.12)' },
  imessage: { label: 'iMessage', color: '#6B9E8A', bg: 'rgba(107,158,138,0.12)' },
  slack: { label: 'Slack', color: '#E01E5A', bg: 'rgba(224,30,90,0.12)' },
  telegram: { label: 'Telegram', color: '#0088CC', bg: 'rgba(0,136,204,0.12)' },
  meeting: { label: 'Meeting', color: '#8B7EC8', bg: 'rgba(139,126,200,0.12)' },
  document: { label: 'Document', color: '#C4A86B', bg: 'rgba(196,168,107,0.12)' },
  file: { label: 'File', color: '#C4A86B', bg: 'rgba(196,168,107,0.12)' },
};

type ChannelType = string;

const SIZE_CONFIG = {
  sm: { fontSize: '10px', padding: '1px 6px', letterSpacing: '0.04em' },
  md: { fontSize: '11px', padding: '2px 8px', letterSpacing: '0.04em' },
} as const;

type BadgeSize = keyof typeof SIZE_CONFIG;

interface ChannelBadgeProps {
  channel: ChannelType | string;
  size?: BadgeSize;
}

export function ChannelBadge({ channel, size = 'md' }: ChannelBadgeProps) {
  const key = channel.toLowerCase() as ChannelType;
  const config = CHANNEL_CONFIG[key] ?? {
    label: channel,
    color: '#8A8A8A',
    bg: 'rgba(138,138,138,0.10)',
  };
  const { fontSize, padding, letterSpacing } = SIZE_CONFIG[size];

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: '9999px',
        backgroundColor: config.bg,
        color: config.color,
        fontSize,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing,
        padding,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
      }}
    >
      {config.label}
    </span>
  );
}
