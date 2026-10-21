/**
 * STUDIO-ONTOLOGY-GRAPH-FIRST-MOUNT-LAYOUT-1: a layout counts as done only when it placed the nodes.
 *
 * cytoscape-cola moves nodes only in requestAnimationFrame ticks, and its `maxSimulationTime` timer
 * can stop it before the first frame: a hidden tab gets no frames, and a cold tab's long first tasks
 * can outlast the timer. It then fires `layoutstop` with every node where it started (all at the
 * origin, or each drip-fed node on top of its parent), and nothing runs it again. This runs a layout,
 * waits for a hidden document to be shown first, and on `layoutstop` re-runs it (with one WARNING per
 * re-run) when no node moved while two or more share one position.
 */

export const MAX_LAYOUT_RETRIES = 2;

const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
const isGone = (cy) => typeof cy.destroyed === 'function' && cy.destroyed();
const key = (p) => `${Math.round(p.x)},${Math.round(p.y)}`;

/** Positions of `nodes`, keyed by node id. */
export function snapshotPositions(nodes) {
  const out = new Map();
  nodes.forEach((n) => out.set(n.id(), key(n.position())));
  return out;
}

/** True when no node moved since `before` and at least two nodes share one position. */
export function layoutLeftNodesStacked(nodes, before) {
  if (nodes.length < 2) return false;
  const seen = new Set();
  let moved = false;
  let stacked = false;
  nodes.forEach((n) => {
    const now = key(n.position());
    if (before.get(n.id()) !== now) moved = true;
    if (seen.has(now)) stacked = true;
    seen.add(now);
  });
  return !moved && stacked;
}

/**
 * Run `config` on `cy`. `onStop` runs once, after a run that placed the nodes (or after the last
 * allowed retry). Returns `cancel()`, which drops a run still waiting for the document to be shown.
 */
export function runCheckedLayout(cy, config, { onStop, label = 'graph', attempt = 0 } = {}) {
  let cancelled = false;
  let waiting = null;
  const cancel = () => {
    cancelled = true;
    if (waiting) document.removeEventListener('visibilitychange', waiting);
    waiting = null;
  };

  const start = (n) => {
    if (cancelled || isGone(cy)) return;
    if (isHidden()) {
      waiting = () => {
        if (isHidden()) return;
        document.removeEventListener('visibilitychange', waiting);
        waiting = null;
        start(n);
      };
      document.addEventListener('visibilitychange', waiting);
      return;
    }
    const nodes = config.eles ? config.eles.nodes() : cy.nodes();
    const before = snapshotPositions(nodes);
    const layout = cy.layout(config);
    layout.one('layoutstop', () => {
      if (cancelled || isGone(cy)) return;
      if (layoutLeftNodesStacked(nodes, before)) {
        if (n < MAX_LAYOUT_RETRIES) {
          console.warn(`[${label}] layout "${config.name}" stopped before moving any of its ${nodes.length} nodes (stacked); re-running it (retry ${n + 1} of ${MAX_LAYOUT_RETRIES}).`);
          start(n + 1);
          return;
        }
        console.warn(`[${label}] layout "${config.name}" stopped before moving any of its ${nodes.length} nodes ${MAX_LAYOUT_RETRIES + 1} times; giving up, stacked nodes stay stacked until the next layout.`);
      }
      onStop?.();
    });
    layout.run();
  };

  start(attempt);
  return cancel;
}
