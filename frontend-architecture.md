# MindFlow Frontend Architecture

**Version 1.0 -- March 28, 2026**

---

## 1. Technology Selection

### 1.1 Framework: React 19

**Decision**: React with React Compiler (automatic memoization).

**Rationale**:
- The PRD calls for a "platform-agnostic" UI that must work embedded in OpenClaw iframes, standalone browsers, and potentially Telegram web views. React's ecosystem has the best support for embedding scenarios and portability.
- React 19's Compiler eliminates manual `useMemo`/`useCallback` — critical for graph re-renders where every node/edge is a component.
- Cytoscape.js (which we keep -- see below) has mature React bindings. The alternative (rewriting the existing 600+ line graph manager in a less-supported framework) is waste.
- Team familiarity and hiring: React remains the largest talent pool. The MindFlow team is small; reducing framework risk matters.

**Rejected alternatives**:
- **Svelte 5**: Excellent reactivity model but immature ecosystem for graph visualization and complex data grids. Cytoscape.js integration is community-maintained and lags.
- **Solid**: Smallest ecosystem. The fine-grained reactivity advantage is less relevant when the bottleneck is canvas graph rendering, not DOM diffing.
- **Vue 3**: Viable but no specific advantage over React for this use case. Smaller ecosystem for the data-intensive components we need (command palette, virtualized lists, graph).

### 1.2 Component Library: Radix UI Primitives + Custom Design System

**Decision**: Radix UI unstyled primitives as the accessibility/behavior foundation. All visual styling is custom via Tailwind CSS.

**Rationale**:
- The visual direction (warm pastels, organic card layouts, large rounded corners, bold-keyword typography) is highly custom. No pre-built component library matches this aesthetic -- we'd spend more time fighting overrides than building from scratch. The warm, approachable style from the reference image is the opposite of what Shadcn/ui or Ant Design provide out of the box.
- Radix provides the hard accessibility parts (dialog focus traps, dropdown keyboard nav, tooltip positioning, command palette interactions) without imposing visual opinions. We style everything ourselves to match the warm, organic aesthetic.
- Shadcn/ui is Radix + Tailwind with copy-paste components -- we can reference its patterns but don't install it as a dependency. Its cool-gray default palette and sharp aesthetic conflict with our direction.

**Rejected alternatives**:
- **Shadcn/ui as a full install**: Too many overrides needed for the premium dark-first aesthetic. Better to use Radix directly and style from scratch.
- **Ant Design**: Heavy, opinionated, enterprise-look. Wrong aesthetic for a premium knowledge tool.
- **Headless UI**: Fewer primitives than Radix (no command palette primitive, weaker tooltip). Radix covers more of our surface area.

### 1.3 CSS Approach: Tailwind CSS 4

**Decision**: Tailwind CSS 4 with a custom theme configuration extending our design tokens.

**Rationale**:
- The current SPA already uses a CSS custom property system (`--bg`, `--surface`, `--text`, `--accent`, etc.) with semantic naming. Tailwind 4's CSS-first config maps directly to this -- we keep the same token names and get utility classes on top.
- Co-location of styles with component markup prevents the drift we see in the current monolithic `styles.css` (516 lines and growing).
- Tailwind's `dark:` variant maps cleanly to our `[data-theme="dark"]` / `[data-theme="light"]` system.
- PostCSS-based -- zero runtime cost.

### 1.4 Graph Library: Cytoscape.js (Keep)

**Decision**: Keep Cytoscape.js. Wrap it in a React component with imperative handle.

**Rationale**:
- The existing `graph.js` (668 lines) implements the full center-and-ring progressive disclosure model with: radial expansion, collapse, drill-down, breadcrumbing, dimming, badge overlay, tooltip layer, and animated transitions. This is working, tested, and matches the PRD's navigation model.
- Cytoscape.js handles the graph layout, hit-testing, pan/zoom, and animations in Canvas. Switching to D3 means reimplementing all of this in SVG/Canvas from scratch with no functional gain.
- The graph is a Canvas rendering bottleneck, not a DOM diffing bottleneck. React's value is in the *surrounding* UI (panels, search, command palette, entity pages), not in graph rendering itself.
- Sigma.js is WebGL-based and optimized for 10K+ node graphs. MindFlow caps at 20 visible nodes per ring -- Sigma's overhead is unjustified.
- React Flow is designed for flowcharts/diagrams with node-as-React-component. MindFlow's radial expansion model doesn't fit React Flow's assumptions.

**Integration pattern**: A `<GraphCanvas>` React component that:
1. Creates a Cytoscape instance on mount via `useRef`.
2. Exposes an imperative API via `useImperativeHandle` (`loadRoot`, `expandNode`, `navigateTo`, `refreshTheme`).
3. Receives callbacks (`onNodeSelect`, `onBreadcrumbChange`) as props.
4. Re-initializes the stylesheet on theme change.
5. Does NOT attempt to reconcile React state with Cytoscape elements -- Cytoscape owns its own element lifecycle.

### 1.5 Build Tool: Vite 6

**Decision**: Vite with React plugin.

**Rationale**:
- Sub-second HMR for the 50+ component SPA.
- Native ESM dev server -- no bundling during development.
- Rollup-based production build with tree-shaking.
- The backend Fastify server serves the built SPA from `dist/ui/` in production. Vite's `build.outDir` is configured to output there.

**Dev workflow**: During development, Vite runs its own dev server (port 5173) and proxies `/api` requests to the Fastify backend (port 7123). In production, Fastify serves the static build directly.

### 1.6 State Management: Zustand + TanStack Query

**Decision**: Two layers of state.

**Server state** (API data): **TanStack Query v5** (React Query).
- Handles caching, deduplication, stale-while-revalidate, and optimistic updates for all API calls.
- Query keys follow the pattern: `['entities', { type, limit, sort }]`, `['entity', id]`, `['graph', entityId, depth]`, `['attention']`, `['stats']`, `['query', queryText]`.
- WebSocket events trigger targeted query invalidation (e.g., `entity:created` invalidates `['entities']`).

**Client state** (UI state): **Zustand** (single store, minimal).
- Theme preference (`'dark' | 'light' | 'system'`)
- Active view (`'digest' | 'graph' | 'entity' | 'search'`)
- Graph breadcrumb path
- Command palette open/closed
- Settings panel open/closed
- Selected entity ID (for cross-view coordination)
- Detail panel content type

Why not Redux: MindFlow's client state is small. Zustand's 1KB footprint, no boilerplate, and direct mutations are the right tool. Redux's action/reducer ceremony is overhead for ~15 state fields.

Why not Context: Context triggers full subtree re-renders on every change. With graph + timeline + detail panel all reading shared state, this would cause unnecessary re-renders.

---

## 2. Page Architecture

### 2.1 Views

MindFlow is a single-page application with four primary views, navigated by the top bar and command palette. No sidebar -- the research shows sidebar-based navigation adds clutter for an app where the primary interaction is search and exploration.

| View | Route | Purpose | Primary Entry |
|------|-------|---------|---------------|
| **Daily Digest** | `/` | Morning brief, attention bar, activity feed, stats | Default landing page |
| **Entity Detail** | `/entity/:id` | Person/Topic/ActionItem page with timeline + context panel | Click entity anywhere |
| **Graph Explorer** | `/graph` or `/graph/:entityId` | Cytoscape canvas with progressive drill-down | "View in graph" links, Cmd+G |
| **Search Results** | `/search?q=...` | Progressive search results with AI answer | Cmd+K, search bar |

Routing is handled by React Router v7 with hash-based routing (`/#/entity/...`) for compatibility with iframe embedding (OpenClaw MCP Apps uses `ui://` scheme which does not support HTML5 pushState).

### 2.2 Navigation Model

```
+------------------------------------------------------------------+
| [Logo]  [Search Bar (Cmd+K)]           [Graph] [Theme] [Settings]|
+------------------------------------------------------------------+
| Breadcrumbs: Me / People / Wang Zong                             |
+------------------------------------------------------------------+
|                                                                   |
|  +-- View Content Area (routes) --------------------------------+|
|  |                                                               ||
|  |  Digest / Entity / Graph / Search                             ||
|  |                                                               ||
|  +---------------------------------------------------------------+|
|                                                                   |
+-------------------------------------------------------------------+
```

- **Top Bar** (always visible, 52px): Logo, search bar, view toggle buttons (digest / graph), theme toggle, settings gear.
- **Breadcrumb Bar** (always visible, 36px): Context trail. In digest: "Me". In entity: "Me / People / Wang Zong". In graph: mirrors Cytoscape breadcrumbs.
- **Main content area**: Fills remaining viewport. Layout varies by view (see below).

### 2.3 Layout per View

**Daily Digest** (`/`):

The digest follows the reference image's card-grid pattern: a personalized greeting at the top, then a grid of tinted cards that serve as entry points to different areas of the knowledge base. Each card has its own pastel background tint.

```
+---------------------------------------------------------------+
| Personalized Greeting (full-width, large text)                 |
| "Hello, Peter.                                                 |
|  What's on your **mind** today?"       [reflection input]      |
+---------------------------------------------------------------+
| Card Grid (2-col, responsive -> 1-col mobile)                  |
| +---------------------------+ +-----------------------------+  |
| | [coral tint]              | | [sage tint]                 |  |
| | 3 items need              | | Recent                      |  |
| | your **attention**        | | **Conversations**           |  |
| | Wang Zong, Lisa...   [->] | | 12 new today           [->]|  |
| +---------------------------+ +-----------------------------+  |
| +---------------------------+ +-----------------------------+  |
| | [lavender tint]           | | [pale yellow tint]          |  |
| | Your                      | | Knowledge                   |  |
| | **People**                | | **Graph**                   |  |
| | 847 contacts         [->] | | Explore connections    [->] |  |
| +---------------------------+ +-----------------------------+  |
| +-----------------------------------------------------------+  |
| | [soft blue tint] Your progress                             |  |
| | 89% of items processed  |  12,450 indexed  |  3 pending   |  |
| +-----------------------------------------------------------+  |
+---------------------------------------------------------------+
```

Each card uses its entity-type fill color as background tint, a corner arrow icon for navigation, and the bold-keyword typography pattern.

**Entity Detail** (`/entity/:id`):
```
+---------------------------------------------------------------+
| Attention Bar (filtered to this entity)                        |
+---------------------------------------------------------------+
| Two-panel layout (resizable, 65% / 35% default)               |
| +-------------------------------+ +-------------------------+ |
| | Entity Card                   | | Context Panel           | |
| |  - Avatar, name, org, role    | |  - Related entities     | |
| |  - Key stats (msgs, last      | |  - Connected topics     | |
| |    contact, pending count)    | |  - Key facts            | |
| |                               | |  - Pending items        | |
| | Timeline                      | |  - [Ask about entity]   | |
| |  - Chronological items        | |    (AI chat input)      | |
| |  - Channel badges             | |                         | |
| |  - Grouped by date            | |                         | |
| +-------------------------------+ +-------------------------+ |
+---------------------------------------------------------------+
```

**Graph Explorer** (`/graph/:entityId?`):
```
+---------------------------------------------------------------+
| Graph Controls Bar                                             |
| [Depth: 1 2 3] [Path Finder] [Reset] [Fullscreen]            |
+---------------------------------------------------------------+
| Split layout (resizable, graph top / detail bottom)            |
| +------------------------------------------------------------+|
| |                                                             ||
| |         Cytoscape Canvas (flex: 2)                          ||
| |                                                             ||
| +------------------------------------------------------------+|
| |-- resize handle -------------------------------------------|
| +------------------------------------------------------------+|
| | Detail Panel (flex: 3)                                      ||
| |  Shows entity timeline/detail for selected node             ||
| +------------------------------------------------------------+|
+---------------------------------------------------------------+
```

**Search Results** (`/search?q=...`):
```
+---------------------------------------------------------------+
| AI Answer Card (if query is a question)                        |
| "Wang Zong quoted $42K/yr for Vendor B on March 15."          |
| Sources: [Email Mar 15] [iMsg Mar 17]                         |
+---------------------------------------------------------------+
| Entity Matches (horizontal scroll chips)                       |
| [Wang Zong] [Q3 Budget] [Vendor B]                            |
+---------------------------------------------------------------+
| Timeline Results (virtualized list)                            |
| Progressive: FTS results appear first, vector results fade in  |
+---------------------------------------------------------------+
```

### 2.4 How the Graph Fits In

The graph is a **dedicated view** accessible via:
1. The "Graph" button in the top bar (`Cmd+G` shortcut).
2. "View in graph" links on entity pages and search results.
3. The command palette: "Open graph for Wang Zong".

When navigating to the graph from an entity page, the graph opens centered on that entity with one level expanded. The graph is NOT a sidebar or overlay -- it occupies the full content area because the canvas needs horizontal space for the radial layout.

The graph view retains its own detail panel (bottom split) for showing the selected node's timeline. This matches the current SPA's layout and avoids context loss.

---

## 3. Component Hierarchy

### 3.1 Top-Level Layout

```
<App>
  <ThemeProvider>
    <QueryClientProvider>            // TanStack Query
      <WebSocketProvider>            // WS connection + event handlers
        <AppLayout>
          <TopBar />                 // Logo, search, toggles
          <BreadcrumbBar />          // Context trail
          <main>
            <Routes>                 // React Router
              <Route path="/" element={<DigestView />} />
              <Route path="/entity/:id" element={<EntityView />} />
              <Route path="/graph/:entityId?" element={<GraphView />} />
              <Route path="/search" element={<SearchView />} />
            </Routes>
          </main>
          <CommandPalette />         // Radix Dialog, Cmd+K
          <SettingsPanel />          // Radix Sheet, slide-out
        </AppLayout>
      </WebSocketProvider>
    </QueryClientProvider>
  </ThemeProvider>
</App>
```

### 3.2 Reusable Components

Each component below includes its key props interface.

#### FeatureCard

The primary visual building block -- a tinted, rounded card that serves as an entry point. Inspired directly by the reference image's card grid.

```typescript
interface FeatureCardProps {
  title: React.ReactNode;         // Supports bold-keyword pattern via <strong>
  subtitle?: string;
  tint: 'person' | 'topic' | 'document' | 'action-item' | 'key-fact' | 'neutral';
  badge?: string | number;        // Corner badge (count, etc.)
  onClick?: () => void;
  children?: React.ReactNode;     // Optional body content
}
```

Styling: Uses entity-type fill color as background (`--color-person-fill`, etc.). 20px border radius. 20-24px padding. No border in light theme (shadow only). Corner arrow icon on hover. The `title` prop accepts `ReactNode` so callers can do:
```tsx
<FeatureCard tint="action-item" title={<>Items need your <strong>attention</strong></>} />
```

#### EntityCard

Compact card showing entity identity and key stats. Used on entity pages, search results, and the context panel.

```typescript
interface EntityCardProps {
  entity: Entity;
  stats?: EntityStats;
  variant: 'full' | 'compact' | 'inline';
  onNavigate?: (entityId: string) => void;
}
```

- `full`: Avatar, name, org, role, key stats, topics, pending count. Used at top of entity detail page. Uses the entity-type pastel tint as header background.
- `compact`: Avatar, name, type badge. Used in context panel and search results. White card with soft shadow.
- `inline`: Name as link with type-colored dot. Used in timeline items.

#### TimelineItem

A single indexed item (email, iMessage, document) in a timeline list.

```typescript
interface TimelineItemProps {
  item: RawItem;
  onCopy?: (text: string) => void;
  onNavigateEntity?: (entityId: string) => void;
}
```

Renders: channel badge, sender, date, subject, body preview (2-line clamp), hover actions (reply, copy, view in graph).

#### AttentionItem

A single pending/attention item with action buttons.

```typescript
interface AttentionItemProps {
  item: AttentionItem;
  onDismiss: (id: string) => void;
  onResolve: (id: string) => void;
  onSnooze: (id: string, until: number) => void;
  onNavigateEntity?: (entityId: string) => void;
}
```

Renders: urgency badge (High/Medium/Low with color), title (clickable if entity linked), type label, time ago, action buttons (snooze, dismiss, resolve) visible on hover.

#### AttentionBar

Persistent attention surface at the top of views.

```typescript
interface AttentionBarProps {
  entityId?: string;    // Filter to specific entity, or show all
  maxVisible?: number;  // Default 3
}
```

Renders: summary count, top N items inline, "View all" link. Collapsible. Fetches via `useQuery(['attention', { entityId }])`.

#### SearchBar

Search input with progressive results dropdown.

```typescript
interface SearchBarProps {
  autoFocus?: boolean;
  onSelectEntity?: (entityId: string) => void;
  onSubmitQuery?: (query: string) => void;
  variant: 'topbar' | 'palette';  // compact vs full-width
}
```

Renders: search icon, input, keyboard shortcut hint (`/`), clear button. On input change, fires debounced FTS entity search. Results appear in dropdown: entity matches first, then "Search all" option.

#### CommandPalette

Full command palette (Cmd+K) built on Radix Dialog + custom list.

```typescript
interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
```

Sections:
1. **Recent** (last 5 visited entities)
2. **Search results** (live, as user types)
3. **Actions** (static: "Show pending", "Open graph", "Run ingestion", "Settings")

Keyboard navigation: arrow keys to select, Enter to activate, Esc to close. Typeahead filters all sections simultaneously.

#### ContextPanel

Right-side context panel on entity detail pages.

```typescript
interface ContextPanelProps {
  entityId: string;
  entityType: EntityType;
}
```

Sections (vary by entity type):
- **Related Entities**: graph neighbors, clickable
- **Connected Topics**: for Person entities
- **Connected People**: for Topic entities
- **Key Facts**: extracted facts with source links
- **Pending Items**: filtered attention items
- **AI Chat Input**: "Ask about [entity name]..." single-line input that opens search scoped to this entity

#### GraphCanvas

Cytoscape.js wrapper.

```typescript
interface GraphCanvasProps {
  centerId?: string;
  onNodeSelect: (nodeData: { id: string; type: string; label: string }) => void;
  onBreadcrumbChange: (crumbs: BreadcrumbItem[]) => void;
}

interface GraphCanvasHandle {
  loadRoot: () => Promise<void>;
  expandNode: (id: string) => Promise<void>;
  navigateTo: (breadcrumbIndex: number) => void;
  refreshTheme: () => void;
  focusEntity: (entityId: string) => Promise<void>;
}
```

#### Timeline

Virtualized timeline list using `@tanstack/react-virtual`.

```typescript
interface TimelineProps {
  entityId: string;
  filters?: {
    after?: number;
    before?: number;
    channels?: SourceChannel[];
  };
}
```

Fetches items via `useInfiniteQuery`. Groups items by date. Renders `TimelineItem` for each.

#### ChannelBadge

Small colored pill showing source channel.

```typescript
interface ChannelBadgeProps {
  channel: SourceChannel;
}
```

Colors: Email = blue `#60A5FA`, iMessage = green `#4ADE80`, Document = amber `#FBBF24`, Meeting = purple `#A78BFA`.

#### EntityTypeBadge

Small colored pill showing entity type.

```typescript
interface EntityTypeBadgeProps {
  type: EntityType;
  variant?: 'pill' | 'dot';
}
```

Colors match design system entity colors (Section 4.2).

#### StatCard

Numeric stat with label.

```typescript
interface StatCardProps {
  label: string;
  value: number;
  color: string;
}
```

#### QueryAnswer

AI-generated answer card with source citations.

```typescript
interface QueryAnswerProps {
  answer: AnswerResult;
  items: RawItem[];
  onNavigateEntity?: (entityId: string) => void;
  onNavigateItem?: (itemId: string) => void;
}
```

Renders: answer text, source items as clickable chips with channel badge and date, related entity chips.

---

## 4. Design System Foundations

### 4.0 Aesthetic Direction

**Reference**: The visual direction is warm, approachable, and organic -- inspired by premium wellness/lifestyle apps rather than the typical dark-tech aesthetic of developer tools. Key characteristics:

- **Soft card-based layouts** with generous whitespace and large border radius (16-24px).
- **Warm, muted color palette**: cream/warm-white backgrounds, sage green, pale yellow, soft blue, muted coral -- NOT high-contrast dark theme as the primary mode.
- **Large typography with bold keyword emphasis**: Headlines use mixed-weight text where key words are bold while surrounding words are regular weight (e.g., "Exercises based on **your needs**").
- **Each card is a self-contained entry point**: Cards have their own background tint (pastel), corner icon/illustration, and clear call-to-action.
- **Personalized greeting**: "Hello, [Name]" with contextual question.
- **Organic illustration elements**: Plant/nature motifs, emoji accents, soft blob shapes as decorative elements.
- **Minimal iconography**: Icons are simple line-art, not filled. Decorative rather than functional.

This shifts the default theme from dark to **warm light** as the primary experience, with a dark theme available as an option.

### 4.1 Typography Scale

Base font: Inter (loaded via `@fontsource/inter`, no external CDN in production).
Fallback: `system-ui, -apple-system, BlinkMacSystemFont, sans-serif`.
Monospace: `'SF Mono', 'Fira Code', ui-monospace, monospace` (for entity IDs, code blocks, metadata).

The reference image uses large, confident typography with mixed-weight emphasis. Headlines are 24-32px with regular weight body and **bold keywords**.

| Token | Size | Weight | Line Height | Usage |
|-------|------|--------|-------------|-------|
| `text-xs` | 11px | 500 | 1.4 | Badges, labels, urgency tags |
| `text-sm` | 13px | 400 | 1.5 | Timeline preview, metadata, secondary text |
| `text-base` | 14px | 400-500 | 1.6 | Body text, timeline subjects, entity names in lists |
| `text-md` | 15px | 400-500 | 1.6 | Default body, search input, settings rows |
| `text-lg` | 18px | 500 | 1.4 | Section titles, card headers |
| `text-xl` | 22px | 400 (bold keywords: 700) | 1.3 | Page titles, card hero text |
| `text-2xl` | 28px | 400 (bold keywords: 700) | 1.2 | Daily Digest greeting, large stat values |
| `text-3xl` | 36px | 700 | 1.1 | Hero stat numbers (e.g., "89%") |

Letter spacing: `-0.02em` for headings (text-lg and above). `0.04em` for uppercase labels (lighter than before -- less "tech", more "editorial").

**Bold keyword pattern**: For headlines like the Daily Digest greeting, use `<span>` with `font-weight: 700` on the emphasized words:
```
"Hello, Peter. How are your **current projects** going?"
"Exercises based on **your needs**"
```
This is a React component pattern, not a CSS trick -- the content layer decides which words to emphasize.

### 4.2 Color Tokens

Semantic color system. All colors defined as CSS custom properties, consumed via Tailwind's theme config.

The palette is inspired by the visual reference: warm, muted, organic. Entity type colors use softened pastels that work as card background tints (not just accent dots). The palette avoids saturated neons in favor of colors that feel approachable.

**Entity Type Colors** (used for card tints, node fills, and badges):

| Token | Fill (card bg) | Accent (text/icon) | Usage |
|-------|---------------|-------------------|-------|
| `--color-person` | `#EDE9FE` | `#7C3AED` | Person cards, avatars -- soft lavender |
| `--color-topic` | `#D1FAE5` | `#059669` | Topic cards, badges -- sage green |
| `--color-document` | `#FEF3C7` | `#D97706` | Document cards, file icons -- pale yellow |
| `--color-action-item` | `#FEE2E2` | `#DC2626` | Pending items -- soft coral |
| `--color-key-fact` | `#DBEAFE` | `#2563EB` | Key fact cards -- soft blue |
| `--color-thread` | `#F3F4F6` | `#6B7280` | Thread items -- warm gray |
| `--color-accent` | `#EDE9FE` | `#7C3AED` | Primary accent (links, focus) -- violet |

Each entity type has TWO color roles: a **fill** (light pastel for card backgrounds, ~10% opacity feel) and an **accent** (darker, for text and icons on that fill). This matches the reference image where each card has its own tinted background.

**Channel Colors** (constant across themes):

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-channel-email` | `#60A5FA` | Email badges |
| `--color-channel-imessage` | `#4ADE80` | iMessage badges |
| `--color-channel-document` | `#D97706` | Document badges |
| `--color-channel-meeting` | `#8B5CF6` | Meeting badges |

**Surface Colors** (theme-dependent):

The warm light theme uses cream/warm-white tones, not cool gray-whites. The dark theme uses warm dark tones to maintain the organic feel.

| Token | Warm Light (default) | Warm Dark | Usage |
|-------|---------------------|-----------|-------|
| `--bg` | `#FAF9F6` | `#1A1918` | Page background (cream, not pure white) |
| `--bg-subtle` | `#F5F3EF` | `#211F1E` | Slightly elevated background |
| `--surface` | `#FFFFFF` | `#252322` | Card/panel background |
| `--surface-raised` | `#FFFFFF` | `#2D2B29` | Cards, attention items (white on cream) |
| `--surface-hover` | `#F9F7F4` | `#333130` | Hover state |
| `--surface-active` | `#F0EDE8` | `#3A3836` | Active/pressed state |
| `--border` | `rgba(0,0,0,0.06)` | `rgba(255,255,255,0.08)` | Default borders (subtle) |
| `--border-strong` | `rgba(0,0,0,0.10)` | `rgba(255,255,255,0.12)` | Hover/emphasis borders |
| `--border-focus` | `rgba(124,58,237,0.35)` | `rgba(124,58,237,0.50)` | Focus rings |
| `--text` | `#1C1917` | `#F5F3EF` | Primary text (warm black) |
| `--text-secondary` | `#57534E` | `#A8A29E` | Secondary text (warm gray) |
| `--text-tertiary` | `#A8A29E` | `#78716C` | Tertiary/muted text |
| `--text-ghost` | `#D6D3D1` | `#44403C` | Placeholder, disabled |

Note: The warm light palette uses Stone/Warm Gray tones (`#1C1917`, `#57534E`, `#A8A29E`) instead of the cool Zinc tones (`#18181B`, `#52525B`, `#A1A1AA`) from the previous version. This single change makes the entire UI feel warmer.

### 4.3 Spacing System

8px base grid. All spacing values are multiples of 4px.

| Token | Value | Usage |
|-------|-------|-------|
| `space-0.5` | 2px | Icon margins, tight gaps |
| `space-1` | 4px | Badge padding, attention item gaps |
| `space-2` | 8px | Between list items, small gaps |
| `space-3` | 12px | Between card sections, medium gaps |
| `space-4` | 16px | Panel padding, section spacing |
| `space-5` | 20px | Detail panel padding |
| `space-6` | 24px | Large section gaps, welcome card padding |
| `space-8` | 32px | Between major sections |

### 4.4 Border Radius

The reference image uses very generous rounding (16-24px on cards). This is a defining visual characteristic -- cards feel soft and organic, not sharp and technical.

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-xs` | 6px | Badges, keyboard shortcut hints |
| `--radius-sm` | 8px | Small buttons, tooltips, inline badges |
| `--radius-md` | 12px | Inputs, timeline items, small cards |
| `--radius-lg` | 16px | Standard cards, entity cards, attention items |
| `--radius-xl` | 20px | Large cards (digest cards, feature entry points) |
| `--radius-2xl` | 24px | Dialogs, command palette, hero cards |
| `--radius-full` | 9999px | Pills, avatar, channel badges |

### 4.5 Shadows

Shadows are softer and more diffused than typical tech UIs. No harsh drop shadows. The warm light theme uses warm-toned shadows (slightly brown rather than pure black).

| Token | Warm Light Value | Warm Dark Value | Usage |
|-------|-----------------|-----------------|-------|
| `--shadow-xs` | `0 1px 3px rgba(28,25,23,0.04)` | `0 1px 2px rgba(0,0,0,0.3)` | Timeline item hover |
| `--shadow-sm` | `0 2px 8px rgba(28,25,23,0.06)` | `0 2px 6px rgba(0,0,0,0.3)` | Card default state |
| `--shadow-md` | `0 4px 20px rgba(28,25,23,0.08)` | `0 4px 16px rgba(0,0,0,0.4)` | Card hover, elevated cards |
| `--shadow-lg` | `0 8px 32px rgba(28,25,23,0.10)` | `0 8px 24px rgba(0,0,0,0.5)` | Dialogs, command palette |
| `--shadow-glow` | `0 0 24px rgba(124,58,237,0.08)` | `0 0 20px rgba(124,58,237,0.15)` | Search focus |

Note: Cards in the warm light theme use `--shadow-sm` by default (always slightly elevated from the cream background, like the reference image) and `--shadow-md` on hover. In the dark theme, cards use borders instead of shadows as the primary separation mechanism.

### 4.6 Motion/Animation Principles

**Core timing tokens**:

| Token | Value | Usage |
|-------|-------|-------|
| `--duration-fast` | 120ms | Hover states, button clicks, badge transitions |
| `--duration-base` | 200ms | Panel content changes, border/background transitions |
| `--duration-slow` | 400ms | Graph node expand/collapse, view transitions, panel slide |

**Easing functions**:

| Token | Value | Usage |
|-------|-------|-------|
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Most transitions (natural deceleration) |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Playful bounces (graph node appear, badge pop) |
| `--ease-linear` | `linear` | Loading spinners only |

**Animation rules**:
1. All animations respect `prefers-reduced-motion: reduce`. When enabled, durations drop to 0ms and all transitions become instant.
2. Graph canvas animations (Cytoscape) use their own easing -- matched visually to our CSS easings but configured via Cytoscape's animation API.
3. No animation exceeds 500ms. If something takes longer, show a loading state instead.
4. New content slides/fades *in from a logical direction* -- timeline items slide up, side panel slides from right, command palette fades down from top.
5. Removed content fades out (opacity 0) before being unmounted. No unmount without exit animation.

**Specific animations**:
- **Graph node expansion**: Nodes animate from parent position to ring position over 450ms with `ease-out-cubic`. Edges fade in over the same duration.
- **Graph node collapse**: Reverse -- nodes animate back to parent, then are removed.
- **Command palette open**: Backdrop fades in 120ms. Card scales from 0.98 to 1.0 and fades in over 150ms.
- **Attention item dismiss**: Item fades to 40% opacity, then slides out and is removed.
- **Timeline item appear**: Fade in + 4px upward slide over 200ms.
- **Theme transition**: Background, text, and border colors transition over 200ms. Graph stylesheet is rebuilt and applied without transition (Cytoscape handles its own).

### 4.7 Theme Architecture

**Default theme: Warm Light.** The visual reference establishes a warm, cream-toned light aesthetic as the primary experience. Dark theme is available for users who prefer it but is not the default.

**Storage**: Theme preference stored in `localStorage` as `'light' | 'dark' | 'system'`. Default: `'light'` (warm light theme).

**Application**: `<html data-theme="light|dark">` attribute, set at the app root before first paint (inline script in `index.html` to prevent flash).

**CSS**: All theme-dependent values use CSS custom properties. The property set (Section 4.2) is the single source of truth. Tailwind's `dark:` variant maps to `[data-theme="dark"]`.

**Graph theme**: The Cytoscape stylesheet reads CSS custom properties at build time via `getComputedStyle`. On theme change, the graph manager's `refreshTheme()` rebuilds and re-applies the stylesheet. Entity node fill colors use the pastel fills from Section 4.2 in light mode, and slightly desaturated versions in dark mode. Graph background uses a subtle warm radial gradient (`--bg` to transparent) in both themes.

**Graph node styling per theme**:
- Warm light: Nodes use pastel fills (e.g., person = `#EDE9FE`), white border, soft shadow. Labels use `--text` (warm black).
- Warm dark: Nodes use the accent colors (e.g., person = `#7C3AED` at 80% opacity). Labels use `--text` (warm white). Edges brighten slightly.

---

## 5. Integration with Backend

### 5.1 API Client Pattern

**TanStack Query v5** manages all server state.

**API client module** (`src/ui/lib/api.ts`): Thin wrapper around `fetch`, similar to the current `api.js` but with TypeScript types. All request/response types imported from the shared `src/types/index.ts`.

```typescript
// Example query hook
export function useEntity(id: string) {
  return useQuery({
    queryKey: ['entity', id],
    queryFn: () => api.getEntity(id),
    staleTime: 30_000,        // 30s before refetch
    gcTime: 5 * 60_000,       // 5min cache retention
  });
}

export function useAttentionItems(entityId?: string) {
  return useQuery({
    queryKey: ['attention', { entityId }],
    queryFn: () => api.getAttention(entityId),
    staleTime: 10_000,        // 10s -- attention is time-sensitive
    refetchInterval: 60_000,  // Poll every 60s as fallback
  });
}

export function useSearchQuery(query: string) {
  return useQuery({
    queryKey: ['query', query],
    queryFn: () => api.query(query),
    enabled: query.length > 0,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });
}
```

**Query key structure** (for targeted invalidation):

| Key Pattern | Invalidated By |
|-------------|----------------|
| `['entities', filters?]` | `entity:created`, `entity:updated`, `entity:merged` |
| `['entity', id]` | `entity:updated` (matching id) |
| `['graph', entityId, depth]` | `relationship:created`, `entity:merged` |
| `['attention']` | `attention:created`, `attention:resolved`, optimistic mutations |
| `['stats']` | `items:ingested`, `sync:completed` |
| `['timeline', entityId]` | `items:ingested` (if entity involved) |
| `['query', queryText]` | Not invalidated (immutable query results) |

### 5.2 WebSocket Integration

A `WebSocketProvider` context manages a single WebSocket connection to `/api/ws`.

```typescript
interface WebSocketContextValue {
  connected: boolean;
  lastEvent: { event: MindFlowEventName; data: unknown } | null;
}
```

**Connection lifecycle**:
1. Connect on app mount.
2. Reconnect with exponential backoff (1s, 2s, 4s, 8s, max 30s) on disconnect.
3. Disconnect on app unmount.

**Event-to-invalidation mapping**: A single `useEffect` in `WebSocketProvider` listens for events and calls `queryClient.invalidateQueries`:

```typescript
const EVENT_INVALIDATION_MAP: Record<MindFlowEventName, QueryKey[]> = {
  'entity:created':      [['entities'], ['stats']],
  'entity:updated':      [['entities'], ['entity']],  // broad invalidation
  'entity:merged':       [['entities'], ['graph']],
  'relationship:created':[['graph']],
  'attention:created':   [['attention']],
  'attention:resolved':  [['attention']],
  'items:ingested':      [['stats'], ['entities']],
  'sync:completed':      [['stats']],
  'sync:error':          [['stats']],
  'item:processed':      [],   // no UI invalidation needed
  'sync:started':        [],   // could show indicator
  'thread:created':      [],
  'thread:updated':      [],
  'community:updated':   [['entities']],
  'pipeline:progress':   [],   // could update progress indicator
};
```

**Processing progress indicator**: When `pipeline:progress` events arrive, update a Zustand store field (`processingProgress: { stage, processed, total }`). The top bar renders a subtle progress bar when processing is active.

### 5.3 Optimistic Updates for Attention Actions

Dismiss, resolve, and snooze actions on attention items use TanStack Query's optimistic update pattern:

```typescript
export function useDismissAttention() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.dismissAttention(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['attention'] });
      const previous = queryClient.getQueryData(['attention']);

      queryClient.setQueryData(['attention'], (old: AttentionResponse) => ({
        items: old.items.filter(item => item.id !== id),
      }));

      return { previous };
    },
    onError: (_err, _id, context) => {
      // Roll back on failure
      queryClient.setQueryData(['attention'], context?.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['attention'] });
    },
  });
}
```

This pattern provides instant visual feedback (item disappears immediately) while ensuring consistency (server confirms or rolls back).

---

## 6. Directory Structure

```
src/ui/                        # Frontend source (Vite project root)
  index.html                   # Entry HTML (theme init script, root div)
  vite.config.ts               # Vite config (proxy, outDir)
  tailwind.config.ts           # Tailwind theme extending design tokens
  postcss.config.js
  src/
    main.tsx                   # React entry point
    App.tsx                    # Root component with providers + router
    stores/
      ui.ts                   # Zustand store (theme, view, selections)
    lib/
      api.ts                  # Typed API client (fetch wrapper)
      ws.ts                   # WebSocket connection manager
      query-client.ts         # TanStack Query client config
      constants.ts            # Entity type colors, channel colors
    providers/
      ThemeProvider.tsx
      WebSocketProvider.tsx
    hooks/
      useEntity.ts            # TanStack Query hooks
      useAttention.ts
      useTimeline.ts
      useSearch.ts
      useStats.ts
      useGraph.ts
      useDismissAttention.ts  # Mutation hooks with optimistic updates
      useResolveAttention.ts
      useSnoozeAttention.ts
    components/
      layout/
        AppLayout.tsx          # Top bar + breadcrumbs + main area
        TopBar.tsx
        BreadcrumbBar.tsx
      search/
        SearchBar.tsx
        CommandPalette.tsx
      entity/
        EntityCard.tsx
        EntityTypeBadge.tsx
        ContextPanel.tsx
      timeline/
        Timeline.tsx           # Virtualized list
        TimelineItem.tsx
        ChannelBadge.tsx
      attention/
        AttentionBar.tsx
        AttentionItem.tsx
      graph/
        GraphCanvas.tsx        # Cytoscape wrapper
        GraphControls.tsx      # Depth slider, path finder, reset
      query/
        QueryAnswer.tsx
      stats/
        StatCard.tsx
      common/
        Avatar.tsx
        Badge.tsx
        Spinner.tsx
    views/
      DigestView.tsx
      EntityView.tsx
      GraphView.tsx
      SearchView.tsx
    styles/
      global.css               # Tailwind imports + CSS custom properties
```

---

## 7. Build and Dev Workflow

### 7.1 Development

```bash
# Terminal 1: Backend
npm run serve              # Fastify on :7123

# Terminal 2: Frontend
cd src/ui && npm run dev   # Vite on :5173, proxies /api -> :7123
```

Vite config:
```typescript
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:7123',
        ws: true,              // Proxy WebSocket upgrade
      },
    },
  },
  build: {
    outDir: '../../dist/ui',   // Output alongside backend dist
    emptyOutDir: true,
  },
});
```

### 7.2 Production Build

```bash
cd src/ui && npm run build   # Outputs to dist/ui/
```

Fastify serves `dist/ui/` as static files with SPA fallback (already implemented in `src/adapters/http/server.ts`).

### 7.3 Package Management

The frontend is a **nested package** within the monorepo: `src/ui/package.json` has its own dependencies (React, Radix, TanStack Query, etc.) separate from the backend `package.json`. This prevents the backend from bundling React and vice versa.

Root `package.json` adds convenience scripts:
```json
{
  "scripts": {
    "ui:dev": "cd src/ui && npm run dev",
    "ui:build": "cd src/ui && npm run build"
  }
}
```

---

## 8. Migration Path from Current SPA

The current vanilla JS SPA (`src/ui/{index.html, app.js, graph.js, timeline.js, api.js, styles.css}`) is functional and matches the API contract. The migration is incremental:

1. **Phase 1**: Create the Vite + React scaffold alongside the existing files. Port `api.js` to typed `lib/api.ts`. Port `graph.js` to `GraphCanvas.tsx` wrapper (minimal changes -- the class becomes the imperative handle). Port `styles.css` design tokens to `tailwind.config.ts` + `global.css`.

2. **Phase 2**: Build the new views (Digest, Entity, Search) as React components. These are net-new -- the current SPA doesn't have these views.

3. **Phase 3**: Integrate Command Palette and Context Panel. Wire WebSocket + TanStack Query.

4. **Phase 4**: Remove the old vanilla files. Update Fastify to serve from `dist/ui/`.

The API contract does not change. All existing endpoints are consumed by the new frontend as-is. No backend changes required for the frontend rebuild.
