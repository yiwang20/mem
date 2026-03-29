import type {
  AnswerContext,
  AttentionItem,
  Entity,
  GraphFragment,
  LLMProvider,
  QueryRequest,
  QueryResult,
  RawItem,
} from '../types/index.js';
import type {
  AttentionItemRepository,
  EntityRepository,
  RawItemRepository,
} from '../storage/repositories.js';
import type { GraphOperations } from '../graph/operations.js';
import { classifyIntent } from './intent.js';
import {
  entitySearch,
  ftsSearch,
  graphSearch,
  vectorSearch,
} from './search.js';
import type { ScoredEntity, ScoredItem } from './search.js';
import { extractItems, rrf } from './fusion.js';

// ---------------------------------------------------------------------------
// QueryEngine dependencies
// ---------------------------------------------------------------------------

export interface QueryEngineRepos {
  rawItems: RawItemRepository;
  entities: EntityRepository;
  attentionItems: AttentionItemRepository;
}

export interface QueryEngineConfig {
  /** Maximum items to include in LLM context (default: 10) */
  maxContextItems?: number;
  /** Maximum entities to include in LLM context (default: 10) */
  maxContextEntities?: number;
  /** Result limit for the final QueryResult (default: 20) */
  resultLimit?: number;
}

// ---------------------------------------------------------------------------
// QueryEngine
// ---------------------------------------------------------------------------

export class QueryEngine {
  private readonly maxContextItems: number;
  private readonly maxContextEntities: number;
  private readonly resultLimit: number;

  constructor(
    private readonly repos: QueryEngineRepos,
    private readonly graphOps: GraphOperations,
    private readonly llmProvider: LLMProvider,
    config: QueryEngineConfig = {},
  ) {
    this.maxContextItems = config.maxContextItems ?? 10;
    this.maxContextEntities = config.maxContextEntities ?? 10;
    this.resultLimit = config.resultLimit ?? 20;
  }

  async query(request: QueryRequest): Promise<QueryResult> {
    const limit = request.limit ?? this.resultLimit;
    const classified = classifyIntent(request.query);

    // --- Pending items shortcut ---
    if (classified.intent === 'pending_items') {
      return this.handlePendingItems(request, limit);
    }

    // --- Resolve named entities mentioned in the query ---
    const queryEntities = this.resolveQueryEntities(classified.detectedNames, limit);

    // --- Run search strategies in parallel ---
    const safeFts = (): ScoredItem[] => {
      try {
        return ftsSearch(request.query, this.repos.rawItems, limit);
      } catch {
        return [];
      }
    };
    const safeEntitySearch = (): ScoredEntity[] => {
      try {
        return entitySearch(request.query, this.repos.entities, limit);
      } catch {
        return [];
      }
    };
    const [ftsResults, entityResults] = await Promise.all([
      Promise.resolve(safeFts()),
      Promise.resolve(safeEntitySearch()),
    ]);

    // Vector search (placeholder — returns [] until embeddings available)
    const vectorResults = vectorSearch(request.query, null, limit);

    // Graph search for each detected entity
    const graphResults = queryEntities
      .slice(0, 3)
      .flatMap((e) => graphSearch(e.id, this.graphOps, limit));

    // --- RRF fusion ---
    const allLists = [ftsResults, vectorResults, graphResults].filter(
      (l) => l.length > 0,
    );
    const fused = rrf(allLists);
    const items = extractItems(fused, limit);

    // --- Build entity context ---
    // Use entity search results + entities found via graph traversal
    const entitySearchEntities = entityResults
      .map((r) => r.entity)
      .slice(0, this.maxContextEntities);
    const graphEntities = this.resolveEntitiesFromItems(items);
    const entities = dedupeEntities([...queryEntities, ...entitySearchEntities, ...graphEntities]).slice(
      0,
      this.maxContextEntities,
    );

    // --- Graph fragment ---
    const graphFragment = this.buildGraphFragment(entities.slice(0, 3));

    // --- LLM answer synthesis ---
    const answerContext: AnswerContext = {
      relevantItems: items.slice(0, this.maxContextItems),
      relevantEntities: entities,
      relevantRelationships: [],
    };

    const answer = await this.llmProvider.answer(request.query, answerContext).catch((err) => {
      console.error('[QueryEngine] LLM answer failed:', err);
      return null;
    });

    return {
      answer,
      entities,
      items,
      graphFragment,
    };
  }

  // --------------------------------------------------------------------------
  // Pending items handler
  // --------------------------------------------------------------------------

  private handlePendingItems(
    _request: QueryRequest,
    _limit: number,
  ): QueryResult {
    const attentionItems: AttentionItem[] = this.repos.attentionItems.findPending();

    // Collect entity IDs from attention items
    const entityIds = [
      ...new Set(attentionItems.map((a) => a.entityId).filter((id): id is string => id !== null)),
    ];

    const entities = entityIds
      .map((id) => this.repos.entities.findById(id))
      .filter((e): e is Entity => e !== undefined && e.status !== 'merged')
      .slice(0, this.maxContextEntities);

    // Collect raw items linked to attention items
    const rawItemIds = [
      ...new Set(
        attentionItems.map((a) => a.rawItemId).filter((id): id is string => id !== null),
      ),
    ];
    const items = rawItemIds
      .map((id) => this.repos.rawItems.findById(id))
      .filter((i): i is RawItem => i !== undefined)
      .slice(0, this.resultLimit);

    return {
      answer: {
        answer: this.formatPendingItemsSummary(attentionItems),
        sourceItemIds: items.map((i) => i.id),
        confidence: 1.0,
      },
      entities,
      items,
      graphFragment: { nodes: [], edges: [] },
    };
  }

  private formatPendingItemsSummary(items: AttentionItem[]): string {
    if (items.length === 0) return 'No pending items found.';
    const lines = items.slice(0, 10).map((item) => `- ${item.title}`);
    return `Found ${items.length} pending item(s):\n${lines.join('\n')}`;
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /** Look up entity IDs for each detected name from the query */
  private resolveQueryEntities(names: string[], limit: number): Entity[] {
    const entities: Entity[] = [];
    for (const name of names) {
      const results = entitySearch(name, this.repos.entities, limit);
      if (results.length > 0 && results[0]) {
        entities.push(results[0].entity);
      }
    }
    return dedupeEntities(entities);
  }

  /** Collect entities linked to a list of items via sender/recipient fields */
  private resolveEntitiesFromItems(items: RawItem[]): Entity[] {
    const entityIds = new Set<string>();
    for (const item of items.slice(0, 10)) {
      if (item.senderEntityId) entityIds.add(item.senderEntityId);
      for (const id of item.recipientEntityIds) entityIds.add(id);
    }

    return Array.from(entityIds)
      .map((id) => this.repos.entities.findById(id))
      .filter((e): e is Entity => e !== undefined && e.status !== 'merged');
  }

  /** Build a graph fragment covering the top entities */
  private buildGraphFragment(entities: Entity[]): GraphFragment {
    if (entities.length === 0) return { nodes: [], edges: [] };

    const allNodes = new Map<string, GraphFragment['nodes'][number]>();
    const allEdges = new Map<string, GraphFragment['edges'][number]>();

    for (const entity of entities) {
      const subgraph = this.graphOps.getSubgraph(entity.id, 1, 50);
      for (const node of subgraph.nodes) allNodes.set(node.id, node);
      for (const edge of subgraph.edges) allEdges.set(edge.id, edge);
    }

    return {
      nodes: Array.from(allNodes.values()),
      edges: Array.from(allEdges.values()),
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dedupeEntities(entities: Entity[]): Entity[] {
  const seen = new Set<string>();
  return entities.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}
