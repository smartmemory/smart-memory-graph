import { useState, useCallback, useEffect, useRef } from 'react';
import { MEMORY_TYPE_SET } from '../core/graphColors';
import { graphNodeToCyElement, graphEdgeToCyElement, cyElementToGraphNode } from '../internal/cytoscapeConvert';

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
 */
export function useGraphInteraction({
  cytoscape,
  adapter,
  stream,
  filters,
  urlState,
  data,
  refresh,
  getShareableUrl,
  saveToUrl,
  onNodeOpen,
}) {
  const [selectedNode, setSelectedNode] = useState(null);
  const [connectedEdges, setConnectedEdges] = useState([]);
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [pathMode, setPathMode] = useState(false);
  const [pathNodes, setPathNodes] = useState([]);
  const [pathResult, setPathResult] = useState(null);
  const [expanding, setExpanding] = useState(false);
  const [timeTravelOpen, setTimeTravelOpen] = useState(!!urlState?.asOfTime);
  const [asOfTime, setAsOfTime] = useState(urlState?.asOfTime || null);
  const [timeTravelLoading, setTimeTravelLoading] = useState(false);
  const [layout, setLayout] = useState('cose-bilkent');

  // Single click: select node + highlight neighbors + open detail panel
  const handleNodeClick = useCallback((nodeData) => {
    setSelectedNode(nodeData);
    setDetailPanelOpen(true);
    cytoscape.selectNode(nodeData.id);
    setConnectedEdges(cytoscape.getConnectedEdges(nodeData.id));

    if (pathMode) {
      setPathNodes((prev) => {
        const next = [...prev, nodeData.id];
        if (next.length === 2) {
          if (!adapter) { setPathMode(false); return []; }
          adapter.findPath(next[0], next[1]).then((result) => {
            setPathResult(result);
            if (result?.path) {
              const nodeIds = result.path.map((n) => n.item_id || n.id);
              cytoscape.highlightElements(nodeIds);
            }
          }).catch(() => setPathResult({ error: 'Path not found' }));
          setPathMode(false);
          return [];
        }
        return next;
      });
    }
  }, [pathMode, cytoscape, adapter]);

  // Double-click: host hook (e.g. open in vault), fall back to detail panel.
  const handleNodeDblClick = useCallback((nodeData) => {
    if (typeof onNodeOpen === 'function') {
      onNodeOpen(nodeData);
      return;
    }
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
    setSelectedNode((prev) => prev ? { ...prev, ...updates } : prev);
  }, [cytoscape]);

  // Wire event handlers into Cytoscape
  useEffect(() => {
    cytoscape.setOnNodeClick(handleNodeClick);
  }, [handleNodeClick, cytoscape]);

  useEffect(() => {
    cytoscape.setOnNodeDblClick(handleNodeDblClick);
  }, [handleNodeDblClick, cytoscape]);

  // Expand neighbors
  const handleExpand = useCallback(async (nodeId) => {
    if (!adapter) return;
    setExpanding(true);
    try {
      const res = await adapter.getNeighbors(nodeId);
      const neighbors = res?.neighbors || [];
      if (!Array.isArray(neighbors) || neighbors.length === 0) return;

      const newCyElements = [];
      for (const item of neighbors) {
        const id = item.item_id;
        if (!id) continue;
        const type = item.memory_type || 'semantic';
        const label = item.content?.substring(0, 40) || id.substring(0, 12);
        const category = MEMORY_TYPE_SET.has(type) ? 'memory' : 'entity';

        newCyElements.push({
          group: 'nodes',
          data: { id, label, type, category, content: item.content || '' },
        });

        const edgeType = item.link_type || 'RELATES_TO';
        newCyElements.push({
          group: 'edges',
          data: { id: `${nodeId}-${id}:${edgeType}`, source: nodeId, target: id, label: edgeType, type: edgeType },
        });
      }

      cytoscape.addElements(newCyElements);

      // Position new nodes radially
      const cy = cytoscape.cy.current;
      if (cy) {
        const origin = cy.getElementById(nodeId);
        if (origin.length) {
          const pos = origin.position();
          const newNodeIds = neighbors.map((n) => n.item_id).filter(Boolean);
          const count = newNodeIds.length || 1;
          const angle = (2 * Math.PI) / count;
          newNodeIds.forEach((nid, i) => {
            const node = cy.getElementById(nid);
            if (node.length) {
              const nodePos = node.position();
              if (nodePos.x === 0 && nodePos.y === 0) {
                node.position({
                  x: pos.x + 120 * Math.cos(angle * i),
                  y: pos.y + 120 * Math.sin(angle * i),
                });
              }
            }
          });
        }
      }

      setConnectedEdges(cytoscape.getConnectedEdges(nodeId));
    } catch (err) {
      console.error('Failed to expand neighbors:', err);
    } finally {
      setExpanding(false);
    }
  }, [adapter, cytoscape]);

  // Refresh
  const handleRefresh = useCallback(() => {
    stream?.drainPending?.();
    refresh?.();
  }, [refresh, stream]);

  // Layout change
  const handleLayoutChange = useCallback((newLayout) => {
    setLayout(newLayout);
    cytoscape.runLayout(newLayout);
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

  // Time travel
  const handleTimeTravel = useCallback(async (isoTimestamp) => {
    if (!isoTimestamp) {
      handleRefresh();
      setAsOfTime(null);
      return;
    }
    if (!adapter) return;
    setTimeTravelLoading(true);
    setAsOfTime(isoTimestamp);
    try {
      const res = await adapter.getTemporalSnapshot(isoTimestamp);
      const items = res?.state || res?.items || res?.memories || [];
      if (Array.isArray(items) && items.length > 0) {
        const newElements = items.map((item) => ({
          group: 'nodes',
          data: {
            id: item.item_id || item.id,
            label: item.title || item.content?.substring(0, 40) || (item.item_id || item.id).substring(0, 12),
            type: item.memory_type || 'semantic',
            category: 'memory',
            content: item.content || '',
            confidence: item.confidence,
            created_at: item.created_at,
            updated_at: item.updated_at,
            metadata: item.metadata || {},
          },
        }));
        cytoscape.setElements(newElements);
        cytoscape.runLayout(layout);
      }
    } catch (err) {
      console.error('Time travel failed:', err);
    } finally {
      setTimeTravelLoading(false);
    }
  }, [handleRefresh, cytoscape, layout, adapter]);

  // Copy shareable link
  const handleCopyLink = useCallback(() => {
    const cy = cytoscape.cy.current;
    const state = {
      layout,
      selected: selectedNode?.id || null,
      filters: [...(filters?.activeMemoryTypes || []), ...(filters?.activeEntityTypes || [])],
      zoom: cy?.zoom() || 1,
      pan: cy?.pan() || { x: 0, y: 0 },
      asOfTime,
    };
    const url = getShareableUrl?.(state);
    saveToUrl?.(state);
    if (url) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
  }, [layout, selectedNode, filters, asOfTime, cytoscape, getShareableUrl, saveToUrl]);

  // Restore URL state on initial load
  const urlRestoredRef = useRef(false);
  useEffect(() => {
    if (urlRestoredRef.current) return;
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
    setDetailPanelOpen(false);
    setSelectedNode(null);
    setConnectedEdges([]);
  }, []);

  return {
    selectedNode,
    connectedEdges,
    detailPanelOpen,
    pathMode,
    pathResult,
    expanding,
    timeTravelOpen,
    setTimeTravelOpen,
    asOfTime,
    timeTravelLoading,
    layout,
    adapterAvailable: !!adapter,
    handleNodeClick,
    handleNodeDblClick,
    handleNodeUpdate,
    handleExpand,
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
