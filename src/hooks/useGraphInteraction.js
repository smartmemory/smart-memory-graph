import { useState, useCallback, useEffect, useRef } from 'react';
import { LAYOUT_OPTIONS } from '../core/constants';
import { MEMORY_TYPE_SET } from '../core/graphColors';
import { graphNodeToCyElement } from '../internal/cytoscapeConvert';
import { normalizeAPIResponse, classifyNode } from '../core/normalize';

/**
 * Filter family and type of one neighbour row. An id the canvas already holds keeps the type the
 * graph reader gave it; a new row is classified by the reader's own classifier when the service sent
 * its category (`node_category`). Only a row with no category at all (an older service) falls back
 * to the memory colour registry.
 */
function classifyNeighbor(item, cy) {
  const loaded = cy?.getElementById(item.item_id);
  if (loaded?.length && loaded.data('category')) {
    return { type: loaded.data('type'), category: loaded.data('category') };
  }
  if (item.node_category || item.category || item.entity_type) return classifyNode(item);
  const type = item.memory_type || 'semantic';
  return { type, category: MEMORY_TYPE_SET.has(type) ? 'memory' : 'entity' };
}

/**
 * Cytoscape elements for a neighbour response, plus the same items as plain nodes and edges for the
 * left-hand filters (type, category, ids). A link the canvas already draws is left out of the elements.
 */
function neighborElements(nodeId, neighbors, cy) {
  const cyElements = [];
  const filterEls = [];
  for (const item of neighbors) {
    const id = item.item_id;
    if (!id) continue;
    const { type, category } = classifyNeighbor(item, cy);
    const label = item.entity_name || item.content?.substring(0, 40) || id.substring(0, 12);
    cyElements.push({ group: 'nodes', data: { id, label, type, category, content: item.content || '' } });

    const edgeType = item.link_type || 'RELATES_TO';
    const [source, target] = item.direction === 'incoming' ? [id, nodeId] : [nodeId, id];
    filterEls.push({ id, type, category }, { source, target, type: edgeType });
    // The loaded graph may already draw this link under its own id: a second copy would double the
    // connection list and the highlight.
    if (cy?.edges(`[source = "${source}"][target = "${target}"][type = "${edgeType}"]`).length) continue;
    cyElements.push({
      group: 'edges',
      data: { id: `${source}->${target}:${edgeType}`, source, target, label: edgeType, type: edgeType },
    });
  }
  return { cyElements, filterEls };
}

/**
 * A fetch must never leave its result hidden by a left-hand filter: register the items, switch their
 * types on (nothing else changes), and un-hide them now rather than after the next render, so the
 * hop view drawn right after can see them. A link is matched by its type too: a parallel link of a
 * type the user switched off stays hidden.
 */
function showFetchedNeighbors(cytoscape, filters, filterEls) {
  filters?.revealTypes?.(filterEls);
  const cy = cytoscape.cy?.current;
  if (!cy) return;
  for (const el of filterEls) {
    const found = 'source' in el
      ? cy.edges(`[source = "${el.source}"][target = "${el.target}"][type = "${el.type}"]`)
      : cy.getElementById(el.id);
    found.removeClass('dimmed');
  }
}

/** New neighbours start on a circle around the node they were fetched for; placed ones stay put. */
function placeRadially(cy, nodeId, ids) {
  const origin = cy?.getElementById(nodeId);
  if (!origin?.length) return;
  const pos = origin.position();
  const angle = (2 * Math.PI) / (ids.length || 1);
  ids.forEach((nid, i) => {
    const node = cy.getElementById(nid);
    if (!node.length) return;
    const nodePos = node.position();
    if (nodePos.x !== 0 || nodePos.y !== 0) return;
    node.position({ x: pos.x + 120 * Math.cos(angle * i), y: pos.y + 120 * Math.sin(angle * i) });
  });
}

/**
 * Put a neighbour response on the canvas: add what is new, switch its filter types on, place it.
 * Returns the ids the response named (already-loaded ones included). Shared by Expand Neighbors and
 * the hop view's "Next hop" at the end of the loaded graph: one call, one way of adding.
 */
export function addNeighborRows(cytoscape, filters, nodeId, rows) {
  const { cyElements: newCyElements, filterEls } = neighborElements(nodeId, rows, cytoscape.cy?.current);
  // The radial placement is the layout for an expand: opt out of the count re-layout, which would
  // re-run the whole layout ~250 ms later and replace it.
  cytoscape.addElements(newCyElements, { relayout: false });
  showFetchedNeighbors(cytoscape, filters, filterEls);
  const ids = [...new Set(rows.map((n) => n.item_id).filter(Boolean))];
  placeRadially(cytoscape.cy?.current, nodeId, ids);
  return ids;
}

/**
 * Node interaction logic extracted from GraphExplorer.jsx:307-586 (R1).
 * Handles selection, path finding, neighbor expansion, time travel, LOD clustering,
 * clipboard, and URL state restoration.
 *
 * @param {Object} options
 * @param {Object} options.cytoscape - useCytoscape return value
 * @param {Object} options.adapter - GraphAPIAdapter
 * @param {Object} options.stream - useGraphStream return value
 * @param {Object} options.filters - useGraphFilters return value
 * @param {Object} options.urlState - from useUrlState
 * @param {{ nodes: GraphNode[], edges: GraphEdge[] }} options.data - from useGraphData
 * @param {function} options.refresh - from useGraphData
 * @param {function} options.getShareableUrl - from useUrlState
 * @param {function} options.saveToUrl - from useUrlState
 * @param {function} [options.onNeighborsLoaded] - (nodeId, ids) after an expand landed on the canvas; the host shows that one hop
 * @param {function} [options.getViewToken] - the host's exploration generation; a change while an expand is pending drops its view
 */
export function useGraphInteraction({
  cytoscape,
  adapter,
  stream,
  filters,
  urlState: rawUrlState,
  enableTimeTravel = false,
  data,
  refresh,
  getShareableUrl,
  saveToUrl,
  onNodeOpen,
  manageCanvas = true,
  temporalUnavailable = false,
  onNeighborsLoaded,
  getViewToken,
}) {
  // Time travel is hidden until fully built: with it off, a past time in the URL is ignored (live graph).
  const urlState = enableTimeTravel ? rawUrlState : (rawUrlState ? { ...rawUrlState, asOfTime: undefined } : rawUrlState);
  const [selectedNode, setSelectedNode] = useState(null);
  const [connectedEdges, setConnectedEdges] = useState([]);
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [pathMode, setPathMode] = useState(false);
  const [pathNodes, setPathNodes] = useState([]);
  const [pathResult, setPathResult] = useState(null);
  const [expanding, setExpanding] = useState(false);
  const [expandStatus, setExpandStatus] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [timeTravelError, setTimeTravelError] = useState(null);
  const snapshotRequest = useRef(0);
  // Bumped whenever the selected node changes: a pending Expand draws its view only if it has not.
  const viewRef = useRef(0);
  const selectedIdRef = useRef(null);
  const noteSelection = (id) => {
    if (selectedIdRef.current !== id) viewRef.current++;
    selectedIdRef.current = id;
  };
  useEffect(() => () => { snapshotRequest.current++; }, [adapter]);
  const [timeTravelOpen, setTimeTravelOpen] = useState(!!urlState?.asOfTime);
  const [asOfTime, setAsOfTime] = useState(null);
  const [timeTravelLoading, setTimeTravelLoading] = useState(false);
  // A shared link carries #layout=...: start on it when it is one of the known layouts.
  const [layout, setLayout] = useState(() => (
    LAYOUT_OPTIONS.some((o) => o.id === urlState?.layout) ? urlState.layout : 'cose-bilkent'
  ));

  // Single click: select node + highlight neighbors + open detail panel
  const selectNode = useCallback((nodeData) => {
    noteSelection(nodeData.id);
    setExpandStatus(null);
    setSelectedNode(nodeData);
    setDetailPanelOpen(true);
    cytoscape.selectNode(nodeData.id);
    setConnectedEdges(cytoscape.getConnectedEdges(nodeData.id));
  }, [cytoscape.selectNode, cytoscape.getConnectedEdges]);

  const handleNodeClick = useCallback((nodeData) => {
    selectNode(nodeData);
    if (pathMode) {
      if (!pathNodes.length) {
        setPathNodes([nodeData.id]);
        return;
      }
      setPathMode(false);
      setPathNodes([]);
      if (!adapter?.findPath) return;
      setPathResult({ loading: true });
      adapter.findPath(pathNodes[0], nodeData.id).then((result) => {
        if (!result?.path?.length || result?.path_found === false) {
          setPathResult({ error: 'No path between these nodes' });
          return;
        }
        setPathResult(result);
        cytoscape.highlightElements(result.path.map((n) => n.item_id || n.id));
      }).catch(() => setPathResult({ error: 'Could not find a path.' }));
    }
  }, [pathMode, pathNodes, cytoscape, adapter, selectNode]);

  // Double-click: host hook (e.g. open in vault), fall back to detail panel.
  const handleNodeDblClick = useCallback((nodeData) => {
    if (typeof onNodeOpen === 'function') {
      onNodeOpen(nodeData);
      return;
    }
    noteSelection(nodeData.id);
    setExpandStatus(null);
    setSelectedNode(nodeData);
    setDetailPanelOpen(true);
    cytoscape.selectNode(nodeData.id);
    setConnectedEdges(cytoscape.getConnectedEdges(nodeData.id));
  }, [cytoscape, onNodeOpen]);

  // Update node data in Cytoscape + React state
  const handleNodeUpdate = useCallback((nodeId, updates) => {
    const cy = cytoscape.cy?.current;
    if (cy) {
      const cyNode = cy.$id(nodeId);
      if (cyNode.length) {
        if (updates.label) cyNode.data('label', updates.label);
        if (updates.type) cyNode.data('type', updates.type);
        if (updates.entity_type) cyNode.data('entity_type', updates.entity_type);
      }
    }
    setSelectedNode((prev) => prev?.id === nodeId ? { ...prev, ...updates } : prev);
  }, [cytoscape]);

  // Wire event handlers into Cytoscape
  useEffect(() => {
    cytoscape.setOnNodeClick(handleNodeClick);
  }, [handleNodeClick, cytoscape]);

  useEffect(() => {
    cytoscape.setOnNodeDblClick(handleNodeDblClick);
  }, [handleNodeDblClick, cytoscape]);

  // Expand neighbors. The data always lands; the one-hop view is drawn only if the user is still on
  // the view they asked from (same selection, no newer exploration), so a late response never
  // replaces what they moved on to.
  const handleExpand = useCallback(async (nodeId) => {
    if (!adapter?.getNeighbors) return;
    const context = snapshotRequest.current;
    const view = [viewRef.current, getViewToken?.()];
    setExpanding(true);
    setExpandStatus(null);
    try {
      const res = await adapter.getNeighbors(nodeId);
      if (context !== snapshotRequest.current) return;
      const neighbors = res?.neighbors || [];
      if (!Array.isArray(neighbors)) throw new Error('Invalid neighbor response.');
      if (neighbors.length === 0) {
        setExpandStatus({ nodeId, message: 'No neighbors found.' });
        return;
      }
      const ids = addNeighborRows(cytoscape, filters, nodeId, neighbors);
      setExpandStatus({ nodeId, message: `Loaded ${neighbors.length} neighbor links.` });
      if (view[0] === viewRef.current && view[1] === getViewToken?.()) onNeighborsLoaded?.(nodeId, ids);
    } catch {
      if (context === snapshotRequest.current) {
        setExpandStatus({ nodeId, error: true, message: 'Could not expand neighbors.' });
      }
    } finally {
      setExpanding(false);
    }
  }, [adapter, cytoscape, filters, onNeighborsLoaded, getViewToken]);

  // The hop view's "Next hop" past the loaded graph: the same fetch as Expand, read now, added later.
  const fetchNeighborRows = useCallback(async (nodeId) => {
    const res = await adapter.getNeighbors(nodeId);
    const rows = res?.neighbors || [];
    if (!Array.isArray(rows)) throw new Error('Invalid neighbor response.');
    return rows;
  }, [adapter]);
  const addFetchedRows = useCallback(
    (nodeId, rows) => addNeighborRows(cytoscape, filters, nodeId, rows),
    [cytoscape, filters],
  );

  useEffect(() => {
    if (!expandStatus?.error && selectedNode?.id && expandStatus?.nodeId === selectedNode.id) {
      setConnectedEdges(cytoscape.getConnectedEdges(selectedNode.id));
    }
  }, [expandStatus, selectedNode, cytoscape.getConnectedEdges]);

  // Refresh
  const handleRefresh = useCallback(() => {
    stream?.drainPending?.();
    refresh?.();
  }, [refresh, stream]);

  // Layout change
  const handleLayoutChange = useCallback((newLayout, options) => {
    setLayout(newLayout);
    cytoscape.runLayout(newLayout, options);
  }, [cytoscape]);

  // Search highlight
  const handleSearch = useCallback((matchingIds) => {
    if (matchingIds.length > 0) {
      cytoscape.highlightElements(matchingIds);
    } else {
      cytoscape.clearHighlights();
    }
  }, [cytoscape]);

  // Path mode toggle
  const handlePathMode = useCallback(() => {
    setPathMode((prev) => !prev);
    setPathNodes([]);
    setPathResult(null);
    cytoscape.clearHighlights();
  }, [cytoscape]);

  // LOD clustering — DISABLED pending VIS-GRAPH-13 (collapsible aggregate nodes).
  // The compound-parent approach creates ugly rectangular boxes and interferes with
  // filters and selection mode. Will be replaced with proper collapsible cluster nodes.
  // See: docs/features/VIS-GRAPH-13/design.md

  // Only the latest request can change the displayed graph.
  const handleTimeTravel = useCallback(async (isoTimestamp) => {
    const request = ++snapshotRequest.current;
    setTimeTravelError(null);
    if (!isoTimestamp) {
      setAsOfTime(null);
      setSnapshot(null);
      setTimeTravelLoading(false);
      handleRefresh();
      return;
    }
    if (temporalUnavailable || !adapter?.getTemporalSnapshot) {
      setTimeTravelError(temporalUnavailable ? 'The local viewer supports only the live graph.' : 'Historical snapshots are unavailable.');
      return;
    }
    setTimeTravelLoading(true);
    try {
      const res = await adapter.getTemporalSnapshot(isoTimestamp);
      if (request !== snapshotRequest.current) return;
      const items = res?.state ?? res?.items ?? res?.memories;
      if (!Array.isArray(items)) throw new Error('Invalid historical snapshot.');
      const nextSnapshot = normalizeAPIResponse({ nodes: items });
      setSnapshot(nextSnapshot);
      setAsOfTime(isoTimestamp);
      if (manageCanvas) {
        cytoscape.setElements(nextSnapshot.nodes.map(graphNodeToCyElement));
        cytoscape.runLayout(layout);
      }
    } catch {
      if (request === snapshotRequest.current) setTimeTravelError('Could not load the historical snapshot.');
    } finally {
      if (request === snapshotRequest.current) setTimeTravelLoading(false);
    }
  }, [adapter, cytoscape, handleRefresh, layout, manageCanvas, temporalUnavailable]);

  // Copy shareable link
  const handleCopyLink = useCallback(async () => {
    const cy = cytoscape.cy.current;
    const state = {
      layout,
      selected: selectedNode?.id || null,
      relation: !selectedNode ? cy?.edges(':selected').first().id() : null,
      filters: [...(filters?.activeMemoryTypes || []), ...(filters?.activeEntityTypes || [])],
      zoom: cy?.zoom() || 1,
      pan: cy?.pan() || { x: 0, y: 0 },
      asOfTime,
    };
    const url = getShareableUrl?.(state);
    if (!url || !navigator.clipboard?.writeText) throw new Error('Clipboard unavailable.');
    await navigator.clipboard.writeText(url);
    saveToUrl?.(state);
  }, [layout, selectedNode, filters, asOfTime, cytoscape, getShareableUrl, saveToUrl]);

  // Restore URL state on initial load
  const urlRestoredRef = useRef(false);
  useEffect(() => {
    if (!manageCanvas || urlRestoredRef.current) return;
    if ((data?.nodes?.length || 0) === 0 && !urlState?.asOfTime) return;
    urlRestoredRef.current = true;

    if (urlState?.asOfTime) {
      handleTimeTravel(urlState.asOfTime);
      return;
    }

    const cy = cytoscape.cy.current;
    if (!cy || cy.nodes().length === 0) return;

    if (urlState?.zoom) cy.zoom(urlState.zoom);
    if (urlState?.pan) cy.pan(urlState.pan);

    if (urlState?.selected) {
      const node = cy.getElementById(urlState.selected);
      if (node.length) {
        handleNodeClick(node.data());
        cy.animate({ center: { eles: node }, duration: 300 });
      }
    }
  }, [data?.nodes?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeDetailPanel = useCallback(() => {
    noteSelection(null);
    setDetailPanelOpen(false);
    setSelectedNode(null);
    setConnectedEdges([]);
  }, []);

  return {
    selectedNode,
    connectedEdges,
    detailPanelOpen,
    pathMode,
    pathStart: pathNodes[0],
    pathResult,
    expanding,
    expandStatus: expandStatus?.nodeId === selectedNode?.id ? expandStatus : null,
    timeTravelOpen,
    setTimeTravelOpen,
    asOfTime,
    timeTravelLoading,
    timeTravelError,
    snapshot,
    layout,
    adapterAvailable: !!adapter,
    handleNodeClick,
    selectNode,
    handleNodeDblClick,
    handleNodeUpdate,
    handleExpand,
    fetchNeighborRows: adapter?.getNeighbors ? fetchNeighborRows : null,
    addFetchedRows,
    handleRefresh,
    handleLayoutChange,
    handleSearch,
    handlePathMode,
    handleTimeTravel,
    handleCopyLink,
    closeDetailPanel,
    setPathResult,
  };
}
