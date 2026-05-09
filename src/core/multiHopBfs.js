/**
 * Client-side multi-hop BFS expansion over an in-memory adjacency view of
 * GraphNodes/GraphEdges.
 *
 * Why a cap: real codebase graphs (and any agentic memory graph past ~1k
 * nodes) have hub nodes that, with no per-hop bound, will hand the layout
 * engine the entire graph in a single click and pin the main thread for
 * tens of seconds.
 *
 * Per the project's no-silent-degradation rule:
 *   • Hitting the cap logs a WARNING with hop number, requested count and
 *     dropped count.
 *   • The truncation is surfaced on the returned hop result via
 *     `truncated: true` + `dropped` so the UI can render an indicator
 *     (e.g. "+N more, click to expand") without re-querying.
 *
 * No fallthrough — if the cap fires we keep the first MAX_PER_HOP frontier
 * neighbours (deterministic by edge order), drop the rest, and continue.
 *
 * Pure / dependency-free so it can be unit-tested without React or
 * Cytoscape. Consumers pass in their own {nodes, edges} snapshot.
 */

export const DEFAULT_MAX_NODES_PER_HOP = 100;

/**
 * Build an adjacency map from edges. Returns Map<nodeId, Array<{ id, edge }>>
 * where `id` is the neighbour's id and `edge` is the originating GraphEdge.
 */
export function buildAdjacency(edges, { directed = false } = {}) {
  const adj = new Map();
  for (const e of edges) {
    if (!e || !e.source || !e.target) continue;
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source).push({ id: e.target, edge: e });
    if (!directed) {
      if (!adj.has(e.target)) adj.set(e.target, []);
      adj.get(e.target).push({ id: e.source, edge: e });
    }
  }
  return adj;
}

/**
 * Run a BFS from `startId` to depth `maxHops`.
 *
 * @param {object}   args
 * @param {string}   args.startId
 * @param {Map}      args.adjacency   - from buildAdjacency()
 * @param {number}   [args.maxHops=2]
 * @param {number}   [args.maxNodesPerHop=DEFAULT_MAX_NODES_PER_HOP]
 * @param {(msg:string,meta:object)=>void} [args.warn=console.warn]
 *
 * @returns {{
 *   nodes: Set<string>,
 *   edges: Array<object>,
 *   hops:  Array<{ hop:number, requested:number, kept:number, dropped:number, truncated:boolean }>,
 *   truncated: boolean,
 * }}
 */
export function bfsExpand({
  startId,
  adjacency,
  maxHops = 2,
  maxNodesPerHop = DEFAULT_MAX_NODES_PER_HOP,
  warn = (msg, meta) => console.warn(msg, meta),
} = {}) {
  if (!startId) throw new Error('bfsExpand: startId is required');
  if (!(adjacency instanceof Map)) {
    throw new Error('bfsExpand: adjacency must be a Map (use buildAdjacency)');
  }
  if (!Number.isFinite(maxHops) || maxHops < 0) {
    throw new Error(`bfsExpand: maxHops must be a non-negative finite number (got ${maxHops})`);
  }
  if (!Number.isFinite(maxNodesPerHop) || maxNodesPerHop <= 0) {
    throw new Error(`bfsExpand: maxNodesPerHop must be > 0 (got ${maxNodesPerHop})`);
  }

  const visited = new Set([startId]);
  const collectedEdges = [];
  const seenEdgeKeys = new Set();
  const hops = [];

  let frontier = [startId];
  let anyTruncated = false;

  for (let hop = 1; hop <= maxHops; hop++) {
    const candidates = [];      // [{ id, edge }]
    const seenInHop = new Set();

    for (const fid of frontier) {
      const neighbours = adjacency.get(fid) || [];
      for (const { id, edge } of neighbours) {
        if (visited.has(id)) {
          // still record the edge — it might be a back-link to a prior hop
          const key = edge.id || `${edge.source}->${edge.target}:${edge.label || edge.type || ''}`;
          if (!seenEdgeKeys.has(key)) {
            seenEdgeKeys.add(key);
            collectedEdges.push(edge);
          }
          continue;
        }
        if (seenInHop.has(id)) continue;
        seenInHop.add(id);
        candidates.push({ id, edge });
      }
    }

    const requested = candidates.length;
    let kept = candidates;
    let dropped = 0;
    let truncated = false;
    if (requested > maxNodesPerHop) {
      kept = candidates.slice(0, maxNodesPerHop);
      dropped = requested - maxNodesPerHop;
      truncated = true;
      anyTruncated = true;
      warn(
        '[multiHopBfs] hop expansion truncated',
        {
          hop,
          requested,
          kept: kept.length,
          dropped,
          maxNodesPerHop,
          startId,
        },
      );
    }

    for (const { id, edge } of kept) {
      visited.add(id);
      const key = edge.id || `${edge.source}->${edge.target}:${edge.label || edge.type || ''}`;
      if (!seenEdgeKeys.has(key)) {
        seenEdgeKeys.add(key);
        collectedEdges.push(edge);
      }
    }

    hops.push({
      hop,
      requested,
      kept: kept.length,
      dropped,
      truncated,
    });

    if (kept.length === 0) break; // nothing new — stop early
    frontier = kept.map((c) => c.id);
  }

  return {
    nodes: visited,
    edges: collectedEdges,
    hops,
    truncated: anyTruncated,
  };
}
