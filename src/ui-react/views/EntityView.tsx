import { useState, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import * as Tabs from '@radix-ui/react-tabs';
import { api } from '../lib/api.js';
import type { Entity, RawItem } from '../lib/api.js';
import { EntityHeader } from '../components/EntityHeader.js';
import { TimelineItem, TimelineDateHeader } from '../components/TimelineItem.js';
import { TimelineFilters } from '../components/TimelineFilters.js';
import type { FilterState } from '../components/TimelineFilters.js';
import { ContextPanel } from '../components/ContextPanel.js';
import { KeyFactsTab, RelationshipsTab } from '../components/TabContent.js';
import { HierarchyNavigator } from '../components/HierarchyNavigator.js';
import { TopicOverview } from '../components/TopicOverview.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(ts: number): string {
  if (!ts) return '';
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ---------------------------------------------------------------------------
// Timeline infinite query helpers
// ---------------------------------------------------------------------------

const TIMELINE_PAGE_SIZE = 20;

function groupByDate(items: RawItem[]): Array<{ date: string; items: RawItem[] }> {
  const groups = new Map<string, RawItem[]>();
  for (const item of items) {
    const d = new Date(item.eventTime);
    const key = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return Array.from(groups.entries()).map(([date, items]) => ({ date, items }));
}

// ---------------------------------------------------------------------------
// Error / loading states
// ---------------------------------------------------------------------------

function LoadingState() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '24px',
      }}
    >
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            height: '88px',
            borderRadius: '12px',
            background: 'var(--bg-subtle)',
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        />
      ))}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: '48px 24px',
        textAlign: 'center',
        color: 'var(--text-tertiary)',
        fontSize: '14px',
      }}
    >
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline tab
// ---------------------------------------------------------------------------

function TimelineTab({ entityId }: { entityId: string }) {
  const [filters, setFilters] = useState<FilterState>({ channel: '', q: '' });

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
  } = useInfiniteQuery({
    queryKey: ['timeline', entityId, filters],
    queryFn: ({ pageParam = 0 }) =>
      api.getTimeline(entityId, {
        limit: TIMELINE_PAGE_SIZE,
        offset: pageParam as number,
        channel: filters.channel || undefined,
        q: filters.q || undefined,
      }),
    getNextPageParam: (lastPage, allPages) => {
      const totalFetched = allPages.reduce((s, p) => s + p.items.length, 0);
      return lastPage.hasMore ? totalFetched : undefined;
    },
    initialPageParam: 0,
  });

  const allItems = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data],
  );
  const dateGroups = useMemo(() => groupByDate(allItems), [allItems]);

  const handleFiltersChange = useCallback((f: FilterState) => {
    setFilters(f);
  }, []);

  return (
    <div>
      <TimelineFilters filters={filters} onChange={handleFiltersChange} />

      {isLoading && <LoadingState />}
      {isError && <ErrorState message="Failed to load timeline." />}

      {!isLoading && !isError && allItems.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: '48px 24px',
            color: 'var(--text-tertiary)',
            fontSize: '14px',
          }}
        >
          No messages found
          {filters.channel || filters.q ? ' matching these filters' : ''}.
        </div>
      )}

      {dateGroups.map(({ date, items }) => (
        <div key={date}>
          <TimelineDateHeader date={date} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {items.map((item) => (
              <TimelineItem key={item.id} item={item} />
            ))}
          </div>
        </div>
      ))}

      {(hasNextPage || isFetchingNextPage) && (
        <div style={{ textAlign: 'center', marginTop: '16px' }}>
          <button
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
            style={{
              padding: '8px 20px',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-secondary)',
              fontSize: '13px',
              fontWeight: 500,
              cursor: isFetchingNextPage ? 'default' : 'pointer',
              opacity: isFetchingNextPage ? 0.6 : 1,
            }}
          >
            {isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab bar styles
// ---------------------------------------------------------------------------

const TAB_IDS = ['timeline', 'key_facts', 'relationships'] as const;
type TabId = typeof TAB_IDS[number];

const TAB_LABELS: Record<TabId, string> = {
  timeline:      'Timeline',
  key_facts:     'Key Facts',
  relationships: 'Relationships',
};

// ---------------------------------------------------------------------------
// EntityView
// ---------------------------------------------------------------------------

export function EntityView() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<TabId>('timeline');

  // Entity + stats
  const {
    data: entityData,
    isLoading: entityLoading,
    isError: entityError,
  } = useQuery({
    queryKey: ['entity', id],
    queryFn: () => api.getEntity(id!),
    enabled: !!id,
  });

  // Subgraph (depth 1) for related entities and relationships
  const { data: subgraph } = useQuery({
    queryKey: ['subgraph', id],
    queryFn: () => api.getSubgraph(id!, 1),
    enabled: !!id,
  });

  // Attention items for context panel
  const { data: attentionData } = useQuery({
    queryKey: ['attention'],
    queryFn: () => api.getAttention(),
  });

  if (!id) {
    return <ErrorState message="No entity ID in URL." />;
  }

  if (entityLoading) {
    return (
      <div style={{ padding: '32px 24px', maxWidth: '1200px', margin: '0 auto' }}>
        <LoadingState />
      </div>
    );
  }

  if (entityError || !entityData) {
    return (
      <div style={{ padding: '32px 24px', maxWidth: '1200px', margin: '0 auto' }}>
        <ErrorState message="Entity not found or failed to load." />
      </div>
    );
  }

  const { entity, stats } = entityData;
  const nodes = subgraph?.nodes ?? [];
  const edges = subgraph?.edges ?? [];

  // Derived data from subgraph
  const allNodes = nodes;
  const keyFacts = allNodes
    .filter((n) => n.type === 'key_fact')
    .map((n) => ({
      id: n.id,
      type: 'key_fact' as Entity['type'],
      canonicalName: n.label,
      nameAlt: null,
      aliases: [],
      attributes: n.attributes,
      confidence: 1,
      status: 'active' as Entity['status'],
      mergedInto: null,
      parentEntityId: null,
      firstSeenAt: 0,
      lastSeenAt: 0,
      createdAt: 0,
      updatedAt: 0,
    } satisfies Entity));

  // Topics from subgraph
  const relatedTopics = allNodes.filter((n) => n.type === 'topic');

  // Pending items related to this entity
  const pendingItems = (attentionData?.items ?? []).filter(
    (a) => a.entityId === id && !a.resolvedAt && !a.dismissedAt,
  );

  return (
    <div
      style={{
        display: 'flex',
        height: 'calc(100vh - 92px)',
        overflow: 'hidden',
      }}
    >
      {/* Main panel */}
      <div
        style={{
          flex: '1 1 65%',
          padding: '24px',
          overflowY: 'auto',
          minWidth: 0,
        }}
      >
        {/* For topics: HierarchyNavigator embeds the header info */}
        {entity.type === 'topic' ? (
          <HierarchyNavigator
            entityId={entity.id}
            entityLabel={entity.canonicalName}
            entityLabelAlt={entity.nameAlt}
            entityStatus={entity.status}
            messageCount={stats.messageCount}
            lastSeenAgo={stats.lastSeenAt ? timeAgo(stats.lastSeenAt) : undefined}
            topicCount={relatedTopics.length}
            pendingCount={pendingItems.length || undefined}
          />
        ) : (
          <EntityHeader
            entity={entity}
            stats={stats}
            pendingCount={pendingItems.length}
            topicCount={relatedTopics.length}
          />
        )}

        {/* AI Overview — topics only */}
        {entity.type === 'topic' && (
          <TopicOverview topicId={entity.id} topicStatus={entity.status} />
        )}

        {/* Tab bar */}
        <Tabs.Root
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as TabId)}
        >
          <Tabs.List
            style={{
              display: 'flex',
              gap: '0',
              borderBottom: '1px solid var(--border)',
              marginBottom: '16px',
            }}
          >
            {TAB_IDS.map((tab) => (
              <Tabs.Trigger
                key={tab}
                value={tab}
                style={{
                  padding: '8px 16px',
                  border: 'none',
                  borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                  background: 'none',
                  color: activeTab === tab ? 'var(--text)' : 'var(--text-tertiary)',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'color 0.15s',
                  marginBottom: '-1px',
                }}
              >
                {TAB_LABELS[tab]}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          <Tabs.Content value="timeline">
            <TimelineTab entityId={id} />
          </Tabs.Content>

          <Tabs.Content value="key_facts">
            <KeyFactsTab keyFacts={keyFacts} />
          </Tabs.Content>

          <Tabs.Content value="relationships">
            <RelationshipsTab entityId={id} nodes={nodes} edges={edges} />
          </Tabs.Content>
        </Tabs.Root>
      </div>

      {/* Context panel — hidden on small screens */}
      <div
        style={{
          flex: '0 0 35%',
          maxWidth: '380px',
          borderLeft: '1px solid var(--border)',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
        className="context-panel-desktop"
      >
        <ContextPanel
          entityId={id}
          nodes={nodes}
          edges={edges}
          pendingItems={pendingItems}
          keyFacts={keyFacts}
        />
      </div>
    </div>
  );
}
