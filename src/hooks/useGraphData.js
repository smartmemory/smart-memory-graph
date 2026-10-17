import { useState, useEffect, useCallback, useRef } from 'react';
import { normalizeAPIResponse } from '../core/normalize';
import { coalesceGraphData } from '../core/coalesce';
import { MEMORY_TYPE_SET } from '../core/graphColors';

/**
 * Fetch and manage graph data via adapter.
 * Refactored: accepts adapter parameter, returns GraphNode/GraphEdge instead of Cytoscape elements.
 *
 * @param {GraphAPIAdapter} adapter
 * @param {Object} [options]
 * @param {*} [options.refreshSignal] - Any value. When it changes after mount, the graph is
 *   refetched in the background: no loading state, a failure keeps the current graph and logs a
 *   warning, and unchanged data keeps the same arrays. Hosts bump it on focus, on an interval
 *   and after their own writes so data written by another client shows up (UI-REFRESH-1).
 *   A signal that arrives while a fetch is in flight is never dropped: it marks the data dirty
 *   and, when that fetch settles (success or error), one trailing fetch runs, waiting for the
 *   tab to be visible first (UI-REFRESH-FU-1).
 * @returns {{ nodes, edges, loading, error, stats, refresh, incrementStats }}
 */
export function useGraphData(adapter, { refreshSignal } = {}) {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({ nodes: 0, edges: 0, types: {} });
  // Latest-request guard and in-flight count: a slow earlier fetch must not overwrite a newer
  // one, and a background refresh never piles onto a fetch that is still running.
  const seqRef = useRef(0);
  const inFlightRef = useRef(0);
  const lastDataRef = useRef(null);
  // A background trigger skipped because a fetch was pending: the data may be older than a write.
  const dirtyRef = useRef(false);
  const mountedRef = useRef(true);
  const fetchRef = useRef(null);
  const stopWaitingRef = useRef(null);

  // One trailing fetch for whatever arrived during a flight, never while the tab is hidden.
  const drainDirty = useCallback(() => {
    if (!mountedRef.current || !dirtyRef.current || inFlightRef.current > 0) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      if (stopWaitingRef.current) return;
      const onVisible = () => {
        if (document.visibilityState === 'hidden') return;
        stopWaitingRef.current?.();
        drainDirty();
      };
      document.addEventListener('visibilitychange', onVisible);
      stopWaitingRef.current = () => {
        document.removeEventListener('visibilitychange', onVisible);
        stopWaitingRef.current = null;
      };
      return;
    }
    fetchRef.current?.({ background: true });
  }, []);

  const fetchGraph = useCallback(async (options) => {
    if (!adapter) return;
    const background = options?.background === true;
    if (background && inFlightRef.current > 0) {
      dirtyRef.current = true; // the pending request may predate this signal: refetch once it settles
      return;
    }
    dirtyRef.current = false; // this fetch reads the server after every signal so far
    const seq = ++seqRef.current;
    const isCurrent = () => seq === seqRef.current;
    inFlightRef.current += 1;
    if (!background) {
      setLoading(true);
      setError(null);
    }
    // Same data as last time: keep the existing arrays so the canvas merge does not re-run.
    const publish = (nextNodes, nextEdges, nextStats) => {
      const key = JSON.stringify([nextNodes, nextEdges]);
      if (key === lastDataRef.current) return;
      lastDataRef.current = key;
      setNodes(nextNodes);
      setEdges(nextEdges);
      setStats(nextStats);
    };
    try {
      let graphNodes, graphEdges;
      try {
        const graphData = await adapter.getFullGraph();
        const normalized = normalizeAPIResponse(graphData);
        graphNodes = normalized.nodes;
        graphEdges = normalized.edges;
      } catch (fullGraphErr) {
        // Auth errors: don't bother with fallback — it'll fail too
        const status = fullGraphErr?.status;
        if (status === 401 || status === 403) throw fullGraphErr;
        console.warn('[useGraphData] getFullGraph failed, falling back to listMemories:', fullGraphErr?.message || fullGraphErr);
        // Fallback: use memory list + edge bulk
        const memoriesRes = await adapter.listMemories(2000);
        const rawMemories = memoriesRes?.items || memoriesRes?.memories || memoriesRes || [];
        const memories = Array.isArray(rawMemories)
          ? rawMemories.filter((m) => {
              const id = m.item_id || m.id || '';
              return !id.startsWith('version_');
            })
          : [];

        if (memories.length === 0) {
          if (isCurrent()) publish([], [], { nodes: 0, edges: 0, types: {} });
          return;
        }

        const nodeIds = memories.map((m) => m.item_id || m.id);
        const linksByNode = {};
        try {
          const edgesRes = await adapter.getEdgesBulk(nodeIds);
          for (const edge of edgesRes?.edges || []) {
            const link = { source_id: edge.source_id, target_id: edge.target_id, link_type: edge.edge_type };
            if (!linksByNode[edge.source_id]) linksByNode[edge.source_id] = [];
            linksByNode[edge.source_id].push(link);
          }
        } catch (bulkErr) {
          console.warn('[useGraphData] getEdgesBulk failed, falling back to individual getLinks:', bulkErr?.message || bulkErr);
          const results = await Promise.allSettled(
            memories.slice(0, 100).map((m) => {
              const id = m.item_id || m.id;
              return adapter.getLinks(id).then((links) => ({ id, links }));
            })
          );
          for (const result of results) {
            if (result.status === 'fulfilled') {
              const { id, links } = result.value;
              linksByNode[id] = Array.isArray(links) ? links : links?.links || [];
            }
          }
        }

        // Transform to GraphNode/GraphEdge
        graphNodes = [];
        graphEdges = [];
        const seenEdges = new Set();

        for (const item of memories) {
          const id = item.item_id || item.id;
          const type = item.memory_type || item.type || 'semantic';
          const label = item.label || item.name || item.title || item.properties?.name || item.content?.substring(0, 40) || id.substring(0, 12);
          const category = MEMORY_TYPE_SET.has(type) ? 'memory' : 'entity';
          graphNodes.push({ id, label, type, category, content: item.content || '' });

          const links = linksByNode[id] || [];
          for (const link of links) {
            const sourceId = link.source_id || link.source;
            const targetId = link.target_id || link.target;
            const edgeType = link.link_type || link.relation_type || link.type || 'RELATES_TO';
            const edgeKey = `${sourceId}->${targetId}:${edgeType}`;
            if (!seenEdges.has(edgeKey)) {
              seenEdges.add(edgeKey);
              graphEdges.push({ id: edgeKey, source: sourceId, target: targetId, label: edgeType, type: edgeType });
            }
          }
        }

        // Filter edges to only those with valid endpoints
        const nodeIdSet = new Set(graphNodes.map(n => n.id));
        graphEdges = graphEdges.filter(e => nodeIdSet.has(e.source) && nodeIdSet.has(e.target));
      }

      // Coalesce
      const { nodes: coalescedNodes, edges: coalescedEdges } = coalesceGraphData(graphNodes, graphEdges, {});

      // Calculate stats
      const typeCounts = {};
      for (const node of coalescedNodes) {
        typeCounts[node.type] = (typeCounts[node.type] || 0) + 1;
      }

      if (!isCurrent()) return; // a newer fetch owns the state
      setError(null); // a background success also clears an earlier failed load
      publish(coalescedNodes, coalescedEdges, { nodes: coalescedNodes.length, edges: coalescedEdges.length, types: typeCounts });
    } catch (err) {
      if (!isCurrent()) return;
      if (background) {
        console.warn('[useGraphData] background refresh failed, keeping the current graph:', err?.message || err);
      } else {
        setError(err.message);
      }
    } finally {
      inFlightRef.current -= 1;
      if (isCurrent()) setLoading(false);
      drainDirty();
    }
  }, [adapter, drainDirty]);

  useEffect(() => {
    fetchRef.current = fetchGraph;
  }, [fetchGraph]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopWaitingRef.current?.();
    };
  }, []);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  // Background refetch when the host's signal changes (not on mount: the effect above loads).
  const lastSignalRef = useRef(refreshSignal);
  useEffect(() => {
    if (Object.is(lastSignalRef.current, refreshSignal)) return;
    lastSignalRef.current = refreshSignal;
    fetchGraph({ background: true });
  }, [refreshSignal, fetchGraph]);

  const incrementStats = useCallback((addedNodes, addedEdges) => {
    const nodeArr = Array.isArray(addedNodes) ? addedNodes : [];
    const edgeNum = typeof addedEdges === 'number' ? addedEdges : 0;
    if (nodeArr.length === 0 && edgeNum === 0) return;
    setStats((prev) => {
      const types = { ...prev.types };
      for (const node of nodeArr) {
        const t = node.type || 'semantic';
        types[t] = (types[t] || 0) + 1;
      }
      return { nodes: prev.nodes + nodeArr.length, edges: prev.edges + edgeNum, types };
    });
  }, []);

  // refresh() stays a foreground reload; callers pass it around as a bare callback.
  const refresh = useCallback(() => fetchGraph(), [fetchGraph]);

  return { nodes, edges, loading, error, stats, refresh, incrementStats };
}
