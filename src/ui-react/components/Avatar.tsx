import { entityColor, initials } from '../lib/utils.js';
import type { Entity } from '../lib/api.js';

// ---------------------------------------------------------------------------
// Size config
// ---------------------------------------------------------------------------

const SIZES = {
  sm: { diameter: 32, fontSize: '13px', fontWeight: 600 },
  md: { diameter: 40, fontSize: '15px', fontWeight: 600 },
  lg: { diameter: 48, fontSize: '18px', fontWeight: 600 },
} as const;

type AvatarSize = keyof typeof SIZES;

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

interface AvatarProps {
  name: string;
  type: Entity['type'];
  size?: AvatarSize;
  /** Optional Gravatar-style image URL (email hash or direct URL) */
  imageUrl?: string;
}

export function Avatar({ name, type, size = 'md', imageUrl }: AvatarProps) {
  const { diameter, fontSize, fontWeight } = SIZES[size];
  const colors = entityColor(type);

  return (
    <div
      aria-label={name}
      style={{
        width: `${diameter}px`,
        height: `${diameter}px`,
        borderRadius: '9999px',
        backgroundColor: colors.color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={name}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={(e) => {
            // Fall back to letter avatar on image load failure
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : null}
      <span
        style={{
          color: 'white',
          fontSize,
          fontWeight,
          lineHeight: 1,
          userSelect: 'none',
          position: imageUrl ? 'absolute' : 'static',
          zIndex: 0,
        }}
      >
        {initials(name)}
      </span>
    </div>
  );
}
