# Focus Mode Navigation Research

## Research for MindFlow Graph UI Redesign

**Date**: March 29, 2026

---

## 1. Focus Mode / Single-Layer Navigation Patterns

### 1.1 Recall (getrecall.ai) — Graph View 2.0

Recall's Graph View 2.0 (released Jan 2026) is the closest existing product to what MindFlow needs, but it does NOT do single-layer navigation. It uses a **focus + fade** model:

**How it works:**
- Click a node to filter the graph to only that card and its direct connections
- Navigate by clicking connected nodes — the graph rebuilds around the new focus
- A **depth slider** (1-3 degrees) controls how many connection levels are visible
- The system builds a **visual trail** of your exploration path (breadcrumb-like)
- **Path Finder**: select two nodes, click the path icon, see the shortest connection highlighted

**What happens to the parent level:**
- Non-connected nodes disappear entirely (not faded, removed from view)
- The trail/path history lets you retrace steps

**Navigation back:**
- Visual trail of your path for retracing
- Graph search to jump to any node by name

**Animation:**
- Zoom-to-fit when focusing on a node
- Timeline animation showing knowledge base growth over time (date range slider)

**Settings:**
- Node spacing, link forces, gravity are adjustable
- Automatic node coloring by tags
- Saved presets for filter/color/layout combos

**Key lesson for MindFlow:** Recall proves that depth-controlled focus (1-3 degrees) works well. But their model still shows too many nodes for large graphs. MindFlow should go further with strict single-layer navigation.

---

### 1.2 macOS Finder — Miller Columns

Miller columns are the gold standard for hierarchical drill-down with context preservation.

**How it works:**
- Multiple vertical columns side by side, each showing one hierarchy level
- Selecting an item in column N populates column N+1 with its children
- Columns scroll horizontally as you go deeper

**Parent level:**
- Parent remains visible in the column to the left
- The full path from root to current selection is always visible
- Selected items are highlighted in each column (bold, colored background)

**Navigation back:**
- Click any item in any visible parent column
- Keyboard: left arrow moves up one level

**Animation:**
- New column slides in from right
- Smooth horizontal scroll

**Maximum visible:**
- Typically 3-4 columns visible at once (constrained by screen width)
- Each column shows ~15-30 items depending on font size

**Limitations:**
- Horizontal space consumption grows with depth
- Poor for non-tree structures (no cross-cutting edges)
- Limited metadata per item (just names)

**Key lesson for MindFlow:** The "parent stays visible to the left" pattern preserves spatial context. Consider a hybrid where the breadcrumb functions as a mini-column view.

---

### 1.3 MindNode — Focus Mode (most relevant to MindFlow)

MindNode's Focus Mode is the closest analogue to what MindFlow needs. It went through 7 design iterations.

**How it works:**
- Select a node, press Shift+Cmd+F (or toolbar button)
- The selected node and its entire subtree remain fully visible
- Everything else **fades to low opacity with blur** — not hidden, but de-emphasized
- The outline view (sidebar) also grays out unfocused content

**Key design decisions (from their dev blog):**
- They rejected "hoisting" (pulling a subtree into a separate document) because it felt too disconnected from context
- They rejected full hiding because users lost spatial awareness
- The final approach: **zoom level controls visibility** — when zoomed in, unfocused branches are nearly invisible; when zoomed out, they reappear faintly
- Opacity and blur are the primary visual mechanisms
- Quick refocus: Option+click on Mac or long-press on iOS switches focus to another node

**Navigation back:**
- Press Shift+Cmd+F again to exit Focus Mode
- Or Option+click any other node to refocus there

**Animation:**
- Opacity/blur transitions (not specified, but smooth)
- Parameters tuned in Swift Playgrounds because static mockups couldn't capture the feel

**Key lesson for MindFlow:** The zoom-as-context-control idea is elegant. When the user zooms in, hide context. When they zoom out, show faded context. This gives users agency over information density.

---

### 1.4 Heptabase — Focus Mode + Sub-Whiteboards

**How it works:**
- Toggle Focus Mode button at bottom-right of whiteboard
- Only the selected card remains fully visible; all other objects dim
- Keyboard navigation moves through cards sequentially
- For deeper organization: create **sub-whiteboards** for subtopics, forming a hierarchy of spatial canvases

**Parent level:**
- Dimmed but visible (same as MindNode approach)
- Sub-whiteboards are separate canvases — parent whiteboard is a different view entirely

**Navigation back:**
- Toggle Focus Mode off
- Navigate up from sub-whiteboard to parent whiteboard

**Key lesson for MindFlow:** The sub-whiteboard concept maps well to MindFlow's layer model. Each "layer" is conceptually a separate canvas, but you can zoom out to see the parent.

---

### 1.5 Roam Research — Block Zoom

**How it works:**
- Click the bullet point of any block to "zoom in" — that block becomes the page
- All child blocks are shown; everything else disappears
- URL updates to reflect the zoomed-in block (deep linking)
- Ctrl+Shift+O zooms into focused block; Cmd+. focuses on a block, Cmd+, focuses on parent

**Parent level:**
- Completely replaced — parent content is gone from view
- A breadcrumb trail at the top shows: Page > Parent Block > Current Block

**Navigation back:**
- Click any breadcrumb segment
- Cmd+, to go up one level
- Browser back button works (URL-based navigation)

**Animation:**
- Instant replacement, no animation (text-based UI)

**Maximum visible:**
- Unlimited (it's a text outline, not a graph)

**Key lesson for MindFlow:** Roam's "click bullet to zoom" is the purest single-layer navigation. The URL-based deep linking is essential for shareability. The breadcrumb is the only context for where you are.

---

### 1.6 Notion — Page Hierarchy

**How it works:**
- Each page can contain sub-pages
- Click a sub-page to navigate into it (full page replacement)
- Cmd+Shift+U goes up one level

**Parent level:**
- Completely replaced by child page
- Breadcrumb at top: Workspace > Parent Page > Current Page
- Sidebar shows full page tree (collapsible)

**Navigation back:**
- Breadcrumb clicks
- Sidebar tree navigation
- Cmd+Shift+U keyboard shortcut

**Key lesson for MindFlow:** The dual navigation (breadcrumb + sidebar tree) is important. The sidebar tree gives global context that breadcrumbs alone cannot provide.

---

### 1.7 Org Chart Tools — Drill-Down Patterns

From research on OrgaNice, Lucidchart, and FusionCharts:

**Drilldown menu pattern:**
- Clicking a parent replaces the current view with its children
- A back link at the top returns to parent level
- Only the current level's items and their siblings are visible at any time
- Very mobile-friendly (minimal scrolling)

**Best practices:**
- Each chart level should have a "manageable" number of roles (not strictly defined, but "single screen" is the goal)
- Break large orgs into linked sub-charts by department/region
- Use tooltips and hover effects for detail without navigation
- Dotted lines for advisory/cross-cutting relationships; solid lines for hierarchical
- Filter/search by role, name, department

---

### 1.8 Pattern Comparison Table

| Product | Focus Mechanism | Parent Visibility | Navigation Back | Cross-refs | Max Nodes |
|---------|----------------|-------------------|----------------|------------|-----------|
| Recall | Remove non-connected | Hidden | Path trail | Depth slider (1-3) | ~50-100 |
| Finder (Miller) | Column per level | Visible (left columns) | Click parent column | N/A (tree only) | ~20/column |
| MindNode | Fade + blur | Faded, visible | Option+click | N/A (tree) | Unlimited (faded) |
| Heptabase | Dim non-selected | Dimmed | Toggle off | Sub-whiteboards | ~20-30 cards |
| Roam | Full replacement | Hidden (breadcrumb) | Breadcrumb click | Block references | Unlimited (text) |
| Notion | Full replacement | Hidden (breadcrumb + sidebar) | Breadcrumb/sidebar | Page links | Unlimited (text) |
| Org charts | Full replacement | Hidden (back link) | Back button | Dotted lines | 10-20/level |

---

## 2. Hierarchical Topic Clustering

### 2.1 BERTopic — Hierarchical Topic Modeling (most production-ready)

BERTopic is the most mature framework for this. Its hierarchical approach:

**Algorithm:**
1. Generate embeddings for all documents
2. Reduce dimensionality via UMAP
3. Cluster via HDBSCAN (flat clusters first)
4. Calculate c-TF-IDF matrix (term importance per topic)
5. Build hierarchy: compute cosine similarity between topic c-TF-IDF vectors
6. Apply hierarchical clustering (Ward's method by default) to create tree
7. At each merge, recalculate c-TF-IDF by summing bag-of-words of merged topics

**Parent-child determination:**
- Topics with the smallest c-TF-IDF distance become siblings under a shared parent
- Ward linkage minimizes within-cluster variance
- The resulting dendrogram gives a full tree structure

**API:**
```python
hierarchical_topics = topic_model.hierarchical_topics(docs)
tree = topic_model.get_topic_tree(hierarchical_topics)  # text tree
topic_model.visualize_hierarchy(hierarchical_topics=hierarchical_topics)  # interactive viz
```

**LLM labeling integration:**
- BERTopic passes candidate keywords + representative docs to an LLM
- LLM generates human-readable topic name
- Works with ChatGPT, GPT-4, open-source models, Claude

**Key lesson for MindFlow:** BERTopic's approach (HDBSCAN for flat clusters, then hierarchical agglomeration on c-TF-IDF) is directly applicable. MindFlow already plans HDBSCAN clustering. Add the c-TF-IDF hierarchy step for automatic subtopic organization.

---

### 2.2 TopicGPT — LLM-Native Hierarchical Topics

TopicGPT takes a different approach: use the LLM directly for hierarchy generation.

**Algorithm:**
1. Prompt LLM: "List 5 subtopics of {topic}"
2. For each subtopic, recursively prompt for 5 more subtopics
3. **Critical**: require the LLM to cite specific source documents for each subtopic (prevents hallucination)
4. The "full path" prompt strategy works best: "In {domain}, under {parent} > {grandparent}, list 5 subtopics of {topic}"

**Results from research:**
- Full path context: 77% accuracy
- Root + current topic: 70% accuracy
- Current topic only: 58% accuracy
- Depth limit: 5 levels (users struggled to manually brainstorm beyond level 5)
- Most common error at depth: "Too General" (subtopics not specific enough)

**Key lesson for MindFlow:** For the "Q3 Budget" example, this means:
1. HDBSCAN clusters messages about budget into one cluster
2. LLM labels it "Q3 Budget"
3. Within that cluster, re-cluster or prompt: "Given these messages about Q3 Budget, what are the subtopics?"
4. LLM returns: "Marketing Budget", "R&D Budget", "Budget Review Process"
5. Each subtopic must cite specific messages as evidence

---

### 2.3 Answering the Key Question

**Given messages about "Q3 Budget", "Marketing Budget", "R&D Budget", "Budget Review Meeting" — how does an LLM-based system determine the hierarchy?**

**Recommended pipeline for MindFlow:**

```
Step 1: Embed all messages → HDBSCAN clusters them
Step 2: LLM labels each cluster (e.g., "Q3 Budget" for the main cluster)
Step 3: Within-cluster re-clustering (sub-HDBSCAN or k-means)
        OR LLM prompt: "These N messages are about Q3 Budget.
        What are the distinct sub-themes? Return as JSON:
        [{name, description, message_ids}]"
Step 4: LLM response:
        - "Marketing Budget" (messages 3, 7, 12)
        - "R&D Budget" (messages 5, 9)
        - "Budget Review Meeting" (messages 1, 8, 14)
Step 5: Validate: each subtopic must have >= 2 source messages
Step 6: Create parent-child edges: Q3 Budget → Marketing Budget, etc.
Step 7: Drift detection: if "Marketing Budget" diverges enough,
        promote it to a top-level topic
```

**Key principles:**
- Always ground subtopics in actual messages (no hallucinated structure)
- Use embedding similarity to validate LLM-proposed hierarchies
- Allow manual override (user can merge/split/reparent topics)
- Re-cluster periodically as new messages arrive

---

### 2.4 How Other Tools Handle This

| Tool | Approach | Automatic? |
|------|----------|-----------|
| Roam/Logseq | Fully manual block nesting | No |
| Obsidian | Tag hierarchies (manual), graph clustering (visual only) | Partially |
| Notion | Manual page nesting | No |
| BERTopic | Embedding + HDBSCAN + hierarchical agglomeration | Yes |
| TopicGPT | LLM-native hierarchy generation | Yes |
| Recall | Keyword-based auto-tagging (flat, not hierarchical) | Partially |

---

## 3. Progressive Disclosure Best Practices

### 3.1 Optimal Number of Items Per Level

**Research findings:**

- **Miller's Law (7 +/- 2)**: Working memory holds ~7 items. This is the theoretical floor for comfortable scanning.
- **Graph visualization research**: Small graphs (<=20 nodes) used by 41% of studies; performance degrades significantly at 50+ nodes for path-finding tasks.
- **Practical consensus**:
  - **7-12 items**: Ideal for decision-making (which node to click next)
  - **15-20 items**: Maximum for comfortable scanning without search
  - **20+ items**: Requires search/filter, grouping, or pagination

**Recommendation for MindFlow:**
- L0 (Root): 4-5 categories (People, Topics, Documents, Pending, Communities) — fixed
- L1 (Category): Show top 12-15 items sorted by recency, with "Show more" or search
- L2 (Entity): Show 7-12 connected entities (topics for a person, people for a topic)
- L3 (Cross-ref): Show the filtered timeline (unlimited, it's a list not a graph)

---

### 3.2 Transition Direction

| Approach | Best For | Pros | Cons |
|----------|----------|------|------|
| **Horizontal (columns/slide)** | Strict hierarchies, file-like navigation | Clear depth perception, parent visible | Horizontal space limited, hard on mobile |
| **Vertical (tree expand)** | Shallow trees, outline-style | Familiar, works on mobile | Deep trees push content offscreen |
| **Spatial (zoom in/out)** | Graph exploration, concept maps | Natural metaphor, preserves layout | Disorienting if zoom is large, needs minimap |
| **Replace (full swap)** | Clear focus, mobile-first | Simple, minimal state | Context loss, needs strong breadcrumb |

**Recommendation for MindFlow:**
Use **spatial zoom** as the primary metaphor (fits the graph paradigm), combined with **replace** for the content area:
1. Click a ring node
2. Animate: zoom into that node (it grows to center position)
3. Old ring nodes fade out, new ring nodes fade in around it
4. Breadcrumb updates at top
5. Detail panel below transitions to new entity's timeline

This combines the spatial feeling of "going deeper" with the clarity of single-layer display.

---

### 3.3 Cross-Cutting Relationships

This is the hardest problem. A person connected to 5 different topic subtrees cannot be represented in a pure tree.

**Strategies (ranked by practicality):**

1. **Ghost nodes / cross-references**: When viewing Topic A's subtree and Person X also appears in Topic B, show Person X in the ring with a small badge/icon indicating "also in Topic B". Clicking the badge navigates to Topic B's view of Person X.

2. **Edge annotations on breadcrumb**: The breadcrumb shows "Me > Topics > Q3 Budget > Wang Zong". If Wang Zong also connects to "Vendor Selection", show a small branching indicator on the breadcrumb.

3. **"Also connected to" section**: Below the ring graph, show a "Also appears in:" list with topic/person links. This is what Recall does with its depth slider (1-3 degrees).

4. **Semantic zoom on edges**: At the current zoom level, show direct connections. If the user zooms out slightly, show faded cross-cutting edges to nodes in other subtrees. If they zoom in, hide them.

5. **Path finder**: Let users explicitly query "how are X and Y connected?" — compute shortest path and display it as a highlighted overlay (like Recall's Path Finder feature).

**Recommendation for MindFlow:**
Implement #1 (ghost nodes with badges) + #5 (path finder). Ghost nodes preserve the single-layer model while surfacing cross-cutting information. Path finder handles the "I know these are connected, show me how" use case.

---

### 3.4 Breadcrumb: Visual vs. Textual

| Approach | Pros | Cons |
|----------|------|------|
| **Textual breadcrumb** | Simple, accessible, works everywhere | No spatial context, can't show graph structure |
| **Mini-map** | Shows global position, spatial awareness | Complex to implement, uses screen space |
| **Hybrid (breadcrumb + faded background)** | Best of both, MindNode-style | Requires careful opacity tuning |
| **Collapsible sidebar tree** | Full context available on demand | Uses horizontal space, Notion-style |

**Recommendation for MindFlow:**
Use a **textual breadcrumb** at top (primary) + a **collapsible mini-map** (secondary, toggleable). The mini-map shows the full graph at very low opacity with the current focus area highlighted. This matches the spatial zoom metaphor.

---

## 4. Cytoscape.js Capabilities

### 4.1 Compound/Nested Nodes

**Yes, Cytoscape.js fully supports compound nodes.**

- Parent-child grouping via the `parent` field in node data
- Parent node dimensions auto-calculate from descendant positions/sizes
- Children can be moved between parents via `eles.move()`
- Works like HTML DOM nesting conceptually
- Compatible layouts: **fCoSE**, **CoSE-Bilkent**, **CoSE** (force-directed with compound support)

```javascript
// Define compound nodes
const elements = [
  { data: { id: 'topics', label: 'Topics' } },  // parent
  { data: { id: 'q3-budget', label: 'Q3 Budget', parent: 'topics' } },  // child
  { data: { id: 'marketing', label: 'Marketing Budget', parent: 'q3-budget' } }  // grandchild
];
```

**Important caveat:** Compound nodes are for visual grouping. For MindFlow's single-layer navigation, you likely do NOT want compound nodes (which show all levels simultaneously). Instead, you want to **dynamically swap which nodes are in the graph**.

---

### 4.2 Layout Algorithms for Hierarchies

| Layout | Type | Best For | Compound Support |
|--------|------|----------|-----------------|
| **dagre** | Hierarchical (top-down) | DAGs, org charts, trees | No |
| **breadthfirst** | Hierarchical (by depth from root) | Trees, BFS traversal viz | No |
| **elk** | Multi-algorithm (layered, mrtree, force) | Complex hierarchies, large graphs | Yes (layered) |
| **klay** | Hierarchical | DAGs | Limited |
| **fCoSE** | Force-directed | Compound graphs, clusters | Yes |
| **CoSE-Bilkent** | Force-directed | Compound graphs | Yes |
| **tidytree** | Tree-specific | Variable-size tree nodes (Reingold-Tilford) | No |
| **concentric** | Radial rings | Center-and-ring display | No |

**Recommendation for MindFlow's single-layer model:**
- Use **concentric** layout for the center-and-ring display (focused entity at center, connections in ring)
- OR use **breadthfirst** with `circle: true` for a similar radial effect
- Use **dagre** if you want an org-chart top-down feel instead

---

### 4.3 Implementing "Collapse Parent, Expand Child" Transitions

**The expand-collapse extension** (`cytoscape-expand-collapse`) exists but is **no longer maintained** and is designed for compound node graphs (show/hide children within a parent container). This is NOT what MindFlow needs.

**What MindFlow needs — custom implementation:**

```javascript
// Pseudocode for single-layer navigation in Cytoscape.js

function drillInto(targetNode) {
  const targetId = targetNode.id();
  const targetPos = targetNode.position();

  // 1. Get the new ring: nodes connected to target
  const newRingIds = getConnectionsForEntity(targetId);  // from your DB

  // 2. Animate: zoom into target node
  cy.animate({
    fit: { eles: targetNode, padding: 200 },
    duration: 300,
    easing: 'ease-in-out'
  });

  // 3. After zoom, swap the graph content
  setTimeout(() => {
    // Remove old nodes (fade out)
    cy.elements().animate({
      style: { opacity: 0 },
      duration: 200
    });

    setTimeout(() => {
      // Remove old elements
      cy.elements().remove();

      // Add new center + ring nodes
      const newElements = buildLayerElements(targetId, newRingIds);
      cy.add(newElements);

      // Set initial opacity to 0
      cy.elements().style('opacity', 0);

      // Run layout
      cy.layout({
        name: 'concentric',
        concentric: (node) => node.data('id') === targetId ? 2 : 1,
        levelWidth: () => 1,
        animate: false
      }).run();

      // Fade in new elements
      cy.elements().animate({
        style: { opacity: 1 },
        duration: 300
      });

      // Fit viewport
      cy.fit(undefined, 50);
    }, 200);
  }, 300);
}

function navigateBack(breadcrumbIndex) {
  // Same as drillInto but with the parent entity ID
  const parentId = breadcrumbStack[breadcrumbIndex];
  drillInto(parentId);
  breadcrumbStack = breadcrumbStack.slice(0, breadcrumbIndex + 1);
}
```

**Key API methods for this pattern:**
- `cy.elements().remove()` — clear current graph
- `cy.add(elements)` — add new nodes/edges
- `cy.animate({fit, duration, easing})` — smooth viewport transitions
- `node.animate({style, duration})` — per-element animation (opacity, size)
- `cy.layout({name, ...}).run()` — re-layout after content swap
- `cy.fit(eles, padding)` — fit viewport to elements

---

### 4.4 Animation Capabilities

Cytoscape.js supports:
- **Element animation**: `node.animate({style: {opacity, width, height, ...}, duration, easing})`
- **Viewport animation**: `cy.animate({fit: {eles, padding}, center: {eles}, zoom, pan, duration, easing})`
- **Layout animation**: Most layouts support `animate: true` or `animate: 'end'` (skip intermediate positions, animate directly to final)
- **Easing functions**: 'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', cubic-bezier, spring
- **Chaining**: `.animate().delay().animate()` for sequenced animations

**Performance notes:**
- Layout animation (`animate: 'end'`) is smoother than step-by-step (`animate: true`)
- For the layer swap, disable animation during layout calculation, then animate from start to end positions
- `animationDuration: 300` (300ms) recommended — matches the PRD's 300ms target

---

### 4.5 Recommended Cytoscape.js Architecture for MindFlow

```
┌─────────────────────────────────────────────┐
│  Navigation State Manager                    │
│  - breadcrumbStack: EntityId[]              │
│  - currentCenter: EntityId                  │
│  - currentRing: EntityId[]                  │
│  - drillInto(entityId)                      │
│  - navigateBack(breadcrumbIndex)            │
│  - navigateToRoot()                         │
├─────────────────────────────────────────────┤
│  Layer Builder                               │
│  - buildLayerElements(centerId, ringIds)    │
│  - getConnectionsForEntity(entityId) → DB   │
│  - applyLayout(layoutName)                  │
│  - calculateBadgeCounts(ringIds) → DB       │
├─────────────────────────────────────────────┤
│  Transition Animator                         │
│  - fadeOutCurrentLayer(duration)            │
│  - swapElements(oldEles, newEles)           │
│  - fadeInNewLayer(duration)                 │
│  - zoomToNode(node, padding, duration)      │
├─────────────────────────────────────────────┤
│  Cytoscape.js Instance                       │
│  - Layout: concentric (center-and-ring)     │
│  - Stylesheet: entity-type colors, badges   │
│  - Event handlers: tap, mouseover           │
└─────────────────────────────────────────────┘
```

---

## 5. Concrete Implementation Recommendations

### 5.1 The MindFlow Navigation Model (Revised)

Based on all research, here is the recommended navigation model:

**Model: "Focus Swap" — single-layer with animated transitions**

1. **One center, one ring**: At any time, the graph shows exactly one center node and its direct connections in a ring around it.

2. **Drill down (tap a ring node)**:
   - Animate: zoom toward tapped node (300ms)
   - Fade out current ring nodes (200ms)
   - Swap: remove old elements, add new center + ring
   - Layout: concentric layout (center at middle, ring around)
   - Fade in new ring nodes (300ms)
   - Update breadcrumb
   - Update detail panel below

3. **Navigate back (tap breadcrumb)**:
   - Same animation sequence but "zoom out" feel
   - Breadcrumb truncates to clicked level

4. **Visual design per level**:
   - L0: "Me" at center, 4-5 category nodes in ring (People, Topics, Docs, Pending, Communities)
   - L1: Category at center, top 12-15 entities in ring (sorted by recency). Search bar appears if >15 items.
   - L2: Entity at center, 7-12 connected entities in ring. Badge counts show activity.
   - L3: Cross-ref view — detail panel dominates, graph shows the intersection point

5. **Cross-cutting relationships**: Ghost node badges ("Wang Zong - also in: Vendor Selection") with tap-to-navigate

6. **Breadcrumb**: Textual, at top: `Me > People > Wang Zong > Q3 Budget`. Each segment is tappable.

7. **Mini-map**: Toggleable, shows the full graph structure at low opacity with current position highlighted.

### 5.2 Topic Hierarchy Pipeline

```
Messages → Embed (BGE-M3) → HDBSCAN (flat clusters)
  → c-TF-IDF per cluster → LLM label each cluster
  → Within-cluster re-clustering (for clusters with >20 messages)
    → LLM prompt: "What are the subtopics? Cite message IDs."
    → Validate: each subtopic needs >=2 messages
    → Create parent→child topic edges
  → Periodic re-clustering as new messages arrive
  → Drift detection: if subtopic centroid diverges >threshold, promote to top-level
```

### 5.3 Node Count Guidelines

| Level | Target Count | Overflow Strategy |
|-------|-------------|-------------------|
| L0 (Root) | 4-5 | Fixed categories |
| L1 (Category) | 12-15 | "Show more" + search |
| L2 (Entity) | 7-12 | Group by type, show top N per type |
| L3 (Cross-ref) | N/A | Timeline list, not graph |

### 5.4 Cytoscape.js Technical Decisions

- **Layout**: `concentric` for center-and-ring pattern
- **Animation**: Custom fade-swap sequence (not the expand-collapse extension)
- **Compound nodes**: NOT used (single-layer swap instead)
- **Extensions needed**: `cytoscape-dagre` (fallback tree view), no others required
- **State management**: External (React state or vanilla JS) — Cytoscape.js is the rendering layer only
- **Element lifecycle**: Full remove/add cycle on each navigation (not show/hide)

---

## Sources

### Focus Mode / Navigation
- [Recall Graph View 2.0 Release Notes](https://feedback.getrecall.ai/changelog/recall-release-notes-jan-12-2026-graph-view-20-and-much-more)
- [Recall Graph View Documentation](https://docs.getrecall.ai/graph-view)
- [MindNode: How We Created Focus Mode](https://www.mindnode.com/post/2019-08-02-how-we-created-focus-mode)
- [MindNode Focus Mode Guide (Sweet Setup)](https://thesweetsetup.com/how-to-use-folding-focus-mode-in-mindnode/)
- [Miller Columns (Wikipedia)](https://en.wikipedia.org/wiki/Miller_columns)
- [Org Chart Design UX Best Practices (OrgaNice)](https://www.organice.app/blog/org-chart-design-ux-ui-best-practices)
- [PatternFly Navigation (Drilldown)](https://www.patternfly.org/components/navigation/design-guidelines/)
- [Heptabase User Interface Logic](https://wiki.heptabase.com/user-interface-logic)

### Topic Clustering
- [BERTopic Hierarchical Topics](https://maartengr.github.io/BERTopic/getting_started/hierarchicaltopics/hierarchicaltopics.html)
- [BERTopic LLM Integration](https://maartengr.github.io/BERTopic/getting_started/representation/llm.html)
- [TopicGPT (GitHub)](https://github.com/ArikReuter/TopicGPT)
- [Eliciting Topic Hierarchies from LLMs (arXiv)](https://arxiv.org/html/2310.19275v2)
- [HDBSCAN Deep Dive (Arize AI)](https://arize.com/blog-course/understanding-hdbscan-a-deep-dive-into-hierarchical-density-based-clustering/)

### Progressive Disclosure / Cognitive Load
- [Scalability of Network Visualization from a Cognitive Load Perspective (arXiv)](https://arxiv.org/abs/2008.07944)
- [Measuring Effectiveness of Graph Visualizations: A Cognitive Load Perspective](https://journals.sagepub.com/doi/10.1057/ivs.2009.10)
- [Multi-level Tree Based Approach for Interactive Graph Visualization with Semantic Zoom](https://www.researchgate.net/publication/333815098)

### Cytoscape.js
- [Cytoscape.js Documentation](https://js.cytoscape.org/)
- [Cytoscape.js Expand-Collapse Extension](https://github.com/iVis-at-Bilkent/cytoscape.js-expand-collapse)
- [Cytoscape.js Dagre Layout](https://github.com/cytoscape/cytoscape.js-dagre)
- [Cytoscape.js ELK Layout](https://github.com/cytoscape/cytoscape.js-elk)
- [Custom Hierarchical Graph Layout (LARUS)](https://larus-ba.it/2024/02/07/how-to-create-a-custom-hierarchical-graph-layout-with-cytoscape-js/)
- [Cytoscape.js Layouts Blog Post](https://blog.js.cytoscape.org/2020/05/11/layouts/)
- [Cytoscape.js TidyTree](https://github.com/chuckzel/cytoscape-tidytree)
