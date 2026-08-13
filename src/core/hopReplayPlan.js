/**
 * Timing + colour plan for a hop-by-hop reveal animation (GRAPH-MULTIHOP-VIZ-1 G3).
 *
 * `useMultiHopReplay` used to derive its hop groups internally from `bfsExpand`,
 * which hard-wired the animation to ONE grouping source (graph distance). This
 * module is the seam that lets a second, genuinely different source drive the
 * same animation: retrieval provenance, via `groupByRetrievalHop` in
 * `retrievalHops.js`.
 *
 * The split is deliberate: everything here is pure (no React, no Cytoscape), so
 * frame ordering, colour cycling and timing are unit-testable without a DOM,
 * and the hook is reduced to "apply these frames to the canvas".
 *
 * Two callers, one frame model:
 *
 *   • BFS replay seeds from a clicked node — frame 0 is that single start node,
 *     and `hopNodeSets[i]` becomes frame i+1. Pass `seedNodeId`.
 *   • Retrieval replay has no seed — hop 0 IS the original query's own result
 *     set, a real group of many nodes. Pass no `seedNodeId`.
 *
 * Normalising both into "frame N renders at N * HOP_DELAY_MS in HOP_COLORS[N]"
 * keeps the BFS timing byte-identical to what shipped while letting the
 * retrieval path start its first group at t=0 instead of leaving a blank frame.
 */

/** Per-hop reveal colours, cycled by frame index. Wired + shipped — do not re-theme. */
export const HOP_COLORS = ['#3b82f6', '#06b6d4', '#8b5cf6', '#22c55e'];

/** Delay between consecutive frames. */
export const HOP_DELAY_MS = 700;

/** Fade duration of a single reveal/dim transition. */
export const FADE_DURATION_MS = 350;

/** Border width for the seeded start node vs. an ordinary hop member. */
export const SEED_BORDER_WIDTH = 6;
export const HOP_BORDER_WIDTH = 4;

/**
 * Build the ordered frames of a hop reveal.
 *
 * Empty groups keep their slot rather than collapsing: hop N must stay hop N
 * (same colour, same beat) whether or not hop N-1 contributed anything, because
 * both colour and delay are chosen by index. A collapsing plan would silently
 * relabel hops — the exact dishonesty `groupByRetrievalHop` refuses upstream.
 *
 * @param {Array<Array<string>>} hopNodeSets — ids per hop, index = hop number
 * @param {Object} [options]
 * @param {string|null} [options.seedNodeId] — when set, prepended as frame 0
 *   (BFS mode) and every `hopNodeSets` entry shifts one frame later.
 * @returns {{frames: Array<{hop: number, nodeIds: string[], color: string,
 *   delayMs: number, borderWidth: number, isSeed: boolean}>, totalMs: number}}
 */
export function buildReplayPlan(hopNodeSets, { seedNodeId = null } = {}) {
  const sets = Array.isArray(hopNodeSets) ? hopNodeSets : [];
  const groups = seedNodeId ? [[seedNodeId], ...sets] : sets;

  const frames = groups.map((nodeIds, hop) => {
    const isSeed = !!seedNodeId && hop === 0;
    return {
      hop,
      nodeIds: Array.isArray(nodeIds) ? nodeIds.filter((id) => typeof id === 'string' && id) : [],
      color: HOP_COLORS[hop % HOP_COLORS.length],
      delayMs: hop * HOP_DELAY_MS,
      borderWidth: isSeed ? SEED_BORDER_WIDTH : HOP_BORDER_WIDTH,
      isSeed,
    };
  });

  const totalMs = frames.length ? frames[frames.length - 1].delayMs + FADE_DURATION_MS : 0;
  return { frames, totalMs };
}

/**
 * Derive BFS hop groups (graph distance from a start node).
 *
 * Lifted verbatim out of `useMultiHopReplay` so the hook holds no grouping logic
 * at all — the two sources (this and `groupByRetrievalHop`) now sit side by side
 * as peers rather than one being privileged by living inside the hook.
 *
 * @param {Object} params
 * @param {string} params.startNodeId
 * @param {Map<string, Array<{id: string}>>} params.adjacency — from `buildAdjacency`
 * @param {Set<string>} params.reachable — nodes `bfsExpand` deemed in range
 * @param {number} params.hopCount — how many hops to lay out
 * @returns {{hopNodeSets: Array<Array<string>>, visited: Set<string>}}
 */
export function buildBfsHopNodeSets({ startNodeId, adjacency, reachable, hopCount }) {
  const hopNodeSets = [];
  const visited = new Set([startNodeId]);

  let frontier = [startNodeId];
  for (let hop = 0; hop < hopCount; hop++) {
    const nextFrontier = [];
    const hopNodes = [];
    for (const fid of frontier) {
      const neighbours = adjacency.get(fid) || [];
      for (const { id } of neighbours) {
        if (visited.has(id)) continue;
        if (!reachable.has(id)) continue;
        visited.add(id);
        hopNodes.push(id);
        nextFrontier.push(id);
      }
    }
    hopNodeSets.push(hopNodes);
    frontier = nextFrontier;
  }

  return { hopNodeSets, visited };
}
