import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installDom } from './helpers/dom.js';
import { MAX_LAYOUT_RETRIES, runCheckedLayout } from '../src/internal/checkedLayout';

// STUDIO-ONTOLOGY-GRAPH-FIRST-MOUNT-LAYOUT-1: a layout is done only when it moved the nodes.
// The fake cy keeps layout runs pending until the test finishes one: placed (each node moved to its
// own spot) or unplaced (cola's maxSimulationTime fired before its first animation frame).

let hidden = false;
let cleanupDom;
function fakeCy(positions) {
  const nodes = positions.map(([x, y], i) => ({ _id: `n${i}`, pos: { x, y } }));
  const api = (list) => ({
    length: list.length,
    forEach: (fn) => list.forEach((n) => fn({ id: () => n._id, position: () => ({ ...n.pos }) })),
  });
  const cy = {
    runs: [],
    _destroyed: false,
    destroyed: () => cy._destroyed,
    nodes: () => api(nodes),
    layout: (config) => {
      const run = { name: config.name, handlers: [] };
      return {
        one: (evt, fn) => { if (evt === 'layoutstop') run.handlers.push(fn); },
        run: () => { cy.runs.push(run); },
      };
    },
    finish: (placed) => {
      const run = cy.runs[cy.runs.length - 1];
      if (placed) nodes.forEach((n, i) => { n.pos = { x: 100 + 40 * i, y: 50 + 20 * i }; });
      run.handlers.splice(0).forEach((fn) => fn());
    },
  };
  return cy;
}

beforeEach(() => {
  cleanupDom = installDom();
  hidden = false;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  delete document.visibilityState;
  vi.restoreAllMocks();
  cleanupDom();
});

const STACKED = [[0, 0], [0, 0], [0, 0]];
const SPREAD = [[0, 0], [10, 0], [20, 0]];

// One row per outcome. `finishes` is the sequence of run outcomes the test drives.
const ROWS = [
  { name: 'placed on the first run', positions: STACKED, finishes: [true], runs: 1, warns: 0 },
  { name: 'stopped before its first frame, then placed', positions: STACKED, finishes: [false, true], runs: 2, warns: 1 },
  {
    name: 'never placed: gives up after the retries',
    positions: STACKED,
    finishes: [false, false, false],
    runs: MAX_LAYOUT_RETRIES + 1,
    warns: MAX_LAYOUT_RETRIES + 1,
  },
  { name: 'nothing moved but nothing stacked (already settled)', positions: SPREAD, finishes: [false], runs: 1, warns: 0 },
  { name: 'a single node never counts as stacked', positions: [[0, 0]], finishes: [false], runs: 1, warns: 0 },
];

describe('runCheckedLayout', () => {
  it.each(ROWS)('$name', ({ positions, finishes, runs, warns }) => {
    const cy = fakeCy(positions);
    const onStop = vi.fn();
    runCheckedLayout(cy, { name: 'cola' }, { onStop });
    finishes.forEach((placed) => cy.finish(placed));

    expect(cy.runs).toHaveLength(runs);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledTimes(warns);
  });

  it('waits for a hidden document to be shown before running', () => {
    hidden = true;
    const cy = fakeCy(STACKED);
    runCheckedLayout(cy, { name: 'cola' });
    expect(cy.runs).toHaveLength(0);

    hidden = false;
    document.dispatchEvent(new window.Event('visibilitychange'));
    expect(cy.runs).toHaveLength(1);
  });

  it.each([
    ['cancelled', (cy, cancel) => cancel()],
    ['the cy is destroyed', (cy) => { cy._destroyed = true; }],
  ])('runs nothing when %s while waiting for the document', (_, act) => {
    hidden = true;
    const cy = fakeCy(STACKED);
    const cancel = runCheckedLayout(cy, { name: 'cola' });
    act(cy, cancel);
    hidden = false;
    document.dispatchEvent(new window.Event('visibilitychange'));
    expect(cy.runs).toHaveLength(0);
  });
});

// Class guard: every layout in the package goes through runCheckedLayout, so none can be marked
// done because it was started. (On 9cd7c51 `useCytoscape.runLayout` and the drip-feed settle
// called `cy.layout(...)` directly.)
describe('every layout run is checked', () => {
  const root = join(__dirname, '..', 'src');
  const files = [];
  const walk = (dir) => readdirSync(dir).forEach((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(js|jsx)$/.test(name) && !/__tests__/.test(path)) files.push(path);
  });
  walk(root);

  it('no source file but checkedLayout.js calls cy.layout(...)', () => {
    const offenders = files
      .filter((path) => !path.endsWith('checkedLayout.js'))
      .filter((path) => readFileSync(path, 'utf8').split('\n').some((line) => /\bcy\.layout\(/.test(line) && !/^\s*(\*|\/\/)/.test(line)))
      .map((path) => relative(root, path));
    expect(offenders).toEqual([]);
  });
});
