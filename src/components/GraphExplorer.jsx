import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
import { useGraphData } from '../hooks/useGraphData';
import { useGraphFilters } from '../hooks/useGraphFilters';
import { useGraphStream } from '../hooks/useGraphStream';
import { useDripFeed } from '../hooks/useDripFeed';
import { useGraphInteraction } from '../hooks/useGraphInteraction';
import { useMultiHopReplay } from '../hooks/useMultiHopReplay';
import { useUrlState } from '../hooks/useUrlState';
import { graphNodeToCyElement, graphEdgeToCyElement } from '../internal/cytoscapeConvert';

/**
 * Main graph explorer component.
 * Orchestrates data fetching, streaming, filtering, and interaction hooks.
 *
 * @param {Object} props
 * @param {GraphAPIAdapter} props.adapter - API adapter for data fetching
 * @param {{ nodes: GraphNode[], edges: GraphEdge[] }} [props.data] - External data (controlled mode)
 * @param {GraphAnnotations} [props.annotations] - Annotation overlay.
 *   Shape: { nodes: Record<id, {kind, value}[]>, edges: Record<id, {kind, value}[]>,
 *            activeKinds: string[], precedence?: string[] }
 * @param {string} [props.wsUrl] - WebSocket URL for streaming (deprecated — use sseBaseUrl)
 * @param {string} [props.wsToken] - JWT token for WebSocket auth (deprecated — use sseToken)
 * @param {string} [props.sseBaseUrl] - SmartMemory API base URL for SSE progress stream
 * @param {string} [props.sseToken] - Bearer JWT for SSE auth
 * @param {string} [props.replayRunId] - When set, replays a specific run (passes runId+fromSeq:0)
 * @param {Object} [props.clock] - Optional shared replay clock from useReplayClock().
 *   When provided, GraphExplorer consumes events released by the clock instead
 *   of opening its own SSE subscription. Used by Run Inspector to lockstep the
 *   graph view with <PipelineDag> on a single playhead. (VIS-PIPELINE-DAG-1 Phase 4)
 * @param {import('react').ReactNode} [props.toolbarRightActions] - Extra controls rendered at toolbar right side
 * @param {string} [props.className] - Additional CSS classes
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
 * @param {string} [props.theme.palette.edge] - Edge line + edge label color.
 * @param {string} [props.theme.palette.label] - Node label text color.
 * @param {string} [props.theme.palette.labelOutline] - Node label outline color.
 * @param {string} [props.theme.palette.selectionBorder] - Selected-element border.
 */
export default function GraphExplorer({
  adapter,
  data: externalData,
  annotations,
  wsUrl,
  wsToken,
  sseBaseUrl,
  sseToken,
  replayRunId,
  clock = null,
  toolbarRightActions,
  showOriginLegend = true,
  hideSelectionToolbar = false,
  className = '',
  onNodeOpen,
  theme = null,
}) {
  // Data: controlled (data only), uncontrolled (adapter only), or hybrid (both).
  // Hybrid mode: adapter powers refresh/reconnect, external data merges as overlay.
  const internalData = useGraphData(adapter || null);
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

  const filters = useGraphFilters(nodes, edges);

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
  const cytoscape = useCytoscape(containerRef, { theme });
  const { urlState, saveToUrl, getShareableUrl } = useUrlState();

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

  // Streaming — SSE transport (sseBaseUrl/sseToken) preferred; wsUrl/wsToken kept for backward compat.
  // VIS-PIPELINE-DAG-1 Phase 4: when a `clock` prop is provided, the clock owns SSE
  // and we consume events released through it — but useGraphStream still needs `enabled`
  // to be true so the clock-driven path actually runs.
  const effectiveSseBase = sseBaseUrl || '';
  const effectiveSseToken = sseToken || wsToken;
  const sseEnabled = !!(sseBaseUrl || sseToken || replayRunId || clock);

  const stream = useGraphStream({
    sseBaseUrl: effectiveSseBase,
    token: effectiveSseToken,
    enabled: sseEnabled,
    runId: replayRunId,
    clock,
    // VIS-PIPELINE-DAG-1 Phase 4 (Codex Round 1 MUST FIX 3):
    // In clock-driven mode, bypass the drip-feed and apply elements directly
    // to Cytoscape. The clock is already pacing events at original_ts; the
    // drip-feed adds a second pacing layer with its own setTimeout queue
    // that does NOT pause when the clock pauses, breaking lockstep pause.
    onElementAdded: (el) => {
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
    onSearchHighlight: (ids) => cytoscape.highlightElements(ids),
    onGroundingFlash: (nodeId) => {
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
        dripFeedRef.current?.replayRecording(idbRecording);
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
    data: { nodes, edges },
    refresh,
    getShareableUrl,
    saveToUrl,
    onNodeOpen,
  });

  const multiHop = useMultiHopReplay({
    cytoscape,
    graphData: { nodes, edges },
  });

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
    stream,
    onGroundingFlash: (nodeId) => {
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

  // Convert GraphNode/GraphEdge → Cytoscape elements and load into cy
  useEffect(() => {
    if (!cytoscape.ready) return;
    if (nodes.length > 0 || edges.length > 0) {
      const cyElements = [
        ...nodes.map(graphNodeToCyElement),
        ...edges.map(graphEdgeToCyElement),
      ];
      const { isInitial } = cytoscape.mergeElements(cyElements);
      if (isInitial) cytoscape.runLayout(interaction.layout);

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
  }, [nodes, edges, cytoscape.ready, loading]);

  // Apply filters whenever they change or Cytoscape becomes ready.
  // Only cytoscape.ready is included (not the whole cytoscape object) to avoid
  // re-triggering on unrelated state changes (selection mode, move mode).
  useEffect(() => {
    cytoscape.applyFilter(filters.visibleNodeIds, filters.activeEdgeTypes, filters.cascadeEdgeFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.visibleNodeIds, filters.activeEdgeTypes, filters.cascadeEdgeFilter, cytoscape.ready]);

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

  // Delete nodes by id — calls backend for all node categories, removes from graph
  const deleteNodes = useCallback(async (ids) => {
    if (!ids || ids.length === 0) return;
    const cy = cytoscape.cy.current;
    await Promise.allSettled(
      ids.map(async (id) => {
        if (!adapter) return;
        const node = cy?.getElementById(id);
        const category = node?.data('category');
        try {
          if (category === 'memory') {
            await adapter.deleteNode(id);
          } else {
            await adapter.deleteEntityNode(id);
          }
        } catch { /* best effort */ }
      })
    );
    cytoscape.removeNodes(ids);
  }, [adapter, cytoscape]);

  const handleDeleteSelected = useCallback(
    () => deleteNodes([...cytoscape.selectedNodeIds]),
    [deleteNodes, cytoscape.selectedNodeIds]
  );

  // Single-node delete from DetailPanel — closes panel after deletion
  const handleDeleteNode = useCallback(async (id) => {
    await deleteNodes([id]);
    interaction.closeDetailPanel?.();
  }, [deleteNodes, interaction]);

  // Keyboard shortcuts: Delete/Backspace removes selection, Cmd/Ctrl+A selects all
  useEffect(() => {
    const onKeyDown = (e) => {
      const active = document.activeElement?.tagName;
      if (['INPUT', 'TEXTAREA'].includes(active)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        handleDeleteSelected();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        cytoscape.selectAll();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleDeleteSelected, cytoscape]);

  // Operations bar click handler — scrub to event state
  const handleOperationClick = useCallback((op) => {
    const cy = cytoscape.cy.current;
    if (!cy) return;

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

  // Error state
  if (error && nodes.length === 0) {
    return (
      <div className={`flex items-center justify-center bg-slate-900 ${className || 'h-screen'}`}>
        <div className="text-center max-w-md">
          <div className="text-red-400 text-4xl mb-4">!</div>
          <p className="text-red-300 font-medium mb-2">Failed to load graph</p>
          <p className="text-slate-400 text-sm mb-4">{error}</p>
          <button
            onClick={interaction.handleRefresh}
            className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (replayNotAvailable) {
    return (
      <div className={`flex items-center justify-center bg-slate-900 ${className || 'h-screen'}`}>
        <div className="text-center max-w-md">
          <div className="text-slate-400 text-4xl mb-4">&#x231B;</div>
          <p className="text-slate-200 font-medium mb-2">Recording not available</p>
          <p className="text-slate-400 text-sm mb-4">
            This replay link has expired. The stream window for run <code className="text-slate-300">{replayRunId}</code> is no longer available on the server, and no local recording was found.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className={`flex min-w-0 flex-col bg-slate-900 overflow-hidden ${className || 'h-full w-full'}`}>
      {loading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/80 pointer-events-none">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4" />
            <p className="text-slate-400">Loading knowledge graph...</p>
          </div>
        </div>
      )}

      <Toolbar
        layout={interaction.layout}
        onLayoutChange={interaction.handleLayoutChange}
        onZoomIn={cytoscape.zoomIn}
        onZoomOut={cytoscape.zoomOut}
        onFitToScreen={cytoscape.fitToScreen}
        onRefresh={interaction.handleRefresh}
        onToggleFilters={() => setFilterPanelOpen((p) => !p)}
        onPathMode={interaction.handlePathMode}
        pathMode={interaction.pathMode}
        selectionMode={cytoscape.selectionMode}
        onSelectionModeChange={cytoscape.setSelectionMode}
        stats={stats}
        cy={cytoscape.cy}
        onCopyLink={interaction.handleCopyLink}
        onToggleTimeTravelSlider={() => interaction.setTimeTravelOpen((p) => !p)}
        timeTravelActive={interaction.timeTravelOpen || !!interaction.asOfTime}
        autoFit={cytoscape.autoFit}
        onAutoFitChange={cytoscape.setAutoFit}
        isFullscreen={isFullscreen}
        onToggleFullscreen={handleToggleFullscreen}
        rightActions={toolbarRightActions}
        originLegendVisible={showOriginLegend !== false && originLegendOpen}
        onToggleOriginLegend={showOriginLegend !== false ? () => setOriginLegendOpen(p => !p) : undefined}
      />

      <div className="flex-1 flex overflow-hidden relative">
        {filterPanelOpen && (
          <FilterPanel
            filters={filters}
            onClose={() => setFilterPanelOpen(false)}
            typeCounts={typeCounts}
            searchBar={(
              <SearchBar
                nodes={nodes}
                onSearch={interaction.handleSearch}
                onNodeSelect={handleSearchNodeSelect}
              />
            )}
          />
        )}

        <CytoscapeCanvas
          setContainerRef={cytoscape.setContainerRef}
        >
          <OriginLegend visible={showOriginLegend !== false && originLegendOpen} />
        </CytoscapeCanvas>

        {/* Detail panel — absolute overlay */}
        {interaction.detailPanelOpen && interaction.selectedNode && (
          <div className="absolute right-0 top-0 bottom-0 z-30">
            <DetailPanel
              node={interaction.selectedNode}
              edges={interaction.connectedEdges}
              onClose={interaction.closeDetailPanel}
              onExpand={interaction.handleExpand}
              expanding={interaction.expanding}
              onHopReplay={(nodeId) => multiHop.replayState === 'playing' ? multiHop.stopReplay() : multiHop.startReplay(nodeId)}
              hopReplayState={multiHop.replayState}
              onNodeUpdate={interaction.handleNodeUpdate}
              onDelete={handleDeleteNode}
              adapter={adapter}
            />
          </div>
        )}
      </div>

      {interaction.timeTravelOpen && (
        <TimeTravelSlider
          onTimeChange={interaction.handleTimeTravel}
          onClose={() => {
            interaction.setTimeTravelOpen(false);
            if (interaction.asOfTime) {
              interaction.handleRefresh();
            }
          }}
        />
      )}

      {/* Multi-hop replay indicator */}
      {multiHop.replayState !== 'idle' && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-cyan-900/90 border border-cyan-600 text-cyan-200 px-4 py-2 rounded-lg text-sm z-50 flex items-center gap-3">
          {multiHop.replayState === 'playing' && (
            <div className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
          )}
          <div className="flex items-center gap-2">
            {multiHop.HOP_COLORS.slice(0, (multiHop.hopStats?.length || 0) + 1).map((color, i) => (
              <div
                key={i}
                className="flex items-center gap-1"
                style={{ opacity: i <= multiHop.activeHop ? 1 : 0.3 }}
              >
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="text-xs">
                  {i === 0 ? 'start' : `hop ${i}`}
                </span>
              </div>
            ))}
          </div>
          {multiHop.replayState === 'done' && (
            <button
              onClick={multiHop.stopReplay}
              className="ml-2 text-xs text-cyan-400 hover:text-white underline"
            >
              Reset
            </button>
          )}
        </div>
      )}

      {interaction.timeTravelLoading && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-purple-900/90 border border-purple-600 text-purple-200 px-4 py-2 rounded-lg text-sm z-50 flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
          Loading temporal snapshot...
        </div>
      )}

      {interaction.asOfTime && !interaction.timeTravelLoading && (
        <div className="absolute top-16 right-4 bg-purple-900/80 border border-purple-600 text-purple-200 px-3 py-1.5 rounded-lg text-xs z-50">
          Viewing: {new Date(interaction.asOfTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </div>
      )}

      {/* Pipeline stage indicator — live ingestion + replay */}
      {currentStage && (
        <div className="absolute bottom-16 left-4 z-50 bg-slate-900/90 border border-yellow-700/60 text-yellow-300 px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 pointer-events-none">
          <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-pulse flex-shrink-0" />
          {currentStage.name.replace(/_/g, ' ')}
          {currentStage.durationMs != null && (
            <span className="text-yellow-600 ml-0.5">{currentStage.durationMs}ms</span>
          )}
        </div>
      )}

      {/* Replay controls */}
      {dripFeed.isReplaying && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-50 bg-cyan-900/90 border border-cyan-700 text-cyan-200 px-4 py-1.5 rounded-full text-xs font-medium flex items-center gap-2">
          <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
          Replaying recording...
          <button
            onClick={() => {
              dripFeed.dripTimersRef.current.forEach(clearTimeout);
              dripFeed.dripTimersRef.current = [];
              dripFeed.setIsReplaying(false);
            }}
            className="ml-2 text-cyan-400 hover:text-cyan-200"
          >
            Stop
          </button>
        </div>
      )}
      {!hideSelectionToolbar && cytoscape.selectedNodeIds.size > 0 && (
        <div className="absolute bottom-16 right-4 z-50 flex items-center gap-2 bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 shadow-lg">
          <span className="text-slate-300 text-xs">{cytoscape.selectedNodeIds.size} selected</span>
          <div className="w-px h-4 bg-slate-600" />
          <button
            type="button"
            onClick={() => cytoscape.setMoveMode(!cytoscape.moveMode)}
            className={`text-xs font-medium transition-colors ${
              cytoscape.moveMode ? 'text-blue-400' : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Drag to move selected nodes as a group"
          >
            Move
          </button>
          <button
            type="button"
            onClick={cytoscape.isolateSelected}
            className="text-slate-400 hover:text-slate-200 text-xs font-medium transition-colors"
            title="Show only selected nodes, hide everything else"
          >
            Isolate
          </button>
          <button
            type="button"
            onClick={handleDeleteSelected}
            className="text-red-400 hover:text-red-300 text-xs font-medium transition-colors"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => {
              cytoscape.setMoveMode(false);
              cytoscape.cy.current?.elements().unselect();
            }}
            className="text-slate-500 hover:text-slate-300 text-xs transition-colors"
          >
            ✕
          </button>
        </div>
      )}
      {cytoscape.isolated && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-indigo-900/90 border border-indigo-600 text-indigo-200 px-4 py-1.5 rounded-lg text-xs font-medium">
          Isolated view
          <button
            onClick={cytoscape.clearIsolation}
            className="ml-1 text-indigo-400 hover:text-indigo-200 underline"
          >
            Show all
          </button>
        </div>
      )}
      {sseEnabled && stream.status === 'connected' && (
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
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-amber-900/90 border border-amber-600 text-amber-200 px-4 py-2 rounded-lg text-sm z-50">
          Click the START node
          <button onClick={interaction.handlePathMode} className="ml-3 text-amber-400 hover:text-amber-300 underline">Cancel</button>
        </div>
      )}

      {cytoscape.selectionMode && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-blue-900/90 border border-blue-600 text-blue-200 px-4 py-2 rounded-lg text-sm z-50">
          Selection mode — click or drag to select nodes, then Delete to remove
          <button onClick={() => cytoscape.setSelectionMode(false)} className="ml-3 text-blue-400 hover:text-blue-300 underline">Exit</button>
        </div>
      )}

      {interaction.pathResult?.error && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-red-900/90 border border-red-600 text-red-200 px-4 py-2 rounded-lg text-sm z-50">
          {interaction.pathResult.error}
          <button onClick={() => interaction.setPathResult(null)} className="ml-3 text-red-400 hover:text-red-300 underline">Dismiss</button>
        </div>
      )}
    </div>
  );
}
