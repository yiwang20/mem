# Topic Detail Page — Product Analysis

## For: Designer handoff | Author: Product Manager | Date: 2026-03-29

---

## 1. Core Use Case: Why Users Visit a Topic Detail Page

A user clicks into a Topic detail page with one of these intents, in priority order:

1. **"Catch me up"** — What's the latest on this topic? Who said what, when?
2. **"Navigate the hierarchy"** — This topic is part of a bigger theme. Where does it fit? What are its sub-topics?
3. **"Find a specific fact"** — Someone said something about this topic, I need to find it
4. **"See who's involved"** — Which people are connected to this topic, and what's their relationship to it?
5. **"What am I forgetting?"** — Are there pending items, unanswered questions, or stale threads related to this topic?

The detail page must serve all five intents, but **intent #1 dominates**. The timeline is the primary content. The hierarchy chart is secondary navigation, not primary content.

---

## 2. The Org Chart's Role: Navigation Aid, Not Hero Content

### Current problem

The MiniOrgChart currently occupies prime screen real estate between the header and the tabs. It behaves like a hero component, but it answers a secondary question ("where does this topic sit in the hierarchy?"). This is backwards — it pushes the timeline (the thing users actually came for) below the fold.

### Recommendation

The org chart should be a **compact, inline navigation aid** — think breadcrumb-on-steroids, not an org chart. It should:

- **Take up minimal vertical space** — one horizontal band, not a multi-level vertical tree
- **Be always visible** but never dominant — it orients you, like a "you are here" marker on a mall map
- **Be horizontally oriented** (left-to-right) — this is the right call for several reasons:
  - Vertical space is precious; horizontal layouts use the wide screen efficiently
  - Left-to-right mirrors natural reading direction and hierarchy depth (root → leaf)
  - Horizontal trees are standard for org charts and file system breadcrumbs
  - The current vertical layout wastes space and creates disconnected-feeling connectors

### Size allocation

- **Org chart area**: ~80-100px height max (a single horizontal band)
- **Timeline + tabs area**: Everything else (the remaining viewport)

---

## 3. What to Show in the Hierarchy Component

### Must show

| Element | How | Why |
|---------|-----|-----|
| **Ancestor path** | Breadcrumb-style pills, left to right: `Root Topic > Parent > Current` | Orientation — where am I in the tree? |
| **Current topic** | Highlighted/active node, visually distinct | Anchor point |
| **Direct children** | Compact pills below or beside the current node | Primary sub-navigation — users drill deeper from here |

### Should NOT show

| Element | Why not |
|---------|---------|
| **Virtual "Topics" root node** | It's meaningless. If the topic has no parent, it IS a root — show nothing above it |
| **Sibling topics** | Adds clutter without adding value. If a user wants siblings, they can click the parent to navigate up. Showing siblings creates visual noise and implies equal importance when the user has already chosen one topic |
| **Related people inline in the chart** | People are a different dimension. Show them in the Relationships tab or the context panel, not in the hierarchy chart |

### Ancestor display logic

- **If root topic (no parent, no children)**: Don't render the chart at all. It adds nothing.
- **If root topic with children**: Show only the current node and its children, horizontally.
- **If mid-level topic**: Show the full ancestor breadcrumb path + children. Cap ancestors at 3 levels (show `... > Grandparent > Parent > Current` if deeper).
- **If leaf topic (has parent, no children)**: Show the ancestor breadcrumb only. No children section.

---

## 4. Horizontal vs. Vertical: Horizontal Wins

| Factor | Horizontal (L→R) | Vertical (T→B) |
|--------|-------------------|-----------------|
| **Vertical space** | Compact — ~80px band | Eats 200-400px depending on depth |
| **Reading direction** | Natural LTR hierarchy traversal | Requires eye to scan up/down |
| **Screen utilization** | Uses wide screens well | Wastes horizontal space |
| **Scalability** | Scrolls horizontally if many children (rare at personal knowledge scale) | Stacks poorly with many children |
| **Familiar pattern** | File explorer breadcrumbs, org charts | Only familiar in corporate org charts |
| **Connector clarity** | Simple horizontal lines, less likely to "break" | Requires vertical stems + crossbars, easy to break visually |

**Verdict: Horizontal, left-to-right.** The ancestor path reads like a breadcrumb. Children fan out to the right or below the current node in a compact row.

---

## 5. Interaction Design

### Clicking a node in the hierarchy chart

**Navigate to that topic's detail page.** Not expand-in-place.

Rationale:
- Each topic has its own rich context (timeline, key facts, relationships). Expanding in-place would require loading all that inline, turning the chart into a competing navigation system.
- Navigation is predictable and reversible (browser back, breadcrumb clicks).
- The chart stays simple and focused on its job: orientation + one-click navigation.

### Hover behavior

- Show a tooltip with: topic status (active/dormant/archived), message count, last activity date.
- Subtle elevation/highlight on hover to signal clickability.

---

## 6. Empty States

| Scenario | What to show |
|----------|-------------|
| **No parent, no children** (orphan root) | Don't render the hierarchy component at all. The EntityHeader already shows the topic name — no need for a one-node chart. |
| **No parent, has children** (top-level parent) | Show current node + children row only. No ancestor breadcrumb. |
| **Has parent, no children** (leaf) | Show ancestor breadcrumb path only. No children section. |
| **Topic just created, not yet clustered** | Don't render the hierarchy component. It will appear once the topic has hierarchy data. |

The key principle: **never show a chart with only one node**. A single node in a hierarchy visualization is noise, not information.

---

## 7. Full Page Layout — Content Blocks by Priority

### Layout: Two-column (main + context sidebar)

**Main column (65%)** — top to bottom:

| Priority | Block | Description |
|----------|-------|-------------|
| P0 | **Entity Header** | Topic name, status badge (active/dormant/archived), first/last seen dates, message count, pending item count. Already exists. |
| P1 | **Hierarchy Navigator** | The redesigned horizontal breadcrumb + children component. Compact, always visible. |
| P2 | **Tab Bar + Content** | Three tabs, ordered by usage frequency: |
| | — Timeline (default) | Chronological feed of all messages/emails/docs mentioning this topic. Filterable by channel, searchable. This is the core content. |
| | — Key Facts | Extracted facts related to this topic, with source attribution. High-density, scannable. |
| | — Relationships | Related entities (people, other topics, documents) with relationship type labels. |

**Context sidebar (35%)** — sticky:

| Priority | Block | Description |
|----------|-------|-------------|
| P0 | **Pending Items** | Action items, unanswered questions, stale threads related to this topic. This is the "what am I forgetting?" answer. Should show urgency indicators. |
| P1 | **Key People** | Top 3-5 people most connected to this topic, with message counts and last interaction date. Click to navigate to their detail page. |
| P2 | **Related Topics** | Other topics that share people or content with this one. "Magical connection discovery" — the feature users love in Capacities and Recall. |
| P3 | **Quick Stats** | Total messages, channels active in, date range, trend (increasing/decreasing activity). |

### Why this order

- **Pending items in sidebar, not buried in a tab**: If a user has forgotten to reply to something about this topic, they need to see it immediately — not after clicking into a tab. The sidebar keeps it persistently visible.
- **Key People in sidebar**: The cross-reference between a topic and the people involved is one of MindFlow's strongest value props. Having it always visible (not just in the Relationships tab) reinforces this.
- **Timeline as default tab**: Validated by competitive research — Mem, Recall, Capacities all lead with chronological content. Users' #1 intent is "catch me up."

---

## 8. Design Spec Summary for Designer

### Hierarchy Navigator Component

- **Layout**: Horizontal band, left-to-right flow
- **Max height**: ~80-100px
- **Background**: Subtle differentiation from main content (e.g., `bg-subtle`)
- **Ancestor nodes**: Small pills/chips, muted styling, dashed border. Connected by thin horizontal lines or chevron separators (`>`).
- **Current node**: Larger pill, solid border in topic color, bold text. Visually anchored as the "you are here" marker.
- **Child nodes**: Medium pills below or to the right of current node, with message count badges. Connected by short lines or arranged in a compact row.
- **Connectors**: Simple horizontal lines or chevrons between ancestors. Short vertical/angled lines from current node to children row.
- **Overflow**: If >6 children, show first 5 + "+N more" pill that expands or navigates to a full list.
- **Animation**: Smooth transition when navigating between topics. New ancestors slide in from left, children fade in.
- **Empty state**: Component does not render if only one node would be shown.

### Acceptance Criteria

1. Ancestor path shows actual root topic, not a virtual "Topics" node
2. Current topic appears exactly once — in the hierarchy navigator, not duplicated
3. Connectors visually connect all nodes without gaps or breaks
4. Layout is horizontal (left-to-right), not vertical
5. Component height never exceeds 100px regardless of hierarchy depth
6. Clicking any node in the chart navigates to that topic's detail page
7. Component gracefully disappears when a topic has no parent and no children
8. Child nodes show message count as a subtle badge
9. Ancestor chain truncates at 3 levels with an ellipsis indicator for deeper hierarchies

### Success Metrics

- **Task completion**: Users can identify where a topic sits in the hierarchy within 2 seconds
- **Navigation efficiency**: Users can navigate to parent or child topic in 1 click
- **Space efficiency**: The hierarchy component never pushes the timeline tab below the fold on a 768px-height viewport
- **Reduced confusion**: Zero instances of "why does the same topic appear twice?" (current bug)

---

## 9. Recommendation

**Build this redesign.** The current implementation has usability bugs (duplicate nodes, broken connectors, wrong root) that undermine trust in the product, and the vertical layout wastes critical screen space. This is not a nice-to-have polish pass — it's a fix for a broken core navigation pattern.

The scope is contained: one component replacement (MiniOrgChart) plus minor layout adjustments. No new data requirements — the `getTopicAncestors` API already returns the path and children needed.

Priority: **Now** — ship before any new feature work on the Topics experience.
