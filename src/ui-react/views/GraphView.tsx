import { useRef, useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAppStore } from '../lib/store.js';
import { resolvedTheme } from '../lib/store.js';
import { CytoscapeGraph } from '../components/CytoscapeGraph.js';
import type { CytoscapeGraphHandle, GraphNodeData } from '../components/CytoscapeGraph.js';
import { FloatingDetailCard } from '../components/FloatingDetailCard.js';
import { GraphControls } from '../components/GraphControls.js';
import { Breadcrumb } from '../components/Breadcrumb.js';
import { api } from '../lib/api.js';

// ----------------------------------------------------------------------------
// Path finder status banner — shown during Find Path mode
// ----------------------------------------------------------------------------

type PathFinderStep = 'pick-first' | 'pick-second' | 'loading' | 'done' | 'error';

interface PathFinderBannerProps {
  step: PathFinderStep;
  firstName: string | null;
  secondName: string | null;
  pathLength: number | null;
  error: string | null;
  onCancel: () => void;
}

function PathFinderBanner({ step, firstName, secondName, pathLength, error, onCancel }: PathFinderBannerProps) {
  let message: string;
  if (step === 'pick-first')  message = 'Click a node to select the start entity';
  else if (step === 'pick-second') message = `Start: ${firstName ?? ''}  —  Click a node to select the end entity`;
  else if (step === 'loading') message = `Finding path from ${firstName ?? ''} to ${secondName ?? ''}…`;
  else if (step === 'done')   message = `Path found: ${firstName ?? ''} → ${secondName ?? ''} (${pathLength ?? 0} hop${pathLength === 1 ? '' : 's'})`;
  else message = error ?? 'No path found';

  const isError = step === 'error';

  return (
    <div
      style={{
        position:   'absolute',
        bottom:     16,
        left:       '50%',
        transform:  'translateX(-50%)',
        display:    'flex',
        alignItems: 'center',
        gap:        10,
        padding:    '8px 14px',
        background: isError ? 'rgba(196,122,122,0.12)' : 'rgba(139,126,200,0.10)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        border:     `1px solid ${isError ? 'rgba(196,122,122,0.3)' : 'rgba(139,126,200,0.3)'}`,
        borderRadius: 8,
        zIndex:     30,
        fontSize:   12,
        fontFamily: 'Inter, system-ui, sans-serif',
        color:      isError ? '#C47A7A' : '#8B7EC8',
        fontWeight: 500,
        maxWidth:   '80vw',
        whiteSpace: 'nowrap',
        overflow:   'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {step === 'loading' && (
        <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite', fontSize: 14 }}>⟳</span>
      )}
      <span>{message}</span>
      <button
        onClick={onCancel}
        style={{
          marginLeft: 4,
          background: 'none',
          border:     'none',
          cursor:     'pointer',
          color:      'inherit',
          fontSize:   13,
          lineHeight: 1,
          padding:    '0 2px',
          opacity:    0.7,
        }}
        title="Cancel path finder"
      >
        ✕
      </button>
    </div>
  );
}

// ----------------------------------------------------------------------------
// GraphView — full-viewport graph explorer
// ----------------------------------------------------------------------------

export function GraphView() {
  const { entityId: routeEntityId } = useParams<{ entityId?: string }>();
  const navigate = useNavigate();
  const { theme } = useAppStore();
  const isDark = resolvedTheme(theme) === 'dark';

  const graphRef = useRef<CytoscapeGraphHandle>(null);

  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedMessageNode, setSelectedMessageNode] = useState<GraphNodeData | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<Array<{ id: string; label: string; type: string }>>([]);

  // Find Path mode state
  const [findPathActive, setFindPathActive] = useState(false);
  const [pathStep, setPathStep] = useState<PathFinderStep>('pick-first');
  const [pathFirst, setPathFirst] = useState<{ id: string; label: string } | null>(null);
  const [pathSecond, setPathSecond] = useState<{ id: string; label: string } | null>(null);
  const [pathLength, setPathLength] = useState<number | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);

  // --------------------------------------------------------------------------
  // Load graph on mount (and when route entity changes)
  // --------------------------------------------------------------------------

  useEffect(() => {
    if (!graphRef.current) return;

    void graphRef.current.loadRoot().then(() => {
      // If routed to a specific entity, drill down after root loads
      if (routeEntityId) {
        void graphRef.current?.drillDown(routeEntityId, 'person', routeEntityId);
      }
    });
  }, [routeEntityId]);

  // --------------------------------------------------------------------------
  // Cancel Find Path — resets all path state and clears highlights
  // --------------------------------------------------------------------------

  const cancelFindPath = useCallback(() => {
    setFindPathActive(false);
    setPathStep('pick-first');
    setPathFirst(null);
    setPathSecond(null);
    setPathLength(null);
    setPathError(null);
    graphRef.current?.clearPathHighlight();
  }, []);

  // --------------------------------------------------------------------------
  // Node selection callback
  // --------------------------------------------------------------------------

  const handleNodeSelect = useCallback((data: GraphNodeData | null) => {
    if (!data) {
      setSelectedEntityId(null);
      setSelectedMessageNode(null);
      return;
    }

    // Cross-reference message leaf nodes — show message card (not usable as path endpoints)
    if (data.id.startsWith('xref-msg-')) {
      setSelectedEntityId(null);
      setSelectedMessageNode(data);
      return;
    }

    setSelectedMessageNode(null);

    // Skip root / category / structural nodes for path finding
    const isStructural = data.id === 'root' || data.type === 'category' || data.type === 'root';

    // ---------- Find Path mode ------------------------------------------------
    if (findPathActive && !isStructural) {
      if (pathStep === 'pick-first') {
        setPathFirst({ id: data.id, label: (data.fullLabel ?? data.label) as string });
        setPathStep('pick-second');
        return;
      }

      if (pathStep === 'pick-second' && pathFirst) {
        const second = { id: data.id, label: (data.fullLabel ?? data.label) as string };
        setPathSecond(second);
        setPathStep('loading');

        void (async () => {
          try {
            const result = await api.getShortestPath(pathFirst.id, second.id);
            const nodeIds = result.nodes.map((n) => n.id);
            const edgeIds = result.edges.map((e) => e.id);
            graphRef.current?.highlightPath(nodeIds, edgeIds);
            setPathLength(result.pathLength);
            setPathStep('done');
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'No path found';
            setPathError(msg);
            setPathStep('error');
          }
        })();
        return;
      }

      // In loading/done/error state, clicks restart selection
      if (pathStep === 'done' || pathStep === 'error') {
        graphRef.current?.clearPathHighlight();
        setPathFirst({ id: data.id, label: (data.fullLabel ?? data.label) as string });
        setPathSecond(null);
        setPathLength(null);
        setPathError(null);
        setPathStep('pick-second');
      }
      return;
    }
    // -------------------------------------------------------------------------

    // Normal selection
    if (isStructural) {
      setSelectedEntityId(null);
    } else {
      setSelectedEntityId(data.id);
    }
  }, [findPathActive, pathStep, pathFirst]);

  // --------------------------------------------------------------------------
  // Breadcrumb navigation
  // --------------------------------------------------------------------------

  const handleNavigateBack = useCallback((index: number) => {
    graphRef.current?.navigateBack(index);
  }, []);

  // --------------------------------------------------------------------------
  // Controls
  // --------------------------------------------------------------------------

  const handleZoomIn  = useCallback(() => graphRef.current?.zoomIn(), []);
  const handleZoomOut = useCallback(() => graphRef.current?.zoomOut(), []);
  const handleFit     = useCallback(() => graphRef.current?.fitView(), []);
  const handleReset   = useCallback(() => {
    cancelFindPath();
    setSelectedEntityId(null);
    void graphRef.current?.loadRoot();
  }, [cancelFindPath]);

  const handleFindPath = useCallback(() => {
    if (findPathActive) {
      cancelFindPath();
    } else {
      setFindPathActive(true);
      setPathStep('pick-first');
      setPathFirst(null);
      setPathSecond(null);
      setPathLength(null);
      setPathError(null);
      graphRef.current?.clearPathHighlight();
      // Hide the entity detail card while in path-finder mode
      setSelectedEntityId(null);
      setSelectedMessageNode(null);
    }
  }, [findPathActive, cancelFindPath]);

  // --------------------------------------------------------------------------
  // Keyboard shortcuts
  // --------------------------------------------------------------------------

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore when focus is inside any input/textarea/select/contenteditable
      const tag = (document.activeElement as HTMLElement | null)?.tagName ?? '';
      const isEditable =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
        (document.activeElement as HTMLElement | null)?.isContentEditable;
      if (isEditable) return;

      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        handleFindPath();
      } else if (e.key === 'Escape' && findPathActive) {
        e.preventDefault();
        cancelFindPath();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [findPathActive, handleFindPath, cancelFindPath]);

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  return (
    <div
      style={{
        position: 'relative',
        flex:     1,
        width:    '100%',
        overflow: 'hidden',
      }}
    >
      {/* Cytoscape canvas — fills entire space */}
      <CytoscapeGraph
        ref={graphRef}
        isDark={isDark}
        onNodeSelect={handleNodeSelect}
        onBreadcrumbsChange={setBreadcrumbs}
      />

      {/* Breadcrumb trail — top-left */}
      <Breadcrumb
        crumbs={breadcrumbs}
        onNavigate={handleNavigateBack}
      />

      {/* Floating controls — top-right */}
      <GraphControls
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFit={handleFit}
        onReset={handleReset}
        onFindPath={handleFindPath}
        findPathActive={findPathActive}
      />

      {/* Path finder status banner — shown during Find Path mode */}
      {findPathActive && (
        <PathFinderBanner
          step={pathStep}
          firstName={pathFirst?.label ?? null}
          secondName={pathSecond?.label ?? null}
          pathLength={pathLength}
          error={pathError}
          onCancel={cancelFindPath}
        />
      )}

      {/* Floating detail card — bottom-right (hidden during path finder mode) */}
      {!findPathActive && (
        <FloatingDetailCard entityId={selectedEntityId} messageNode={selectedMessageNode} />
      )}
    </div>
  );
}
