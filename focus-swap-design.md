# Focus Swap Navigation + Hierarchical Topics — Design Specification

**Version**: 1.3
**Date**: 2026-03-29
**Status**: Draft (layout confirmed: grouped-row org-chart tree)

---

## 1. Problem Statement

MindFlow's current graph UI is an accumulative radial tree: clicking a node expands its children into the existing view, dimming non-path nodes. This creates visual clutter as users drill deeper — nodes pile up, the viewport must zoom to fit, and the user loses the "one layer at a time" mental model that makes knowledge graphs intuitive.

The correct interaction model is **Focus Swap**: the screen always shows exactly one layer (a parent node at the top + its children arranged horizontally below, like an org chart). Drilling into a child node fully replaces the current layer with a new one — the child becomes the new parent at top, and its children appear below. Drilling out restores the parent layer. The user navigates through their knowledge like walking down and up an org chart.

Additionally, Topics are currently flat — every topic sits at the same level. Users need hierarchical topics (e.g., "Q3 Budget" contains "Marketing Budget" and "R&D Budget") to organize their knowledge at multiple scales.

---

## 2. Scope and Constraints

**In scope:**
- Focus Swap navigation state machine and animation sequence
- Breadcrumb navigation with full drill-back support
- Hierarchical topic data model (`parent_entity_id` on entities)
- Topic hierarchy generation pipeline (HDBSCAN + LLM sub-clustering)
- New and modified API endpoints for layer-based navigation
- Frontend architecture: NavigationStateManager, LayerBuilder, TransitionAnimator
- Cross-cutting reference handling (ghost nodes with badges)

**Out of scope:**
- Mini-map (deferred to follow-up)
- Path finder UI (existing API works; UI integration deferred)
- Manual topic reparenting drag-and-drop (deferred)
- Mobile-specific layout adaptations

**Approach:** Incremental refactor of `CytoscapeGraph.tsx`, not a rewrite. The existing component structure (imperative handle, badge layer, stylesheet) is preserved. The core change is replacing the expand/collapse/dimming model with a full element swap model.

---

## 3. Layer Structure

Each layer is defined by a **parent node** (displayed at the top center) and its **child nodes** (arranged horizontally below). This follows an org-chart / top-down tree pattern.

| Layer | Parent (top) | Children (below) | Max Children | Overflow |
|-------|-------------|-------------------|--------------|----------|
| L0 | "Me" (virtual root) | People, Topics, Documents, Pending, Groups | 5 | Fixed |
| L1 | Category node (e.g., "Topics") | Top entities of that type, sorted by recency | 12 | "Show more" child node + search bar above graph |
| L2 | Entity (e.g., "Wang Zong") | Connected entities, grouped by type | 12 | "Show more" child node + search bar above graph |
| L3 | Entity detail (e.g., "Q3 Budget" under Wang Zong) | Sub-topics or cross-ref timeline in detail panel | 12 | Same |
| L4+ | Sub-topic or nested entity | Children of that entity | 12 | Same |

**Visual layout per layer:**
```
                      ┌───────────┐
                      │ Q3 Budget │           ← parent node, top center
                      └─────┬─────┘
                            │
          ┌─────────────────┼──────────────────┐
          │                                    │
   ── 子话题 ──────────────────     ── 相关人物 ────────────
   ┌──────────┐ ┌────────┐ ┌────┐   ┌──────┐ ┌─────────┐ ┌─────────┐
   │ Marketing│ │  R&D   │ │评审│   │ Lisa │ │Wang Zong│ │Zhang San│
   │  Budget  │ │ Budget │ │会议│   │      │ │         │ │         │
   └──────────┘ └────────┘ └────┘   └──────┘ └─────────┘ └─────────┘
```

Each type group occupies its own horizontal row with a label. Multiple groups are laid out left-to-right with spacing between them. When there are many groups, they wrap to a second row.

**Child node grouping:** Children are grouped by entity type. Each group has:
1. A **type label** rendered as a DOM overlay above the group (e.g., "子话题", "相关人物", "文档"). Labels are localized.
2. Nodes within the group are **horizontally arranged**, sorted by recency.
3. Groups are ordered left-to-right: topics, people, documents, action items, key facts, threads.
4. **Inter-group spacing** (80px) is wider than intra-group spacing (50px) to visually separate groups.
5. Edges from the parent fan out to each child with taxi-style right-angle connectors.

**Overflow handling:** When `totalAvailable > 12`, two mechanisms work together:
1. A **"Show more" pseudo-node** appears as the last child (styled distinctly: dotted outline, "+N more" label). Tapping it loads the next page of child nodes, appending them to the row (up to 12 more). This repeats until all are shown.
2. A **search bar** appears above the graph when `totalAvailable > 12`. Typing filters the child nodes in real-time against entity names, replacing the current children with matching results.

**Node count control at the clustering layer:** The 12-node-per-layer limit is primarily enforced by the clustering algorithm, not the UI. When a topic produces > 12 sub-topics, the `discoverSubTopics()` pipeline automatically applies a second round of hierarchical aggregation to group related sub-topics under intermediate parent topics (see Section 5.5). This keeps each layer naturally browsable without relying on pagination.

**Key difference from current implementation:** L1 "Topics" now shows **top-level topics only** (those with no parent). Drilling into a topic at L2+ shows its sub-topics as child nodes, not its flat relationship graph.

---

## 4. Focus Swap Navigation State Machine

### 4.1 State Definition

```typescript
interface NavigationState {
  /** Stack of layers from root to current. Always has at least one entry (root). */
  layerStack: LayerEntry[];
  /** Current animation phase */
  phase: 'idle' | 'sliding-down' | 'fading-out' | 'swapping' | 'fading-in' | 'settling';
}

interface LayerEntry {
  /** The entity ID at the top of this layer (the parent node). 'root' for L0. */
  parentId: string;
  /** Display label for breadcrumb */
  label: string;
  /** Entity type or 'root'/'category'/'crossref' */
  type: string;
  /** IDs of child nodes at this layer (cached for back-navigation) */
  childNodeIds: string[];
  /** Snapshot of child node data for instant back-navigation without re-fetch */
  childNodes: ChildNodeData[];
}

interface ChildNodeData {
  id: string;
  label: string;
  type: string;
  badge?: number;
  /** For ghost nodes: list of other parent contexts this entity appears in */
  alsoIn?: Array<{ id: string; label: string }>;
}
```

### 4.2 State Transitions

```
                    ┌─────────┐
         ┌─────────│  idle    │─────────┐
         │         └─────────┘         │
   tap child node              tap breadcrumb
         │                             │
         v                             v
  ┌──────────────┐             ┌──────────────┐
  │ sliding-down │             │  sliding-up  │
  │   (200ms)    │             │   (200ms)    │
  └──────┬───────┘             └──────┬───────┘
         │                            │
         v                            v
  ┌─────────────┐              ┌─────────────┐
  │ fading-out  │              │ fading-out   │
  │   (150ms)   │              │   (150ms)    │
  └──────┬──────┘              └──────┬───────┘
         │                            │
         v                            v
  ┌─────────────┐              ┌─────────────┐
  │  swapping   │              │  swapping    │
  │  (instant)  │              │  (instant)   │
  └──────┬──────┘              └──────┬───────┘
         │                            │
         v                            v
  ┌─────────────┐              ┌─────────────┐
  │ fading-in   │              │ fading-in    │
  │   (250ms)   │              │   (250ms)    │
  └──────┬──────┘              └──────┬───────┘
         │                            │
         v                            v
  ┌─────────────┐              ┌─────────────┐
  │  settling   │              │  settling    │
  │   (100ms)   │              │   (100ms)    │
  └──────┬──────┘              └──────┬───────┘
         │                            │
         └─────────► idle ◄───────────┘
```

**Total transition time: ~700ms** (within the 300ms render target for perceived responsiveness — the slide-down gives immediate visual feedback within 200ms).

### 4.3 Drill-In Sequence (tap child node)

```
1. User taps child node N
2. Guard: if phase !== 'idle', ignore tap
3. Set phase = 'sliding-down'
4. Animate: viewport pans downward toward N's position (200ms, ease-in-out)
   - N grows slightly (44px -> 56px) and gains glow
   - Parent node and sibling children begin fading (opacity 1 -> 0.3)
5. Set phase = 'fading-out'
6. Animate: all elements fade to opacity 0 (150ms, ease-in)
7. Set phase = 'swapping'
8. Fetch new layer data: GET /api/graph/layer/:entityId
9. cy.elements().remove()
10. Build new parent + children elements (all at opacity 0)
11. Add elements to cy
12. Run preset layout (positions are pre-calculated by buildLayerElements)
13. Set phase = 'fading-in'
14. Animate: all elements fade to opacity 1 (250ms, ease-out)
    - Parent node (formerly the tapped child) fades in first at top
    - Child nodes appear below, staggered left-to-right by group (20ms per node)
    - Group labels (DOM overlays) fade in with their group's first node
15. Set phase = 'settling'
16. cy.fit(padding: 60) animated (100ms)
17. Update badges
18. Push new LayerEntry to layerStack
19. Emit breadcrumb change
20. Set phase = 'idle'
```

### 4.4 Drill-Out Sequence (tap breadcrumb)

```
1. User taps breadcrumb at index I
2. Guard: if phase !== 'idle', ignore
3. Determine target layer: layerStack[I]
4. Set phase = 'sliding-up'
5. Animate: viewport pans upward slightly (200ms, ease-in-out)
   - Parent node shrinks, children begin fading
6. Set phase = 'fading-out'
7. Animate: all elements fade to opacity 0 (150ms, ease-in)
8. Set phase = 'swapping'
9. Restore layer from cache: layerStack[I].childNodes
   - If cache is stale (>30s old), re-fetch from API
   - Otherwise use cached data for instant restore
10. cy.elements().remove()
11. Build parent + children from cached/fetched data (positions pre-calculated)
12. Run preset layout
13. Set phase = 'fading-in'
14. Animate: parent node fades in first, then children appear below by group (reverse stagger: right-to-left)
15. Set phase = 'settling'
16. cy.fit(padding: 60)
17. Truncate layerStack to [0..I]
18. Emit breadcrumb change
19. Set phase = 'idle'
```

### 4.5 Grouped-Row Layout

Dagre and breadthfirst layouts cannot produce type-grouped rows with labels. The layout is computed manually by `buildLayerElements()` (see Section 7.3), which pre-calculates all node positions based on type groups.

**Layout constants:**

```typescript
const LAYOUT = {
  nodeWidth: 44,
  nodeHeight: 44,
  intraGroupGap: 50,    // horizontal gap between nodes within a group
  interGroupGap: 80,    // horizontal gap between type groups
  parentChildGap: 120,  // vertical gap from parent to children row
  groupLabelHeight: 20, // vertical space reserved for group label above nodes
};
```

**Position algorithm summary:**
1. Group children by type (ordered: topic, person, document, action_item, key_fact, thread)
2. For each group, compute the total width: `(groupSize - 1) * intraGroupGap`
3. Compute total row width: sum of all group widths + `(numGroups - 1) * interGroupGap`
4. Position parent node at `(0, 0)`
5. Position children starting from `(-totalRowWidth / 2, parentChildGap)`, advancing x by `intraGroupGap` within groups and `interGroupGap` between groups
6. Group labels are rendered as DOM overlays (not Cytoscape nodes) centered above each group

No external layout dependency is needed. Cytoscape is used with `{ name: 'preset' }` layout (positions already assigned to elements).

---

## 5. Hierarchical Topic System

### 5.1 Data Model Change

Add `parent_entity_id` column to the `entities` table:

**Migration `002_topic_hierarchy.sql`:**

```sql
-- Add parent_entity_id for hierarchical entity relationships (primarily topics)
ALTER TABLE entities ADD COLUMN parent_entity_id TEXT REFERENCES entities(id);

-- Index for fast child lookups
CREATE INDEX idx_entities_parent ON entities(parent_entity_id)
  WHERE parent_entity_id IS NOT NULL;

-- Hierarchy depth helper: view for recursive parent chain
-- (used by API, not stored)
```

**Why `parent_entity_id` instead of a `PartOf` relationship?**

The `relationships` table already has `PartOf` edges from clustering. However, parent-child hierarchy is a structural property of the entity itself, not a temporal relationship. Using a column:
- Enables efficient tree queries (`WHERE parent_entity_id = ?`)
- Avoids ambiguity with other `PartOf` relationships (an entity can be "part of" a community without being a child of it)
- Allows simple recursive CTEs for ancestor/descendant queries
- Is consistent with how other tree structures work in SQLite

The existing `PartOf` relationships in the `relationships` table are preserved for community membership. The `parent_entity_id` column is specifically for topic hierarchy.

### 5.2 Type Changes

```typescript
// In src/types/index.ts — extend Entity interface
export interface Entity {
  // ... existing fields ...
  parentEntityId: string | null;  // NEW: parent in hierarchy (null = top-level)
}
```

### 5.3 Topic Hierarchy Generation Pipeline

The hierarchy is generated in two phases: initial clustering (existing) and sub-topic discovery (new).

**Phase 1: Flat Clustering (existing, unchanged)**
```
Messages -> Embed (BGE-M3) -> HDBSCAN -> c-TF-IDF -> LLM label
Result: flat list of Topic entities
```

**Phase 2: Sub-Topic Discovery (new)**
```
For each Topic T with >= 8 associated messages:
  1. Gather all raw_items linked to T via entity_episodes
  2. If count > 20:
     a. Re-cluster within T using HDBSCAN on embeddings
        (min_cluster_size = 3, min_samples = 2)
     b. For each sub-cluster with >= 3 messages:
        - LLM prompt: "These messages are grouped under the topic '{T.canonicalName}'.
          Here are N messages from a sub-group:
          {message_summaries}
          What specific sub-topic do they discuss?
          Return JSON: { "name": "...", "name_alt": "..." }"
        - Validate: sub-topic name must differ from parent name
        - Create Topic entity with parent_entity_id = T.id
        - Link sub-cluster messages to new sub-topic via entity_episodes
  3. If count 8-20:
     a. LLM prompt: "These N messages are about '{T.canonicalName}'.
        Are there distinct sub-themes (2-5)?
        Return JSON: [{ "name": "...", "message_indices": [...] }]
        Only return sub-themes with >= 2 messages."
     b. For each sub-theme with >= 2 messages:
        - Create child Topic entity
        - Re-link episodes
```

**Phase 3: Drift-Based Promotion/Demotion**
```
During periodic re-clustering:
  - If a child topic's embedding centroid diverges > 0.6 cosine distance
    from parent's centroid: promote to top-level (set parent_entity_id = null)
  - If two sibling topics' centroids converge < 0.3: merge them
  - If a top-level topic's centroid is within 0.35 of another topic's
    centroid and it has < 5 messages: demote as child
```

### 5.4 Hierarchy Depth Limit

Maximum hierarchy depth: **4 levels** (root topic -> sub-topic -> sub-sub-topic -> leaf).

Enforced at creation time: if parent chain length >= 4, the new topic becomes a sibling instead of a child.

### 5.5 Automatic Aggregation for Overflow Control

When `discoverSubTopics()` produces more than 12 child topics for a single parent, the pipeline automatically applies a second round of hierarchical aggregation to keep each layer browsable. This happens at the clustering layer, not the UI layer — the hierarchy is structurally correct before it ever reaches the frontend.

**Algorithm:**

```
function enforceLayerWidth(parentTopicId: string, maxChildren = 12):
  children = getChildTopics(parentTopicId)
  if children.length <= maxChildren:
    return  // nothing to do

  // Step 1: Compute pairwise embedding similarity between child topics
  embeddings = children.map(c => getTopicCentroidEmbedding(c))
  similarityMatrix = computeCosineSimilarity(embeddings)

  // Step 2: Agglomerative clustering on the children
  //   - Use average-linkage on embedding similarity
  //   - Target: ceil(children.length / maxChildren) groups, each <= maxChildren
  targetGroups = ceil(children.length / 8)  // aim for ~8 per group, leaving room
  groups = agglomerativeClustering(similarityMatrix, targetGroups)

  // Step 3: For each group with > 1 member, create an intermediate topic
  for group in groups:
    if group.length == 1:
      continue  // single-member groups stay as direct children

    // LLM labels the intermediate topic
    memberNames = group.map(c => c.canonicalName)
    intermediateName = llm.prompt(
      "These sub-topics are all under '{parentTopic.name}': {memberNames}.
       What single short label (2-4 words) describes this group?
       Return JSON: { "name": "...", "name_alt": "..." }"
    )

    // Create intermediate topic entity
    intermediateId = createTopicEntity(
      name: intermediateName,
      parent_entity_id: parentTopicId,
    )

    // Reparent group members under the intermediate
    for child in group:
      child.parent_entity_id = intermediateId

  // Step 4: Recurse — check if the intermediate level also overflows
  newChildren = getChildTopics(parentTopicId)
  if newChildren.length > maxChildren:
    enforceLayerWidth(parentTopicId, maxChildren)  // recurse

  // Step 5: Check depth limit
  //   If creating the intermediate would exceed depth 4,
  //   skip aggregation and let the UI handle overflow via pagination
```

**Integration with `discoverSubTopics()`:**

After Phase 2 (sub-topic discovery) creates child topics, `enforceLayerWidth()` is called on every parent topic that has > 12 children. This runs before Phase 3 (drift detection).

**Depth guard:** If the parent topic is already at depth 3, creating an intermediate would push children to depth 5 (exceeding the limit of 4). In this case, aggregation is skipped and the UI's "Show more" node handles the overflow instead.

**Example:**

```
Before aggregation (18 sub-topics under "Q3 Planning"):
  Q3 Planning
    ├── Marketing Budget
    ├── R&D Budget
    ├── Sales Forecast
    ├── Vendor Selection
    ├── Contract Renewal
    ├── Hiring Plan
    ├── Office Expansion
    ├── IT Infrastructure
    ├── Travel Policy
    ├── Benefits Review
    ├── Training Budget
    ├── Legal Fees
    ├── Insurance Review
    ├── Board Presentation
    ├── Investor Update
    ├── Compliance Audit
    ├── Tax Planning
    └── Year-End Close

After aggregation (3 intermediate groups):
  Q3 Planning
    ├── Budget & Finance (7)
    │   ├── Marketing Budget
    │   ├── R&D Budget
    │   ├── Sales Forecast
    │   ├── Legal Fees
    │   ├── Insurance Review
    │   ├── Tax Planning
    │   └── Year-End Close
    ├── Operations (6)
    │   ├── Vendor Selection
    │   ├── Contract Renewal
    │   ├── Office Expansion
    │   ├── IT Infrastructure
    │   ├── Travel Policy
    │   └── Training Budget
    └── People & Governance (5)
        ├── Hiring Plan
        ├── Benefits Review
        ├── Board Presentation
        ├── Investor Update
        └── Compliance Audit
```

### 5.6 Integration with Existing TopicClusterer

The `TopicClusterer` class (`src/graph/clustering.ts`) is extended with new methods:

```typescript
class TopicClusterer {
  // Existing method (unchanged)
  clusterTopics(now?: number): ClusteringStats;

  // NEW: Run sub-topic discovery on topics with sufficient messages
  discoverSubTopics(now?: number): SubTopicStats;

  // NEW: Enforce max children per topic via hierarchical aggregation
  enforceLayerWidth(parentTopicId: string, maxChildren?: number): void;
}

interface SubTopicStats {
  topicsAnalyzed: number;
  subTopicsCreated: number;
  subTopicsMerged: number;
  intermediatesCreated: number;  // from enforceLayerWidth
  promoted: number;  // child -> top-level
  demoted: number;   // top-level -> child
}
```

---

## 6. API Changes

### 6.1 New Endpoint: `GET /api/graph/layer/:entityId`

Returns the data needed to render one layer (parent + children in a top-down tree).

**Request:**
```
GET /api/graph/layer/:entityId?maxChildren=12
```

**Response:**
```typescript
interface LayerResponse {
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
    badge: number;       // pending count or activity count
    alsoIn: Array<{      // cross-cutting references (ghost node info)
      id: string;
      label: string;
    }>;
  }>;
  /** Total available child nodes (for "show more" UI) */
  totalAvailable: number;
  /** Whether this entity has grandchildren (for indicating drillability) */
  hasChildren: boolean;
}
```

**Backend logic per entity type:**

| Parent Type | Children Source |
|------------|------------|
| `root` | Fixed categories with counts (same as current `/api/graph/root`) |
| `category:people` | `SELECT FROM entities WHERE type='person' AND status='active' ORDER BY last_seen_at DESC LIMIT ?` |
| `category:topics` | `SELECT FROM entities WHERE type='topic' AND parent_entity_id IS NULL AND status='active' ORDER BY last_seen_at DESC LIMIT ?` |
| `category:documents` | Same pattern for documents |
| `category:pending` | Attention items |
| `category:groups` | Communities |
| `person` | Related entities via relationships (topics, action_items, key_facts) |
| `topic` | Child topics (if any) + related people + related documents |
| `action_item` | Related person + related topic + source thread |
| `community` | Member entities |

**Cross-cutting references (`alsoIn`):**

When building children for a person, each topic child is annotated with other people who also discuss that topic. When building children for a topic, each person is annotated with other topics they share.

Query for topic child node's `alsoIn` when parent is a person:
```sql
SELECT DISTINCT e.id, e.canonical_name
FROM relationships r1
JOIN relationships r2 ON r2.to_entity_id = r1.to_entity_id  -- same topic
JOIN entities e ON e.id = r2.from_entity_id
WHERE r1.from_entity_id = :centerId    -- current person
  AND r1.to_entity_id = :ringNodeId    -- the topic
  AND r2.from_entity_id != :centerId   -- other people
  AND e.type = 'person'
  AND e.status = 'active'
LIMIT 5
```

### 6.2 New Endpoint: `GET /api/topics/tree`

Returns the full topic hierarchy as a tree structure. Used for sidebar/overview, not for the graph.

**Response:**
```typescript
interface TopicTreeNode {
  id: string;
  label: string;
  labelAlt: string | null;
  messageCount: number;
  status: 'active' | 'dormant' | 'archived';
  children: TopicTreeNode[];
}

interface TopicTreeResponse {
  roots: TopicTreeNode[];  // top-level topics (parent_entity_id IS NULL)
}
```

**Implementation:** Recursive CTE:
```sql
WITH RECURSIVE topic_tree AS (
  SELECT id, canonical_name, name_alt, parent_entity_id, status, 0 as depth
  FROM entities
  WHERE type = 'topic' AND parent_entity_id IS NULL AND status != 'merged'
  UNION ALL
  SELECT e.id, e.canonical_name, e.name_alt, e.parent_entity_id, e.status, tt.depth + 1
  FROM entities e
  JOIN topic_tree tt ON e.parent_entity_id = tt.id
  WHERE e.type = 'topic' AND e.status != 'merged' AND tt.depth < 4
)
SELECT * FROM topic_tree ORDER BY depth, canonical_name;
```

### 6.3 New Endpoint: `POST /api/topics/:id/reparent`

Allows user to manually move a topic under a different parent.

**Request:**
```json
{ "newParentId": "string | null" }
```

**Validation:**
- Target parent must be a topic entity
- Cannot create a cycle (target is not a descendant of the moving topic)
- Resulting depth must be <= 4

### 6.4 Modified: `GET /api/graph/root`

No schema change needed. The response is the same. However, the "Topics" count should now reflect only top-level topics:

```sql
-- Change from:
SELECT COUNT(*) FROM entities WHERE type = 'topic' AND status = 'active'
-- To:
SELECT COUNT(*) FROM entities WHERE type = 'topic'
  AND parent_entity_id IS NULL AND status = 'active'
```

### 6.5 Modified: `GET /api/graph/:entityId`

The existing subgraph endpoint is preserved for backwards compatibility (used by search results, path visualization). No changes needed.

---

## 7. Frontend Architecture

### 7.1 Component Changes

The refactor touches `CytoscapeGraph.tsx` and adds supporting modules. The existing component API (`CytoscapeGraphHandle`) is preserved.

**New modules:**

```
src/ui-react/
  lib/
    navigation.ts        # NavigationStateManager
    layer-builder.ts     # LayerBuilder — builds Cytoscape elements from API data
    transition.ts        # TransitionAnimator — orchestrates the focus swap animation
  components/
    CytoscapeGraph.tsx   # Modified: delegates to navigation/layer/transition modules
    Breadcrumb.tsx       # Extracted: breadcrumb bar (currently inline in parent)
```

### 7.2 NavigationStateManager

```typescript
// src/ui-react/lib/navigation.ts

import type { LayerResponse } from './api.js';

export interface LayerEntry {
  parentId: string;
  label: string;
  type: string;
  childNodes: ChildNodeData[];
  fetchedAt: number;  // timestamp for cache staleness check
}

export interface ChildNodeData {
  id: string;
  label: string;
  type: string;
  badge?: number;
  alsoIn?: Array<{ id: string; label: string }>;
}

export class NavigationStateManager {
  private layerStack: LayerEntry[] = [];
  private phase: 'idle' | 'transitioning' = 'idle';

  get currentLayer(): LayerEntry | null {
    return this.layerStack[this.layerStack.length - 1] ?? null;
  }

  get breadcrumbs(): Array<{ id: string; label: string; type: string }> {
    return this.layerStack.map(l => ({
      id: l.parentId,
      label: l.label,
      type: l.type,
    }));
  }

  get depth(): number {
    return this.layerStack.length;
  }

  get isTransitioning(): boolean {
    return this.phase !== 'idle';
  }

  /** Push a new layer onto the stack */
  pushLayer(entry: LayerEntry): void {
    this.layerStack.push(entry);
  }

  /** Pop layers back to the given index (inclusive) */
  popTo(index: number): LayerEntry | null {
    if (index < 0 || index >= this.layerStack.length) return null;
    this.layerStack = this.layerStack.slice(0, index + 1);
    return this.currentLayer;
  }

  /** Reset to empty (before loading root) */
  reset(): void {
    this.layerStack = [];
    this.phase = 'idle';
  }

  /** Get cached layer at index, or null if stale */
  getCachedLayer(index: number, maxAgeMs = 30_000): LayerEntry | null {
    const entry = this.layerStack[index];
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > maxAgeMs) return null;
    return entry;
  }

  setPhase(phase: 'idle' | 'transitioning'): void {
    this.phase = phase;
  }
}
```

### 7.3 LayerBuilder

Positions are pre-calculated using a grouped-row algorithm. No external layout library is needed — Cytoscape runs with `{ name: 'preset' }`.

```typescript
// src/ui-react/lib/layer-builder.ts

import type { ElementDefinition } from 'cytoscape';
import type { ChildNodeData } from './navigation.js';

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const INTRA_GROUP_GAP = 50;   // horizontal spacing between nodes in same group
const INTER_GROUP_GAP = 80;   // horizontal spacing between type groups
const PARENT_CHILD_GAP = 120; // vertical distance from parent to children row
const GROUP_LABEL_OFFSET = -20; // y-offset of group label above children

// Type group ordering and display labels
const TYPE_GROUPS: Array<{
  type: string;
  label: string;       // English
  labelAlt: string;    // Chinese
}> = [
  { type: 'topic',       label: 'Sub-topics',    labelAlt: '子话题' },
  { type: 'person',      label: 'People',        labelAlt: '相关人物' },
  { type: 'document',    label: 'Documents',     labelAlt: '文档' },
  { type: 'action_item', label: 'Action Items',  labelAlt: '待办事项' },
  { type: 'key_fact',    label: 'Key Facts',     labelAlt: '关键事实' },
  { type: 'thread',      label: 'Threads',       labelAlt: '会话' },
  { type: 'category',    label: 'Categories',    labelAlt: '分类' },
  { type: 'community',   label: 'Groups',        labelAlt: '群组' },
  { type: 'pending',     label: 'Pending',       labelAlt: '待处理' },
];

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface LayerElements {
  nodes: ElementDefinition[];
  edges: ElementDefinition[];
  /** Group label overlays to render as DOM elements above the Cytoscape canvas */
  groupLabels: GroupLabel[];
}

export interface GroupLabel {
  label: string;
  labelAlt: string;
  /** Center x position (in Cytoscape model coordinates) */
  cx: number;
  /** y position (in Cytoscape model coordinates, above the children row) */
  y: number;
  /** Number of nodes in this group */
  count: number;
}

// ---------------------------------------------------------------------------
// Build function
// ---------------------------------------------------------------------------

/**
 * Build Cytoscape elements for a single layer with grouped-row layout.
 *
 * Layout:
 *   - Parent node at (0, 0), centered at top
 *   - Children grouped by entity type, each group in a horizontal row
 *   - Groups arranged left-to-right with inter-group spacing
 *   - Group labels positioned above each group
 *
 * All positions are pre-calculated. Use { name: 'preset' } layout in Cytoscape.
 */
export function buildLayerElements(
  parent: { id: string; label: string; type: string },
  children: ChildNodeData[],
): LayerElements {
  const nodes: ElementDefinition[] = [];
  const edges: ElementDefinition[] = [];
  const groupLabels: GroupLabel[] = [];

  // Parent node at origin
  nodes.push({
    data: {
      id: parent.id,
      label: parent.label,
      type: parent.type,
      isParent: true,
    },
    position: { x: 0, y: 0 },
    classes: 'parent-node',
  });

  // Group children by type (preserving order within each type by recency)
  const groups = new Map<string, ChildNodeData[]>();
  for (const child of children) {
    const list = groups.get(child.type) ?? [];
    list.push(child);
    groups.set(child.type, list);
  }

  // Order groups by TYPE_GROUPS ordering, skip empty groups
  const orderedGroups: Array<{ type: string; nodes: ChildNodeData[]; meta: typeof TYPE_GROUPS[0] }> = [];
  for (const tg of TYPE_GROUPS) {
    const g = groups.get(tg.type);
    if (g && g.length > 0) {
      orderedGroups.push({ type: tg.type, nodes: g, meta: tg });
    }
  }

  if (orderedGroups.length === 0) {
    return { nodes, edges, groupLabels };
  }

  // Calculate total row width
  const groupWidths = orderedGroups.map(g =>
    (g.nodes.length - 1) * INTRA_GROUP_GAP
  );
  const totalWidth =
    groupWidths.reduce((sum, w) => sum + w, 0) +
    (orderedGroups.length - 1) * INTER_GROUP_GAP;

  // Starting x: center the entire row under the parent
  let cursorX = -totalWidth / 2;
  const childY = PARENT_CHILD_GAP;

  for (let gi = 0; gi < orderedGroups.length; gi++) {
    const group = orderedGroups[gi]!;
    const groupWidth = groupWidths[gi]!;
    const groupStartX = cursorX;

    // Position each node in this group
    for (let ni = 0; ni < group.nodes.length; ni++) {
      const child = group.nodes[ni]!;
      const x = cursorX + ni * INTRA_GROUP_GAP;

      const truncLabel = child.label.length > 14
        ? child.label.slice(0, 13) + '\u2026'
        : child.label;

      nodes.push({
        data: {
          id: child.id,
          label: truncLabel,
          fullLabel: child.label,
          type: child.type,
          badge: child.badge,
          alsoIn: child.alsoIn,
          isParent: false,
          typeGroup: gi,
          typeGroupLabel: group.meta.label,
        },
        position: { x, y: childY },
      });

      edges.push({
        data: {
          id: `${parent.id}-${child.id}`,
          source: parent.id,
          target: child.id,
        },
      });
    }

    // Group label: centered above this group's nodes
    const groupCenterX = groupStartX + groupWidth / 2;
    groupLabels.push({
      label: group.meta.label,
      labelAlt: group.meta.labelAlt,
      cx: groupCenterX,
      y: childY + GROUP_LABEL_OFFSET,
      count: group.nodes.length,
    });

    // Advance cursor past this group + inter-group gap
    cursorX += groupWidth + INTER_GROUP_GAP;
  }

  return { nodes, edges, groupLabels };
}
```

### 7.3.1 Group Label Rendering

Group labels are **DOM overlays**, not Cytoscape nodes. This ensures labels are crisp, never overlap with graph elements, and can use standard CSS typography.

The group label layer is managed alongside the existing badge layer in `CytoscapeGraph.tsx`:

```typescript
function updateGroupLabels(cy: Core, layer: HTMLDivElement, labels: GroupLabel[]): void {
  layer.innerHTML = '';
  const pan = cy.pan();
  const zoom = cy.zoom();

  for (const gl of labels) {
    const screenX = gl.cx * zoom + pan.x;
    const screenY = gl.y * zoom + pan.y;

    const el = document.createElement('div');
    el.style.cssText =
      `position:absolute;left:${screenX}px;top:${screenY}px;` +
      `transform:translateX(-50%);` +
      `font-size:10px;font-weight:600;letter-spacing:0.5px;` +
      `text-transform:uppercase;color:var(--text-muted);` +
      `font-family:Inter,system-ui,sans-serif;` +
      `white-space:nowrap;pointer-events:none;opacity:0.6`;
    // Use labelAlt (Chinese) if the user's locale starts with 'zh', else label
    el.textContent = navigator.language.startsWith('zh') ? gl.labelAlt : gl.label;
    layer.appendChild(el);
  }
}
```

Group labels are updated on `pan`, `zoom`, and after every layer transition (same lifecycle as badges).

### 7.4 TransitionAnimator

```typescript
// src/ui-react/lib/transition.ts

import type { Core, NodeSingular } from 'cytoscape';
import type { LayerElements } from './layer-builder.js';

export interface TransitionOptions {
  direction: 'in' | 'out';
  /** The child node being drilled into (for slide-down target) */
  targetNode?: NodeSingular;
  /** Group labels to render after transition */
  groupLabels: Array<{ label: string; labelAlt: string; cx: number; y: number; count: number }>;
  /** DOM layer for group labels */
  groupLabelLayer: HTMLDivElement;
}

/**
 * Orchestrate the focus swap animation sequence with top-down tree layout.
 * Drill-in slides downward; drill-out slides upward.
 * Returns a promise that resolves when the transition completes.
 */
export async function transitionLayers(
  cy: Core,
  newElements: LayerElements,
  options: TransitionOptions,
): Promise<void> {
  const { direction, targetNode, groupLabels, groupLabelLayer } = options;

  // Phase 1: Slide toward target (200ms)
  if (direction === 'in' && targetNode?.length) {
    // Slide down: pan viewport so the tapped child moves toward top-center
    const targetPos = targetNode.position();
    const currentPan = cy.pan();
    const slideDistance = 80; // pixels to slide down
    await animatePromise(cy, {
      pan: { x: currentPan.x, y: currentPan.y - slideDistance },
      duration: 200,
      easing: 'ease-in-out',
    });
  } else {
    // Slide up: pan viewport upward
    const currentPan = cy.pan();
    const slideDistance = 80;
    await animatePromise(cy, {
      pan: { x: currentPan.x, y: currentPan.y + slideDistance },
      duration: 200,
      easing: 'ease-in-out',
    });
  }

  // Phase 2: Fade out current elements (150ms)
  const fadeOutPromises = cy.elements().map(el =>
    animateElementPromise(el, {
      style: { opacity: 0 },
      duration: 150,
      easing: 'ease-in',
    })
  );
  await Promise.all(fadeOutPromises);

  // Phase 3: Swap — remove old, add new (instant)
  cy.elements().remove();

  const allElements = [...newElements.nodes, ...newElements.edges];
  cy.add(allElements);

  // Set initial state: all invisible
  cy.elements().style('opacity', 0);

  // Positions are already set by buildLayerElements — use preset layout
  cy.layout({ name: 'preset' }).run();

  // Clear old group labels
  groupLabelLayer.innerHTML = '';

  // Phase 4: Fade in new elements (250ms, staggered)
  const parentNode = cy.nodes('[?isParent]');
  const childNodes = cy.nodes('[!isParent]');
  const edgeEls = cy.edges();

  // Parent fades in first at top
  animateElementPromise(parentNode, {
    style: { opacity: 1 },
    duration: 150,
    easing: 'ease-out',
  });

  // Children stagger in left-to-right (sorted by x position)
  const sortedChildren = childNodes.sort((a, b) =>
    a.position('x') - b.position('x')
  );
  const staggerDelay = Math.min(20, 300 / Math.max(sortedChildren.length, 1));
  const childPromises = sortedChildren.map((node, i) => {
    return new Promise<void>(resolve => {
      setTimeout(() => {
        node.animate(
          { style: { opacity: 1 } as any },
          { duration: 200, easing: 'ease-out-cubic', complete: () => resolve() },
        );
      }, i * staggerDelay);
    });
  });

  // Edges fade in with children
  edgeEls.animate(
    { style: { opacity: 1 } as any },
    { duration: 250, easing: 'ease-out' },
  );

  await Promise.all(childPromises);

  // Phase 5: Settle — fit viewport (100ms)
  await animatePromise(cy, {
    fit: { padding: 60 },
    duration: 100,
    easing: 'ease-out',
  });

  // Phase 6: Render group labels as DOM overlays
  updateGroupLabels(cy, groupLabelLayer, groupLabels);
}

// Helpers to promisify Cytoscape animations
function animatePromise(cy: Core, opts: any): Promise<void> {
  return new Promise(resolve => {
    cy.animate({ ...opts, complete: () => resolve() });
  });
}

function animateElementPromise(el: any, opts: any): Promise<void> {
  return new Promise(resolve => {
    el.animate({ ...opts, complete: () => resolve() });
  });
}
```

### 7.5 CytoscapeGraph Changes

The `CytoscapeGraph.tsx` component is refactored:

**Removed:**
- `expandedNodes` ref (no more multi-layer accumulation)
- `childrenMap` ref (replaced by `NavigationStateManager.layerStack`)
- `drillPath` ref (replaced by `NavigationStateManager.breadcrumbs`)
- `collapseNode`, `collapseDeeper` functions
- `updateDimming` function (no dimming in focus swap — all nodes are always fully visible)

**Modified:**
- `handleNodeClick` — calls `transitionLayers` instead of `expandNode`
- `loadRoot` — builds L0 via `buildLayerElements` instead of manual element creation, uses preset layout
- `navigateBack` — pops `NavigationStateManager` stack and calls `transitionLayers` with `direction: 'out'`

**Preserved:**
- Badge overlay system (ensureBadgeLayer, updateBadges)
- Stylesheet (buildStylesheet) with modifications:
  - Remove `.dimmed` styles
  - Add `.parent-node` style (replaces `.root-node`, used for the top node of every layer)
  - Add `.ghost-badge` style for cross-cutting reference indicators
- Hover highlight behavior
- Imperative handle API (loadRoot, drillDown, navigateBack, fitView, zoom, highlightPath)
- Path highlight support

**New refs:**
- `groupLabelLayerRef` — DOM overlay layer for type-group labels (managed alongside `badgeLayerRef`)

**No external layout dependency needed.** Positions are pre-calculated by `buildLayerElements()`. Cytoscape uses `{ name: 'preset' }`.

**New stylesheet entries:**

```typescript
// Parent node styling (top of the tree, used for the focused entity in every layer)
{
  selector: 'node.parent-node',
  style: {
    width: 52,
    height: 52,
    'font-size': '11px',
    'font-weight': '600',
    color: labelActive,
    'text-valign': 'bottom',
    'text-halign': 'center',
    'text-margin-y': 8,
    'shadow-blur': 20,
    'shadow-opacity': 0.5,
    'border-width': 2,
    'border-color': (el: any) => colorFor(el.data('type')).ring,
    'border-opacity': 0.6,
  },
},
// Ghost node badge indicator (dashed border on nodes that appear in other contexts)
{
  selector: 'node[alsoIn]',
  style: {
    'border-width': 1.5,
    'border-color': '#6B8EC4',
    'border-style': 'dashed',
    'border-opacity': 0.5,
  },
},
```

**Edge styling for tree layout:**
```typescript
// Tree edges: straight lines from parent to children (not curved beziers)
{
  selector: 'edge',
  style: {
    'curve-style': 'taxi',        // right-angle connectors for org-chart feel
    'taxi-direction': 'downward', // route edges downward from parent
    'taxi-turn': '50%',
    width: 1.5,
    'line-color': edgeColor,
    'target-arrow-shape': 'none', // no arrows in tree view
  },
},
```

### 7.6 Cross-Cutting References (Ghost Nodes)

When a child node has `alsoIn` data (it appears in multiple parent contexts), the node displays:
1. A **dashed border** (via CSS class) indicating it exists elsewhere
2. A **tooltip on hover** showing "Also in: Topic A, Topic B"
3. **Tap the dashed border area** (or long-press on mobile) opens a small popover with links to navigate to those other contexts

The ghost node popover is implemented as a DOM overlay (same technique as badges), not as Cytoscape elements.

### 7.6.1 Cross-Reference View (Person x Topic)

When a user drills from a Person (e.g., "Wang Zong") into a connected Topic (e.g., "Q3 Budget"), this is a **cross-reference view**. The interaction splits between the graph and the detail panel:

**Graph behavior:**
- The parent node (top of tree) becomes the Topic ("Q3 Budget")
- The children below show the Topic's sub-topics and other connected entities (people, documents) — the same as drilling into any topic
- The originating Person ("Wang Zong") appears as a child node with a highlighted edge (active-edge class) to indicate the cross-reference context

**Detail panel behavior (below graph):**
- The detail panel switches to a **filtered timeline**: only messages where both the Person AND the Topic co-occur
- This replaces the current approach of rendering shared messages as graph nodes (which was visually confusing)
- The timeline uses the existing `getCrossRef(personId, topicId)` API
- A header above the timeline reads "Wang Zong x Q3 Budget — 3 shared messages"
- The timeline supports the same filtering (channel, date range, keyword) as the regular entity timeline

**Breadcrumb:**
- Shows `Me > People > Wang Zong > Q3 Budget` with the last segment using a "x" separator style to indicate cross-reference context
- The breadcrumb entry stores both entity IDs so the filtered timeline can be restored on back-navigation

**State:**
```typescript
interface LayerEntry {
  // ... existing fields ...
  /** When set, the detail panel shows a cross-ref filtered timeline */
  crossRefEntityId?: string;
}
```

### 7.7 Breadcrumb Component

```typescript
// src/ui-react/components/Breadcrumb.tsx

interface BreadcrumbProps {
  crumbs: Array<{ id: string; label: string; type: string }>;
  onNavigate: (index: number) => void;  // -1 = root
}
```

Visual design:
```
  [Me] > [Topics] > [Q3 Budget] > [Marketing Budget]
   ^        ^            ^               ^
  always  tappable    tappable     current (bold, no link)
```

- Fixed position at the top of the graph area
- Semi-transparent background with blur
- Each segment shows a colored dot matching the entity type color
- Current (last) segment is bold and not clickable
- "Me" is always the first segment and navigates to L0

### 7.8 Coordination with Existing Views

The existing views (`DigestView`, `SearchView`, `EntityView`) interact with the graph via:

1. **Entity selection from search/digest:** Call `graphHandle.drillDown(entityId, type, label)` which pushes directly to the target layer (skipping intermediate layers).

2. **EntityView context panel:** Shows the timeline for the current center node. No change needed — it already listens to `onNodeSelect`.

3. **Store integration:** The Zustand store's `graphBreadcrumbs` is kept in sync via `onBreadcrumbsChange`. The `setSelectedEntityId` is called when the center changes.

---

## 8. API Client Changes

Add to `src/ui-react/lib/api.ts`:

```typescript
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
  totalAvailable: number;
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

// Add to api object:
export const api = {
  // ... existing methods ...

  getLayer(entityId: string, maxChildren = 12): Promise<LayerResponse> {
    return apiFetch<LayerResponse>(`/graph/layer/${entityId}?maxChildren=${maxChildren}`);
  },

  getTopicTree(): Promise<{ roots: TopicTreeNode[] }> {
    return apiFetch<{ roots: TopicTreeNode[] }>('/topics/tree');
  },

  reparentTopic(id: string, newParentId: string | null): Promise<{ entity: Entity }> {
    return apiFetch<{ entity: Entity }>(`/topics/${id}/reparent`, {
      method: 'POST',
      body: JSON.stringify({ newParentId }),
    });
  },
};
```

---

## 9. Implementation Plan

Tasks are ordered by dependency. Each task is independently implementable.

### Task 1: Database Migration — `parent_entity_id`
**Files:** `migrations/002_topic_hierarchy.sql`, `src/types/index.ts`
**What:** Add `parent_entity_id` column to entities table. Update `Entity` type to include the new field. Update `rowToEntity` mapper in `src/graph/operations.ts`.
**Acceptance criteria:** Migration runs cleanly. Existing data unaffected. TypeScript compiles.
**Dependencies:** None.

### Task 2: Topic Hierarchy API — `/api/topics/tree` and `/api/topics/:id/reparent`
**Files:** `src/adapters/http/routes/topics.ts` (new), `src/adapters/http/server.ts` (register routes)
**What:** Implement the recursive CTE query for topic tree. Implement reparent with cycle detection. Register routes.
**Acceptance criteria:** `GET /api/topics/tree` returns nested JSON. `POST /api/topics/:id/reparent` validates depth <= 4 and no cycles.
**Dependencies:** Task 1.
**Guardrails:** Raw SQL only, parameterized queries. Validate input with Zod.

### Task 3: Layer API — `/api/graph/layer/:entityId`
**Files:** `src/adapters/http/routes/graph.ts`, `src/graph/operations.ts`
**What:** Add `getLayerData(entityId, maxRing)` method to `GraphOperations`. Implement the route handler with cross-cutting reference queries.
**Acceptance criteria:** Returns correct center + children for each entity type. `alsoIn` populated for cross-cutting nodes. `totalAvailable` correct.
**Dependencies:** Task 1.
**Guardrails:** The `alsoIn` query must be limited (max 5 per node) to avoid N+1. Batch the cross-ref lookups.

### Task 4: Modify `/api/graph/root` for top-level topics only
**Files:** `src/adapters/http/routes/graph.ts`
**What:** Change the Topics count query to filter `parent_entity_id IS NULL`.
**Acceptance criteria:** Topic count reflects only root-level topics.
**Dependencies:** Task 1.

### Task 5: Sub-Topic Discovery + Automatic Aggregation in TopicClusterer
**Files:** `src/graph/clustering.ts`
**What:** Add `discoverSubTopics()` method with within-cluster re-clustering and LLM sub-topic labeling. Add `enforceLayerWidth()` method that automatically aggregates children into intermediate groups when a parent has > 12 children (Section 5.5). Set `parent_entity_id` on created child and intermediate topics.
**Acceptance criteria:** Topics with >= 8 messages get sub-topics. Sub-topics have correct `parent_entity_id`. When a parent has > 12 children, intermediate grouping topics are created via embedding similarity clustering + LLM labeling. Depth <= 4 enforced (aggregation skipped at depth 3). Each layer has <= 12 children after aggregation.
**Dependencies:** Task 1.
**Guardrails:** LLM calls must go through existing `LLMProvider` interface. Must handle LLM failures gracefully (skip sub-topic creation, don't crash pipeline). `enforceLayerWidth` must be idempotent — running it twice on the same parent should not create duplicate intermediates.

### Task 6: Frontend — NavigationStateManager + LayerBuilder + TransitionAnimator
**Files:** `src/ui-react/lib/navigation.ts` (new), `src/ui-react/lib/layer-builder.ts` (new), `src/ui-react/lib/transition.ts` (new)
**What:** Implement the three modules as specified in sections 7.2-7.4. LayerBuilder pre-calculates grouped-row positions (children grouped by type, each group with its own horizontal segment) and returns `GroupLabel[]` for DOM overlay rendering. TransitionAnimator uses slide-down/slide-up panning, `{ name: 'preset' }` layout, and renders group labels after settle.
**Acceptance criteria:** Unit-testable. `NavigationStateManager` correctly manages the layer stack. `buildLayerElements` produces valid Cytoscape element definitions with pre-calculated positions grouped by type, plus `groupLabels` array. `transitionLayers` executes the slide + fade animation sequence and renders group labels.
**Dependencies:** None (pure frontend logic).

### Task 7: Frontend — Refactor CytoscapeGraph.tsx for Focus Swap (Grouped-Row Tree Layout)
**Files:** `src/ui-react/components/CytoscapeGraph.tsx`, `src/ui-react/lib/api.ts`
**What:** Replace expand/collapse model with focus swap using grouped-row tree layout. Remove dimming logic and radial positioning. Use `NavigationStateManager`, `buildLayerElements` (with pre-calculated positions), and `transitionLayers`. Add `getLayer` to API client. Update stylesheet: replace `.root-node` with `.parent-node`, add tree edge styles (`curve-style: 'taxi'`), remove `.dimmed`. Add group label DOM overlay layer (alongside badge layer) that renders type-group labels above each group of children. Use `{ name: 'preset' }` layout (no dagre dependency).
**Acceptance criteria:** Graph shows one layer at a time — parent at top center, children in grouped horizontal rows below with type labels ("Sub-topics", "People", etc.). Drill-in slides down, drill-out slides up. Group labels render as DOM overlays and update on pan/zoom. Breadcrumbs update correctly. Badge overlay works. Imperative handle API preserved (loadRoot, drillDown, navigateBack).
**Dependencies:** Task 3, Task 6.
**Guardrails:** Preserve the existing `CytoscapeGraphHandle` interface — other components depend on it. No new npm dependencies needed.

### Task 8: Frontend — Breadcrumb Component
**Files:** `src/ui-react/components/Breadcrumb.tsx` (new or extracted from parent)
**What:** Implement the breadcrumb bar as described in section 7.7.
**Acceptance criteria:** Shows full path. Each segment tappable. Color dots per type. Current segment is bold.
**Dependencies:** Task 7 (needs to be wired into the graph component).

### Task 9: Frontend — Ghost Node Cross-Reference UI
**Files:** `src/ui-react/components/CytoscapeGraph.tsx`
**What:** Add dashed border style for nodes with `alsoIn`. Implement hover tooltip and tap popover for cross-cutting navigation.
**Acceptance criteria:** Nodes with `alsoIn` show dashed border. Hovering shows "Also in: X, Y". Tapping navigates to the selected cross-context.
**Dependencies:** Task 7.

### Task 10: Integration Testing
**Files:** `tests/integration/focus-swap.test.ts` (new), `tests/integration/topic-hierarchy.test.ts` (new)
**What:** Test the full flow: create hierarchical topics, query layer API, verify tree structure. Test navigation state machine transitions.
**Acceptance criteria:** All tests pass. Edge cases covered: empty layers, single-child topics, max depth enforcement, cycle prevention.
**Dependencies:** Tasks 1-5.

---

## 10. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| LLM sub-topic quality is poor | Sub-topics are meaningless or duplicate parent | Require >= 2 messages per sub-topic. Validate name differs from parent. Allow user to collapse (reparent children to grandparent, delete empty topic). |
| Animation jank on large tree (12 children) | Transition feels sluggish | Positions are pre-calculated by `buildLayerElements` (no layout computation during animation). Stagger child node fade-in left-to-right by group. Profile on low-end hardware. |
| Cache staleness during back-navigation | User sees stale data when navigating back | 30-second cache TTL. If stale, re-fetch from `/api/graph/layer`. Show subtle loading indicator during re-fetch. |
| Cross-cutting reference queries are slow | Layer API response > 500ms | Limit `alsoIn` to 5 per node. Use a single batch query instead of N per child node. Add index on `(from_entity_id, to_entity_id)` if not present. |
| Breaking existing views that use `getSubgraph` | Search results, path visualization break | Keep `GET /api/graph/:entityId` unchanged. New layer API is additive. |
| Topic hierarchy migration on large DB | ALTER TABLE slow on > 100K entities | SQLite ALTER TABLE ADD COLUMN is O(1) — it modifies the schema, not data. No risk. |
| Automatic aggregation creates unhelpful intermediate topics | "Miscellaneous" or too-generic group names | LLM labeling with context of parent topic name + member names. Validate intermediate name differs from parent. If LLM fails, fall back to "Group 1", "Group 2" naming and let user rename. |
| Aggregation recursion exceeds depth limit | Children pushed to depth 5+ | Hard guard: if parent is at depth 3, skip aggregation entirely. UI "Show more" handles overflow instead. |

---

## 11. Confirmed Decisions

1. **Layout**: Top-down grouped-row tree (org chart), not radial/concentric. Parent node centered at top, children arranged in type-grouped horizontal rows below. Each type group has a label (e.g., "Sub-topics", "People"). Positions are pre-calculated by `buildLayerElements()` — no external layout library needed (uses `{ name: 'preset' }`). Group labels are DOM overlays, not Cytoscape nodes.

2. **Overflow UX**: Both "Show more" child node AND search bar. The "Show more" pseudo-node loads the next page of children; the search bar (visible when `totalAvailable > 12`) filters in real-time. Additionally, node count is controlled at the clustering layer: `enforceLayerWidth()` automatically aggregates sub-topics into intermediate groups when a parent has > 12 children (see Section 5.5).

3. **Cross-reference rendering**: Cross-references (e.g., Person x Topic) use **list view in the detail panel**, not graph nodes. The graph shows the topic's normal children (sub-topics, related entities); the detail panel below shows the filtered timeline of shared messages. See Section 7.6.1 for full interaction design.

4. **Drill-in animation**: Slide downward (pan viewport down toward tapped child), then fade-swap. Matches the top-down spatial metaphor.

5. **Drill-out animation**: Slide upward (pan viewport up), then fade-swap. Reverse of drill-in.
