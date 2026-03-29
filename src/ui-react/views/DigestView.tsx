import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { AttentionCard } from '../components/AttentionCard.js';
import { PersonCard } from '../components/PersonCard.js';
import { TopicCard } from '../components/TopicCard.js';
import { EmptyState } from '../components/EmptyState.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSyncTime(ts: number | null): string {
  if (ts === null) return 'never synced';
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: '10px',
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--text-tertiary)',
        marginBottom: '12px',
      }}
    >
      {children}
    </div>
  );
}

function SkeletonBlock({ height = 120, borderRadius = '20px' }: { height?: number; borderRadius?: string }) {
  return (
    <div
      style={{
        borderRadius,
        height: `${height}px`,
        background: 'linear-gradient(90deg, var(--bg-subtle) 25%, var(--border) 50%, var(--bg-subtle) 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.4s ease-in-out infinite',
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// DigestView
// ---------------------------------------------------------------------------

export function DigestView() {
  const statsQuery = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.getStats(),
    refetchInterval: 60_000,
  });

  const attentionQuery = useQuery({
    queryKey: ['attention'],
    queryFn: () => api.getAttention(),
  });

  const peopleQuery = useQuery({
    queryKey: ['entities', { type: 'person', limit: 8, sort: 'recent' }],
    queryFn: () => api.listEntities({ type: 'person', limit: 8, sort: 'recent' }),
  });

  const topicsQuery = useQuery({
    queryKey: ['entities', { type: 'topic', limit: 6, sort: 'recent' }],
    queryFn: () => api.listEntities({ type: 'topic', limit: 6, sort: 'recent' }),
  });

  const stats = statsQuery.data;
  const attentionItems = attentionQuery.data?.items ?? [];
  const people = peopleQuery.data?.entities ?? [];
  const topics = topicsQuery.data?.entities ?? [];

  const isFirstLoad =
    statsQuery.isLoading &&
    attentionQuery.isLoading &&
    peopleQuery.isLoading &&
    topicsQuery.isLoading;

  const hasNoData =
    !isFirstLoad &&
    !statsQuery.isLoading &&
    (stats?.rawItemCount ?? 0) === 0 &&
    people.length === 0;

  return (
    <div
      style={{
        maxWidth: '720px',
        margin: '0 auto',
        padding: '40px 24px 80px',
      }}
    >
      {/* ------------------------------------------------------------------ */}
      {/* Greeting                                                            */}
      {/* ------------------------------------------------------------------ */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: '40px',
          gap: '16px',
        }}
      >
        <div>
          <div
            style={{
              fontSize: '28px',
              fontWeight: 400,
              color: 'var(--text)',
              lineHeight: 1.2,
              letterSpacing: '-0.02em',
              marginBottom: '8px',
            }}
          >
            Hello, Peter
          </div>
          <div
            style={{
              fontSize: '22px',
              fontWeight: 400,
              color: 'var(--text-secondary)',
              lineHeight: 1.3,
              letterSpacing: '-0.02em',
            }}
          >
            Here&apos;s what needs your{' '}
            <strong style={{ fontWeight: 700, color: 'var(--text)' }}>attention</strong> today
          </div>
        </div>

        {stats && (
          <div
            style={{
              fontSize: '13px',
              color: 'var(--text-tertiary)',
              flexShrink: 0,
              paddingTop: '4px',
              textAlign: 'right',
              lineHeight: 1.5,
            }}
          >
            <div>Last sync</div>
            <div style={{ color: 'var(--text-secondary)' }}>{formatSyncTime(stats.lastSyncAt)}</div>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Empty onboarding state                                             */}
      {/* ------------------------------------------------------------------ */}
      {hasNoData && (
        <EmptyState
          title="No data yet"
          description="Run the ingest pipeline to start building your personal knowledge graph."
          hint="mindflow init &amp;&amp; mindflow ingest"
        />
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Attention cards                                                     */}
      {/* ------------------------------------------------------------------ */}
      {!hasNoData && (
        <section style={{ marginBottom: '32px' }}>
          <SectionLabel>Attention needed</SectionLabel>

          {attentionQuery.isLoading ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: '12px',
              }}
            >
              <SkeletonBlock height={140} />
              <SkeletonBlock height={140} />
            </div>
          ) : attentionItems.length === 0 ? (
            <div
              style={{
                padding: '24px',
                textAlign: 'center',
                fontSize: '14px',
                color: 'var(--text-tertiary)',
                backgroundColor: 'var(--surface)',
                borderRadius: '16px',
                border: '1px solid var(--border)',
              }}
            >
              All clear — nothing needs attention right now.
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: '12px',
              }}
            >
              {attentionItems.map((item) => (
                <AttentionCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Recent contacts                                                     */}
      {/* ------------------------------------------------------------------ */}
      {!hasNoData && (
        <section style={{ marginBottom: '32px' }}>
          <SectionLabel>Recent contacts</SectionLabel>

          {peopleQuery.isLoading ? (
            <div style={{ display: 'flex', gap: '12px' }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <SkeletonBlock key={i} height={130} borderRadius="16px" />
              ))}
            </div>
          ) : people.length === 0 ? (
            <div style={{ fontSize: '14px', color: 'var(--text-tertiary)' }}>
              No contacts yet.
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                gap: '12px',
                overflowX: 'auto',
                scrollSnapType: 'x mandatory',
                paddingBottom: '8px',
                scrollbarWidth: 'none',
              }}
            >
              {people.map((person) => (
                <PersonCard key={person.id} entity={person} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Active topics                                                        */}
      {/* ------------------------------------------------------------------ */}
      {!hasNoData && (
        <section>
          <SectionLabel>Active topics</SectionLabel>

          {topicsQuery.isLoading ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: '12px',
              }}
            >
              <SkeletonBlock height={120} />
              <SkeletonBlock height={120} />
            </div>
          ) : topics.length === 0 ? (
            <div style={{ fontSize: '14px', color: 'var(--text-tertiary)' }}>
              No active topics yet.
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: '12px',
              }}
            >
              {topics.map((topic) => (
                <TopicCard key={topic.id} entity={topic} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
