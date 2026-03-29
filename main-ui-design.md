# MindFlow Main UI — Design Specification

**Version**: 1.0
**Date**: 2026-03-29
**Status**: Draft
**Replaces**: DigestView + separate GraphView layout

---

## 0. Design Summary

The new main UI replaces the current DigestView landing page and separate Graph Explorer with a unified two-panel layout: a **left sidebar** with three navigation tabs (Todo / Contacts / Topics) and a **right main content area** showing an org chart for the selected tab. This is the single default view of MindFlow — there is no separate "Graph" page.

The design maintains MindFlow's established warm, soft, card-based visual language with cream backgrounds, muted watercolor entity colors, generous border radii, and the "premium stationery" aesthetic.

---

## 1. Overall Layout

### 1.1 Shell Structure

```
+--[ TopBar (52px height) ]-------------------------------------------+
|  [M] MindFlow     [Search........⌘K]          [☀] [⚙]              |
+----+----------------------------------------------------------------+
|    |                                                                 |
| S  |                     Org Chart Area                              |
| I  |                                                                 |
| D  |              ┌────────────┐                                     |
| E  |              │  Root Node │   ← breadcrumb: Me / Topics        |
| B  |              └─────┬──────┘                                     |
| A  |         ┌──────────┼──────────┐                                 |
| R  |    ┌────┴───┐ ┌────┴───┐ ┌───┴────┐                            |
|    |    │ Child1 │ │ Child2 │ │ Child3 │                            |
| 64 |    └────────┘ └────────┘ └────────┘                            |
| px |                                                                 |
|    |                                                                 |
+----+----------------------------------------------------------------+
```

### 1.2 TopBar (unchanged from current)

The existing TopBar remains as-is:
- Height: `52px`
- Background: `var(--surface)`
- Border bottom: `1px solid var(--border)`
- Shadow: `var(--shadow-xs)`
- Contains: Logo, search input, theme toggle, settings button
- **Removed**: The separate "Graph Explorer" icon button (the graph is now the main view)
- **Removed**: The standalone BreadcrumbBar below TopBar (breadcrumbs are now inside the main content area, above the org chart)

### 1.3 Left Sidebar

| Property | Value |
|----------|-------|
| Width | `64px` (icon-only mode) |
| Min height | `calc(100vh - 52px)` (fills below TopBar) |
| Background | `var(--surface)` |
| Border right | `1px solid var(--border)` |
| Padding | `8px 0` |
| Display | `flex`, `flex-direction: column`, `align-items: center` |
| Gap | `4px` |
| z-index | `50` |

The sidebar is a narrow icon strip — no text labels in the default state. Each tab is an icon button.

#### Tab Buttons

| Property | Default | Active | Hover |
|----------|---------|--------|-------|
| Size | `44px x 44px` | `44px x 44px` | `44px x 44px` |
| Border radius | `12px` | `12px` | `12px` |
| Background | `transparent` | `var(--accent-soft)` | `var(--surface-hover)` |
| Border | `none` | `2px solid var(--accent)` | `none` |
| Icon size | `20px` | `20px` | `20px` |
| Icon color | `var(--text-tertiary)` | `var(--accent)` | `var(--text-secondary)` |
| Cursor | `pointer` | `default` | `pointer` |
| Transition | `150ms ease` | — | — |
| Tooltip | Show on hover, `8px` to the right of button | — | — |

#### Tab Definitions

| Order | Tab | Icon | Tooltip | Entity color accent |
|-------|-----|------|---------|---------------------|
| 1 | Todo | Checkbox-list (heroicons `clipboard-document-check`) | "Todo 待办" | `var(--color-action-item)` `#C47A7A` |
| 2 | Contacts | People (heroicons `users`) | "Contacts 联系人" | `var(--color-person)` `#8B7EC8` |
| 3 | Topics | Hashtag/bubble (heroicons `chat-bubble-left-right`) | "Topics 话题" | `var(--color-topic)` `#6B9E8A` |

**Active indicator enhancement**: When a tab is active, in addition to the accent background, a small vertical bar appears on the left edge of the button:
- Width: `3px`, height: `20px`, border-radius: `0 2px 2px 0`
- Color: the tab's entity color accent (not the global accent)
- This provides a colored hint that matches the entity type being viewed

#### Bottom section of sidebar

Below the three tabs, a flexible spacer pushes a bottom-aligned section:
- **Divider**: `1px solid var(--border)`, `margin: 0 12px 8px`
- **Settings icon button**: same 44x44 style as tabs, opens settings panel
- **Theme toggle icon button**: same style, cycles theme

This moves theme/settings out of the TopBar into the sidebar for a cleaner header.

### 1.4 Main Content Area

| Property | Value |
|----------|-------|
| Flex | `1` (fills remaining width) |
| Background | `var(--bg)` |
| Display | `flex`, `flex-direction: column` |
| Overflow | `hidden` |

The main content area is split into two vertical zones:

1. **Breadcrumb bar** (top, fixed height)
2. **Org chart canvas** (fills remaining space)

---

## 2. Breadcrumb Bar

Positioned at the top of the main content area (not a separate app-level bar).

| Property | Value |
|----------|-------|
| Height | `40px` |
| Background | `var(--bg-subtle)` |
| Border bottom | `1px solid var(--border)` |
| Padding | `0 24px` |
| Display | `flex`, `align-items: center` |
| Gap | `8px` |
| Overflow-x | `auto` |
| White-space | `nowrap` |

### Breadcrumb items

| Property | Ancestor | Current (last) |
|----------|----------|----------------|
| Font | `13px`, weight `400` | `13px`, weight `500` |
| Color | `var(--text-secondary)` | `var(--text)` |
| Cursor | `pointer` | `default` |
| Hover | `var(--text)`, underline | — |

**Separator**: `/` character in `var(--text-ghost)`, `margin: 0 2px`

**Root label**: "Me" — always the first item. When at root level, shows only "Me" in `var(--text-tertiary)`.

**Tab context**: The second breadcrumb item shows the active tab name (e.g., "Topics 话题"). This is a clickable link that returns to that tab's root layer.

Example breadcrumb trail: `Me / Topics 话题 / Q3 Budget / Marketing Budget`

---

## 3. Org Chart Canvas

The core visual area. Uses Cytoscape.js with preset layout (positions pre-calculated), following the Focus Swap navigation model from `focus-swap-design.md`.

| Property | Value |
|----------|-------|
| Flex | `1` (fills remaining space below breadcrumb) |
| Background | `var(--bg)` with radial gradient: `radial-gradient(ellipse at 50% 40%, rgba(124,92,252,0.015) 0%, transparent 60%)` |
| Overflow | `hidden` |
| Position | `relative` (for floating overlays) |

### 3.1 Layout Constants

```
Parent node:           top center of canvas
Children:              below parent, grouped by type in horizontal rows
Parent-child gap:      120px vertical
Intra-group gap:       50px horizontal (between nodes in same type group)
Inter-group gap:       80px horizontal (between type groups)
Group label height:    24px above each group's first node
Canvas padding:        60px (cy.fit padding)
```

### 3.2 Search Bar (overflow)

When the current layer has `> 12` total available children, a search/filter input appears above the org chart:

| Property | Value |
|----------|-------|
| Position | Top of canvas area, below breadcrumb |
| Height | `40px` |
| Max width | `360px` |
| Margin | `12px auto` (centered) |
| Background | `var(--surface)` |
| Border | `1px solid var(--border)` |
| Border radius | `20px` (pill shape) |
| Padding | `0 16px` |
| Font | `13px`, `var(--text)` |
| Placeholder | "Filter nodes... 筛选" in `var(--text-ghost)` |
| Icon | Search icon `14px` in `var(--text-tertiary)`, left side |
| Shadow | `var(--shadow-xs)` |

---

## 4. Node Design

All nodes in the org chart are rendered as Cytoscape compound elements with HTML label overlays for rich content.

### 4.1 Parent Node (top of layer)

The currently focused entity, shown at the top center.

| Property | Value |
|----------|-------|
| Width | `56px` |
| Height | `56px` |
| Shape | Circle (in Cytoscape: `ellipse`) |
| Fill | Entity type color (e.g., `var(--color-topic)` for topics) |
| Border | `2.5px solid` entity type color at `70%` opacity |
| Shadow | `0 0 20px {entity-color} at 25% opacity` |
| Label | Below node, `12px`, weight `600`, `var(--text)` |
| Label max width | `120px`, ellipsis |

### 4.2 Child Nodes

| Property | Default | Hover | Selected |
|----------|---------|-------|----------|
| Width | `44px` | `48px` | `52px` |
| Height | `44px` | `48px` | `52px` |
| Shape | Circle | Circle | Circle |
| Fill | Entity type color | Entity type color | Entity type color |
| Border | `none` | `1.5px solid {entity-color}` at full opacity | `2px solid var(--accent)` |
| Shadow-blur | `0` | `16px` at `40%` opacity | `20px` at `60%` opacity |
| Label | Below, `11px`, weight `500`, `var(--text-secondary)` | `var(--text)` | `var(--text)`, weight `600` |
| Label max width | `100px`, ellipsis | `120px` | `120px` |
| Transition | `200ms ease-out` | — | — |
| Cursor | `pointer` | — | — |

**Initial letter**: Inside the circle, show the first character of the entity name in white, weight `700`:
- 44px node: `14px` font
- 48px node: `15px` font
- 52px node: `16px` font
- 56px node: `18px` font

### 4.3 Badge (on nodes)

Positioned top-right of the node circle.

| Property | Value |
|----------|-------|
| Min width | `18px` |
| Height | `18px` |
| Border radius | `9999px` |
| Background | `var(--color-action-item)` for pending count, entity color for other counts |
| Text | White, `9px`, weight `700`, centered |
| Padding | `0 5px` |
| Border | `2px solid var(--bg)` (creates a "cutout" effect against background) |
| Position | `top: -4px, right: -4px` relative to node |

### 4.4 "Show More" Pseudo-Node

When there are more children than displayed:

| Property | Value |
|----------|-------|
| Width | `44px` |
| Height | `44px` |
| Shape | Circle |
| Fill | `transparent` |
| Border | `2px dashed var(--border-strong)` |
| Label | `+N more`, `11px`, weight `500`, `var(--text-tertiary)` |
| Cursor | `pointer` |
| Hover | Border color: `var(--text-secondary)`, label color: `var(--text-secondary)` |

### 4.5 Color Coding by Entity Type

Consistent with existing design system:

| Entity Type | Circle Fill | Tint (for cards) | Label prefix |
|-------------|-------------|-------------------|-------------|
| Person 人物 | `#8B7EC8` | `#F0EDF8` | — |
| Topic 话题 | `#6B9E8A` | `#EDF5F0` | — |
| Action Item 待办 | `#C47A7A` | `#F8EDEC` | — |
| Document 文档 | `#C4A86B` | `#F8F3EA` | — |
| Key Fact 要点 | `#6B8EC4` | `#EDF1F8` | — |
| Thread 线索 | `#8A8A8A` | `#F2F2F0` | — |

### 4.6 Group Labels

Rendered as DOM overlays (not Cytoscape elements), positioned above each horizontal type group.

| Property | Value |
|----------|-------|
| Font | `10px`, weight `700`, uppercase, letter-spacing `0.06em` |
| Color | Entity type color at `80%` opacity |
| Position | Centered above the group, `8px` above the top of nodes |
| Background | `none` |

Label text is bilingual:
- "子话题 Sub-topics"
- "相关人物 People"
- "文档 Documents"
- "待办 Action Items"
- "要点 Key Facts"
- "线索 Threads"

### 4.7 Edges (connectors)

| Property | Value |
|----------|-------|
| Style | Taxi (right-angle, `segment-distances` and `segment-weights` for stepped routing) |
| Width | `1px` |
| Color | `rgba(0,0,0,0.06)` (light), `rgba(255,255,255,0.06)` (dark) |
| Line style | Solid |
| Source endpoint | Bottom center of parent node |
| Target endpoint | Top center of child node |
| Corner radius | `8px` (achieved via short taxi segments) |

The edges should feel very subtle — almost invisible. They provide structural guidance without visual noise.

---

## 5. Todo Tab

### 5.1 Root Layer (L0 for Todo)

When the Todo tab is selected, the org chart root shows:

**Parent node**: "Todo 待办" — uses `var(--color-action-item)` `#C47A7A`

**Children**: Grouped by urgency level, each rendered as a category node:

| Category Node | Color | Badge |
|---------------|-------|-------|
| "Overdue 逾期" | `var(--color-urgency-high)` `#C47A7A` | Count of overdue items |
| "This Week 本周" | `var(--color-urgency-medium)` `#C4A86B` | Count of items due this week |
| "Upcoming 待处理" | `var(--color-urgency-low)` `#6B9E8A` | Count of upcoming items |
| "No Due Date 无截止日" | `var(--text-tertiary)` `#9A9A9A` | Count |

If any urgency group has 0 items, it is still shown but with a dimmed appearance (opacity `0.4`, no badge).

### 5.2 Urgency Layer (L1 for Todo)

Drilling into an urgency category (e.g., "Overdue") shows individual action items as child nodes.

**Parent**: The urgency category node
**Children**: Individual todo items, each as a `44px` circle with `var(--color-action-item)` fill

**Node content (via HTML overlay below the circle)**:
- Line 1: Action item title, `11px`, weight `500`, `var(--text)`, 1-line clamp, max `120px`
- Line 2: Owner name or "Me", `10px`, weight `400`, `var(--text-tertiary)`
- Line 3: Due date or "No due date", `10px`, weight `400`, `var(--text-tertiary)`

**Completed vs. incomplete visual**:
| State | Circle opacity | Label strikethrough | Badge |
|-------|---------------|---------------------|-------|
| Incomplete | `1.0` | No | Source channel badge |
| Completed | `0.35` | Yes, `var(--text-ghost)` | Checkmark icon instead of channel badge |

### 5.3 Todo Item Detail (L2)

Drilling into a specific todo item shows a detail view. Rather than another org chart layer, this displays a **floating detail card** (see Section 8) with:

- Title of the action item
- Owner (person node link)
- Due date
- Source message/thread (with channel badge)
- Related topic links
- Status toggle: "Mark Complete" / "Mark Incomplete"
- "Snooze" action with duration picker

The org chart behind the detail card shows the context: the person who assigned it, the related topic, and the source thread — as a small contextual org chart.

---

## 6. Contacts Tab

### 6.1 Root Layer (L0 for Contacts)

**Parent node**: "Contacts 联系人" — uses `var(--color-person)` `#8B7EC8`

**Children**: The user's contacts, sorted by most recent interaction.

**Grouping strategy**: Children are grouped by **community/organization** when clear organization data exists, otherwise displayed as a flat list sorted by recency.

When grouped by organization:
| Group Label | Example |
|-------------|---------|
| Organization name | "Partner Corp", "Acme Inc" |
| "Other 其他" | Contacts without clear org affiliation |

When flat (no clear organizations): All contacts shown in a single row, sorted by recency. No group labels.

**Max nodes per layer**: 12. If more exist, "Show more" pseudo-node + search bar above graph.

### 6.2 Person Detail Layer (L1 for Contacts)

Drilling into a person shows their connected entities as children.

**Parent**: Person node (e.g., "Wang Zong")
**Children**: Grouped by type in this order:

| Group | Label | Content |
|-------|-------|---------|
| Topics | "相关话题 Topics" | Topics this person discusses |
| Pending | "待办 Pending" | Action items involving this person |
| Key Facts | "要点 Key Facts" | Key facts associated with this person |
| Documents | "文档 Documents" | Documents shared with/by this person |

Each child node uses its entity type color and shows a badge count where relevant (e.g., pending items show urgency-colored badge).

### 6.3 Person Node Information

Each person node in the contact list shows:

**Circle**: `44px`, fill `var(--color-person)`, white initial letter

**Below the circle (HTML overlay)**:
- Line 1: Name, `11px`, weight `500`, `var(--text)`, 1-line clamp
- Line 2: Organization or role, `10px`, weight `400`, `var(--text-tertiary)`, 1-line clamp
- Line 3: Last contact relative time, `10px`, weight `400`, `var(--text-tertiary)` (e.g., "2h ago")

**Badge**: If the person has pending items involving the user, show a coral badge with the count.

---

## 7. Topics Tab

### 7.1 Root Layer (L0 for Topics)

**Parent node**: "Topics 话题" — uses `var(--color-topic)` `#6B9E8A`

**Children**: Top-level topics (those with `parent_entity_id = null`), sorted by recency of last activity.

Each topic node shows:
- Circle: `44px`, fill `var(--color-topic)`
- Line 1: Topic name, `11px`, weight `500`, `var(--text)`
- Line 2: Status pill — "Active 活跃" in `var(--color-urgency-low)` tint or "Dormant 休眠" in `var(--text-ghost)` tint
- Badge: Message count or pending item count

### 7.2 Topic Detail Layer (L1+)

Drilling into a topic shows its sub-topics and related entities as children.

**Parent**: Topic node (e.g., "Q3 Budget")
**Children**: Grouped by type in this order (matching focus-swap-design.md Section 4.5):

| Group Order | Label | Content |
|-------------|-------|---------|
| 1 | "子话题 Sub-topics" | Child topics (entities with `parent_entity_id` = this topic) |
| 2 | "相关人物 People" | People who discuss this topic |
| 3 | "文档 Documents" | Documents related to this topic |
| 4 | "待办 Action Items" | Action items under this topic |
| 5 | "要点 Key Facts" | Key facts extracted for this topic |
| 6 | "线索 Threads" | Message threads about this topic |

This is the confirmed "Option A" layout — children grouped by type with labeled rows.

### 7.3 Hierarchy Depth

Topics support up to 4 levels of nesting:
- L0: "Topics" root
- L1: Top-level topics (e.g., "Q3 Budget")
- L2: Sub-topics (e.g., "Marketing Budget")
- L3: Sub-sub-topics (e.g., "Digital Ad Spend")
- L4: Leaf topics

At each level, the same grouped-row layout applies. The breadcrumb grows to show the full path.

### 7.4 Topic Status Indicators

| Status | Visual Treatment |
|--------|-----------------|
| Active 活跃 | Full opacity, `var(--color-topic)` fill, green status dot `6px` |
| Dormant 休眠 | `0.5` opacity, `var(--text-ghost)` status dot |
| Archived 归档 | `0.3` opacity, dashed circle border, gray fill |

---

## 8. Floating Detail Card

When a node is clicked (single click, not drill-in), a floating detail card appears. Double-click or Enter drills in.

| Property | Value |
|----------|-------|
| Position | `bottom: 20px`, `right: 24px`, `position: absolute` |
| Width | `320px` |
| Max height | `400px` |
| Background | `var(--surface)` |
| Border | `1px solid var(--border)` |
| Border radius | `16px` |
| Shadow | `var(--shadow-md)` |
| Padding | `20px` |
| z-index | `60` |
| Appear animation | Fade in + slide up 8px, `200ms ease-out` |
| Disappear | Fade out, `120ms ease-in` |

### Card content by entity type

**Person**:
- Avatar: `48px` circle, entity color, white initial
- Name: `18px`, weight `500`
- Org / role: `13px`, `var(--text-secondary)`
- Stats: "84 messages · Last: 2h ago · 2 pending", `13px`, `var(--text-tertiary)`
- Action: "Open 查看详情 →", `13px`, weight `500`, `var(--accent)`

**Topic**:
- Color dot: `10px` circle, topic color
- Name: `18px`, weight `500`
- Status badge: Active/Dormant pill
- Stats: "12 messages · 4 people · Last: 1d ago", `13px`, `var(--text-tertiary)`
- Action: "Open 查看详情 →"

**Action Item**:
- Urgency dot: `8px` circle, urgency color
- Title: `15px`, weight `500`
- Owner + due date: `13px`, `var(--text-secondary)`
- Source: channel badge + message preview, `11px`
- Actions row: "Complete 完成" / "Snooze 稍后" buttons, ghost style

---

## 9. Animations and Transitions

### 9.1 Tab Switch

When switching between Todo / Contacts / Topics:

| Phase | Duration | Easing | Effect |
|-------|----------|--------|--------|
| Fade out current | `120ms` | `ease-in` | Org chart nodes fade to opacity `0` |
| Swap data | instant | — | Clear canvas, build new layer |
| Fade in new | `250ms` | `ease-out` | New root + children fade in with stagger `20ms` per node |

**Breadcrumb reset**: On tab switch, breadcrumb resets to `Me / {Tab Name}`. This is immediate, no animation.

**Sidebar active indicator**: The colored bar on the active tab slides to the new position with `200ms ease-out` transition (using `transform: translateY`).

### 9.2 Drill-In (tap child node)

Follows the Focus Swap sequence from `focus-swap-design.md` Section 4.3:

| Phase | Duration | Effect |
|-------|----------|--------|
| Sliding down | `200ms` | Viewport pans toward tapped node; node grows `44px → 56px` with glow; siblings fade to `0.3` |
| Fading out | `150ms` | All elements fade to `0` |
| Swapping | instant | Remove old elements, add new layer |
| Fading in | `250ms` | Parent fades in first, children stagger left-to-right `20ms` each, group labels appear with first node |
| Settling | `100ms` | `cy.fit(padding: 60)` animated |

**Total**: ~700ms. First visual feedback within 200ms.

### 9.3 Drill-Out (tap breadcrumb)

Same as Focus Swap Section 4.4 — sliding up instead of down, children stagger right-to-left.

### 9.4 Node Hover

| Property | From | To | Duration |
|----------|------|----|----------|
| Size | `44px` | `48px` | `200ms ease-out` |
| Shadow blur | `0` | `16px` at `40%` | `200ms ease-out` |
| Label color | `var(--text-secondary)` | `var(--text)` | `120ms ease` |

### 9.5 Reduced Motion

When `prefers-reduced-motion: reduce` is active:
- All transition durations become `0ms`
- Drill-in/out becomes an instant swap (no slide, no fade)
- Node hover size change is disabled

---

## 10. Responsive Behavior

### 10.1 Breakpoints

| Breakpoint | Sidebar | Content |
|------------|---------|---------|
| Desktop `>= 1024px` | `64px` icon sidebar, always visible | Full org chart |
| Tablet `768px - 1023px` | `64px` icon sidebar, always visible | Org chart with `cy.fit` adjusting to narrower width |
| Mobile `< 768px` | Bottom tab bar instead of sidebar | Full-width org chart |

### 10.2 Desktop (>= 1024px)

Full layout as specified. Floating detail card at bottom-right.

### 10.3 Tablet (768px - 1023px)

- Sidebar stays at `64px`
- Org chart adjusts `cy.fit` padding to `40px`
- Floating detail card width reduces to `280px`
- Search bar (overflow) max-width reduces to `280px`

### 10.4 Mobile (< 768px)

**Sidebar transforms into a bottom tab bar**:

| Property | Value |
|----------|-------|
| Height | `56px` |
| Position | `fixed`, `bottom: 0` |
| Width | `100%` |
| Background | `var(--surface)` |
| Border top | `1px solid var(--border)` |
| Shadow | `0 -2px 8px rgba(0,0,0,0.05)` |
| Display | `flex`, `justify-content: space-around` |
| z-index | `100` |
| Safe area | `padding-bottom: env(safe-area-inset-bottom)` |

Each tab button in the bottom bar:
- Icon: `20px`
- Label below icon: `10px`, weight `500`
- Labels: "Todo", "Contacts", "Topics"
- Active: entity color icon + label, dot indicator above icon
- Touch target: `min-height: 44px`

**Org chart area**: Gets `padding-bottom: 56px` to account for bottom bar.

**Floating detail card**: Becomes a **bottom sheet** that slides up:
- Width: `100%`
- Max height: `50vh`
- Border radius: `16px 16px 0 0`
- Position: above the bottom tab bar
- Drag handle: `32px x 4px` rounded bar centered at top, `var(--border-strong)`
- Slide animation: `300ms cubic-bezier(0.16, 1, 0.3, 1)`

**Breadcrumb**: Horizontal scroll, text size `12px`, padding `0 16px`.

---

## 11. Empty States

### 11.1 No Todos

When the Todo tab has no action items:

- Parent node "Todo 待办" shown at top (dimmed, opacity `0.5`)
- Below: centered text block instead of children
  - Icon: Checkmark circle, `32px`, `var(--color-urgency-low)` at `50%` opacity
  - Text: "All clear. 没有待办事项。", `15px`, weight `400`, `var(--text-tertiary)`
  - Subtext: "Action items from your messages will appear here.", `13px`, `var(--text-ghost)`

### 11.2 No Contacts

- Parent node "Contacts 联系人" shown at top (dimmed)
- Icon: Users icon, `32px`, `var(--color-person)` at `50%`
- Text: "No contacts yet. 还没有联系人。"
- Subtext: "Start by indexing your email or messages."

### 11.3 No Topics

- Parent node "Topics 话题" shown at top (dimmed)
- Icon: Chat bubble icon, `32px`, `var(--color-topic)` at `50%`
- Text: "No topics yet. 还没有话题。"
- Subtext: "Topics are extracted automatically from your conversations."

### 11.4 First Run (no data at all)

If no data has been indexed yet, all three tabs show a shared welcome state:

- No parent node
- Centered welcome card: `max-width: 400px`, `var(--surface)`, `border-radius: 20px`, `padding: 32px`, `var(--shadow-sm)`
- Heading: "Welcome to MindFlow", `22px`, weight `500`
- 3 steps with numbered circles (`24px`, `var(--accent)` fill, white number):
  1. "Configure data sources in Settings"
  2. "Run your first ingestion"
  3. "Explore your knowledge"
- Button: "Open Settings 打开设置", `var(--accent)` background, white text, `radius-sm`, `padding: 10px 20px`

---

## 12. Loading States

### 12.1 Layer Loading (drill-in)

During the `swapping` phase (API fetch):
- Previous content has already faded out
- Show 3-5 skeleton circle nodes at child positions:
  - Circle: `44px`, `var(--bg-subtle)`, shimmer animation
  - Placeholder label below: `60px x 10px` rectangle, `var(--bg-subtle)`, shimmer
- Shimmer: `linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)`, `background-position` animates `-200%` to `200%` over `1500ms`, infinite

### 12.2 Tab Switch Loading

Same skeleton treatment as layer loading, shown during the swap phase of a tab switch.

### 12.3 Initial App Load

While the first API call fetches data:
- Sidebar renders immediately (static)
- Main content shows the skeleton state
- Breadcrumb shows "Me / ..." with the tab name

---

## 13. Keyboard Navigation

| Key | Action |
|-----|--------|
| `1` / `2` / `3` | Switch to Tab 1 (Todo) / 2 (Contacts) / 3 (Topics) |
| `Cmd+K` | Open command palette |
| `Escape` | Close detail card; if none, drill out one level |
| `Enter` | Drill into selected node |
| `Backspace` | Drill out one level (same as clicking parent breadcrumb) |
| `Tab` | Cycle through child nodes (focus ring on node) |
| `Arrow Left/Right` | Move selection between sibling nodes |

Focus-visible on nodes: `2px solid var(--accent)`, `outline-offset: 4px`, `border-radius: 50%`.

---

## 14. Implementation Notes

### 14.1 Route Changes

The new layout replaces the current routing structure:

| Current Route | New Behavior |
|---------------|-------------|
| `/` (DigestView) | **Replaced** → Main UI with default tab (Todo) at root layer |
| `/graph` | **Removed** → The org chart IS the main view |
| `/graph/:entityId` | **Removed** → Navigate via tab + drill-in |
| `/entity/:id` | **Kept** → Deep links to entity detail pages still work; they open in the Main UI by auto-selecting the right tab and drilling to that entity |
| `/search` | **Kept** → Search results page |

### 14.2 State Management

New Zustand store fields:
```
activeTab: 'todo' | 'contacts' | 'topics'
layerStack: LayerEntry[]  (per-tab, stored as map)
selectedNodeId: string | null
detailCardEntityId: string | null
```

Each tab maintains its own independent `layerStack`, so switching tabs preserves drill-in state.

### 14.3 Component Structure

```
App
├── TopBar (modified: remove graph button)
├── Shell (new layout)
│   ├── Sidebar
│   │   ├── TabButton (Todo)
│   │   ├── TabButton (Contacts)
│   │   ├── TabButton (Topics)
│   │   ├── Spacer
│   │   ├── ThemeToggle
│   │   └── SettingsButton
│   └── MainContent
│       ├── Breadcrumb
│       ├── SearchFilterBar (conditional)
│       ├── OrgChartCanvas (Cytoscape)
│       │   ├── GroupLabels (DOM overlays)
│       │   └── FloatingDetailCard
│       └── BottomTabBar (mobile only)
├── CommandPalette
└── SettingsPanel
```

### 14.4 API Endpoints Used

Per tab at each layer:

| Tab | Root API | Drill-in API |
|-----|----------|-------------|
| Todo | `GET /api/attention/pending` (grouped by urgency) | `GET /api/graph/layer/:entityId` |
| Contacts | `GET /api/graph/layer/root` filtered to persons | `GET /api/graph/layer/:entityId` |
| Topics | `GET /api/graph/layer/root` filtered to topics | `GET /api/graph/layer/:entityId` |

### 14.5 CSS Token Usage Summary

All new components MUST use existing CSS custom properties. No new colors, fonts, or spacing values are introduced. Reference `tailwind.css` and this spec's `var(--*)` tokens exclusively.

Key tokens for this spec:
- Backgrounds: `--bg`, `--bg-subtle`, `--surface`, `--surface-hover`, `--surface-active`
- Text: `--text`, `--text-secondary`, `--text-tertiary`, `--text-ghost`
- Borders: `--border`, `--border-strong`, `--border-focus`
- Entity colors: `--color-person`, `--color-topic`, `--color-action-item`, `--color-document`, `--color-key-fact`, `--color-thread`
- Entity tints: `--color-*-tint` variants
- Shadows: `--shadow-xs`, `--shadow-sm`, `--shadow-md`, `--shadow-card`
- Accent: `--accent`, `--accent-soft`

---

## 15. HierarchyNavigator — Topic Detail Page Component

A compact, horizontal (left-to-right) navigation band that shows a topic's position in the hierarchy. Sits between the EntityHeader and the Tab Bar on the Topic detail page. Uses SVG `<path>` connectors with HTML nodes (per Architect recommendation).

### 15.1 Position and Sizing

| Property | Value |
|----------|-------|
| Position | Between EntityHeader (`margin-bottom: 0`) and Tab Bar |
| Width | `100%` of main column |
| Max height | `88px` (hard limit — must never push tabs below fold) |
| Padding | `16px 20px` |
| Background | `var(--bg-subtle)` |
| Border | `1px solid var(--border)` top and bottom |
| Border radius | `0` (full-bleed within main column) |
| Overflow-x | `auto` (horizontal scroll when content exceeds width) |
| Overflow-y | `hidden` |
| Scroll behavior | `smooth` |
| Scrollbar | Hidden (`scrollbar-width: none`, `::-webkit-scrollbar { display: none }`) |

**Render conditions**: The component renders ONLY when the topic has at least one parent OR at least one child. A lone topic with no hierarchy produces no HierarchyNavigator.

### 15.2 Overall Horizontal Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  [... ›] [Grandparent] ──── [Parent] ════ [CURRENT] ──┬── [Child1] │
│                                                        ├── [Child2] │
│                                                        └── [Child3] │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

The layout is a single horizontal flex container with three zones:

| Zone | Content | Flex |
|------|---------|------|
| Ancestors | Breadcrumb-style pills, left to right | `flex: 0 0 auto` |
| Current | Highlighted current topic node | `flex: 0 0 auto` |
| Children | Vertical stack of child pills to the right | `flex: 0 0 auto` |

Container: `display: flex`, `align-items: center`, `gap: 0` (spacing handled by connector widths), `position: relative`.

The SVG overlay sits absolutely positioned over the entire container: `position: absolute`, `inset: 0`, `pointer-events: none`, `z-index: 1`. Nodes sit at `z-index: 2` (above the SVG).

### 15.3 Ancestor Pills

Each ancestor topic is rendered as a compact pill. The ancestor chain reads left-to-right from the oldest ancestor toward the current topic.

| Property | Value |
|----------|-------|
| Height | `28px` |
| Padding | `0 12px` |
| Border radius | `9999px` (full pill) |
| Background | `transparent` |
| Border | `1px dashed var(--border-strong)` |
| Font | `12px`, weight `500`, `var(--text-secondary)` |
| Max width | `140px` |
| Text overflow | Ellipsis, `white-space: nowrap` |
| Cursor | `pointer` |
| Transition | `120ms ease` |

**Hover state**:

| Property | Value |
|----------|-------|
| Background | `var(--color-topic-tint)` |
| Border | `1px solid var(--color-topic)` at `40%` opacity |
| Color | `var(--text)` |
| Transform | `translateY(-1px)` |
| Shadow | `var(--shadow-xs)` |

**Focus-visible**: `outline: 2px solid var(--accent)`, `outline-offset: 2px`

**Truncation rule**: Show at most 3 ancestor levels. If the chain is deeper, show an ellipsis pill before the visible ancestors:

| Property | Value |
|----------|-------|
| Content | "..." |
| Height | `28px` |
| Padding | `0 8px` |
| Border radius | `9999px` |
| Background | `transparent` |
| Border | `1px dashed var(--text-ghost)` |
| Font | `12px`, weight `500`, `var(--text-ghost)` |
| Cursor | `default` |
| Tooltip on hover | Full ancestor path as text, e.g. "Root > Sub-A > Sub-B > ..." |

**Spacing between ancestor pills**: `0px` — the SVG connector path visually bridges the gap. Each pill has `margin-right: 0` and the connector path spans the `40px` horizontal gap between the right edge of one pill and the left edge of the next.

### 15.4 Current Topic Node

The "you are here" marker. Visually distinct from ancestors and children.

| Property | Value |
|----------|-------|
| Height | `36px` |
| Padding | `0 16px` |
| Border radius | `12px` |
| Background | `var(--color-topic-tint)` (`#EDF5F0` light / `rgba(107,158,138,0.12)` dark) |
| Border | `2px solid var(--color-topic)` (`#6B9E8A`) |
| Font | `13px`, weight `600`, `var(--text)` |
| Max width | `180px` |
| Text overflow | Ellipsis |
| Cursor | `default` (not clickable — it's the current page) |
| Shadow | `var(--shadow-xs)` |

**Left accent dot**: A `6px` circle inside the pill, left of the text, filled with `var(--color-topic)`. Provides a color anchor.

**Status indicator**: To the right of the text, a subtle status label:
- Active: "Active 活跃", `10px`, weight `600`, `var(--color-topic)`, uppercase, letter-spacing `0.04em`
- Dormant: "Dormant 休眠", `10px`, weight `600`, `var(--text-ghost)`, uppercase
- Only shown if horizontal space allows (hidden below `160px` pill width)

### 15.5 Child Topic Pills

Each direct child topic is rendered as a compact clickable pill, stacked vertically to the right of the current node.

| Property | Value |
|----------|-------|
| Height | `26px` |
| Padding | `0 10px` |
| Border radius | `9999px` (full pill) |
| Background | `var(--surface)` |
| Border | `1px solid var(--border)` |
| Font | `12px`, weight `400`, `var(--text-secondary)` |
| Max width | `130px` |
| Text overflow | Ellipsis |
| Cursor | `pointer` |
| Transition | `120ms ease` |

**Hover state**:

| Property | Value |
|----------|-------|
| Background | `var(--color-topic-tint)` |
| Border | `1px solid var(--color-topic)` at `50%` opacity |
| Color | `var(--text)` |
| Shadow | `var(--shadow-xs)` |
| Transform | `translateX(2px)` (subtle rightward nudge) |

**Message count badge**: Positioned inside the pill, right side, after the label text.

| Property | Value |
|----------|-------|
| Display | Inline, after text with `margin-left: 6px` |
| Font | `10px`, weight `600`, `var(--text-tertiary)` |
| Content | Message count number, e.g. "12" |
| No background | Just the number — keeping it minimal |

**Vertical spacing between child pills**: `4px` gap.

**Children container**:
| Property | Value |
|----------|-------|
| Display | `flex`, `flex-direction: column`, `align-items: flex-start` |
| Gap | `4px` |
| Max height | `88px - 32px = 56px` (container padding subtracted) |
| Overflow-y | `hidden` (excess children handled by "+N more" pill) |

### 15.6 Overflow: More Than 5 Children

When a topic has more than 5 direct children:

1. Show the first 4 children as normal pills
2. Show a "+N more" pill as the 5th item:

| Property | Value |
|----------|-------|
| Height | `26px` |
| Padding | `0 10px` |
| Border radius | `9999px` |
| Background | `transparent` |
| Border | `1px dashed var(--border-strong)` |
| Font | `11px`, weight `500`, `var(--text-tertiary)` |
| Content | "+3 more" / "+3 更多" |
| Cursor | `pointer` |

**Click behavior**: Clicking "+N more" expands the children list to show all children. The component's max height constraint is temporarily lifted (animates to `auto` height with `max-height` transition). A "Show less 收起" pill replaces the "+N more" pill at the bottom.

**Expanded state**:
| Property | Value |
|----------|-------|
| Max height | `200px` (capped even when expanded) |
| Overflow-y | `auto` with hidden scrollbar |
| Transition | `250ms cubic-bezier(0.16, 1, 0.3, 1)` on `max-height` |

**"Show less" pill**:
| Property | Value |
|----------|-------|
| Same style as "+N more" pill |
| Content | "Show less 收起" |
| Icon | Chevron up, `12px`, inline before text |

### 15.7 SVG Connector Paths

Connectors are drawn as SVG `<path>` elements in an overlay `<svg>` that covers the entire HierarchyNavigator container.

#### SVG Container

| Property | Value |
|----------|-------|
| Position | `absolute` |
| Inset | `0` |
| Width / Height | `100%` |
| Pointer events | `none` |
| z-index | `1` |

#### Ancestor-to-Ancestor Connectors (horizontal)

Simple horizontal bezier curves connecting the right center of one ancestor pill to the left center of the next.

| Property | Value |
|----------|-------|
| Stroke | `var(--text-ghost)` (`#CBCBC8` light / `#3F3F46` dark) |
| Stroke width | `1.5px` |
| Fill | `none` |
| Stroke linecap | `round` |
| Path type | Cubic bezier: `M x1,y C cx1,y cx2,y x2,y` (horizontally smooth) |

The horizontal gap between pills is `40px`. The bezier control points create a gentle S-curve:
```
Start:  right center of pill A  →  (x1, y1)
End:    left center of pill B   →  (x2, y2)
CP1:    (x1 + 20, y1)          →  halfway, same y
CP2:    (x2 - 20, y2)          →  halfway, same y
```

Since ancestors are on the same horizontal line (`y1 === y2`), the connector is effectively a straight horizontal line with soft bezier endpoints. This looks cleaner than a literal straight line because the bezier avoids the "rigid ruler" feel.

#### Ancestor-to-Current Connector

Same style as ancestor-to-ancestor, but with slightly thicker stroke:

| Property | Value |
|----------|-------|
| Stroke | `var(--color-topic)` at `40%` opacity |
| Stroke width | `2px` |
| Path type | Same horizontal bezier |

This subtle color shift signals "you're entering the focused area."

#### Current-to-Children Connectors (branching)

One path from the right center of the current node to the left center of each child pill. These fan out vertically.

| Property | Value |
|----------|-------|
| Stroke | `var(--color-topic)` at `30%` opacity |
| Stroke width | `1.5px` |
| Fill | `none` |
| Stroke linecap | `round` |

**Path shape**: Cubic bezier with horizontal-first curvature:
```
Start:  right center of current node  →  (x1, y1)
End:    left center of child pill     →  (x2, y2)
CP1:    (x1 + 24, y1)                →  push right from current, stay at current's y
CP2:    (x2 - 24, y2)                →  pull left from child, at child's y
```

This creates organic S-curves that fan out smoothly from a single point to the vertically stacked children. The curves feel natural and warm, matching MindFlow's aesthetic.

**Gap between current node and children column**: `48px` (horizontal space for the bezier curves to breathe).

#### Ellipsis-to-Ancestor Connector

When the "..." truncation pill is shown:

| Property | Value |
|----------|-------|
| Stroke | `var(--text-ghost)` at `50%` opacity |
| Stroke width | `1px` |
| Stroke dasharray | `4 4` (dashed to match the ellipsis pill's dashed border) |

### 15.8 Spacing Reference (px values)

```
Container padding:                    16px top/bottom, 20px left/right
Ancestor pill to ancestor pill:       40px (horizontal, bridged by SVG)
Last ancestor to current node:        40px (horizontal, bridged by SVG)
Current node to children column:      48px (horizontal, bridged by SVG)
Child pill to child pill:             4px  (vertical gap)
Ellipsis pill to first ancestor:      32px (horizontal, bridged by dashed SVG)
```

### 15.9 Animation and Transitions

#### Page navigation animation

When the user clicks an ancestor or child pill, navigating to a different topic's detail page:

| Phase | Duration | Easing | Effect |
|-------|----------|--------|--------|
| Exit | `150ms` | `ease-in` | All pills and connectors fade to opacity `0`; current node scales to `0.95` |
| Enter (on new page) | `250ms` | `ease-out` | Ancestors slide in from left (staggered `40ms` each), current node fades + scales `0.95 → 1.0`, children slide in from right (staggered `30ms` each) |

#### Connector drawing animation (on mount)

SVG paths animate from zero length to full length using `stroke-dashoffset`:

| Property | Value |
|----------|-------|
| Initial | `stroke-dasharray: pathLength`, `stroke-dashoffset: pathLength` |
| Animate to | `stroke-dashoffset: 0` |
| Duration | `400ms` |
| Easing | `ease-out` |
| Stagger | Ancestor connectors first (left to right, `60ms` apart), then current-to-children (top to bottom, `40ms` apart) |

#### Expand/collapse animation

| Phase | Duration | Easing | Effect |
|-------|----------|--------|--------|
| Expand | `250ms` | `cubic-bezier(0.16, 1, 0.3, 1)` | `max-height` grows, new child pills fade in (`opacity 0 → 1`) staggered `30ms` each, SVG paths draw in |
| Collapse | `200ms` | `ease-in` | Reverse — pills fade out, paths retract, `max-height` shrinks |

#### Hover effects

Already specified per-element in sections 15.3, 15.4, 15.5. All transitions: `120ms ease`.

#### Reduced motion

When `prefers-reduced-motion: reduce`:
- All pill transitions become `0ms`
- SVG stroke-dashoffset animation disabled (paths appear immediately)
- Expand/collapse is instant (no `max-height` transition)
- Page navigation: instant swap, no fade/slide

### 15.10 Dark Theme Adaptations

All colors reference CSS variables that already have dark-theme overrides in `tailwind.css`. Specific adaptations:

| Element | Light | Dark |
|---------|-------|------|
| Container bg | `var(--bg-subtle)` = `#F3F0EB` | `var(--bg-subtle)` = `#18181B` |
| Ancestor pill border | `1px dashed var(--border-strong)` = `rgba(0,0,0,0.10)` | `1px dashed var(--border-strong)` = `rgba(255,255,255,0.12)` |
| Current node bg | `var(--color-topic-tint)` = `#EDF5F0` | `var(--color-topic-tint)` = `rgba(107,158,138,0.12)` |
| Current node border | `var(--color-topic)` = `#6B9E8A` | Same `#6B9E8A` (entity colors are shared) |
| Child pill bg | `var(--surface)` = `#FFFFFF` | `var(--surface)` = `#1E1E22` |
| SVG stroke (ancestors) | `var(--text-ghost)` = `#CBCBC8` | `var(--text-ghost)` = `#3F3F46` |
| SVG stroke (current→children) | `var(--color-topic)` at `30%` | Same |

No additional dark-theme overrides are needed. The design-token system handles the adaptation automatically.

### 15.11 Narrow Screen / Overflow Behavior

When the HierarchyNavigator content exceeds the container width:

1. Container has `overflow-x: auto` with hidden scrollbar
2. On mount, auto-scroll to center the current node horizontally:
   ```
   currentNode.scrollIntoView({ inline: 'center', behavior: 'smooth' })
   ```
3. **Fade edges**: When scrollable, show gradient fade masks on the left and/or right edges to indicate more content:
   - Width: `24px`
   - Gradient: `linear-gradient(to right, var(--bg-subtle), transparent)` on left, reverse on right
   - Only show the fade on the side that has hidden content
   - Implemented as `::before` / `::after` pseudo-elements on the scroll container
   - `pointer-events: none`, `z-index: 3`

4. **Touch scrolling**: On mobile/tablet, the container is swipeable. No scroll buttons.

### 15.12 Conditional Rendering Rules

| Scenario | Render? | What shows |
|----------|---------|------------|
| No parent, no children | **No** | Component not rendered |
| No parent, has children | **Yes** | Current node + children only (no ancestor zone) |
| Has parent, no children | **Yes** | Ancestors + current node only (no children zone) |
| Has parent, has children | **Yes** | Full layout: ancestors → current → children |
| Topic just created, hierarchy unknown | **No** | Component not rendered until hierarchy data available |

### 15.13 Tooltip on Hover

When hovering any pill (ancestor or child) for `500ms`, show a tooltip:

| Property | Value |
|----------|-------|
| Position | Above the pill, centered, `8px` gap |
| Background | `var(--surface-raised)` |
| Border | `1px solid var(--border)` |
| Border radius | `8px` |
| Padding | `8px 12px` |
| Shadow | `var(--shadow-sm)` |
| Max width | `220px` |
| z-index | `70` |
| Appear | Fade in, `120ms ease-out` |
| Disappear | Fade out, `80ms ease-in` |

**Tooltip content**:
- Line 1: Full topic name (untruncated), `13px`, weight `500`, `var(--text)`
- Line 2: Status + message count + last activity, `11px`, weight `400`, `var(--text-tertiary)`
  - e.g. "Active · 24 messages · 2h ago"
