import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import { DECISION_CONFLICT_EDGE_TYPE, DECISION_CONTRADICTION_CLASS } from '../core/decisionStyles';
import DecisionEffects from './effects/DecisionEffects';
import CytoscapeCanvas from './CytoscapeCanvas';
import Toolbar from './Toolbar';
import FilterPanel from './FilterPanel';
import DetailPanel from './DetailPanel';
import SearchBar from './SearchBar';
import TimeTravelSlider from './TimeTravelSlider';
import OperationsBar from './OperationsBar';
import ReplayButton from './ReplayButton';
import OriginLegend from './OriginLegend';
import { useCytoscape } from '../internal/useCytoscape';
import { useDaemonCapabilities } from '../hooks/useDaemonCapabilities';
import { useExplorerFocus } from '../hooks/useExplorerFocus';
import { useGraphData } from '../hooks/useGraphData';
import { useGraphFilters } from '../hooks/useGraphFilters';
import { useGraphStream } from '../hooks/useGraphStream';
import { useDripFeed } from '../hooks/useDripFeed';
import { useGraphInteraction } from '../hooks/useGraphInteraction';
import { useMultiHopReplay } from '../hooks/useMultiHopReplay';
import { useUrlState } from '../hooks/useUrlState';
import { graphNodeToCyElement, graphEdgeToCyElement } from '../internal/cytoscapeConvert';
import { classifyGraphKey, describeDeletion, isEditableTarget } from '../core/graphKeyboard';

/**
 * Main graph explorer component.
 * Orchestrates data fetching, streaming, filtering, and interaction hooks.
 *
 * @param {Object} props
 * @param {{hash: string}} [props.focusRequest] - An explicit selection in the current view.
 * @param {GraphAPIAdapter} props.adapter - API adapter for data fetching
 * @param {{ nodes: GraphNode[], edges: GraphEdge[] }} [props.data] - External data (controlled mode)
 * @param {boolean} [props.decisionEffectsLoading=false] - Show the outstanding effects read.
 * @param {boolean} [props.enableDecisionEffects=false] - Display the controlled decision-effects view.
 * @param {import('./effects/types').EffectsPresentation} [props.decisionEffects] - Effects for the supplied data.
 * @param {import('./effects/types').EffectsActions} [props.decisionEffectsActions] - Host callbacks for draft and focus changes.
 * @param {GraphAnnotations} [props.annotations] - Annotation overlay.
 *   Shape: { nodes: Record<id, {kind, value}[]>, edges: Record<id, {kind, value}[]>,
 *            activeKinds: string[], precedence?: string[] }
 * @param {string} [props.wsToken] - DEPRECATED alias for sseToken. There is no
 *   WebSocket transport any more (PLAT-PUSH-SSE-1); this only survives because
 *   smart-memory-studio still passes it
 *   (web/src/components/shared/containers/AdaptiveResultsContainer.jsx). Pass
 *   sseToken instead — this alias goes away once studio migrates.
 * @param {string} [props.sseBaseUrl] - SmartMemory API base URL for SSE progress stream
 * @param {Object} [props.auth] - SDK AuthCore for live credentials and session recovery
 * @param {string} [props.workspaceId] - Recreate the subscription when scope changes
 * @param {string} [props.sseToken] - Bearer JWT for SSE auth
 * @param {boolean} [props.enableTimeTravel=false] - Show the Time button and slider (and honour a past time in the URL).
 *   Hidden by default until time travel is fully built.
 * @param {boolean} [props.showPlaybackBar=false] - Show the bottom live-feed bar (status, pause, speed, ticker, Replay).
 *   Hidden by default. The detail panel's "Replay hops" does not use this bar.
 * @param {boolean} [props.enableEntityEditing=false] - Detail panel: change entity type, rename, remove grounding.
 *   Hidden by default (the local Lite server has no write routes for them).
 * @param {boolean} [props.enableGrounding=false] - Detail panel "Ground" (Wikipedia picker). Hidden by default:
 *   Accept does not save anywhere yet.
 * @param {boolean} [props.enableDecisionTools=false] - Decision block "Find conflicts" and "Load provenance".
 *   Hidden by default (the local Lite server has no routes for them).
 * @param {boolean} [props.enableSvgExport=false] - Export > SVG. Hidden by default: needs the cytoscape-svg plugin.
 * @param {string} [props.replayRunId] - When set, replays a specific run (passes runId+fromSeq:0)
 * @param {Object} [props.clock] - Optional shared replay clock from useReplayClock().
 *   When provided, GraphExplorer consumes events released by the clock instead
 *   of opening its own SSE subscription. Used by Run Inspector to lockstep the
 *   graph view with <PipelineDag> on a single playhead. (VIS-PIPELINE-DAG-1 Phase 4)
 * @param {import('react').ReactNode} [props.toolbarRightActions] - Extra controls rendered at toolbar right side
 * @param {Array<Array<string>>} [props.hopGroups] - Precomputed retrieval-hop groups
 *   (index = hop number, value = node ids) driving the hop reveal animation.
 *   GRAPH-MULTIHOP-VIZ-1: produce these with `groupByRetrievalHop(results)` and gate
 *   on `shouldEnterRetrievalReplay(results)` — pass an empty array to render the set
 *   all at once instead. Independent of the BFS replay reachable from DetailPanel.
 * @param {any} [props.autoReplayKey] - Changing this value replays `hopGroups` from
 *   the start. Pass a per-search stamp so a re-run of the same query animates again.
 * @param {boolean} [props.hideSelectionToolbar] - Hides the Move/Isolate/Delete toolbar AND
 *   disables keyboard Delete/Backspace deletion: the host opts out of destructive graph actions.
 * @param {string} [props.className] - Additional CSS classes
 * @param {*} [props.refreshSignal] - Change it to refetch the graph in the background (no
 *   loading flash, the canvas is diff-merged in place). Hosts bump it on window focus, on a
 *   visible-tab interval and after their own writes (UI-REFRESH-1).
 * @param {'dark'|'light'} [props.mode='dark'] - The host's resolved colour mode (the design-system
 *   kit's `useColorMode()`). Drives the canvas label, outline, edge and selection colours; styles
 *   are rebuilt in place when it changes (no re-layout). Default dark leaves existing consumers
 *   unchanged until they opt in. An explicit `theme.mode` wins over this prop.
 * @param {Object} [props.theme] - Optional consumer-scoped canvas theme.
 *   When omitted, the default dark semantic palette is used (web/studio/insights).
 *   Applies to nodes/edges only — surrounding chrome stays under consumer CSS.
 *   Annotation overlays (search match, contradictions) keep their signal colors
 *   regardless of theme.
 * @param {'dark'|'light'} [props.theme.mode] - Mode-default label/outline/selection
 *   colors when no explicit palette override is provided.
 * @param {Object} [props.theme.palette] - Direct color overrides. Each field
 *   accepts any CSS color (hex, rgb(), named). Use this to mirror a host
 *   application's theme variables (e.g. Obsidian `--graph-node`, `--graph-line`,
 *   `--graph-text`) — the canvas updates live via the workspace `css-change`
 *   event when the consumer re-renders with new values.
 * @param {string} [props.theme.palette.node] - Single fill replacing the
 *   per-type memory/entity/grounding palette (size differentiation preserved).
 * @param {string} [props.readOnlyReason] - Explain unavailable actions on a data-only graph.
 * @param {string} [props.theme.palette.edge] - Edge line + edge label color.
 * @param {string} [props.theme.palette.label] - Node label text color.
 * @param {string} [props.theme.palette.labelOutline] - Node label outline color.
 * @param {string} [props.theme.palette.selectionBorder] - Selected-element border.
 */
export default function GraphExplorer({ enableDecisionEffects = false, decisionEffects, decisionEffectsActions, decisionEffectsLoading = false, ...props }) {
  if (enableDecisionEffects) {
    if (decisionEffectsLoading) return <p role="status">Loading decision effects…</p>;
    if (!props.data || !decisionEffects) return <p role="status">Decision effects unavailable.</p>;
    return <DecisionEffects key={JSON.stringify([props.workspaceId, decisionEffects.focus, decisionEffects.phase, decisionEffects.today, decisionEffects.revision])}
      theme={props.theme} mode={props.mode} data={props.data} effects={decisionEffects} actions={decisionEffectsActions} className={props.className} />;
  }
  return <WorkspaceGraph {...props} />;
}

function WorkspaceGraph({
  adapter,
  data: externalData,
  readOnlyReason,
  annotations,
  wsToken,
  sseBaseUrl,
  sseToken,
  auth,
  workspaceId,
  replayRunId,
  clock = null,
  toolbarRightActions,
  hopGroups = null,
  autoReplayKey = null,
  showOriginLegend = true,
  hideSelectionToolbar = false,
  enableTimeTravel = false,
  showPlaybackBar = false,
  enableEntityEditing = false,
  enableGrounding = false,
  enableDecisionTools = false,
  enableSvgExport = false,
  className = '',
  onNodeOpen,
  theme = null,
  mode = 'dark',
  refreshSignal,
  focusRequest,
  active: attached = true,
  documentVisible = true,
  keepView = false,
}) {
  // Data: controlled (data only), uncontrolled (adapter only), or hybrid (both).
  // Hybrid mode: adapter powers refresh/reconnect, external data merges as overlay.
  const controlledReason = !adapter && readOnlyReason;
  const { daemon, capabilities, error: capabilityError } = useDaemonCapabilities(adapter);
  const active = attached && documentVisible;
  const internalData = useGraphData(adapter || null, { refreshSignal, active: attached });
  const externalNodes = externalData?.nodes || [];
  const externalEdges = externalData?.edges || [];
  const hasExternal = externalNodes.length > 0 || externalEdges.length > 0;

  // Memoize merged data to prevent layout thrash from unrelated re-renders.
  // In hybrid mode, merged arrays were previously rebuilt every render, causing
  // the setElements+layout effect to fire on every WS/stream/ops update.
  const { nodes, edges, loading, error, stats, refresh, incrementStats } = useMemo(() => {
    if (adapter) {
      const _refresh = internalData.refresh;
      const _incrementStats = internalData.incrementStats;
      const _error = internalData.error;

      if (hasExternal) {
        const seenNodeIds = new Set();
        const mergedNodes = [];
        for (const n of [...externalNodes, ...(internalData.nodes || [])]) {
          if (!seenNodeIds.has(n.id)) { seenNodeIds.add(n.id); mergedNodes.push(n); }
        }
        const seenEdgeIds = new Set();
        const mergedEdges = [];
        for (const e of [...externalEdges, ...(internalData.edges || [])]) {
          if (!seenEdgeIds.has(e.id)) { seenEdgeIds.add(e.id); mergedEdges.push(e); }
        }
        return {
          nodes: mergedNodes,
          edges: mergedEdges,
          loading: false,
          error: _error,
          stats: { nodes: mergedNodes.length, edges: mergedEdges.length, types: internalData.stats?.types || {} },
          refresh: _refresh,
          incrementStats: _incrementStats,
        };
      }
      return {
        nodes: internalData.nodes,
        edges: internalData.edges,
        loading: internalData.loading,
        error: _error,
        stats: internalData.stats,
        refresh: _refresh,
        incrementStats: _incrementStats,
      };
    }
    // Pure controlled mode
    const _nodes = externalNodes;
    const _edges = externalEdges;
    return {
      nodes: _nodes,
      edges: _edges,
      loading: false,
      error: null,
      stats: { nodes: _nodes.length, edges: _edges.length, types: {} },
      refresh: () => {},
      incrementStats: () => {},
    };
  }, [
    adapter, hasExternal, externalNodes, externalEdges,
    internalData.nodes, internalData.edges, internalData.loading,
    internalData.error, internalData.stats, internalData.refresh, internalData.incrementStats,
  ]);

  const [filterSnapshot, setFilterSnapshot] = useState(null);
  const filters = useGraphFilters(filterSnapshot?.nodes ?? nodes, filterSnapshot?.edges ?? edges, workspaceId);

  const typeCounts = useMemo(() => {
    const counts = {};
    for (const node of (nodes || [])) {
      const t = node.type;
      if (t) counts[t] = (counts[t] || 0) + 1;
    }
    for (const edge of (edges || [])) {
      const t = edge.type;
      if (t) counts[t] = (counts[t] || 0) + 1;
    }
    return counts;
  }, [nodes, edges]);

  const containerRef = useRef(null);
  const rootRef = useRef(null);
  const cytoscape = useCytoscape(containerRef, { theme, mode, keepView });
  // Cytoscape skips drawing and its per-frame renderer callbacks inside a batch.
  // Keep the canvas pixels and model intact until the host attaches its slot again.
  useLayoutEffect(() => {
    const cy = cytoscape.cy.current;
    if (active || !cy) return;
    cy.startBatch();
    return () => { if (!cy.destroyed()) cy.endBatch(); };
  }, [active, cytoscape.cy, cytoscape.ready]);
  const { urlState, saveToUrl, getShareableUrl, clearHistoricalUrl } = useUrlState(focusRequest);
  const restoredView = useRef(null);

  const [contradictionOverlay, setContradictionOverlay] = useState(false);
  const [filterPanelOpen, setFilterPanelOpen] = useState(true);
  const [originLegendOpen, setOriginLegendOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Sync isFullscreen state when user exits via Esc or browser chrome
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      rootRef.current?.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }, []);

  // Current pipeline stage indicator (live + replay)
  const [currentStage, setCurrentStage] = useState(null);
  const stageDismissRef = useRef(null);
  const handleStageChange = useCallback(({ stage, durationMs }) => {
    if (!stage) return;
    setCurrentStage({ name: stage, durationMs: durationMs ?? null });
    if (stageDismissRef.current) clearTimeout(stageDismissRef.current);
    stageDismissRef.current = setTimeout(() => setCurrentStage(null), 2000);
  }, []);

  // Refs to break forward-reference between stream ↔ dripFeed
  const dripFeedRef = useRef(null);
  const streamRef = useRef(null);

  // Replay not available state: set when 404 + no IDB recording found
  const [replayNotAvailable, setReplayNotAvailable] = useState(false);

  // Streaming — SSE only. `wsUrl` is gone (it was declared and never read);
  // `wsToken` remains a deprecated alias for `sseToken` for the one caller
  // that still passes it. PLAT-PUSH-SSE-1.
  // VIS-PIPELINE-DAG-1 Phase 4: when a `clock` prop is provided, the clock owns SSE
  // and we consume events released through it — but useGraphStream still needs `enabled`
  // to be true so the clock-driven path actually runs.
  const effectiveSseBase = sseBaseUrl || '';
  const effectiveSseToken = sseToken || wsToken;
  const sseEnabled = !!(auth || sseBaseUrl || sseToken || replayRunId || clock);

  const historicalRef = useRef(false);
  const stream = useGraphStream({
    sseBaseUrl: effectiveSseBase,
    token: effectiveSseToken,
    auth,
    workspaceId,
    enabled: active && sseEnabled,
    runId: replayRunId,
    clock,
    // VIS-PIPELINE-DAG-1 Phase 4 (Codex Round 1 MUST FIX 3):
    // In clock-driven mode, bypass the drip-feed and apply elements directly
    // to Cytoscape. The clock is already pacing events at original_ts; the
    // drip-feed adds a second pacing layer with its own setTimeout queue
    // that does NOT pause when the clock pauses, breaking lockstep pause.
    onElementAdded: (el) => {
      if (historicalRef.current) return;
      if (clock) {
        const cy = cytoscape.cy?.current;
        if (!cy) return;
        try {
          const cyEl = 'source' in el ? graphEdgeToCyElement(el) : graphNodeToCyElement(el);
          const existing = cy.getElementById(cyEl.data.id);
          if (existing.length) existing.data(cyEl.data);
          else cy.add(cyEl);
        } catch (_) { /* element exists or transient */ }
        return;
      }
      dripFeedRef.current?.enqueue(el);
    },
    onElementRemoved: ({ nodeIds = [], edgeIds = [], edges = [] }) => {
      if (historicalRef.current) return;
      const cy = cytoscape.cy?.current;
      dripFeedRef.current?.removeElements?.({ nodeIds, edgeIds, edges });
      if (!cy) return;
      if (nodeIds.length) {
        cytoscape.removeNodes(nodeIds);
      }
      if (!edgeIds.length && !edges.length) return;
      cy.batch(() => {
        edgeIds.forEach((id) => {
          const edge = cy.getElementById(id);
          if (edge.length) edge.remove();
        });
        edges.forEach(({ edgeId, sourceId, targetId, edgeType }) => {
          if (edgeId) {
            const edge = cy.getElementById(edgeId);
            if (edge.length) edge.remove();
            return;
          }
          if (!sourceId && !targetId && !edgeType) return;
          cy.edges().filter((edge) => {
            if (sourceId && edge.source().id() !== sourceId) return false;
            if (targetId && edge.target().id() !== targetId) return false;
            if (edgeType && edge.data('type') !== edgeType && edge.data('edge_type') !== edgeType) return false;
            return true;
          }).remove();
        });
      });
    },
    onSearchHighlight: (ids) => { if (!historicalRef.current) cytoscape.highlightElements(ids); },
    onGroundingFlash: (nodeId) => {
      if (historicalRef.current) return;
      const cy = cytoscape.cy?.current;
      if (!cy) return;
      const node = cy.getElementById(nodeId);
      if (node && node.length) {
        node.addClass('grounding-flash');
        setTimeout(() => node.removeClass('grounding-flash'), 2500);
      }
    },
    onPipelineProgress: handleStageChange,
    onGraphCleared: () => {
      if (historicalRef.current) {
        refresh();
        return;
      }
      dripFeedRef.current?.resetDrip();
      streamRef.current?.clearOperations();
      // VIS-PIPELINE-DAG-1 Phase 4 (Codex Round 1 MUST FIX 2):
      // In clock-driven replay mode, do NOT refetch the live graph — that
      // would replace the playhead's slice with current global state and
      // leave future nodes visible after seek-backward. Wipe the canvas
      // and let the clock re-emit events from the new playhead position.
      if (clock) {
        try {
          cytoscape.cy?.current?.elements()?.remove();
        } catch (_) { /* no canvas yet */ }
        return;
      }
      refresh();
    },
    onReconnect: () => refresh(),
    onReplayNotFound: (idbRecording) => {
      if (idbRecording) {
        // IDB fallback available — replay from the local recording
        if (!historicalRef.current) dripFeedRef.current?.replayRecording(idbRecording);
      } else {
        // No IDB recording either — surface "recording not available"
        setReplayNotAvailable(true);
      }
    },
  });
  streamRef.current = stream;

  // Drip-feed animation
  const interaction = useGraphInteraction({
    cytoscape,
    adapter,
    stream,
    filters,
    urlState,
    enableTimeTravel,
    data: { nodes, edges },
    refresh,
    getShareableUrl,
    saveToUrl,
    onNodeOpen,
    manageCanvas: false,
    temporalUnavailable: daemon,
  });
  const { snapshot, asOfTime, handleTimeTravel } = interaction;
  historicalRef.current = !!snapshot;
  const temporalHandler = useRef(handleTimeTravel);
  temporalHandler.current = handleTimeTravel;
  const lastTimeHash = useRef(null);
  useEffect(() => {
    if (urlState.focusOnly) return;
    // A past time in the URL is honoured only when the host enables time travel (UI-HIDE-TIME-SLIDER-1).
    if (urlState.asOfTime && enableTimeTravel) {
      interaction.setTimeTravelOpen(!!adapter?.getTemporalSnapshot && !daemon);
      temporalHandler.current(urlState.asOfTime);
    } else if (lastTimeHash.current) {
      interaction.setTimeTravelOpen(false);
      temporalHandler.current(null);
    }
    lastTimeHash.current = urlState;
  }, [urlState, daemon, adapter?.getTemporalSnapshot, interaction.setTimeTravelOpen]);

  const multiHop = useMultiHopReplay({
    cytoscape,
    graphData: { nodes, edges },
  });

  // Retrieval-hop replay (GRAPH-MULTIHOP-VIZ-1 G3).
  // Held in a ref so the autoplay effect below depends only on `autoReplayKey` —
  // the caller rebuilds `hopGroups` on every render, and depending on the array
  // itself would restart the animation mid-flight on any unrelated re-render.
  const hopGroupsRef = useRef(hopGroups);
  hopGroupsRef.current = hopGroups;

  const hasHopGroups = Array.isArray(hopGroups) && hopGroups.length > 0;
  const { startRetrievalReplay, cancelReplay } = multiHop;

  // No stopReplay() first: it would start a 350ms restore-to-opacity-1 animation
  // that races the new run's dim-to-0.08. The replay driver already stops in-flight
  // animations, clears its own timers, and resets leftover styles before dimming.
  const replayHopGroups = useCallback(() => {
    const groups = hopGroupsRef.current;
    if (!Array.isArray(groups) || groups.length === 0) return;
    startRetrievalReplay(groups);
  }, [startRetrievalReplay]);

  // A running replay is animating elements that a data change is about to replace.
  // Nothing else cancels it: the merge below swaps the canvas contents while the old
  // run's timers keep firing — recolouring any ids the two sets share and driving the
  // hop indicator for a search that is no longer on screen. If the new set never
  // starts a replay of its own (a hop-0-only search), the old one runs to completion
  // over it. Cancel on the data identity, not on a render.
  useEffect(() => {
    cancelReplay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  // Autoplay once the canvas actually holds the elements. `cytoscape.ready` alone
  // is not enough: the setElements/merge effect below runs on the same commit, so
  // firing here would dim and reveal an empty canvas. The delay lets the merge and
  // its layout land first.
  useEffect(() => {
    if (autoReplayKey == null || snapshot) return;
    if (!cytoscape.ready) return;
    if (!hasHopGroups) return;
    if (!nodes.length) return;
    const timer = setTimeout(replayHopGroups, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, autoReplayKey, cytoscape.ready, hasHopGroups, nodes.length]);

  // Wire node click/dblclick handlers to Cytoscape events
  useEffect(() => {
    cytoscape.setOnNodeClick(interaction.handleNodeClick);
    cytoscape.setOnNodeDblClick(interaction.handleNodeDblClick);
  }, [cytoscape, interaction.handleNodeClick, interaction.handleNodeDblClick]);

  const dripFeed = useDripFeed({
    cytoscape,
    filters,
    incrementStats,
    layout: interaction.layout,
    keepView,
    stream,
    onGroundingFlash: (nodeId) => {
      if (historicalRef.current) return;
      const cy = cytoscape.cy?.current;
      if (!cy) return;
      const node = cy.getElementById(nodeId);
      if (node?.length) {
        node.addClass('grounded'); // permanent — node now has Wikipedia provenance
        node.data('grounded', true); // data backup for node[grounded] selector
        node.addClass('grounding-flash');
        setTimeout(() => node.removeClass('grounding-flash'), 2500);
      }
    },
    onStageChange: handleStageChange,
  });
  dripFeedRef.current = dripFeed;
  useEffect(() => {
    if (!active) dripFeed.resetDrip();
  }, [active, dripFeed.resetDrip]);

  const mergedData = useRef(null);
  const wasHistorical = useRef(false);
  const snapshotInCanvas = useRef(null);

  // Convert GraphNode/GraphEdge → Cytoscape elements and load into cy
  useEffect(() => {
    if (!active || !cytoscape.ready) return;
    const pendingView = restoredView.current !== urlState && Object.keys(urlState).length > 0;
    if (snapshot) {
      if (snapshotInCanvas.current !== snapshot) {
        dripFeed.resetDrip();
        multiHop.stopReplay();
        stream.drainPending();
        interaction.closeDetailPanel();
        setFilterSnapshot(snapshot);
        cytoscape.setElements(snapshot.nodes.map(graphNodeToCyElement));
        if (!pendingView) cytoscape.runLayout(interaction.layout);
        snapshotInCanvas.current = snapshot;
      }
      wasHistorical.current = true;
      return;
    }
    if (wasHistorical.current) {
      mergedData.current = null;
      wasHistorical.current = false;
      snapshotInCanvas.current = null;
      setFilterSnapshot(null);
      interaction.closeDetailPanel();
      cytoscape.setElements([]);
    }
    if (nodes.length > 0 || edges.length > 0) {
      if (keepView && mergedData.current?.nodes === nodes && mergedData.current?.edges === edges && cytoscape.cy.current?.nodes().length) return;
      mergedData.current = { nodes, edges };
      const cyElements = [
        ...nodes.map(graphNodeToCyElement),
        ...edges.map(graphEdgeToCyElement),
      ];
      const { isInitial } = cytoscape.mergeElements(cyElements);
      if (isInitial && !pendingView) cytoscape.runLayout(interaction.layout);

      // Replay any WS events that arrived during the API fetch
      const pending = stream.drainPending();
      if (pending.length > 0) {
        const pendingCyEls = pending.map((el) =>
          'source' in el ? graphEdgeToCyElement(el) : graphNodeToCyElement(el)
        );
        cytoscape.addElements(pendingCyEls);
      }

      // Safety net: if cy is empty after merge, retry once with full layout
      const retryTimer = setTimeout(() => {
        const cy = cytoscape.cy.current;
        if (cy && cy.nodes().length === 0 && nodes.length > 0) {
          cytoscape.mergeElements(cyElements);
          cytoscape.runLayout(interaction.layout);
        }
      }, 300);
      return () => clearTimeout(retryTimer);
    } else if (!loading) {
      cytoscape.setElements([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, cytoscape.ready, loading, snapshot, active]);

  // Apply filters whenever they change or Cytoscape becomes ready.
  // Only cytoscape.ready is included (not the whole cytoscape object) to avoid
  // re-triggering on unrelated state changes (selection mode, move mode).
  useEffect(() => {
    if (filterSnapshot !== snapshot) return;
    cytoscape.applyFilter(filters.visibleNodeIds, filters.activeEdgeTypes, filters.cascadeEdgeFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.visibleNodeIds, filters.activeEdgeTypes, filters.cascadeEdgeFilter, cytoscape.ready, filterSnapshot, snapshot]);

  useEffect(() => {
    const cy = cytoscape.cy.current;
    if (!cytoscape.ready || !cy || !contradictionOverlay) return;
    const selector = `edge[type="${DECISION_CONFLICT_EDGE_TYPE}"]`;
    const highlight = () => {
      cy.nodes().removeClass(DECISION_CONTRADICTION_CLASS);
      cy.edges(selector).connectedNodes().addClass(DECISION_CONTRADICTION_CLASS);
    };
    highlight();
    cy.on('add remove data', 'edge', highlight);
    return () => {
      cy.off('add remove data', 'edge', highlight);
      cy.nodes().removeClass(DECISION_CONTRADICTION_CLASS);
    };
  }, [cytoscape.ready, cytoscape.cy, contradictionOverlay]);

  // Apply annotations whenever they change OR data is replaced.
  // setElements() destroys all Cytoscape elements (and their classes), so annotations
  // must be reapplied even if the annotations object itself hasn't changed.
  useEffect(() => {
    if (!cytoscape.ready) return;
    if (annotations) {
      cytoscape.applyAnnotations(annotations);
    } else {
      cytoscape.clearAnnotations();
    }
  }, [annotations, cytoscape.ready, nodes, edges]);

  // Delete nodes by id: calls the backend per node and removes from the graph ONLY the nodes
  // whose backend delete succeeded (GRAPH-KEY-DELETE-1). A failed delete leaves the node in
  // place and is surfaced, because a node that vanishes from the graph while it still exists
  // in SmartMemory reads as "deleted" and comes back on the next refresh.
  const [pendingDelete, setPendingDelete] = useState(null); // { ids, message } awaiting confirm
  const [deleteFailure, setDeleteFailure] = useState(null); // { failed, total } | { message }
  const deletingRef = useRef(false);

  const deleteNodes = useCallback(async (ids) => {
    if (!ids || ids.length === 0 || deletingRef.current) return { deleted: [], failed: [] };
    deletingRef.current = true;
    try {
      const cy = cytoscape.cy.current;
      const results = await Promise.allSettled(
        ids.map(async (id) => {
          if (!adapter) throw new Error('no adapter to delete with');
          const category = cy?.getElementById(id)?.data('category');
          if (daemon && (category !== 'memory' || capabilities?.delete !== true)) {
            throw new Error('The daemon does not support deleting this node.');
          }
          if (category === 'memory') {
            await adapter.deleteNode(id);
          } else {
            await adapter.deleteEntityNode(id);
          }
        })
      );
      const deleted = [];
      const failed = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') deleted.push(ids[i]);
        else {
          failed.push(ids[i]);
          console.warn(`[GraphExplorer] delete failed for ${ids[i]}; node kept in graph:`, r.reason);
        }
      });
      if (deleted.length > 0) cytoscape.removeNodes(deleted);
      setDeleteFailure(failed.length > 0 ? { failed: failed.length, total: ids.length } : null);
      return { deleted, failed };
    } finally {
      deletingRef.current = false;
    }
  }, [adapter, cytoscape, daemon, capabilities]);

  // Every multi-node delete (keyboard or the selection toolbar) goes through a confirm that
  // names the count. The ids are frozen when the prompt opens.
  const requestDelete = useCallback(() => {
    const ids = [...cytoscape.selectedNodeIds];
    if (ids.length === 0) return;
    if (!adapter) {
      console.warn('[GraphExplorer] delete requested with no adapter; nothing was deleted and the nodes were kept.');
      setDeleteFailure({ message: 'This graph is read-only: there is no adapter to delete with.' });
      return;
    }
    const cy = cytoscape.cy.current;
    let memories = 0;
    for (const id of ids) {
      if (cy?.getElementById(id)?.data('category') === 'memory') memories += 1;
    }
    setDeleteFailure(null);
    setPendingDelete({ ids, message: describeDeletion({ memories, entities: ids.length - memories }) });
  }, [adapter, cytoscape]);

  const closePendingDelete = useCallback(() => {
    setPendingDelete(null);
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  const confirmPendingDelete = useCallback(async () => {
    const ids = pendingDelete?.ids;
    setPendingDelete(null);
    rootRef.current?.focus({ preventScroll: true });
    if (ids) await deleteNodes(ids);
  }, [pendingDelete, deleteNodes]);

  // Single-node delete from DetailPanel (it has its own inline confirm). The panel stays open
  // when the delete failed so the failure is visible next to the node.
  const handleDeleteNode = useCallback(async (id) => {
    const { failed } = await deleteNodes([id]);
    if (failed.length === 0) interaction.closeDetailPanel?.();
  }, [deleteNodes, interaction]);

  // Keyboard shortcuts, scoped to the graph (GRAPH-KEY-DELETE-1): they act only while the
  // explorer root itself has focus, never on a window-wide listener, so a host's editor,
  // fields and buttons keep their own Backspace / Delete / Cmd+A.
  const handleRootKeyDown = useCallback((e) => {
    const action = classifyGraphKey(e, rootRef.current, document.activeElement);
    if (action === 'delete') {
      // A host that hides the selection toolbar has opted out of destructive graph actions
      // (Obsidian does, in graph-view.tsx): the keyboard is not a back door around that.
      if (hideSelectionToolbar || snapshot) return;
      e.preventDefault();
      requestDelete();
    } else if (action === 'select-all') {
      e.preventDefault();
      cytoscape.selectAll();
    }
  }, [requestDelete, cytoscape, hideSelectionToolbar, snapshot]);

  // A press on the canvas or chrome gives the root focus so the shortcuts above reach it;
  // presses on fields, buttons and links keep their own focus.
  const handleRootMouseDown = useCallback((e) => {
    const t = e.target;
    if (isEditableTarget(t)) return;
    const own = t.closest?.('button, a, [role="button"], [tabindex]');
    if (own && own !== rootRef.current) return;
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  // Operations bar click handler — scrub to event state
  const handleOperationClick = useCallback((op) => {
    const cy = cytoscape.cy.current;
    if (!cy || historicalRef.current) return;

    if (op.category === 'node_added' || op.category === 'edge_added' || op.category === 'graph_cleared') {
      dripFeed.dripTimersRef.current.forEach(clearTimeout);
      dripFeed.dripTimersRef.current = [];

      if (op.category === 'graph_cleared') {
        const cyElements = [
          ...nodes.map(graphNodeToCyElement),
          ...edges.map(graphEdgeToCyElement),
        ];
        cytoscape.setElements(cyElements);
      } else {
        const streamState = stream.getStateUpTo(op.id);
        if (streamState) {
          const baseCyEls = [
            ...nodes.map(graphNodeToCyElement),
            ...edges.map(graphEdgeToCyElement),
          ];
          const baseIds = new Set(baseCyEls.map(e => e.data.id));
          const newCyEls = [
            ...streamState.nodes.map(graphNodeToCyElement),
            ...streamState.edges.map(graphEdgeToCyElement),
          ].filter(e => !baseIds.has(e.data.id));
          cytoscape.setElements([...baseCyEls, ...newCyEls]);
        }
      }
      cytoscape.runLayout(interaction.layout);
      stream.pause();
    }

    // Highlight affected nodes
    const ids = [];
    if (op.nodeId) ids.push(op.nodeId);
    if (op.matchIds?.length) ids.push(...op.matchIds);
    if (ids.length === 0) return;

    setTimeout(() => {
      cytoscape.highlightElements(ids);
      const primary = cy.getElementById(ids[0]);
      if (primary.length) {
        interaction.handleNodeClick(primary.data());
        cy.animate({ center: { eles: primary }, duration: 300 });
      }
    }, 50);
  }, [cytoscape, nodes, edges, stream, interaction, dripFeed]);

  // Decision chain highlight (stable identity: DecisionDetailBlock clears it in an effect keyed on this function).
  const { highlightElements: cyHighlight, clearHighlights: cyClearHighlights } = cytoscape;
  const handleDecisionChainHighlight = useCallback((ids) => {
    if (ids && ids.length) cyHighlight(ids);
    else cyClearHighlights();
  }, [cyHighlight, cyClearHighlights]);

  // The origin legend only means something when nodes carry an origin; Lite nodes have none.
  const legendAvailable = showOriginLegend !== false
    && nodes.some((n) => n.origin && n.origin !== 'unknown');

  const handleSearchNodeSelect = useCallback((id) => {
    const cy = cytoscape.cy.current;
    if (cy) {
      const node = cy.getElementById(id);
      if (node.length) {
        interaction.handleNodeClick(node.data());
        cy.animate({ center: { eles: node }, duration: 300 });
      }
    }
  }, [cytoscape, interaction]);

  const { focusStatus, handleDecisionSelect } = useExplorerFocus({
    adapter, daemon, snapshot, asOfTime, loading, urlState, cytoscape, filters, interaction, historicalRef, restoredView,
  });
  const highlightDecisionChain = useCallback((ids) => {
    const cy = cytoscape.cy.current;
    if (!ids) {
      cytoscape.clearHighlights();
      return;
    }
    const chainIds = new Set(ids);
    const chainTypes = new Set(['SUPERSEDES', 'DERIVED_FROM', 'CAUSED_BY', 'CAUSES', 'INFLUENCES', 'PRODUCED']);
    const edgeIds = cy?.edges().filter((edge) => chainIds.has(edge.source().id()) &&
      chainIds.has(edge.target().id()) && chainTypes.has(edge.data('type'))).map((edge) => edge.id());
    cytoscape.highlightElements(ids, edgeIds);
  }, [cytoscape.cy, cytoscape.clearHighlights, cytoscape.highlightElements]);

  const changeTime = (timestamp) => {
    if (!timestamp) clearHistoricalUrl();
    handleTimeTravel(timestamp);
  };
  const closeTimeTravel = () => {
    interaction.setTimeTravelOpen(false);
    changeTime(null);
  };
  const capabilityStatus = capabilityError ? 'Could not check daemon capabilities.' : 'Checking daemon capabilities…';
  let deleteUnavailable = null;
  if (daemon && interaction.selectedNode?.category !== 'memory') {
    deleteUnavailable = 'The local viewer cannot delete entities.';
  } else if (daemon && capabilities?.delete !== true) {
    deleteUnavailable = capabilities?.delete === false ? 'Memory deletion is unavailable through this daemon.' : capabilityStatus;
  }
  const decisionUnavailable = daemon && capabilities?.decisions !== true
    ? capabilities?.decisions === false ? 'Unavailable through this daemon' : capabilityStatus
    : null;

  // Error state
  if (error && nodes.length === 0 && !snapshot) {
    return (
      <div className={`flex items-center justify-center bg-background dark:bg-slate-900 ${className || 'h-screen'}`}>
        <div className="text-center max-w-md">
          <div className="text-red-700 dark:text-red-400 text-4xl mb-4">!</div>
          <p className="text-red-700 dark:text-red-300 font-medium mb-2">Failed to load graph</p>
          <p className="text-muted-foreground dark:text-slate-400 text-sm mb-4">{error}</p>
          <button
            onClick={interaction.handleRefresh}
            className="bg-muted dark:bg-slate-700 hover:bg-accent dark:hover:bg-slate-600 text-foreground dark:text-white px-4 py-2 rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (replayNotAvailable) {
    return (
      <div className={`flex items-center justify-center bg-background dark:bg-slate-900 ${className || 'h-screen'}`}>
        <div className="text-center max-w-md">
          <div className="text-muted-foreground dark:text-slate-400 text-4xl mb-4">&#x231B;</div>
          <p className="text-foreground dark:text-slate-200 font-medium mb-2">Recording not available</p>
          <p className="text-muted-foreground dark:text-slate-400 text-sm mb-4">
            This replay link has expired. The stream window for run <code className="text-foreground dark:text-slate-300">{replayRunId}</code> is no longer available on the server, and no local recording was found.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      data-graph-explorer=""
      tabIndex={0}
      onKeyDown={handleRootKeyDown}
      onMouseDown={handleRootMouseDown}
      className={`flex min-w-0 flex-col bg-background dark:bg-slate-900 overflow-hidden outline-none ${className || 'h-full w-full'}`}
    >
      {stream.error && (
        <div role="alert" className="px-4 py-2 text-sm text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-950">
          Event stream unavailable: {stream.error}
        </div>
      )}
      {loading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 dark:bg-slate-900/80 pointer-events-none">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-300 dark:border-blue-500 mx-auto mb-4" />
            <p className="text-muted-foreground dark:text-slate-400">Loading knowledge graph...</p>
          </div>
        </div>
      )}

      {controlledReason && <p className="px-4 py-1 text-xs">{controlledReason}</p>}
      <Toolbar
        contradictionOverlay={contradictionOverlay}
        onToggleContradictionOverlay={setContradictionOverlay}
        readOnlyReason={controlledReason}
        layout={interaction.layout}
        onLayoutChange={interaction.handleLayoutChange}
        onZoomIn={cytoscape.zoomIn}
        onZoomOut={cytoscape.zoomOut}
        onFitToScreen={cytoscape.fitToScreen}
        onRefresh={adapter && !snapshot ? interaction.handleRefresh : undefined}
        onToggleFilters={() => setFilterPanelOpen((p) => !p)}
        onPathMode={!daemon && !snapshot && adapter?.findPath ? interaction.handlePathMode : undefined}
        pathUnavailable={daemon}
        pathMode={interaction.pathMode}
        selectionMode={cytoscape.selectionMode}
        onSelectionModeChange={cytoscape.setSelectionMode}
        stats={snapshot ? { nodes: snapshot.nodes.length, edges: snapshot.edges.length } : stats}
        cy={cytoscape.cy}
        onCopyLink={interaction.handleCopyLink}
        timeUnavailable={enableTimeTravel && daemon}
        timeTravelEnabled={enableTimeTravel}
        onToggleTimeTravelSlider={enableTimeTravel && !daemon && adapter?.getTemporalSnapshot ? () => {
          if (interaction.timeTravelOpen) closeTimeTravel();
          else interaction.setTimeTravelOpen(true);
        } : undefined}
        timeTravelActive={interaction.timeTravelOpen || !!interaction.asOfTime}
        autoFit={cytoscape.autoFit}
        onAutoFitChange={cytoscape.setAutoFit}
        isFullscreen={isFullscreen}
        onToggleFullscreen={handleToggleFullscreen}
        rightActions={toolbarRightActions}
        originLegendVisible={legendAvailable && originLegendOpen}
        onToggleOriginLegend={legendAvailable ? () => setOriginLegendOpen(p => !p) : undefined}
        svgExportEnabled={enableSvgExport}
      />

      <div className="flex-1 flex overflow-hidden relative">
        {filterPanelOpen && (
          <FilterPanel
            filters={filters}
            onClose={() => setFilterPanelOpen(false)}
            typeCounts={typeCounts}
            searchBar={(
              <SearchBar
                nodes={snapshot?.nodes ?? nodes}
                onSearch={interaction.handleSearch}
                onNodeSelect={handleSearchNodeSelect}
              />
            )}
          />
        )}

        <CytoscapeCanvas
          setContainerRef={cytoscape.setContainerRef}
        >
          <OriginLegend visible={legendAvailable && originLegendOpen} />
        </CytoscapeCanvas>

        {interaction.detailPanelOpen && interaction.selectedNode && (
          <div className="absolute right-0 top-0 bottom-0 z-30">
            <DetailPanel
              key={JSON.stringify([workspaceId, interaction.selectedNode.id])}
              rippleCanvas={!daemon && !snapshot ? cytoscape.cy.current : null}
              node={interaction.selectedNode}
              edges={interaction.connectedEdges}
              onClose={interaction.closeDetailPanel}
              onExpand={!snapshot && adapter?.getNeighbors ? interaction.handleExpand : undefined}
              expandStatus={interaction.expandStatus}
              expanding={interaction.expanding}
              onHopReplay={!snapshot ? (nodeId) => multiHop.replayState === 'playing' ? multiHop.stopReplay() : multiHop.startReplay(nodeId) : undefined}
              hopReplayState={multiHop.replayState}
              onNodeUpdate={interaction.handleNodeUpdate}
              onDelete={!snapshot && adapter && !deleteUnavailable ? handleDeleteNode : undefined}
              readOnlyReason={controlledReason}
              deleteUnavailable={!snapshot ? deleteUnavailable : null}
              daemon={daemon}
              decisionUnavailable={decisionUnavailable}
              adapter={!snapshot ? adapter : null}
              onSelectId={handleDecisionSelect}
              onDecisionChainHighlight={highlightDecisionChain}
              enableEntityEditing={enableEntityEditing}
              enableGrounding={enableGrounding}
              enableDecisionTools={enableDecisionTools}
            />
          </div>
        )}
      </div>

      {enableTimeTravel && interaction.timeTravelOpen && (
        <TimeTravelSlider
          onTimeChange={changeTime}
          onClose={closeTimeTravel}
          asOfTime={asOfTime}
          loading={interaction.timeTravelLoading}
          error={interaction.timeTravelError}
          empty={!!snapshot && snapshot.nodes.length === 0}
        />
      )}

      {!interaction.timeTravelOpen && interaction.timeTravelError && (
        <p role="alert" className="absolute bottom-16 left-1/2 -translate-x-1/2 z-50 bg-card px-3 py-2 text-xs">
          {interaction.timeTravelError}
        </p>
      )}
      {focusStatus && (
        <p role={focusStatus.error ? 'alert' : 'status'} className="absolute top-16 left-1/2 -translate-x-1/2 z-50 bg-card px-3 py-2 text-xs">
          {focusStatus.message}
        </p>
      )}

      {/* Multi-hop replay indicator */}
      {multiHop.replayState !== 'idle' && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-cyan-100 dark:bg-cyan-900/90 border border-cyan-300 dark:border-cyan-600 text-cyan-700 dark:text-cyan-200 px-4 py-2 rounded-lg text-sm z-50 flex items-center gap-3">
          {multiHop.replayState === 'playing' && (
            <div className="w-3 h-3 border-2 border-cyan-300 dark:border-cyan-400 border-t-transparent rounded-full animate-spin" />
          )}
          <div className="flex items-center gap-2">
            {/* One dot per FRAME, not per HOP_COLORS entry — a 6-hop replay cycles
                the 4 colours and must still show 6 dots. In BFS mode frame 0 is the
                clicked start node; in retrieval mode frame 0 is retrieval hop 0
                (the original query's own results), so it is labelled as such. */}
            {Array.from({ length: multiHop.frameCount }, (_, i) => (
              <div
                key={i}
                className="flex items-center gap-1"
                style={{ opacity: i <= multiHop.activeHop ? 1 : 0.3 }}
              >
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: multiHop.HOP_COLORS[i % multiHop.HOP_COLORS.length] }}
                />
                <span className="text-xs">
                  {multiHop.replayMode === 'bfs' && i === 0 ? 'start' : `hop ${i}`}
                </span>
              </div>
            ))}
          </div>
          {multiHop.replayState === 'done' && (
            <>
              {multiHop.replayMode === 'retrieval' && hasHopGroups && (
                <button
                  onClick={replayHopGroups}
                  className="ml-2 text-xs text-cyan-700 dark:text-cyan-400 hover:text-foreground dark:hover:text-white underline"
                >
                  Replay
                </button>
              )}
              <button
                onClick={multiHop.stopReplay}
                className="ml-2 text-xs text-cyan-700 dark:text-cyan-400 hover:text-foreground dark:hover:text-white underline"
              >
                Reset
              </button>
            </>
          )}
        </div>
      )}

      {enableTimeTravel && interaction.timeTravelLoading && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-purple-100 dark:bg-purple-900/90 border border-purple-300 dark:border-purple-600 text-purple-700 dark:text-purple-200 px-4 py-2 rounded-lg text-sm z-50 flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-purple-300 dark:border-purple-400 border-t-transparent rounded-full animate-spin" />
          Loading temporal snapshot...
        </div>
      )}

      {enableTimeTravel && interaction.asOfTime && !interaction.timeTravelLoading && (
        <div className="absolute top-16 right-4 bg-purple-100 dark:bg-purple-900/80 border border-purple-300 dark:border-purple-600 text-purple-700 dark:text-purple-200 px-3 py-1.5 rounded-lg text-xs z-50">
          Viewing: {new Date(interaction.asOfTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </div>
      )}

      {/* Pipeline stage indicator — live ingestion + replay */}
      {currentStage && (
        <div className="absolute bottom-16 left-4 z-50 bg-background/90 dark:bg-slate-900/90 border border-yellow-300 dark:border-yellow-700/60 text-yellow-700 dark:text-yellow-300 px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 pointer-events-none">
          <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-pulse flex-shrink-0" />
          {currentStage.name.replace(/_/g, ' ')}
          {currentStage.durationMs != null && (
            <span className="text-yellow-600 ml-0.5">{currentStage.durationMs}ms</span>
          )}
        </div>
      )}

      {/* Replay controls */}
      {showPlaybackBar && dripFeed.isReplaying && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-50 bg-cyan-100 dark:bg-cyan-900/90 border border-cyan-300 dark:border-cyan-700 text-cyan-700 dark:text-cyan-200 px-4 py-1.5 rounded-full text-xs font-medium flex items-center gap-2">
          <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
          Replaying recording...
          <button
            onClick={() => {
              dripFeed.dripTimersRef.current.forEach(clearTimeout);
              dripFeed.dripTimersRef.current = [];
              dripFeed.setIsReplaying(false);
            }}
            className="ml-2 text-cyan-700 dark:text-cyan-400 hover:text-cyan-700 dark:hover:text-cyan-200"
          >
            Stop
          </button>
        </div>
      )}
      {!hideSelectionToolbar && !snapshot && adapter && cytoscape.selectedNodeIds.size > 0 && (
        <div className="absolute bottom-16 right-4 z-50 flex items-center gap-2 bg-card dark:bg-slate-800 border border-input dark:border-slate-600 rounded-lg px-3 py-1.5 shadow-lg">
          <span className="text-foreground dark:text-slate-300 text-xs">{cytoscape.selectedNodeIds.size} selected</span>
          <div className="w-px h-4 bg-accent dark:bg-slate-600" />
          <button
            type="button"
            onClick={() => cytoscape.setMoveMode(!cytoscape.moveMode)}
            className={`text-xs font-medium transition-colors ${
              cytoscape.moveMode ? 'text-blue-700 dark:text-blue-400' : 'text-muted-foreground dark:text-slate-400 hover:text-foreground dark:hover:text-slate-200'
            }`}
            title="Drag to move selected nodes as a group"
          >
            Move
          </button>
          <button
            type="button"
            onClick={cytoscape.isolateSelected}
            className="text-muted-foreground dark:text-slate-400 hover:text-foreground dark:hover:text-slate-200 text-xs font-medium transition-colors"
            title="Show only selected nodes, hide everything else"
          >
            Isolate
          </button>
          <button
            type="button"
            onClick={requestDelete}
            className="text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-xs font-medium transition-colors"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => {
              cytoscape.setMoveMode(false);
              cytoscape.cy.current?.elements().unselect();
            }}
            className="text-muted-foreground dark:text-slate-500 hover:text-foreground dark:hover:text-slate-300 text-xs transition-colors"
          >
            ✕
          </button>
        </div>
      )}
      {pendingDelete && (
        <div
          role="alertdialog"
          aria-modal="false"
          aria-label="Confirm delete"
          data-testid="graph-delete-confirm-dialog"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); closePendingDelete(); } }}
          className="absolute bottom-28 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-card dark:bg-slate-800 border border-red-300 dark:border-red-700 text-foreground dark:text-slate-200 px-4 py-2 rounded-lg text-sm shadow-lg"
        >
          <span>{pendingDelete.message}</span>
          <button
            type="button"
            data-testid="graph-delete-confirm"
            onClick={confirmPendingDelete}
            className="text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-medium"
          >
            Delete
          </button>
          <button
            type="button"
            data-testid="graph-delete-cancel"
            autoFocus
            onClick={closePendingDelete}
            className="text-muted-foreground dark:text-slate-400 hover:text-foreground dark:hover:text-slate-200"
          >
            Cancel
          </button>
        </div>
      )}
      {deleteFailure && (
        <div role="alert" data-testid="graph-delete-failure" className="absolute bottom-28 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-red-100 dark:bg-red-950 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-200 px-4 py-2 rounded-lg text-sm shadow-lg">
          <span>
            {deleteFailure.message
              || `Could not delete ${deleteFailure.failed} of ${deleteFailure.total} ${deleteFailure.total === 1 ? 'item' : 'items'}. ${deleteFailure.failed === 1 ? 'It is' : 'They are'} still in the graph.`}
          </span>
          <button type="button" onClick={() => setDeleteFailure(null)} className="text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-200 underline">
            Dismiss
          </button>
        </div>
      )}
      {cytoscape.isolated && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-indigo-100 dark:bg-indigo-900/90 border border-indigo-300 dark:border-indigo-600 text-indigo-700 dark:text-indigo-200 px-4 py-1.5 rounded-lg text-xs font-medium">
          Isolated view
          <button
            onClick={cytoscape.clearIsolation}
            className="ml-1 text-indigo-700 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200 underline"
          >
            Show all
          </button>
        </div>
      )}
      {showPlaybackBar && !snapshot && sseEnabled && stream.status === 'connected' && (
        <OperationsBar
          status={stream.status}
          operations={stream.operations}
          opsPerSecond={stream.opsPerSecond}
          isPaused={stream.isPaused}
          onPause={stream.pause}
          onResume={stream.resume}
          dripInterval={dripFeed.dripInterval}
          onDripIntervalChange={dripFeed.setDripInterval}
          onOperationClick={handleOperationClick}
          replayControl={(
            <ReplayButton
              onReplay={dripFeed.replayRecording}
              disabled={dripFeed.isReplaying}
              floating={false}
            />
          )}
        />
      )}

      {interaction.pathMode && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-amber-100 dark:bg-amber-900/90 border border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-200 px-4 py-2 rounded-lg text-sm z-50">
          {interaction.pathStart ? 'Click the END node' : 'Click the START node'}
          <button onClick={interaction.handlePathMode} className="ml-3 text-amber-700 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 underline">Cancel</button>
        </div>
      )}

      {cytoscape.selectionMode && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-blue-100 dark:bg-blue-900/90 border border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-200 px-4 py-2 rounded-lg text-sm z-50">
          Selection mode — click or drag to select nodes, then Delete to remove
          <button onClick={() => cytoscape.setSelectionMode(false)} className="ml-3 text-blue-700 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline">Exit</button>
        </div>
      )}

      {interaction.pathResult?.loading && <p role="status" className="absolute top-16 left-1/2 z-50 bg-card px-3 py-2 text-xs">Finding path…</p>}

      {interaction.pathResult?.error && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-red-100 dark:bg-red-900/90 border border-red-300 dark:border-red-600 text-red-700 dark:text-red-200 px-4 py-2 rounded-lg text-sm z-50">
          {interaction.pathResult.error}
          <button onClick={() => interaction.setPathResult(null)} className="ml-3 text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 underline">Dismiss</button>
        </div>
      )}
    </div>
  );
}
