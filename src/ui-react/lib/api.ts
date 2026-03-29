// ============================================================================
// MindFlow API Client — typed HTTP client for the Fastify backend
// ============================================================================

export interface SystemStats {
  rawItemCount: number;
  entityCount: number;
  relationshipCount: number;
  pendingJobCount: number;
  attentionItemCount: number;
  lastSyncAt: number | null;
}

export interface Entity {
  id: string;
  type: 'person' | 'topic' | 'action_item' | 'key_fact' | 'document' | 'thread';
  canonicalName: string;
  nameAlt: string | null;
  aliases: string[];
  attributes: Record<string, unknown>;
  confidence: number;
  status: 'active' | 'dormant' | 'archived' | 'merged';
  mergedInto: string | null;
  firstSeenAt: number;
  lastSeenAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface EntityStats {
  entityId: string;
  messageCount: number;
  relationshipCount: number;
  firstSeenAt: number | null;
  lastSeenAt: number | null;
}

export interface RawItem {
  id: string;
  sourceAdapter: string;
  channel: 'email' | 'imessage' | 'file';
  externalId: string;
  threadId: string | null;
  senderEntityId: string | null;
  recipientEntityIds: string[];
  subject: string | null;
  body: string;
  bodyFormat: 'plaintext' | 'html' | 'markdown';
  language: string | null;
  eventTime: number;
  ingestedAt: number;
  processingStatus: string;
  metadata: Record<string, unknown>;
}

export interface TimelinePage {
  items: RawItem[];
  total: number;
  hasMore: boolean;
}

export interface AttentionItem {
  id: string;
  type: string;
  entityId: string | null;
  rawItemId: string | null;
  urgencyScore: number;
  title: string;
  description: string | null;
  detectedAt: number;
  resolvedAt: number | null;
  dismissedAt: number | null;
  snoozedUntil: number | null;
  resolutionType: string | null;
}

export interface GraphNode {
  id: string;
  type: string;
  label: string;
  attributes: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  strength: number;
}

export interface Subgraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ShortestPath {
  nodes: GraphNode[];
  edges: GraphEdge[];
  pathLength: number;
}

export interface QueryResult {
  answer: string | null;
  sourceItemIds: string[];
  confidence: number;
  items: RawItem[];
  entities: Entity[];
}

export interface BriefingAttendee {
  name: string;
  entity: Entity | null;
  recentItems: RawItem[];
  pendingActions: AttentionItem[];
}

export interface BriefingResult {
  summary: string | null;
  attendees: BriefingAttendee[];
  relatedFacts: Entity[];
  relatedTopics: Entity[];
}

export interface CrossRefResult {
  items: RawItem[];
  entity1: Entity;
  entity2: Entity;
}

export interface GraphRootCategory {
  id: string;
  label: string;
  type: string | null;
  count: number;
}

export interface GraphRoot {
  categories: GraphRootCategory[];
}

export interface LayerResponse {
  center: {
    id: string;
    type: string;
    label: string;
    labelAlt: string | null;
    attributes: Record<string, unknown>;
    stats: { messageCount: number; relationshipCount: number };
  };
  children: Array<{
    id: string;
    type: string;
    label: string;
    badge: number;
    alsoIn: Array<{ id: string; label: string }>;
  }>;
  /** Total available children (for "show more" UI) */
  totalAvailable: number;
  /** Whether this entity has children (for indicating drillability) */
  hasChildren: boolean;
}

export interface TopicTreeNode {
  id: string;
  label: string;
  labelAlt: string | null;
  messageCount: number;
  status: string;
  children: TopicTreeNode[];
}

export interface TopicTreeResponse {
  roots: TopicTreeNode[];
}

export interface TopicAncestorNode {
  id: string;
  label: string;
  type: string;
}

export interface TopicChildNode {
  id: string;
  label: string;
  status: string;
  messageCount: number;
}

export interface TopicAncestorsResponse {
  /** Ordered from root → direct parent (does NOT include the topic itself) */
  path: TopicAncestorNode[];
  children: TopicChildNode[];
}

export interface TopicOverviewResponse {
  overview: {
    content: string;
    generatedAt: number;
    topicStatus: string;
  } | null;
}

// ---------------------------------------------------------------------------
// Core fetch helper
// ---------------------------------------------------------------------------

class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });

  if (!res.ok) {
    let message = `API error ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = String(body.error);
    } catch {
      // ignore
    }
    throw new ApiError(res.status, message);
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

export const api = {
  // Stats
  getStats(): Promise<SystemStats> {
    return apiFetch<SystemStats>('/stats');
  },

  // Entities
  listEntities(params?: {
    type?: Entity['type'];
    limit?: number;
    sort?: 'recent' | 'frequent';
  }): Promise<{ entities: Entity[] }> {
    const qs = new URLSearchParams();
    if (params?.type) qs.set('type', params.type);
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    if (params?.sort) qs.set('sort', params.sort);
    const query = qs.toString();
    return apiFetch<{ entities: Entity[] }>(`/entities${query ? `?${query}` : ''}`);
  },

  searchEntities(search: string, limit = 10): Promise<{ entities: Entity[] }> {
    const qs = new URLSearchParams({ search, limit: String(limit) });
    return apiFetch<{ entities: Entity[] }>(`/entities?${qs}`);
  },

  getEntity(id: string): Promise<{ entity: Entity; stats: EntityStats }> {
    return apiFetch<{ entity: Entity; stats: EntityStats }>(`/entities/${id}`);
  },

  getTimeline(
    entityId: string,
    params?: {
      limit?: number;
      offset?: number;
      after?: number;
      before?: number;
      channel?: 'email' | 'imessage' | 'file';
      q?: string;
    },
  ): Promise<TimelinePage> {
    const qs = new URLSearchParams();
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    if (params?.offset !== undefined) qs.set('offset', String(params.offset));
    if (params?.after !== undefined) qs.set('after', String(params.after));
    if (params?.before !== undefined) qs.set('before', String(params.before));
    if (params?.channel) qs.set('channel', params.channel);
    if (params?.q) qs.set('q', params.q);
    const query = qs.toString();
    return apiFetch<TimelinePage>(`/entities/${entityId}/timeline${query ? `?${query}` : ''}`);
  },

  // Attention
  getAttention(): Promise<{ items: AttentionItem[] }> {
    return apiFetch<{ items: AttentionItem[] }>('/attention');
  },

  resolveAttention(id: string): Promise<void> {
    return apiFetch<void>(`/attention/${id}/resolve`, { method: 'POST' });
  },

  dismissAttention(id: string): Promise<void> {
    return apiFetch<void>(`/attention/${id}/dismiss`, { method: 'POST' });
  },

  snoozeAttention(id: string, until: number): Promise<void> {
    return apiFetch<void>(`/attention/${id}/snooze`, {
      method: 'POST',
      body: JSON.stringify({ until }),
    });
  },

  // Graph
  getGraphRoot(): Promise<GraphRoot> {
    return apiFetch<GraphRoot>('/graph/root');
  },

  getSubgraph(entityId: string, depth = 1): Promise<Subgraph> {
    return apiFetch<Subgraph>(`/graph/${entityId}?depth=${depth}`);
  },

  getShortestPath(id1: string, id2: string, maxDepth = 5): Promise<ShortestPath> {
    return apiFetch<ShortestPath>(`/graph/path/${id1}/${id2}?maxDepth=${maxDepth}`);
  },

  // Query
  query(q: string): Promise<QueryResult> {
    return apiFetch<QueryResult>('/query', {
      method: 'POST',
      body: JSON.stringify({ query: q }),
    });
  },

  // Cross-reference
  getCrossRef(id1: string, id2: string): Promise<CrossRefResult> {
    return apiFetch<CrossRefResult>(`/entities/${id1}/crossref/${id2}`);
  },

  // Entity mutations
  renameEntity(id: string, canonicalName: string): Promise<{ entity: Entity }> {
    return apiFetch<{ entity: Entity }>(`/entities/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ canonicalName }),
    });
  },

  mergeEntities(id: string, otherId: string): Promise<{ entity: Entity; auditId: string }> {
    return apiFetch<{ entity: Entity; auditId: string }>(`/entities/${id}/merge/${otherId}`, {
      method: 'POST',
    });
  },

  splitEntity(id: string): Promise<{ entity: Entity }> {
    return apiFetch<{ entity: Entity }>(`/entities/${id}/split`, { method: 'POST' });
  },

  // Ingest
  triggerIngest(): Promise<{ success: boolean; message: string; itemsProcessedBefore: number }> {
    return apiFetch('/ingest', { method: 'POST' });
  },

  // Briefing
  getBriefing(attendees: string[], topic?: string): Promise<BriefingResult> {
    return apiFetch<BriefingResult>('/briefing', {
      method: 'POST',
      body: JSON.stringify({ attendees, topic }),
    });
  },

  // Focus Swap — layer navigation
  getLayer(entityId: string, maxChildren = 15): Promise<LayerResponse> {
    return apiFetch<LayerResponse>(`/graph/layer/${entityId}?maxChildren=${maxChildren}`);
  },

  getTopicTree(): Promise<TopicTreeResponse> {
    return apiFetch<TopicTreeResponse>('/topics/tree');
  },

  reparentTopic(id: string, newParentId: string | null): Promise<{ entity: Entity }> {
    return apiFetch<{ entity: Entity }>(`/topics/${id}/reparent`, {
      method: 'POST',
      body: JSON.stringify({ newParentId }),
    });
  },

  getTopicAncestors(id: string): Promise<TopicAncestorsResponse> {
    return apiFetch<TopicAncestorsResponse>(`/topics/${id}/ancestors`);
  },

  async getTopicOverview(topicId: string): Promise<TopicOverviewResponse> {
    const res = await fetch(`/api/topics/${topicId}/overview`);
    if (res.status === 204) return { overview: null };
    if (!res.ok) {
      let message = `API error ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) message = String(body.error);
      } catch {
        // ignore
      }
      throw new ApiError(res.status, message);
    }
    return res.json() as Promise<TopicOverviewResponse>;
  },
};
