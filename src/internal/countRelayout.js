// GRAPH-PKG-RELAYOUT-1: lay out again when the node or edge count changes.
//
// GraphExplorer lays out only on the initial load, and `mergeElements` / `addElements` seed
// later nodes beside a neighbour without a layout. A graph that grows after its first layout
// therefore keeps a hand-seeded arrangement instead of the layout the user picked. This module
// holds the decisions (pure) and the debounce; useCytoscape wires them to the two data-driven
// add paths. The drip-feed (`useDripFeed`) adds through `cy.add` and settles itself with its own
// quiet layout, so it never reaches this scheduler.

import { containerHasArea } from './containerGate';

export const DEFAULT_LAYOUT_NAME = 'cose-bilkent';

/** Delay that collapses a burst of merges / adds into one re-layout. */
export const COUNT_RELAYOUT_DELAY_MS = 250;

/** Node and edge counts, ignoring the ghost edges the drip-feed pulse animation adds. */
export function graphCounts(cy) {
  const real = (ele) => !ele.data('_isPulse');
  return { nodes: cy.nodes().filter(real).length, edges: cy.edges().filter(real).length };
}

export function countsChanged(prev, next) {
  return !prev || prev.nodes !== next.nodes || prev.edges !== next.edges;
}

/**
 * Options for a re-layout after the graph grew or shrank, for any layout name.
 * `randomize: false` keeps the force layouts (cose-bilkent, cola) near the existing arrangement
 * instead of reshuffling it; layouts without that option ignore it. The camera follows the
 * user's autofit toggle: on, the graph is re-fitted; off, pan and zoom stay where the user put them.
 */
export function countRelayoutRequest(lastLayoutName, autoFit) {
  return {
    layoutName: lastLayoutName || DEFAULT_LAYOUT_NAME,
    options: { randomize: false, fit: !!autoFit },
  };
}

/**
 * Request for the hidden-to-visible re-layout: the layout the user chose, not a hard-coded one,
 * instantly (no entrance animation) and from a fresh arrangement, since the old positions came
 * from a degenerate container.
 */
export function revealRelayoutRequest(lastLayoutName) {
  return {
    layoutName: lastLayoutName || DEFAULT_LAYOUT_NAME,
    options: { animate: false, randomize: true },
  };
}

/**
 * Debounced "did the count change since the last layout ran" check.
 *
 * - `markLaidOut()` records the counts a layout is about to run on (call it right before `run()`).
 * - `schedule()` is called after elements were added or removed; when the timer fires and the
 *   counts differ from the last layout's, `run()` is called once.
 * - Never fires before a first layout has run (the first layout owns the initial load), and never
 *   against a container with no area (the container observer re-lays out when it is sized).
 */
export function createCountRelayout({
  getCy,
  run,
  delayMs = COUNT_RELAYOUT_DELAY_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let lastCounts = null;
  let timer = null;

  const fire = () => {
    timer = null;
    const cy = getCy();
    if (!cy || lastCounts === null || cy.nodes().length === 0) return;
    if (!containerHasArea(cy)) return;
    if (!countsChanged(lastCounts, graphCounts(cy))) return;
    run();
  };

  return {
    markLaidOut() {
      const cy = getCy();
      if (cy) lastCounts = graphCounts(cy);
    },
    schedule() {
      if (timer !== null) clearTimer(timer);
      timer = setTimer(fire, delayMs);
    },
    cancel() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      lastCounts = null;
    },
  };
}
