import { useState, useCallback, useRef, useEffect } from 'react';
import { buildAdjacency, bfsExpand } from '../core/multiHopBfs';
import {
  buildBfsHopNodeSets,
  buildReplayPlan,
  HOP_COLORS,
  HOP_DELAY_MS,
  FADE_DURATION_MS,
} from '../core/hopReplayPlan';

/**
 * Every style the replay writes as a per-element bypass. Anything listed here must be
 * removable in one call, or a reset leaves the canvas on replay-owned values instead of
 * the stylesheet's (edge `width` and node `border-width` in particular vary by type).
 */
const REPLAY_OWNED_STYLES = 'opacity border-width border-color line-color width';

/**
 * Orchestrates a hop-by-hop reveal animation on the Cytoscape canvas.
 *
 * Dims all elements, then progressively reveals nodes in timed groups, each in a
 * distinct colour. The hook owns only the canvas side of that — WHICH nodes belong
 * to which hop comes from one of two independent sources (GRAPH-MULTIHOP-VIZ-1):
 *
 *   • `startReplay(nodeId)` — GRAPH DISTANCE. BFS out from a clicked node over the
 *     already-loaded edges. Answers "what is near this?"
 *   • `startRetrievalReplay(hopNodeSets)` — RETRIEVAL PROVENANCE. Precomputed groups
 *     from `groupByRetrievalHop(results)`, i.e. which hop of a multi-hop search first
 *     surfaced each result. Answers "how did the search get here?"
 *
 * Neither derives the other (a result found at retrieval hop 2 may be one edge away,
 * or unconnected in the loaded subgraph). Keeping the grouping outside the hook is
 * what lets both drive the same animation.
 *
 * Uses already-loaded graph data — no API calls.
 *
 * @param {Object} options
 * @param {Object} options.cytoscape - useCytoscape return value (cy ref + helpers)
 * @param {Object} options.graphData - useGraphData return value ({ nodes, edges })
 */
export function useMultiHopReplay({ cytoscape, graphData }) {
  const [replayState, setReplayState] = useState('idle');
  const [replayMode, setReplayMode] = useState(null); // 'bfs' | 'retrieval' | null
  const [activeHop, setActiveHop] = useState(-1);
  const [hopStats, setHopStats] = useState(null);
  const [frameCount, setFrameCount] = useState(0);
  const cancelRef = useRef(false);
  const timersRef = useRef([]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  /**
   * Apply a built plan to the canvas.
   *
   * Edge reveal is PROGRESSIVE: an edge lights up only once both of its endpoints
   * have already been revealed by an earlier-or-current frame. The previous
   * implementation tested against the fully-populated visited set, which existed
   * before the first frame fired — so an edge into a hop-3 node was drawn bright at
   * hop 1 while that endpoint was still dimmed to 0.08. The code contradicted its
   * own comment ("connecting to previously-revealed nodes"); the comment was right.
   */
  const playPlan = useCallback((plan, mode) => {
    const cy = cytoscape?.cy?.current;
    if (!cy) return;
    if (!plan.frames.length) return;

    clearTimers();
    cancelRef.current = false;
    setReplayMode(mode);
    setFrameCount(plan.frames.length);
    setReplayState('playing');
    setActiveHop(0);

    // Reset the canvas before dimming, so a re-run starts clean rather than
    // inheriting the last run's hop hues.
    //
    // `stop(true)` FIRST, and it is not optional: `removeStyle` does not cancel an
    // in-flight animation. An element still mid-reveal simply finishes and reapplies
    // its old hop colour on top of the new run, and the new dim/reveal work queues
    // behind whatever is still playing. Clearing the queue is what makes the reset real.
    //
    // Colours are then REMOVED, never animated to null: Cytoscape lowercases every
    // animated value as a colour string, so a null in an animate() payload throws.
    cy.elements().stop(true);
    cy.elements().removeStyle(REPLAY_OWNED_STYLES);

    // Dim everything first
    cy.elements().animate(
      { style: { opacity: 0.08 } },
      { duration: FADE_DURATION_MS },
    );

    const revealed = new Set();

    const renderFrame = (frame) => {
      if (cancelRef.current) return;
      setActiveHop(frame.hop);

      // Mark the whole frame revealed before drawing edges, so edges WITHIN a
      // single hop (two hop-1 results linked to each other) are drawn too.
      for (const nid of frame.nodeIds) revealed.add(nid);

      for (const nid of frame.nodeIds) {
        const node = cy.getElementById(nid);
        if (!node.length) continue;
        node.animate(
          { style: { opacity: 1, 'border-width': frame.borderWidth, 'border-color': frame.color } },
          { duration: FADE_DURATION_MS },
        );

        node.connectedEdges().forEach((edge) => {
          if (!revealed.has(edge.source().id())) return;
          if (!revealed.has(edge.target().id())) return;
          edge.animate(
            { style: { opacity: 0.7, 'line-color': frame.color, width: 2 } },
            { duration: FADE_DURATION_MS },
          );
        });
      }
    };

    plan.frames.forEach((frame, idx) => {
      const isLast = idx === plan.frames.length - 1;
      const finish = () => {
        if (isLast) {
          const doneTimer = setTimeout(() => {
            if (!cancelRef.current) setReplayState('done');
          }, FADE_DURATION_MS + 200);
          timersRef.current.push(doneTimer);
        }
      };

      // Frame 0 renders immediately — a leading blank beat reads as a stall.
      if (frame.delayMs === 0) {
        renderFrame(frame);
        finish();
        return;
      }
      const timer = setTimeout(() => {
        if (cancelRef.current) return;
        renderFrame(frame);
        finish();
      }, frame.delayMs);
      timersRef.current.push(timer);
    });
  }, [cytoscape, clearTimers]);

  /** BFS replay: group by graph distance from a clicked start node. */
  const startReplay = useCallback((startNodeId, maxHops = 3) => {
    const cy = cytoscape?.cy?.current;
    if (!cy || !startNodeId) return;
    if (!graphData?.edges?.length) return;

    const adjacency = buildAdjacency(graphData.edges);
    const result = bfsExpand({
      startId: startNodeId,
      adjacency,
      maxHops,
      maxNodesPerHop: 50,
    });

    setHopStats(result.hops);

    const { hopNodeSets } = buildBfsHopNodeSets({
      startNodeId,
      adjacency,
      reachable: result.nodes,
      hopCount: result.hops.length,
    });

    playPlan(buildReplayPlan(hopNodeSets, { seedNodeId: startNodeId }), 'bfs');
  }, [cytoscape, graphData, playPlan]);

  /**
   * Retrieval replay: reveal precomputed hop groups from a search result set.
   *
   * The caller owns the grouping AND the decision to animate at all — gate on
   * `shouldEnterRetrievalReplay(results)`, never on a raw max hop, or a set whose
   * later hops hold only duplicates will play blank frames.
   *
   * @param {Array<Array<string>>} hopNodeSets — index = retrieval hop, value = ids
   */
  const startRetrievalReplay = useCallback((hopNodeSets) => {
    const cy = cytoscape?.cy?.current;
    if (!cy) return;
    if (!Array.isArray(hopNodeSets) || hopNodeSets.length === 0) return;

    setHopStats(null);
    playPlan(buildReplayPlan(hopNodeSets), 'retrieval');
  }, [cytoscape, playPlan]);

  /**
   * Abandon a running replay WITHOUT the restore animation.
   *
   * For when the elements the replay was animating are about to be replaced (a new
   * result set landing under a mounted canvas). `stopReplay` would fade the OLD run's
   * elements back in over the NEW data; this just drops the run. Without it, search A's
   * timers keep ticking over search B — recolouring any shared ids and driving the hop
   * indicator — and if B never starts a replay of its own, nothing ever clears them.
   */
  const cancelReplay = useCallback(() => {
    cancelRef.current = true;
    clearTimers();
    setReplayState('idle');
    setReplayMode(null);
    setActiveHop(-1);
    setHopStats(null);
    setFrameCount(0);
    const cy = cytoscape?.cy?.current;
    if (cy) {
      try {
        cy.elements().stop(true);
        cy.elements().removeStyle(REPLAY_OWNED_STYLES);
      } catch (_) { /* canvas already gone */ }
    }
  }, [cytoscape, clearTimers]);

  const stopReplay = useCallback(() => {
    cancelRef.current = true;
    clearTimers();
    setReplayState('idle');
    setReplayMode(null);
    setActiveHop(-1);
    setHopStats(null);
    setFrameCount(0);

    const cy = cytoscape?.cy?.current;
    if (cy) {
      // Kill anything still animating first — `removeStyle` alone does not cancel an
      // in-flight animation, so a node mid-reveal would finish and reapply its hop
      // colour after the restore had already run.
      cy.elements().stop(true);
      // Colours are REMOVED, not animated to null. Cytoscape parses every animated
      // style value as a colour string and lowercases it, so a null in this payload
      // throws `Cannot read properties of null (reading 'toLowerCase')` and aborts the
      // whole restore — leaving the canvas dimmed at 0.08 with no way back.
      cy.elements().removeStyle('border-color line-color');
      cy.elements().animate(
        { style: { opacity: 1, 'border-width': 2 } },
        {
          duration: FADE_DURATION_MS,
          // Fade back, THEN hand control to the stylesheet. Leaving the animated
          // values in place would keep every element on a replay-owned bypass —
          // notably edge `width` and node `border-width`, which the stylesheet varies
          // by type — so the canvas would stay subtly wrong after a reset.
          complete: () => {
            try {
              cy.elements().removeStyle(REPLAY_OWNED_STYLES);
            } catch (_) { /* canvas destroyed mid-fade */ }
          },
        },
      );
    }
  }, [cytoscape, clearTimers]);

  // Timers outlive the component without this — a replay started just before a
  // route change kept firing into a destroyed canvas.
  useEffect(() => () => {
    cancelRef.current = true;
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  return {
    replayState,
    replayMode,
    activeHop,
    hopStats,
    frameCount,
    startReplay,
    startRetrievalReplay,
    stopReplay,
    cancelReplay,
    HOP_COLORS,
    HOP_DELAY_MS,
  };
}
