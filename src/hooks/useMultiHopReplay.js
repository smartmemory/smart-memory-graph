import { useState, useCallback, useRef, useEffect } from 'react';
import { isEditableTarget } from '../core/graphKeyboard';
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

/** Hops a stepped explore may lay out. "No hop limit, just no loops" (OWNER 2026-11-27): BFS never revisits. */
const MAX_STEPPED_HOPS = 200;

/** Reset the canvas and dim everything, ready for a reveal. `stop(true)` first: see `playPlan`. */
function dimAll(cy) {
  cy.elements().stop(true);
  cy.elements().removeStyle(REPLAY_OWNED_STYLES);
  cy.elements().animate({ style: { opacity: 0.08 } }, { duration: FADE_DURATION_MS });
}

/**
 * Reveal one frame. THE reveal code: Explore Hops, Expand Neighbors and the search replay all
 * draw a hop through this. An edge lights only once both endpoints are in `revealed`, and the
 * whole frame is marked revealed first so edges WITHIN a hop are drawn too.
 */
function revealFrame(cy, frame, revealed) {
  for (const nid of frame.nodeIds) revealed.add(nid);
  for (const nid of frame.nodeIds) {
    const node = cy.getElementById(nid);
    if (!node.length) continue;
    node.animate(
      { style: { opacity: 1, 'border-width': frame.borderWidth, 'border-color': frame.color } },
      { duration: FADE_DURATION_MS },
    );
    node.connectedEdges().forEach((edge) => {
      if (!revealed.has(edge.source().id()) || !revealed.has(edge.target().id())) return;
      edge.animate(
        { style: { opacity: 0.7, 'line-color': frame.color, width: 2 } },
        { duration: FADE_DURATION_MS },
      );
    });
  }
}

/**
 * Hop groups by graph distance from `seedId` over what the canvas holds RIGHT NOW (nodes added by
 * an expand included), skipping anything a left-hand filter hides. Trailing empty hops are cut so
 * "hop N of M" counts steps that add something.
 */
function hopSetsFromCanvas(cy, seedId) {
  const edges = [];
  cy.edges().forEach((e) => {
    if (e.hasClass('dimmed') || e.source().hasClass('dimmed') || e.target().hasClass('dimmed')) return;
    edges.push({ id: e.id(), source: e.source().id(), target: e.target().id() });
  });
  const adjacency = buildAdjacency(edges);
  const result = bfsExpand({ startId: seedId, adjacency, maxHops: MAX_STEPPED_HOPS, maxNodesPerHop: 50 });
  const { hopNodeSets } = buildBfsHopNodeSets({
    startNodeId: seedId, adjacency, reachable: result.nodes, hopCount: result.hops.length,
  });
  while (hopNodeSets.length && hopNodeSets[hopNodeSets.length - 1].length === 0) hopNodeSets.pop();
  return { hopNodeSets, capped: result.truncated };
}

/**
 * Orchestrates a hop-by-hop reveal animation on the Cytoscape canvas.
 *
 * Dims all elements, then progressively reveals nodes in timed groups, each in a
 * distinct colour. The hook owns only the canvas side of that — WHICH nodes belong
 * to which hop comes from one of two independent sources (GRAPH-MULTIHOP-VIZ-1):
 *
 *   • `startReplay(nodeId)` — GRAPH DISTANCE, stepped by the user (`nextHop`/`prevHop`). BFS out
 *     from a clicked node over the edges the canvas holds. Answers "what is near this?"
 *   • `startRetrievalReplay(hopNodeSets)` — RETRIEVAL PROVENANCE. Precomputed groups
 *     from `groupByRetrievalHop(results)`, i.e. which hop of a multi-hop search first
 *     surfaced each result. Answers "how did the search get here?"
 *
 * Neither derives the other (a result found at retrieval hop 2 may be one edge away,
 * or unconnected in the loaded subgraph). Keeping the grouping outside the hook is
 * what lets both drive the same animation.
 *
 * Makes no API calls: it reads the canvas.
 *
 * @param {Object} options
 * @param {Object} options.cytoscape - useCytoscape return value (cy ref + helpers)
 */
export function useMultiHopReplay({ cytoscape }) {
  const [replayState, setReplayState] = useState('idle');
  const [replayMode, setReplayMode] = useState(null); // 'step' | 'retrieval' | null
  const [activeHop, setActiveHop] = useState(-1);
  const [hopStats, setHopStats] = useState(null);
  const [frameCount, setFrameCount] = useState(0);
  const [step, setStep] = useState(null); // stepped explore: { seedId, active, total, added, capped }
  const stepFramesRef = useRef([]);
  const revealedRef = useRef(new Set());
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

    dimAll(cy);

    const revealed = new Set();

    const renderFrame = (frame) => {
      if (cancelRef.current) return;
      setActiveHop(frame.hop);

      revealFrame(cy, frame, revealed);
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

  /**
   * Stepped explore: dim the graph and show only `seedId`, then the user walks outward with
   * `nextHop` / `prevHop`. `toHop` reveals that many steps at once (Expand Neighbors shows its one
   * hop with `toHop: 1`). Nothing plays by itself.
   */
  const startReplay = useCallback((seedId, { toHop = 0 } = {}) => {
    const cy = cytoscape?.cy?.current;
    if (!cy || !seedId || !cy.getElementById(seedId).length) return;
    clearTimers();
    cancelRef.current = false;
    const { hopNodeSets, capped } = hopSetsFromCanvas(cy, seedId);
    const plan = buildReplayPlan(hopNodeSets, { seedNodeId: seedId });
    stepFramesRef.current = plan.frames;
    revealedRef.current = new Set();
    dimAll(cy);
    const active = Math.min(toHop, plan.frames.length - 1);
    for (let i = 0; i <= active; i++) revealFrame(cy, plan.frames[i], revealedRef.current);
    setHopStats(null);
    setReplayMode('step');
    setFrameCount(plan.frames.length);
    setStep({ seedId, active, total: plan.frames.length - 1, added: plan.frames[active].nodeIds.length, capped });
    setActiveHop(active);
    setReplayState('stepping');
  }, [cytoscape, clearTimers]);

  const showStep = useCallback((active) => {
    const frames = stepFramesRef.current;
    setStep((prev) => prev && { ...prev, active, added: frames[active].nodeIds.length });
    setActiveHop(active);
  }, []);

  /** One more step outward. */
  const nextHop = useCallback(() => {
    const cy = cytoscape?.cy?.current;
    const frames = stepFramesRef.current;
    if (!cy || !step || step.active >= step.total) return;
    revealFrame(cy, frames[step.active + 1], revealedRef.current);
    showStep(step.active + 1);
  }, [cytoscape, step, showStep]);

  /** Hide the last step: rebuild the view one step shorter. */
  const prevHop = useCallback(() => {
    const cy = cytoscape?.cy?.current;
    const frames = stepFramesRef.current;
    if (!cy || !step || step.active <= 0) return;
    revealedRef.current = new Set();
    dimAll(cy);
    for (let i = 0; i < step.active; i++) revealFrame(cy, frames[i], revealedRef.current);
    showStep(step.active - 1);
  }, [cytoscape, step, showStep]);

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
    setStep(null);
    revealedRef.current = new Set();
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
    setStep(null);
    revealedRef.current = new Set();

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

  // While a stepped view is on, a click outside the lit set (empty canvas, a dimmed node or link) or
  // Escape brings back the full graph. Local to this hook: the shared canvas store is untouched.
  const stepping = replayState === 'stepping';
  useEffect(() => {
    const cy = cytoscape?.cy?.current;
    if (!stepping || !cy) return undefined;
    const lit = (el) => (el.isNode()
      ? revealedRef.current.has(el.id())
      : revealedRef.current.has(el.source().id()) && revealedRef.current.has(el.target().id()));
    const onTap = (evt) => {
      if (evt.target !== cy && lit(evt.target)) return;
      stopReplay();
    };
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isEditableTarget(e.target)) return;
      stopReplay();
    };
    cy.on('tap', onTap);
    document.addEventListener('keydown', onKey);
    return () => {
      cy.off('tap', onTap);
      document.removeEventListener('keydown', onKey);
    };
  }, [stepping, cytoscape, stopReplay]);

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
    step,
    startReplay,
    nextHop,
    prevHop,
    showAll: stopReplay,
    startRetrievalReplay,
    stopReplay,
    cancelReplay,
    HOP_COLORS,
    HOP_DELAY_MS,
  };
}
