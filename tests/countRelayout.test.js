import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COUNT_RELAYOUT_DELAY_MS,
  countRelayoutRequest,
  countsChanged,
  createCountRelayout,
  graphCounts,
  revealRelayoutRequest,
} from '../src/internal/countRelayout.js';

// GRAPH-PKG-RELAYOUT-1: a graph that gains or loses nodes or edges after its first layout is
// laid out again, once per burst, with the layout the user picked, and never on a container
// with no area. The fake cy has just what the scheduler reads.

const eleSet = (items) => ({
  length: items.length,
  filter: (fn) => eleSet(items.filter(fn)),
});
const ele = (pulse = false) => ({ data: (key) => (key === '_isPulse' ? pulse : undefined) });

function fakeCy({ nodes = 3, edges = 2, pulses = 0, width = 800, height = 400 } = {}) {
  const state = { nodes, edges, pulses, width, height };
  return {
    state,
    nodes: () => eleSet(Array.from({ length: state.nodes }, () => ele())),
    edges: () => eleSet([
      ...Array.from({ length: state.edges }, () => ele()),
      ...Array.from({ length: state.pulses }, () => ele(true)),
    ]),
    container: () => ({ getBoundingClientRect: () => ({ width: state.width, height: state.height }) }),
  };
}

// The scheduler as useCytoscape wires it: run() asks for the user's last layout, then the layout
// itself marks the counts it ran on.
function harness(layoutName, cy, autoFit = true) {
  const runs = [];
  const rl = createCountRelayout({
    getCy: () => cy,
    run: () => {
      const request = countRelayoutRequest(layoutName, autoFit);
      runs.push(request);
      rl.markLaidOut();
    },
  });
  return { rl, runs };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('count-change re-layout', () => {
  // One row per case. Every layout name appears in at least one count-change row; the rows that
  // must NOT re-layout (unchanged count, 0x0, never laid out) are the guards. Each row fails on the
  // old behaviour (no re-layout after the first one) except the guard rows, which fail if the
  // scheduler fires when it should not.
  const rows = [
    ['nodes up, cose-bilkent', 'cose-bilkent', { nodes: 5 }, 1],
    ['edges up, cola', 'cola', { edges: 4 }, 1],
    ['nodes and edges up, dagre', 'dagre', { nodes: 6, edges: 5 }, 1],
    ['nodes up, concentric', 'concentric', { nodes: 4 }, 1],
    ['edges up, grid', 'grid', { edges: 3 }, 1],
    ['nodes up, circle', 'circle', { nodes: 9 }, 1],
    ['nodes down, dagre', 'dagre', { nodes: 1 }, 1],
    ['count unchanged, cose-bilkent', 'cose-bilkent', {}, 0],
    ['count unchanged, dagre', 'dagre', {}, 0],
    ['nodes up but container 0x0, cose-bilkent', 'cose-bilkent', { nodes: 5, width: 0, height: 0 }, 0],
    ['nodes up but no width, dagre', 'dagre', { nodes: 5, width: 0 }, 0],
    ['nodes up but no height, grid', 'grid', { nodes: 5, height: 0 }, 0],
  ];
  it.each(rows)('%s', (_name, layoutName, change, expectedRuns) => {
    const cy = fakeCy();
    const { rl, runs } = harness(layoutName, cy);
    rl.markLaidOut(); // the first layout ran on 3 nodes / 2 edges
    Object.assign(cy.state, change);
    rl.schedule();
    vi.advanceTimersByTime(COUNT_RELAYOUT_DELAY_MS + 1);
    expect(runs).toHaveLength(expectedRuns);
    if (expectedRuns) expect(runs[0].layoutName).toBe(layoutName);
  });

  it('a 0x0 count change re-lays out once the container is sized and the next change arrives', () => {
    const cy = fakeCy();
    const { rl, runs } = harness('dagre', cy);
    rl.markLaidOut();
    Object.assign(cy.state, { nodes: 5, width: 0, height: 0 });
    rl.schedule();
    vi.advanceTimersByTime(COUNT_RELAYOUT_DELAY_MS + 1);
    expect(runs).toHaveLength(0);
    Object.assign(cy.state, { width: 800, height: 400 });
    rl.schedule();
    vi.advanceTimersByTime(COUNT_RELAYOUT_DELAY_MS + 1);
    expect(runs).toHaveLength(1);
  });

  it('a drip of ten merges inside the delay lays out once', () => {
    const cy = fakeCy();
    const { rl, runs } = harness('cola', cy);
    rl.markLaidOut();
    for (let i = 1; i <= 10; i += 1) {
      cy.state.nodes += 1;
      rl.schedule();
      vi.advanceTimersByTime(COUNT_RELAYOUT_DELAY_MS / 5);
    }
    expect(runs).toHaveLength(0);
    vi.advanceTimersByTime(COUNT_RELAYOUT_DELAY_MS + 1);
    expect(runs).toHaveLength(1);
    // The layout recorded the new counts, so the same count no longer triggers.
    rl.schedule();
    vi.advanceTimersByTime(COUNT_RELAYOUT_DELAY_MS + 1);
    expect(runs).toHaveLength(1);
  });

  it('never re-lays out before a first layout has run', () => {
    const cy = fakeCy();
    const { rl, runs } = harness('cose-bilkent', cy);
    cy.state.nodes += 2;
    rl.schedule();
    vi.advanceTimersByTime(COUNT_RELAYOUT_DELAY_MS + 1);
    expect(runs).toHaveLength(0);
  });

  it('cancel drops a pending re-layout and forgets the counts (a destroyed cy)', () => {
    const cy = fakeCy();
    const { rl, runs } = harness('cola', cy);
    rl.markLaidOut();
    cy.state.nodes += 2;
    rl.schedule();
    rl.cancel();
    vi.advanceTimersByTime(COUNT_RELAYOUT_DELAY_MS + 1);
    expect(runs).toHaveLength(0);
    rl.schedule();
    vi.advanceTimersByTime(COUNT_RELAYOUT_DELAY_MS + 1);
    expect(runs).toHaveLength(0);
  });
});

describe('counts', () => {
  const rows = [
    ['plain', { nodes: 3, edges: 2 }, { nodes: 3, edges: 2 }],
    ['pulse ghost edges are not counted', { nodes: 3, edges: 2, pulses: 4 }, { nodes: 3, edges: 2 }],
  ];
  it.each(rows)('graphCounts: %s', (_name, cyArgs, expected) => {
    expect(graphCounts(fakeCy(cyArgs))).toEqual(expected);
  });

  const diffRows = [
    ['no previous layout', null, { nodes: 1, edges: 0 }, true],
    ['same', { nodes: 1, edges: 0 }, { nodes: 1, edges: 0 }, false],
    ['nodes differ', { nodes: 1, edges: 0 }, { nodes: 2, edges: 0 }, true],
    ['edges differ', { nodes: 1, edges: 0 }, { nodes: 1, edges: 1 }, true],
  ];
  it.each(diffRows)('countsChanged: %s', (_name, prev, next, expected) => {
    expect(countsChanged(prev, next)).toBe(expected);
  });
});

describe('re-layout requests carry the user layout for every layout name', () => {
  const names = ['cose-bilkent', 'cola', 'dagre', 'concentric', 'grid', 'circle'];
  const rows = names.flatMap((name) => [
    [`${name}, autofit on keeps the fit`, name, true, { randomize: false, fit: true }],
    [`${name}, autofit off keeps the user's pan and zoom`, name, false, { randomize: false, fit: false }],
  ]);
  it.each(rows)('count change: %s', (_name, layoutName, autoFit, options) => {
    expect(countRelayoutRequest(layoutName, autoFit)).toEqual({ layoutName, options });
  });

  it.each(names.map((n) => [n]))('hidden -> visible re-runs %s, not a fixed layout', (layoutName) => {
    expect(revealRelayoutRequest(layoutName)).toEqual({
      layoutName,
      options: { animate: false, randomize: true },
    });
  });

  it('falls back to cose-bilkent when no layout has run yet', () => {
    expect(countRelayoutRequest(null, true).layoutName).toBe('cose-bilkent');
    expect(revealRelayoutRequest(undefined).layoutName).toBe('cose-bilkent');
  });
});
