import { create } from 'zustand';
import type { LayerEntry } from './navigation.js';

// ============================================================================
// Types
// ============================================================================

export type Theme = 'light' | 'dark' | 'system';
export type View = 'digest' | 'entity' | 'graph' | 'search';
export type ActiveTab = 'todo' | 'contacts' | 'topics';

export interface GraphBreadcrumb {
  entityId: string;
  label: string;
}

// ============================================================================
// Store shape
// ============================================================================

interface AppState {
  // Theme
  theme: Theme;
  setTheme: (theme: Theme) => void;

  // Active view (mirrors the router but useful for cross-view coordination)
  view: View;
  setView: (view: View) => void;

  // Active tab in the main UI sidebar
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;

  // Per-tab layer stacks (preserves drill-in state when switching tabs)
  tabLayerStacks: Record<ActiveTab, LayerEntry[]>;
  setTabLayerStack: (tab: ActiveTab, stack: LayerEntry[]) => void;

  // Selected node in the current org chart layer
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;

  // Entity shown in the floating detail card
  detailCardEntityId: string | null;
  setDetailCardEntityId: (id: string | null) => void;

  // Selected entity (shared across views — clicking entity anywhere sets this)
  selectedEntityId: string | null;
  setSelectedEntityId: (id: string | null) => void;

  // Graph breadcrumb trail
  graphBreadcrumbs: GraphBreadcrumb[];
  pushBreadcrumb: (crumb: GraphBreadcrumb) => void;
  popBreadcrumb: () => void;
  resetBreadcrumbs: (root?: GraphBreadcrumb) => void;

  // Command palette
  commandPaletteOpen: boolean;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;

  // Settings panel
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;

  // Search query (synced with URL but also kept in store for cross-view)
  searchQuery: string;
  setSearchQuery: (q: string) => void;
}

// ============================================================================
// Store implementation
// ============================================================================

export const useAppStore = create<AppState>((set) => ({
  // Theme
  theme: 'system',
  setTheme: (theme) => {
    set({ theme });
    applyTheme(theme);
  },

  // View
  view: 'digest',
  setView: (view) => set({ view }),

  // Active tab
  activeTab: 'topics',
  setActiveTab: (tab) => set({ activeTab: tab }),

  // Per-tab layer stacks
  tabLayerStacks: { todo: [], contacts: [], topics: [] },
  setTabLayerStack: (tab, stack) =>
    set((s) => ({ tabLayerStacks: { ...s.tabLayerStacks, [tab]: stack } })),

  // Selected node
  selectedNodeId: null,
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),

  // Detail card entity
  detailCardEntityId: null,
  setDetailCardEntityId: (id) => set({ detailCardEntityId: id }),

  // Selected entity
  selectedEntityId: null,
  setSelectedEntityId: (id) => set({ selectedEntityId: id }),

  // Breadcrumbs
  graphBreadcrumbs: [],
  pushBreadcrumb: (crumb) =>
    set((s) => ({ graphBreadcrumbs: [...s.graphBreadcrumbs, crumb] })),
  popBreadcrumb: () =>
    set((s) => ({ graphBreadcrumbs: s.graphBreadcrumbs.slice(0, -1) })),
  resetBreadcrumbs: (root) =>
    set({ graphBreadcrumbs: root ? [root] : [] }),

  // Command palette
  commandPaletteOpen: false,
  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),

  // Settings
  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),

  // Search
  searchQuery: '',
  setSearchQuery: (q) => set({ searchQuery: q }),
}));

// ============================================================================
// Theme helpers
// ============================================================================

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', theme);
  }
}

/** Resolved theme — 'light' or 'dark' — accounting for system preference. */
export function resolvedTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
