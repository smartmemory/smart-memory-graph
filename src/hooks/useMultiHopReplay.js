import { useState, useCallback, useRef, useEffect } from 'react';
import { isEditableTarget } from '../core/graphKeyboard';
import { buildAdjacency } from '../core/multiHopBfs';
import {
  planSteppedHops,
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
 * "Next hop" past the loaded graph fetches one request per frontier node, at most this many nodes;
 * a wider step asks the user to expand one node. Default by s1-chat, not owner-set.
 */
export const FETCH_FRONTIER_LIMIT = 10;

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
 * Stepped-explore frames from what the canvas holds RIGHT NOW (nodes an expand or fetch added
 * included), skipping anything a left-hand filter hides. "No hop limit, just no loops" (OWNER
 * 2026-11-27): the planner runs until nothing new is reachable and never revisits a node.
 */
function planFromCanvas(cy, explore) {
  const edges = [];
  cy.edges().forEach((e) => {
    if (e.hasClass('dimmed') || e.source().hasClass('dimmed') || e.target().hasClass('dimmed')) return;
    edges.push({ id: e.id(), source: e.source().id(), target: e.target().id() });
  });
  const isVisible = (id) => {
    const node = cy.getElementById(id);
    return node.length > 0 && !node.hasClass('dimmed');
  };
  const { hopNodeSets, capped } = planSteppedHops({
    seedId: explore.seedId, adjacency: buildAdjacency(edges), isVisible, forced: explore.forced,
  });
  return { frames: buildReplayPlan(hopNodeSets, { seedNodeId: explore.seedId }).frames, capped };
}

const frameKey = (frame) => (frame ? frame.nodeIds.join('\n') : '');
const sameFrames = (a, b) => a.length === b.length && a.every((f, i) => frameKey(f) === frameKey(b[i]));

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
 * It reads the canvas. Its one network use is the stepped view's "Next hop" past the loaded
 * graph, through the host's `fetchNeighbors` (the call Expand Neighbors uses).
 *
 * @param {Object} options
 * @param {Object} options.cytoscape - useCytoscape return value (cy ref + helpers)
 * @param {function} [options.fetchNeighbors] - async (nodeId) => neighbour rows; null = no fetch past the loaded graph
 * @param {function} [options.addNeighbors] - (nodeId, rows) => ids, puts fetched rows on the canvas
 * @param {Object} [options.rootRef] - the explorer's root element: Escape counts only from inside it (or from the page)
 * @param {boolean} [options.active] - false while the explorer's tab is hidden: Escape is ignored
 */
export function useMultiHopReplay({ cytoscape, fetchNeighbors = null, addNeighbors = null, rootRef = null, active = true }) {
  const [replayState, setReplayState] = useState('idle');
  const [replayMode, setReplayMode] = useState(null); // 'step' | 'retrieval' | null
  const [activeHop, setActiveHop] = useState(-1);
  const [hopStats, setHopStats] = useState(null);
  const [frameCount, setFrameCount] = useState(0);
  const [step, setStep] = useState(null); // stepped explore: { seedId, active, total, added, capped }
  const stepFramesRef = useRef([]);
  const stepRef = useRef(null); // the step state as of now, for handlers called between renders
  // The current stepped exploration: seed, ids forced into a hop by a fetch, nodes already fetched
  // (never fetched again), and fetched rows waiting for the user's "Next hop".
  const exploreRef = useRef(null);
  // Bumped by every new view (explore, retrieval replay, Show all): a pending fetch for an older one
  // adds its data but draws nothing.
  const generationRef = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;
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
   * Show `frames` at step `active`. `redraw` repaints from scratch (dim all, reveal 0..active);
   * otherwise the caller has revealed the new frame itself. What the server may hold beyond the
   * last step (`more`) is kept only while the step and its frontier are unchanged.
   */
  const applyStep = useCallback((frames, active, capped, redraw) => {
    const cy = cytoscape?.cy?.current;
    const explore = exploreRef.current;
    if (!cy || !explore) return;
    stepFramesRef.current = frames;
    if (redraw) {
      revealedRef.current = new Set();
      dimAll(cy);
      for (let i = 0; i <= active; i++) revealFrame(cy, frames[i], revealedRef.current);
    }
    const prev = stepRef.current;
    const total = frames.length - 1;
    const same = prev && prev.active === active && prev.total === total && prev.frontier === frameKey(frames[active]);
    const next = {
      seedId: explore.seedId, active, total, added: frames[active].nodeIds.length, capped,
      frontier: frameKey(frames[active]), more: same ? prev.more : (active === total ? 'idle' : null),
    };
    stepRef.current = next;
    setStep(next);
    setFrameCount(frames.length);
    setActiveHop(active);
  }, [cytoscape]);

  const setMore = useCallback((more) => {
    if (!stepRef.current) return;
    stepRef.current = { ...stepRef.current, more };
    setStep(stepRef.current);
  }, []);

  /**
   * Stepped explore: dim the graph and show only `seedId`, then the user walks outward with
   * `nextHop` / `prevHop`. `toHop` reveals that many steps at once. Expand Neighbors passes
   * `firstHop`, the ids its fetch returned: they are hop 1 whatever the node's neighbour count, and
   * the seed counts as fetched. Nothing plays by itself.
   */
  const startReplay = useCallback((seedId, { toHop = 0, firstHop = null } = {}) => {
    const cy = cytoscape?.cy?.current;
    if (!cy || !seedId || !cy.getElementById(seedId).length) return;
    generationRef.current++;
    clearTimers();
    cancelRef.current = false;
    exploreRef.current = {
      seedId,
      forced: firstHop ? [[], firstHop] : [],
      fetched: new Set(firstHop ? [seedId] : []),
      pending: new Map(),
    };
    stepRef.current = null;
    const { frames, capped } = planFromCanvas(cy, exploreRef.current);
    setHopStats(null);
    setReplayMode('step');
    setReplayState('stepping');
    applyStep(frames, Math.min(toHop, frames.length - 1), capped, true);
  }, [cytoscape, clearTimers, applyStep]);

  /**
   * Re-plan the stepped view after the left-hand filters changed (the host calls this right after
   * applying them), so "hop N of M" and "+k nodes" describe what the canvas shows. No-op when the
   * steps are unchanged.
   */
  const refreshStep = useCallback(() => {
    const cy = cytoscape?.cy?.current;
    const s = stepRef.current;
    const explore = exploreRef.current;
    if (!cy || !s || !explore || !cy.getElementById(explore.seedId).length) return;
    const { frames, capped } = planFromCanvas(cy, explore);
    if (capped === s.capped && sameFrames(frames, stepFramesRef.current)) return;
    applyStep(frames, Math.min(s.active, frames.length - 1), capped, true);
  }, [cytoscape, applyStep]);

  /** Ids the fetched rows would add: not yet in any step of this exploration. */
  const pendingNewIds = useCallback(() => {
    const shown = new Set(stepFramesRef.current.flatMap((f) => f.nodeIds));
    const ids = [...exploreRef.current.pending.values()].flat().map((r) => r?.item_id);
    return ids.filter((id) => id && !shown.has(id));
  }, []);

  /**
   * At the last loaded step, ask the server what lies one step further: one request per frontier
   * node not fetched before, at most FETCH_FRONTIER_LIMIT. The rows are held until "Next hop".
   */
  const probeMore = useCallback(async () => {
    const explore = exploreRef.current;
    const s = stepRef.current;
    if (!explore || !s) return;
    if (!fetchNeighbors || !addNeighbors) { setMore('off'); return; }
    const frontier = stepFramesRef.current[s.active].nodeIds.filter((id) => !explore.fetched.has(id));
    if (!frontier.length) { setMore(pendingNewIds().length ? 'available' : 'none'); return; }
    if (frontier.length > FETCH_FRONTIER_LIMIT) { setMore('tooMany'); return; }
    const generation = generationRef.current;
    setMore('checking');
    frontier.forEach((id) => explore.fetched.add(id));
    try {
      const results = await Promise.all(frontier.map(async (id) => [id, await fetchNeighbors(id)]));
      if (generation !== generationRef.current) return;
      for (const [id, rows] of results) if (rows.length) explore.pending.set(id, rows);
      setMore(pendingNewIds().length ? 'available' : 'none');
    } catch {
      if (generation === generationRef.current) setMore('error');
    }
  }, [fetchNeighbors, addNeighbors, setMore, pendingNewIds]);

  useEffect(() => {
    if (step?.more === 'idle') probeMore();
  }, [step, probeMore]);

  /** Put the held rows on the canvas as the next hop and show it. */
  const revealFetched = useCallback(() => {
    const cy = cytoscape?.cy?.current;
    const explore = exploreRef.current;
    const s = stepRef.current;
    const ids = [];
    for (const [nodeId, rows] of explore.pending) ids.push(...addNeighbors(nodeId, rows));
    explore.pending.clear();
    const hop = s.active + 1;
    explore.forced[hop] = [...(explore.forced[hop] || []), ...ids];
    const { frames, capped } = planFromCanvas(cy, explore);
    applyStep(frames, Math.min(hop, frames.length - 1), capped, true);
  }, [cytoscape, addNeighbors, applyStep]);

  /** One more step outward; past the loaded graph, the step the server sent. */
  const nextHop = useCallback(() => {
    const cy = cytoscape?.cy?.current;
    const s = stepRef.current;
    if (!cy || !s) return;
    if (s.active < s.total) {
      revealFrame(cy, stepFramesRef.current[s.active + 1], revealedRef.current);
      applyStep(stepFramesRef.current, s.active + 1, s.capped, false);
    } else if (s.more === 'available') {
      revealFetched();
    }
  }, [cytoscape, applyStep, revealFetched]);

  /** Hide the last step: rebuild the view one step shorter. */
  const prevHop = useCallback(() => {
    const s = stepRef.current;
    if (!s || s.active <= 0) return;
    applyStep(stepFramesRef.current, s.active - 1, s.capped, true);
  }, [applyStep]);

  /** A new view or none: forget the exploration; a pending fetch for it draws nothing. */
  const endExploration = useCallback(() => {
    generationRef.current++;
    exploreRef.current = null;
    stepRef.current = null;
  }, []);

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

    endExploration();
    setHopStats(null);
    playPlan(buildReplayPlan(hopNodeSets), 'retrieval');
  }, [cytoscape, playPlan, endExploration]);

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
    endExploration();
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
  }, [cytoscape, clearTimers, endExploration]);

  const stopReplay = useCallback(() => {
    endExploration();
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
  }, [cytoscape, clearTimers, endExploration]);

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
    // Escape is this explorer's only while its tab is shown, and only from inside it or from no
    // control at all (the page itself); a control elsewhere on the page keeps its own Escape.
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isEditableTarget(e.target)) return;
      if (!activeRef.current) return;
      const root = rootRef?.current;
      const doc = root?.ownerDocument;
      const fromPage = !e.target || e.target === doc || e.target === doc?.body || e.target === doc?.documentElement;
      if (root && !fromPage && !root.contains(e.target)) return;
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
    refreshStep,
    viewGeneration: () => generationRef.current,
    fetchFrontierLimit: FETCH_FRONTIER_LIMIT,
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
