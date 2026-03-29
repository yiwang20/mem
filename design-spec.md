# MindFlow Design Specification

**Version 1.0 -- March 29, 2026**

A pixel-precise design system and page specification for the MindFlow frontend rebuild. This document is the single source of truth for all visual decisions. An SDE should be able to implement every screen without design ambiguity.

---

## 1. Visual Language

### 1.1 Aesthetic Direction

MindFlow's visual identity is **warm, approachable, and organic** -- inspired by premium wellness and lifestyle apps, not the typical dark-tech aesthetic of developer tools. The interface should feel like a calm personal studio, not a command center.

Key characteristics:
- Soft card-based layouts with generous whitespace and large border radius
- Warm, muted color palette: cream backgrounds, sage green, pale yellow, soft blue, muted coral
- Large typography with mixed-weight emphasis on key words
- Each card is a self-contained entry point with its own background tint
- Minimal iconography: line-art style, decorative rather than dense
- The **warm light theme is the primary experience**; dark theme is a secondary option

### 1.2 Color Palette

#### Light Theme (Primary)

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg` | `#FAF8F5` | Page background (warm cream, not pure white) |
| `--bg-subtle` | `#F3F0EB` | Slightly recessed areas, input backgrounds |
| `--surface` | `#FFFFFF` | Card backgrounds, panels |
| `--surface-raised` | `#FFFFFF` | Elevated cards (with shadow for separation) |
| `--surface-hover` | `#F7F5F2` | Card/button hover state |
| `--surface-active` | `#EFECE7` | Pressed/active state |
| `--border` | `rgba(0,0,0,0.06)` | Default card borders |
| `--border-strong` | `rgba(0,0,0,0.10)` | Hover emphasis borders |
| `--border-focus` | `rgba(139,92,246,0.40)` | Focus rings |
| `--text` | `#1A1A1A` | Primary text (warm black, not pure #000) |
| `--text-secondary` | `#5C5C5C` | Body text, descriptions |
| `--text-tertiary` | `#9A9A9A` | Placeholders, labels, metadata |
| `--text-ghost` | `#CBCBC8` | Disabled text, inactive elements |

#### Dark Theme (Secondary)

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg` | `#111113` | Page background |
| `--bg-subtle` | `#18181B` | Recessed areas |
| `--surface` | `#1E1E22` | Card backgrounds |
| `--surface-raised` | `#252529` | Elevated cards |
| `--surface-hover` | `#2C2C31` | Hover state |
| `--surface-active` | `#343439` | Pressed/active state |
| `--border` | `rgba(255,255,255,0.07)` | Default borders |
| `--border-strong` | `rgba(255,255,255,0.12)` | Hover borders |
| `--border-focus` | `rgba(139,92,246,0.50)` | Focus rings |
| `--text` | `#ECECF1` | Primary text |
| `--text-secondary` | `#A1A1AA` | Secondary text |
| `--text-tertiary` | `#63636E` | Tertiary text |
| `--text-ghost` | `#3F3F46` | Ghost/disabled text |

#### Accent Colors (shared across themes)

| Token | Hex | Soft Variant | Usage |
|-------|-----|-------------|-------|
| `--accent` | `#7C5CFC` | `rgba(124,92,252,0.10)` | Primary accent, links, focus |

#### Entity Type Colors

| Token | Hex | Card Tint (light) | Card Tint (dark) | Usage |
|-------|-----|-------------------|-------------------|-------|
| `--color-person` | `#8B7EC8` | `#F0EDF8` | `rgba(139,126,200,0.12)` | People -- muted lavender |
| `--color-topic` | `#6B9E8A` | `#EDF5F0` | `rgba(107,158,138,0.12)` | Topics -- sage green |
| `--color-document` | `#C4A86B` | `#F8F3EA` | `rgba(196,168,107,0.12)` | Documents -- warm amber |
| `--color-action-item` | `#C47A7A` | `#F8EDEC` | `rgba(196,122,122,0.12)` | Pending -- muted coral |
| `--color-key-fact` | `#6B8EC4` | `#EDF1F8` | `rgba(107,142,196,0.12)` | Key facts -- soft blue |
| `--color-thread` | `#8A8A8A` | `#F2F2F0` | `rgba(138,138,138,0.10)` | Threads -- warm gray |

These are intentionally muted and warm-toned compared to the vivid tech palette. They should feel like watercolors, not neon.

#### Channel Colors

| Channel | Hex | Badge BG (light) | Usage |
|---------|-----|-------------------|-------|
| Email | `#6B8EC4` | `rgba(107,142,196,0.12)` | Email badges |
| iMessage | `#6B9E8A` | `rgba(107,158,138,0.12)` | iMessage badges |
| Meeting | `#8B7EC8` | `rgba(139,126,200,0.12)` | Meeting badges |
| Document | `#C4A86B` | `rgba(196,168,107,0.12)` | Document badges |

#### Urgency Colors

| Level | Hex | Background | Usage |
|-------|-----|------------|-------|
| High | `#C47A7A` | `rgba(196,122,122,0.12)` | Overdue, urgent items |
| Medium | `#C4A86B` | `rgba(196,168,107,0.12)` | Approaching deadline |
| Low | `#6B9E8A` | `rgba(107,158,138,0.12)` | Informational |

#### Shadows

| Token | Light Value | Dark Value | Usage |
|-------|-------------|------------|-------|
| `--shadow-xs` | `0 1px 3px rgba(0,0,0,0.04)` | `0 1px 2px rgba(0,0,0,0.3)` | Subtle card elevation |
| `--shadow-sm` | `0 2px 8px rgba(0,0,0,0.05)` | `0 2px 6px rgba(0,0,0,0.3)` | Hovered cards |
| `--shadow-md` | `0 4px 20px rgba(0,0,0,0.06)` | `0 4px 16px rgba(0,0,0,0.4)` | Dialogs, command palette |
| `--shadow-lg` | `0 8px 40px rgba(0,0,0,0.08)` | `0 8px 32px rgba(0,0,0,0.5)` | Settings panel |
| `--shadow-card` | `0 1px 4px rgba(0,0,0,0.03)` | none | Default card shadow (light only) |

Shadows in light theme are warm and diffuse, never harsh. In dark theme, shadows are deeper but still subtle.

### 1.3 Typography

**Font Family**: Inter
**Fallback**: `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
**Monospace**: `'SF Mono', 'Fira Code', ui-monospace, monospace`

| Token | Size | Weight | Line Height | Letter Spacing | Usage |
|-------|------|--------|-------------|----------------|-------|
| `text-xs` | 11px | 500 | 1.4 | 0.04em | Badges, channel labels, urgency tags |
| `text-sm` | 13px | 400 | 1.5 | 0 | Timeline previews, metadata, secondary text |
| `text-base` | 14px | 400 | 1.6 | 0 | Body text, form labels, settings rows |
| `text-md` | 15px | 400 | 1.6 | 0 | Search input, entity names in lists |
| `text-lg` | 18px | 500 | 1.4 | -0.01em | Section titles, card headers |
| `text-xl` | 22px | 400 | 1.3 | -0.02em | Page titles, greeting subtitle |
| `text-2xl` | 28px | 400 | 1.2 | -0.02em | Daily Digest greeting |
| `text-3xl` | 36px | 700 | 1.1 | -0.03em | Hero stat numbers |
| `label` | 10px | 700 | 1.3 | 0.06em | Uppercase section labels, overlines |

**Bold keyword pattern**: Headlines use mixed-weight text. The greeting "Hello, Peter. How are your **current projects** going?" renders "current projects" at `font-weight: 700` while the rest is `400`. This is the defining typographic gesture of the design.

### 1.4 Spacing System

Base grid: 4px. All spacing is a multiple of 4px.

| Token | Value | Usage |
|-------|-------|-------|
| `space-0.5` | 2px | Tight inline gaps |
| `space-1` | 4px | Badge padding, icon-text gap in badges |
| `space-2` | 8px | Between list items, tight card padding |
| `space-3` | 12px | Between sections within a card |
| `space-4` | 16px | Standard card padding, section gaps |
| `space-5` | 20px | Panel padding |
| `space-6` | 24px | Between major card groups |
| `space-8` | 32px | Top-level section separation |
| `space-10` | 40px | Hero spacing (greeting to first section) |
| `space-12` | 48px | Empty state vertical padding |

**Page content max-width**: `720px`, centered with `auto` side margins and `24px` horizontal padding on mobile.

### 1.5 Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `radius-xs` | 4px | Small badges, keyboard hints |
| `radius-sm` | 8px | Buttons, inputs, tooltips |
| `radius-md` | 12px | Timeline items, attention items |
| `radius-lg` | 16px | Entity cards, stat cards, topic cards |
| `radius-xl` | 20px | Feature cards (Daily Digest attention cards) |
| `radius-2xl` | 24px | Command palette, dialogs |
| `radius-full` | 9999px | Avatars, pill badges, channel badges |

The reference image uses very generous radius (16-24px for cards). This is a defining visual characteristic.

### 1.6 Icons

**Style**: Outlined (stroke-only), 2px stroke weight, rounded line caps, rounded line joins.
**Library**: Heroicons (outline set) or custom SVGs matching this style.

| Size Token | Dimensions | Usage |
|-----------|------------|-------|
| `icon-xs` | 14 x 14px | Inline with badge text, small buttons |
| `icon-sm` | 16 x 16px | Topbar buttons, action buttons |
| `icon-md` | 20 x 20px | Card action icons, navigation |
| `icon-lg` | 24 x 24px | Entity type icons in cards |
| `icon-xl` | 32 x 32px | Empty state illustrations |

Color: Icons use `--text-tertiary` by default, `--text-secondary` on hover, `--text` when active. Entity-specific icons use their entity color.

---

## 2. Page Layouts

### 2.1 Daily Digest (Landing Page)

The default view. A single-column, scrollable page that serves as the user's morning command center.

**Structure** (top to bottom):

```
+-- Page Container (max-width: 720px, centered) ----+
|                                                     |
|  Greeting Section                                   |
|  "Hello, Peter"                      Last sync: 2h  |
|  "How are your **current projects** going?"          |
|                                                     |
|  [space-8: 32px]                                    |
|                                                     |
|  Attention Cards (2-column grid, 12px gap)          |
|  +--------------------+ +--------------------+      |
|  | Urgency: High      | | Urgency: Medium    |     |
|  | Wang Zong waiting   | | Contract renewal   |     |
|  | for budget update   | | deadline Apr 1     |     |
|  | [Dismiss] [Resolve] | | [Snooze] [Resolve] |    |
|  +--------------------+ +--------------------+      |
|  +--------------------+                             |
|  | Urgency: Low        |                            |
|  | Lisa's doc unreviewed|                           |
|  | [Dismiss] [Resolve] |                            |
|  +--------------------+                             |
|                                                     |
|  [space-8: 32px]                                    |
|                                                     |
|  "Recent Contacts" label                            |
|  Horizontal scroll of contact avatar cards          |
|  [Avatar] [Avatar] [Avatar] [Avatar] [Avatar] -->  |
|                                                     |
|  [space-8: 32px]                                    |
|                                                     |
|  "Active Topics" label                              |
|  Topic cards (2-column grid, 12px gap)              |
|  +--------------------+ +--------------------+      |
|  | sage-tint bg        | | yellow-tint bg     |     |
|  | Q3 Budget           | | Vendor Selection   |     |
|  | 4 people, 12 msgs   | | 2 people, 5 msgs   |    |
|  | Last: 2h ago        | | Last: 1d ago       |    |
|  +--------------------+ +--------------------+      |
|                                                     |
+-----------------------------------------------------+
```

**Greeting Section**:
- "Hello, Peter" at `text-2xl` (28px), `font-weight: 400`
- Contextual subtitle at `text-xl` (22px), `font-weight: 400`, with bold keywords at `700`
- Sync status right-aligned, `text-sm` (13px), `--text-tertiary`
- `margin-bottom: 40px` before attention cards

**Attention Cards**:
- Background: entity type card tint (e.g., `#F8EDEC` for pending items)
- Border: none (the tint color provides separation)
- Border radius: `20px`
- Padding: `20px`
- Shadow: `--shadow-card` in light theme
- Urgency indicator: small colored dot (8px circle) at top-left of card, color from urgency palette
- Title: `text-lg` (18px), `font-weight: 500`, `--text`
- Context line: `text-sm` (13px), `--text-secondary`, e.g., "3 days waiting"
- Action buttons: bottom of card, ghost-style buttons with text labels ("Dismiss", "Snooze", "Resolve")
- Grid: `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`, `gap: 12px`

**Recent Contacts**:
- Section label: `label` (10px uppercase), `--text-tertiary`, `margin-bottom: 12px`
- Horizontal scroll container with `overflow-x: auto`, `scroll-snap-type: x mandatory`
- Each contact card: 120px wide, vertically stacked
  - Avatar circle: 56px diameter, entity color background, white initial letter at `text-lg`
  - Name: `text-sm` (13px), `font-weight: 500`, centered, `margin-top: 8px`
  - Last message preview: `text-xs` (11px), `--text-tertiary`, 1-line clamp, centered
- Gap between cards: `12px`
- Scroll padding: `24px` on left/right

**Active Topics**:
- Section label: same style as Recent Contacts
- Grid: same as attention cards (`minmax(280px, 1fr)`)
- Each topic card:
  - Background: topic card tint (`#EDF5F0` sage)
  - Border radius: `20px`
  - Padding: `20px`
  - Topic name: `text-lg` (18px), `font-weight: 500`
  - Stats line: `text-sm` (13px), `--text-secondary`, "4 people, 12 messages"
  - Last activity: `text-xs` (11px), `--text-tertiary`, "Last: 2 hours ago"
  - Small arrow icon at top-right corner, `--text-tertiary`, 16px

### 2.2 Entity Detail Page

**Structure**:

```
+-- Two-Panel Layout (65% / 35%, resizable) ---------+
|                                                     |
| +-- Main Panel (left) ---+ +-- Context Panel -----+|
| |                         | |                      ||
| | Entity Card             | | RELATED ENTITIES     ||
| | +---------------------+ | | [avatar] Wang Zong   ||
| | | [Avatar] Name       | | | [avatar] Lisa Chen   ||
| | | Org, Role           | | |                      ||
| | | email@example.com   | | | CONNECTED TOPICS     ||
| | | 84 messages          | | | [badge] Q3 Budget    ||
| | | Last: Today 2:15 PM | | | [badge] Vendor Sel.  ||
| | | [Topic] [Topic]     | | |                      ||
| | +---------------------+ | | PENDING (2)          ||
| |                         | | [item] Budget update ||
| | Tab Bar                 | | [item] Doc review    ||
| | [Timeline] [Key Facts]  | |                      ||
| | [Relationships]         | | KEY FACTS            ||
| |                         | | * Budget: $42K/yr    ||
| | Timeline Content        | | * Deadline: Apr 1    ||
| | +-------------------+   | |                      ||
| | | Mar 27 [Email]     |  | | +------------------+ ||
| | | Re: Q3 Budget      |  | | | Ask about Wang   | ||
| | | Preview text...    |  | | | Zong...           | ||
| | +-------------------+   | | +------------------+ ||
| | +-------------------+   | |                      ||
| | | Mar 25 [iMessage]  |  | |                      ||
| | | Budget update...   |  | |                      ||
| | +-------------------+   | |                      ||
| |                         | |                      ||
| +-------------------------+ +----------------------+|
+-----------------------------------------------------+
```

**Entity Card** (top of main panel):
- Background: `--surface`
- Border: `1px solid --border`
- Border radius: `16px`
- Padding: `20px`
- Avatar: 48px circle, entity type color, white initial at `text-xl`
- Name: `text-xl` (22px), `font-weight: 600`, `--text`
- Organization + Role: `text-base` (14px), `--text-secondary`
- Contact info (email, phone): `text-sm` (13px), `--text-tertiary`, clickable
- Stats row: horizontal, separated by `middot`, `text-sm`, `--text-secondary`
  - "84 messages", "Last: Today 2:15 PM", "2 pending"
- Topic badges: row of pills, `radius-full`, entity topic color background, `text-xs`, `font-weight: 600`
- `margin-bottom: 24px`

**Tab Bar**:
- Horizontal tabs: "Timeline", "Key Facts", "Relationships"
- Each tab: `text-sm` (13px), `font-weight: 500`, `padding: 8px 16px`
- Active tab: `--text`, bottom border `2px solid --accent`
- Inactive tab: `--text-tertiary`, no border
- Tab bar has bottom border: `1px solid --border`
- `margin-bottom: 16px`

**Timeline Items** (below tab bar):
- Grouped by date. Date header: `label` (10px uppercase), `--text-tertiary`, `margin: 16px 0 8px`
- Each item: card with `radius-md` (12px), `padding: 16px`, `border: 1px solid --border`
- Header row: channel badge + sender name + date, same line
  - Channel badge: `radius-full`, channel-specific tint background and text color, `text-xs`, `font-weight: 700`, uppercase
  - Sender: `text-base` (14px), `font-weight: 500`, `--text`
  - Date: `text-xs` (11px), `--text-tertiary`, right-aligned
- Subject (if present): `text-base` (14px), `font-weight: 500`, `--text`, `margin-top: 4px`
- Preview: `text-sm` (13px), `--text-secondary`, 2-line clamp, `margin-top: 4px`
- Hover actions (appear on hover): "Reply" / "Open in Messages" + "Copy", `text-xs`, `--accent`, `margin-top: 8px`
- Gap between items: `8px`

**Context Panel** (right side):
- Background: `--bg-subtle`
- Border-left: `1px solid --border`
- Padding: `20px`
- Each section has a `label` title (uppercase, `--text-tertiary`) and `margin-bottom: 20px`
- Related entities: compact rows, avatar (24px) + name + type dot, `text-sm`, clickable
- Topic badges: pills, clickable
- Pending items: compact attention items (no cards, just bullet-style with urgency dot + title)
- Key facts: bulleted list, `text-sm`, `--text-secondary`
- AI chat input: single-line input at bottom, `placeholder: "Ask about [name]..."`, `radius-sm`, `border: 1px solid --border`

### 2.3 Graph Explorer

Full-viewport view accessed via the Graph toggle button or "View in graph" links.

**Structure**:

```
+-- Full Viewport ----------------------------------------+
|                                                          |
|  Graph Controls Bar (floating, top-right)                |
|  [Depth: 1 | 2 | 3]  [Path Finder]  [Reset]  [Full]   |
|                                                          |
|  Cytoscape Canvas (fills viewport)                       |
|                                                          |
|       [Node]---[Node]                                   |
|         |    /                                           |
|       [Center]---[Node]                                 |
|         |    \                                           |
|       [Node]---[Node]                                   |
|                                                          |
|  +-- Floating Detail Card (bottom-right) --------------+|
|  | Entity preview card appears on node click            ||
|  | [Avatar] Name                                        ||
|  | Type badge, last contact                             ||
|  | [Open full page ->]                                  ||
|  +------------------------------------------------------+|
|                                                          |
+----------------------------------------------------------+
```

**Graph Background**: `--bg` with radial gradient `radial-gradient(ellipse at 50% 50%, rgba(124,92,252,0.02) 0%, transparent 70%)`

**Graph Nodes**:
- Shape: circle
- Size: 44px default, 56px selected, 52px root
- Fill: entity type color (the muted palette above)
- No border by default; `2px` border in entity ring color when on active path
- Shadow: entity type glow, `blur: 18px`, `opacity: 0` default, `0.5` on active path, `0.7` on selected
- Label: below node, `text-xs` (10px / 11px selected), `--graph-label` color
- Truncated at 12 characters with ellipsis; full label shown in tooltip on hover
- Badge pill: positioned at top-right, 16px min-width, `radius-full`, entity type color or `--color-action-item` for pending counts, white text at 9px bold

**Graph Edges**:
- Style: curved bezier (`unbundled-bezier`)
- Width: 1px default, 1.5px active
- Color: `--graph-edge` (very subtle, `rgba(0,0,0,0.05)` in light), `--graph-edge-active` for active path
- Dimmed edges: `opacity: 0.08`

**Floating Controls Bar**:
- Position: `top: 16px, right: 16px`, `position: absolute`
- Background: `--surface` with `backdrop-filter: blur(8px)` and `--shadow-sm`
- Border radius: `radius-sm` (8px)
- Padding: `4px`
- Buttons: segmented toggle for depth, icon buttons for Path Finder, Reset, Fullscreen
- Each button: `32px` height, `padding: 0 12px`, `text-xs`, `font-weight: 500`

**Floating Detail Card**:
- Position: `bottom: 16px, right: 16px`, `width: 320px`
- Background: `--surface` with `--shadow-md`
- Border radius: `radius-lg` (16px)
- Padding: `16px`
- Shows: compact entity card (avatar 36px, name, type badge, "84 messages, last 2h ago")
- "Open full page" link: `text-sm`, `--accent`, `font-weight: 500`
- Appears with `fade-in + slide-up` animation (200ms)

### 2.4 Search / Command Palette (Cmd+K)

**Trigger**: `Cmd+K` (or `Ctrl+K` on non-Mac). Also accessible via clicking the search input.

**Structure**:

```
+-- Backdrop (rgba(0,0,0,0.3), blur 8px) ---------------+
|                                                         |
|  +-- Palette Card (520px wide, top 20vh) -------------+|
|  |                                                     ||
|  | [Search icon] [Input: "wang zong"]                  ||
|  |                                                     ||
|  | PEOPLE                                              ||
|  | [avatar] Wang Zong -- CEO, Partner Corp    [Enter]  ||
|  |                                                     ||
|  | TOPICS                                              ||
|  | [dot] Q3 Budget -- 12 messages, last 2h             ||
|  | [dot] Vendor Selection -- 5 messages                ||
|  |                                                     ||
|  | ACTIONS                                             ||
|  | [icon] Search: "wang zong"                          ||
|  | [icon] Ask: "wang zong"                             ||
|  |                                                     ||
|  +-----------------------------------------------------+|
+----------------------------------------------------------+
```

**Palette Card**:
- Width: `520px`, `max-width: 90vw`
- Background: `--surface`
- Border: `1px solid --border`
- Border radius: `radius-2xl` (24px)
- Shadow: `--shadow-md`
- No padding on the card itself; sections handle their own padding

**Input Area**:
- Height: `56px` (generous touch target)
- Padding: `0 20px`
- Border-bottom: `1px solid --border`
- Search icon: `icon-sm` (16px), `--text-tertiary`, left-aligned
- Input: `text-md` (15px), `font-weight: 400`, no border, full width
- Placeholder: `--text-ghost`, "Type a name, question, or command..."

**Results Area**:
- Max height: `360px`, `overflow-y: auto`
- Section headers: `label` (10px uppercase), `--text-tertiary`, `padding: 12px 20px 4px`
- Each result row: `padding: 10px 20px`, `cursor: pointer`
  - Hover: `--surface-hover` background
  - Active/selected (keyboard): `--surface-hover` background + left border `2px solid --accent`
  - Entity avatar or type dot: 24px, left-aligned
  - Name: `text-base` (14px), `font-weight: 500`, `--text`
  - Subtitle: `text-sm` (13px), `--text-secondary`
  - Right hint: `text-xs`, `--text-ghost` (e.g., "Enter" or keyboard shortcut)
- Result types: People (avatar), Topics (colored dot), Documents (file icon), Actions (command icon), Queries (search icon)

**Empty state**: "No results" centered, `text-sm`, `--text-tertiary`

### 2.5 Settings Panel

Slide-out panel from right edge.

- Width: `360px`, `max-width: 90vw`
- Background: `--surface`
- Border-left: `1px solid --border`
- Shadow: `--shadow-lg`
- Slide animation: `translateX(100%) -> translateX(0)`, `300ms ease-out`

**Header**: `padding: 20px`, title "Settings" at `text-lg`, close button (X icon)

**Body sections**:
- Each section: `padding: 0 20px 24px`
- Section title: `label` (10px uppercase), `--text-tertiary`, `margin-bottom: 12px`
- Setting rows: `padding: 10px 0`, `border-bottom: 1px solid --border`, flex between label and value
  - Label: `text-base`, `--text-secondary`
  - Value: `text-base`, `font-weight: 500`, `--text`
- Buttons: `padding: 10px 20px`, `radius-sm`, `border: 1px solid --border`
  - Primary: `--accent` background, white text
  - Default: `--surface-raised` background, `--text`

---

## 3. Component Specifications

### 3.1 Attention Card (Daily Digest)

| Property | Value |
|----------|-------|
| Width | Fill available (min 280px in grid) |
| Padding | 20px |
| Border radius | 20px |
| Background | Entity type card tint |
| Shadow | `--shadow-card` (light only) |
| Urgency dot | 8px circle, top: 20px, left: 20px, urgency color |
| Title | `text-lg` (18px), weight 500, `--text` |
| Context | `text-sm` (13px), `--text-secondary`, margin-top: 4px |
| Actions | Bottom, margin-top: 12px, flex row, gap: 8px |
| Action button | `text-sm`, weight 500, `--text-tertiary`, hover: `--text` |
| Hover | `--shadow-sm`, subtle scale(1.01) |
| Transition | `200ms ease-out` |

### 3.2 Contact Avatar Card (Recent Contacts)

| Property | Value |
|----------|-------|
| Width | 120px |
| Padding | 12px |
| Text align | Center |
| Avatar | 56px circle, entity color bg, white initial letter (text-lg) |
| Name | `text-sm` (13px), weight 500, `--text`, margin-top: 8px, 1-line clamp |
| Preview | `text-xs` (11px), `--text-tertiary`, 1-line clamp |
| Hover | Background `--surface-hover`, radius-lg |
| Cursor | Pointer |

### 3.3 Timeline Item

| Property | Default | Hover |
|----------|---------|-------|
| Padding | 16px | -- |
| Border radius | 12px | -- |
| Background | `--surface-raised` | `--surface-hover` |
| Border | `1px solid --border` | `1px solid --border-strong` |
| Shadow | none | `--shadow-xs` |
| Transform | none | `translateY(-0.5px)` |
| Actions opacity | 0 | 1 |
| Transition | `120ms ease` | -- |

**Channel Badge**: `padding: 3px 8px`, `radius-full`, `text-xs` (11px), weight 700, uppercase, channel color + tint bg
**Sender**: `text-base` (14px), weight 500, `--text`, flex: 1, ellipsis
**Date**: `text-xs` (11px), `--text-tertiary`, tabular-nums
**Subject**: `text-base`, weight 500, `--text`, 1-line clamp
**Preview**: `text-sm` (13px), `--text-secondary`, 2-line clamp
**Action links**: `text-xs` (11px), weight 500, `--accent`, hover: opacity 0.7

### 3.4 Action Button (Attention Actions)

| Property | Default | Hover | Focus-visible |
|----------|---------|-------|--------------|
| Size | 28 x 28px | -- | -- |
| Border radius | 8px | -- | -- |
| Background | transparent | `--surface-active` | -- |
| Border | none | `1px solid --border` | `2px solid --accent`, offset 1px |
| Color | `--text-tertiary` | `--text` | -- |
| Icon size | 14px | -- | -- |
| Transition | `120ms ease` | -- | -- |

Resolve button hover color: `#6B9E8A` (sage green, not neon green)

### 3.5 Stat Card

| Property | Value |
|----------|-------|
| Padding | 20px 16px |
| Border radius | 16px |
| Background | `--surface-raised` |
| Border | `1px solid --border` |
| Shadow | none (hover: `--shadow-sm`) |
| Value | `text-3xl` (36px), weight 700, entity color, tabular-nums |
| Label | `label` (10px), uppercase, `--text-tertiary`, margin-top: 6px |
| Hover | border `--border-strong`, translateY(-1px) |

### 3.6 Channel Badge

| Property | Value |
|----------|-------|
| Padding | 3px 8px |
| Border radius | 9999px |
| Font | 11px / weight 700 / uppercase / letter-spacing 0.06em |
| Line height | 1 |
| Color | Channel color |
| Background | Channel tint |

### 3.7 Topic Badge (Pill)

| Property | Value |
|----------|-------|
| Padding | 4px 12px |
| Border radius | 9999px |
| Font | 11px / weight 600 |
| Color | `--color-topic` |
| Background | Topic tint |
| Clickable variant | Cursor pointer, hover: darken bg 6% |

### 3.8 Entity Avatar

| Sizes | 24px (inline), 36px (compact), 48px (full), 56px (feature) |
|-------|------|
| Shape | Circle (`radius-full`) |
| Background | Entity type color |
| Text | White, centered, Inter weight 700 |
| Text size | 10px (24), 14px (36), 18px (48), 22px (56) |

---

## 4. Interaction Specifications

### 4.1 Click / Tap

| Element | Action |
|---------|--------|
| Attention card | Navigate to related entity in graph or entity page |
| Contact avatar card | Navigate to person entity page |
| Topic card | Navigate to topic entity page |
| Timeline item | No action (expand preview in future) |
| Timeline action "Reply" | Opens `mailto:` link |
| Timeline action "Copy" | Copies body to clipboard, button text changes to "Copied" for 1.2s |
| Attention Dismiss | API call `POST /attention/:id/dismiss`, fade out + remove |
| Attention Resolve | API call `POST /attention/:id/resolve`, fade to 40% opacity |
| Attention Snooze | API call `POST /attention/:id/snooze` (1 day), fade to 40% opacity |
| Graph node | Progressive expansion (see graph.js behavior) |
| Breadcrumb link | Navigate graph to that level, collapse deeper nodes |
| "View in graph" link | Switch to Graph Explorer view centered on that entity |

### 4.2 Hover

| Element | Effect | Timing |
|---------|--------|--------|
| Card (any) | Border darkens to `--border-strong`, subtle shadow appears, translateY(-0.5px) | 120ms |
| Timeline item | Actions row fades in (opacity 0 -> 1) | 120ms |
| Attention item | Action buttons fade in | 120ms |
| Graph node | Glow intensifies (shadow-opacity 0 -> 0.7), node scales to 50px | 300ms |
| Button (any) | Background changes to hover color | 120ms |
| Link | Opacity 0.7 | 120ms |

### 4.3 Focus (keyboard)

All interactive elements must have a visible focus indicator:
- `outline: 2px solid --accent` with `outline-offset: 2px`
- Only visible on `:focus-visible` (not on mouse click)
- Tab order follows visual order (top-to-bottom, left-to-right)

### 4.4 Loading States

| Context | Treatment |
|---------|-----------|
| Page loading | Skeleton cards: `--bg-subtle` rectangles with rounded corners, subtle shimmer animation (gradient sweep left-to-right, 1.5s, infinite) |
| Timeline loading | 3 skeleton timeline items (rectangles for badge, name, date, preview) |
| Graph node expanding | Clicked node pulses (shadow-blur 18 -> 30 -> 18 over 600ms) while API is in flight |
| Command palette search | Shimmer on results area while API returns |
| Attention action | Item fades to 40% opacity immediately (optimistic), removed on API success |

**Skeleton shimmer gradient**: `linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)` animating `background-position` from `-200%` to `200%`.

### 4.5 Empty States

| Context | Content |
|---------|---------|
| No items indexed (first run) | Welcome card: "Welcome to MindFlow" heading, 3-step instructions (init, ingest, explore), warm illustration placeholder |
| No attention items | "All clear. Nothing needs your attention." centered text with checkmark icon, `--text-tertiary` |
| No timeline items | "No messages yet." centered text with clock icon |
| No search results | "No results for '[query]'" with suggestion: "Try a different query or browse entities" |
| Empty context panel section | Section is hidden entirely (don't show "No related entities") |

### 4.6 Error States

| Context | Treatment |
|---------|-----------|
| API unreachable | Toast notification: "Could not connect to server", red-tinted, persistent until resolved |
| Failed to load entity | Inline error: "Could not load data. [Retry]" button, `--color-action-item` accent |
| Attention action failed | Silently revert the optimistic UI (item reappears at full opacity) |
| Search error | "Search failed. Please try again." in results area |

### 4.7 Transitions and Animations

| Animation | Duration | Easing | Description |
|-----------|----------|--------|-------------|
| Card hover | 120ms | ease | Border, shadow, transform changes |
| Panel slide (settings) | 300ms | `cubic-bezier(0.16, 1, 0.3, 1)` | translateX 100% -> 0 |
| Command palette open | 150ms | ease-out | Backdrop fade + card scale(0.98 -> 1) + fade |
| Command palette close | 100ms | ease-in | Reverse |
| Graph node expand | 450ms | `ease-out-cubic` | Position + opacity from parent to ring |
| Graph node collapse | 300ms | `ease-in-cubic` | Reverse, then remove |
| Timeline item appear | 200ms | ease-out | Opacity 0->1 + translateY(4px -> 0) |
| Theme switch | 200ms | ease | Background, text, border color transition |
| Toast slide-in | 250ms | ease | translateX(110% -> 0) |
| Toast slide-out | 200ms | ease | translateX(0 -> 110%) |
| Skeleton shimmer | 1500ms | linear | Infinite, background-position sweep |
| Attention dismiss | 300ms | ease-out | opacity 1 -> 0, then height collapse |

All animations respect `prefers-reduced-motion: reduce` -- when enabled, all durations become 0ms.

---

## 5. Responsive Behavior

### 5.1 Breakpoints

| Name | Width | Layout changes |
|------|-------|----------------|
| Desktop | >= 1024px | Full layout: two-panel entity view, full command palette |
| Tablet | 768px - 1023px | Entity view: context panel collapses to tabs below main content |
| Mobile | < 768px | Single column, full-width cards, bottom sheet for command palette |

### 5.2 Adaptations by Breakpoint

**Desktop (>= 1024px)**:
- All layouts as specified above
- Entity detail: 65/35 split with resizable divider
- Graph: full viewport with floating controls
- Command palette: 520px centered card

**Tablet (768px - 1023px)**:
- Daily Digest: single-column card grid (cards stack vertically if < 600px)
- Entity detail: context panel moves below the main content as collapsible accordion sections
- Graph: same as desktop but floating card is narrower (280px)
- Command palette: same but 90vw width
- Topbar: logo text hidden, only logo mark shown

**Mobile (< 768px)**:
- Daily Digest: single column, cards full width
- Recent contacts: still horizontal scroll but smaller avatars (44px)
- Entity detail: single column, no context panel (replaced by "Related" section at bottom)
- Graph: full screen, floating controls at bottom, detail card is a bottom sheet (slides up from bottom, max 50vh)
- Command palette: full width, slides up from bottom as a sheet
- Topbar: logo mark only, search icon (tap to expand), icon buttons for theme/settings
- Attention actions: always visible (no hover-reveal on touch devices)
- Timeline item actions: always visible
- Touch targets: minimum 44px height

### 5.3 Content Max-Width

The main content area uses `max-width: 720px` with `margin: 0 auto` on the Daily Digest and Entity Detail views. The Graph Explorer is full-viewport (no max-width). This creates a focused, readable column while allowing the graph to use all available space.

---

## 6. Accessibility Requirements

- All text meets WCAG AA contrast ratio (4.5:1 for normal text, 3:1 for large text) in both themes
- All interactive elements have `:focus-visible` outline
- All icon-only buttons have `aria-label`
- All images/icons have `alt` text or `aria-hidden="true"` if decorative
- Command palette and dialogs trap focus
- Escape closes all overlays
- Graph nodes are not keyboard-accessible (the graph is a visual exploration tool; all data is also accessible via the entity pages and search)
- Color is never the only indicator of meaning (urgency uses color + text label)
- `prefers-reduced-motion` disables all animations
- `prefers-color-scheme` sets initial theme if no localStorage preference

---

## 7. Implementation Notes

### 7.1 CSS Custom Properties

All theme-dependent values are CSS custom properties on `[data-theme="light"]` and `[data-theme="dark"]`. Shared values (entity colors, spacing, radii, motion) are on `:root`. Tailwind's theme config extends these properties.

### 7.2 Light Theme is Default

The `data-theme` initialization script checks:
1. `localStorage.getItem('mindflow-theme')` -- explicit user choice
2. `prefers-color-scheme` media query -- system preference
3. Falls back to `'light'` (not dark)

### 7.3 Card Tint Backgrounds

The card tint colors (e.g., `#F0EDF8` for person cards) are the defining visual characteristic. They replace borders as the primary visual separator between cards. In dark theme, tints become `rgba()` overlays on `--surface-raised` to maintain the effect without looking washed out.

### 7.4 The Warm Palette Shift

The entire color system has shifted from the previous tech-dark aesthetic to warm tones. The key difference:
- Backgrounds use cream (`#FAF8F5`) not pure white (`#FFFFFF`)
- Entity colors are muted/desaturated compared to the previous vivid palette
- Shadows are warm and diffuse, never harsh
- The overall feeling should be "premium stationery" not "developer dashboard"
