// ============================================================================
// NavigationStateManager — manages the Focus Swap layer stack
// ============================================================================

export interface LayerEntry {
  parentId: string;
  label: string;
  type: string;
  childNodes: ChildNodeData[];
  /** Unix ms timestamp — used for 30s cache staleness check */
  fetchedAt: number;
  /** Total children available on the server (may exceed childNodes.length if truncated) */
  totalAvailable?: number;
  /** When set, the detail panel shows a cross-ref filtered timeline */
  crossRefEntityId?: string;
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
    return this.layerStack.map((l) => ({
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

  /** Pop layers back to the given index (inclusive). Returns the layer at that index. */
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

  /**
   * Get cached layer at index, or null if stale (older than maxAgeMs).
   * Default cache TTL is 30 seconds.
   */
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
