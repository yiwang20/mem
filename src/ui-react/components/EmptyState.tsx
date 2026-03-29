interface EmptyStateProps {
  title: string;
  description: string;
  hint?: string;
  onboarding?: boolean;
}

function OnboardingCard() {
  return (
    <div
      style={{
        padding: '40px 40px 36px',
        backgroundColor: 'var(--surface)',
        borderRadius: '20px',
        border: '1px solid var(--border)',
        maxWidth: '560px',
      }}
    >
      <div style={{ fontSize: '22px', fontWeight: 600, color: 'var(--text)', marginBottom: '8px', letterSpacing: '-0.01em' }}>
        Welcome to MindFlow
      </div>
      <div style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '28px' }}>
        Your personal knowledge graph for people, topics, and action items. Get started in three steps:
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Step 1 */}
        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '9999px',
              background: 'var(--accent-soft)',
              border: '1px solid var(--border-focus)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              fontSize: '12px',
              fontWeight: 700,
              color: 'var(--accent)',
            }}
          >
            1
          </div>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text)', marginBottom: '4px' }}>
              Point MindFlow at your data
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '8px' }}>
              Set the path to your mail or message export in the config file:
            </div>
            <code
              style={{
                display: 'block',
                fontSize: '12px',
                fontFamily: "'SF Mono', 'Fira Code', ui-monospace, monospace",
                color: 'var(--text-secondary)',
                backgroundColor: 'var(--bg-subtle)',
                borderRadius: '8px',
                padding: '8px 12px',
                border: '1px solid var(--border)',
              }}
            >
              mindflow config set dataPath ~/Mail/export
            </code>
          </div>
        </div>

        {/* Step 2 */}
        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '9999px',
              background: 'var(--accent-soft)',
              border: '1px solid var(--border-focus)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              fontSize: '12px',
              fontWeight: 700,
              color: 'var(--accent)',
            }}
          >
            2
          </div>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text)', marginBottom: '4px' }}>
              Run the first ingest
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '8px' }}>
              Kick off processing to extract entities and build your graph:
            </div>
            <code
              style={{
                display: 'block',
                fontSize: '12px',
                fontFamily: "'SF Mono', 'Fira Code', ui-monospace, monospace",
                color: 'var(--text-secondary)',
                backgroundColor: 'var(--bg-subtle)',
                borderRadius: '8px',
                padding: '8px 12px',
                border: '1px solid var(--border)',
              }}
            >
              mindflow ingest --all
            </code>
          </div>
        </div>

        {/* Step 3 */}
        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '9999px',
              background: 'var(--accent-soft)',
              border: '1px solid var(--border-focus)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              fontSize: '12px',
              fontWeight: 700,
              color: 'var(--accent)',
            }}
          >
            3
          </div>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text)', marginBottom: '4px' }}>
              Ask a question or explore
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '8px' }}>
              Use the search bar above or try a natural language query:
            </div>
            <code
              style={{
                display: 'block',
                fontSize: '12px',
                fontFamily: "'SF Mono', 'Fira Code', ui-monospace, monospace",
                color: 'var(--text-secondary)',
                backgroundColor: 'var(--bg-subtle)',
                borderRadius: '8px',
                padding: '8px 12px',
                border: '1px solid var(--border)',
              }}
            >
              What's pending with Alice from last week?
            </code>
          </div>
        </div>
      </div>
    </div>
  );
}

export function EmptyState({ title, description, hint, onboarding }: EmptyStateProps) {
  if (onboarding) {
    return <OnboardingCard />;
  }

  return (
    <div
      style={{
        padding: '48px 32px',
        textAlign: 'center',
        backgroundColor: 'var(--surface)',
        borderRadius: '20px',
        border: '1px solid var(--border)',
      }}
    >
      {/* Simple line-art icon */}
      <div style={{ marginBottom: '16px', color: 'var(--text-ghost)' }}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
      </div>
      <div style={{ fontSize: '18px', fontWeight: 500, color: 'var(--text)', marginBottom: '8px' }}>
        {title}
      </div>
      <div style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: hint ? '16px' : 0 }}>
        {description}
      </div>
      {hint && (
        <div
          style={{
            display: 'inline-block',
            fontSize: '12px',
            fontFamily: "'SF Mono', 'Fira Code', ui-monospace, monospace",
            color: 'var(--text-tertiary)',
            backgroundColor: 'var(--bg-subtle)',
            borderRadius: '8px',
            padding: '6px 12px',
            border: '1px solid var(--border)',
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}
