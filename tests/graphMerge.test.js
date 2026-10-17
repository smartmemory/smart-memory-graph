/**
 * UI-REFRESH-1 — merging a refreshed graph payload into a live canvas.
 *
 * Owner demo symptom: "expected graph nodes missing after update". The merge used to wipe the
 * canvas and re-add everything, so every refresh dropped the user's selection, dropped new nodes
 * at the graph origin with no layout (stacked under whatever sits at 0,0), and a single edge whose
 * endpoint was not in the payload threw out of cy.add() halfway through, skipping the position
 * restore for every surviving node.
 *
 * Runs against a real headless cytoscape. No DOM, no network.
 */
import cytoscape from 'cytoscape';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyGraphMerge } from '../src/internal/graphMerge.js';

const node = (id, extra = {}) => ({ group: 'nodes', data: { id, label: id, type: 'semantic', category: 'memory', ...extra } });
const edge = (source, target, type = 'RELATED') => ({
  group: 'edges',
  data: { id: `${source}->${target}:${type}`, source, target, type, label: type },
});

function seeded(elements, positions) {
  const cy = cytoscape({ headless: true, styleEnabled: true });
  applyGraphMerge(cy, elements);
  for (const [id, pos] of Object.entries(positions)) cy.getElementById(id).position(pos);
  return cy;
}

const ids = (coll) => coll.map((e) => e.id()).sort();

afterEach(() => vi.restoreAllMocks());

// One row per shape of change the refresh can carry. Each row: the canvas before, the payload,
// and the node/edge ids expected after. Positions: every surviving node keeps its own.
const ROWS = [
  {
    name: 'new node added next to an existing one',
    before: [node('a'), node('b'), edge('a', 'b')],
    payload: [node('a'), node('b'), node('c'), edge('a', 'b'), edge('a', 'c')],
    nodes: ['a', 'b', 'c'],
    edges: ['a->b:RELATED', 'a->c:RELATED'],
  },
  {
    name: 'deleted node removed with its edges',
    before: [node('a'), node('b'), node('c'), edge('a', 'b'), edge('b', 'c')],
    payload: [node('a'), node('b'), edge('a', 'b')],
    nodes: ['a', 'b'],
    edges: ['a->b:RELATED'],
  },
  {
    name: 'add and delete in the same refresh',
    before: [node('a'), node('b'), edge('a', 'b')],
    payload: [node('a'), node('c'), edge('a', 'c')],
    nodes: ['a', 'c'],
    edges: ['a->c:RELATED'],
  },
  {
    name: 'edge whose endpoint is not in the payload is skipped, the rest still lands',
    before: [node('a'), node('b')],
    payload: [node('a'), node('b'), node('c'), edge('a', 'ghost'), edge('b', 'c')],
    nodes: ['a', 'b', 'c'],
    edges: ['b->c:RELATED'],
  },
];

describe('applyGraphMerge', () => {
  it.each(ROWS)('$name', ({ before, payload, nodes, edges }) => {
    const positions = { a: { x: 400, y: 300 }, b: { x: 700, y: 300 }, c: { x: 550, y: 600 } };
    const cy = seeded(before, positions);
    const kept = cy.nodes().filter((n) => nodes.includes(n.id())).map((n) => n.id());
    cy.nodes().select(); // the user's selection must survive a background refresh
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const after = vi.fn();

    let result;
    expect(() => { result = applyGraphMerge(cy, payload, { afterMerge: after }); }).not.toThrow();
    expect(result.isInitial).toBe(false);
    expect(after).toHaveBeenCalledTimes(1);

    expect(ids(cy.nodes())).toEqual(nodes);
    expect(ids(cy.edges())).toEqual(edges);
    for (const id of kept) {
      expect(cy.getElementById(id).position()).toEqual(positions[id]);
      expect(cy.getElementById(id).selected()).toBe(true);
    }
    if (payload.some((e) => e.data.target === 'ghost')) {
      // no-silent-degradation: the dropped edge is named in a warning
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('ghost'));
    }
  });

  it('places a new node beside its existing neighbour, not at the graph origin', () => {
    const cy = seeded([node('a'), node('b')], { a: { x: 900, y: 700 }, b: { x: 1200, y: 700 } });
    applyGraphMerge(cy, [node('a'), node('b'), node('n1'), node('n2'), edge('a', 'n1'), edge('n2', 'b')]);

    for (const [id, anchor] of [['n1', 'a'], ['n2', 'b']]) {
      const p = cy.getElementById(id).position();
      const q = cy.getElementById(anchor).position();
      expect(p).not.toEqual({ x: 0, y: 0 });
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(250);
    }
    // two new nodes never land on the same spot
    expect(cy.getElementById('n1').position()).not.toEqual(cy.getElementById('n2').position());
  });

  it('places a new node with no neighbour inside the existing graph, not at the origin', () => {
    const cy = seeded([node('a'), node('b')], { a: { x: 900, y: 700 }, b: { x: 1300, y: 900 } });
    applyGraphMerge(cy, [node('a'), node('b'), node('lonely')]);
    const p = cy.getElementById('lonely').position();
    expect(p.x).toBeGreaterThan(800);
    expect(p.y).toBeGreaterThan(600);
  });

  it('keeps the selection and runtime classes of nodes that survive', () => {
    const cy = seeded([node('a'), node('b'), edge('a', 'b')], {});
    cy.getElementById('a').select();
    cy.getElementById('b').addClass('highlighted');

    applyGraphMerge(cy, [node('a'), node('b'), node('c'), edge('a', 'b')]);

    expect(cy.getElementById('a').selected()).toBe(true);
    expect(cy.getElementById('b').hasClass('highlighted')).toBe(true);
  });

  it('updates the data and data-derived classes of a node that changed', () => {
    const cy = seeded([{ ...node('a', { label: 'old' }), classes: 'grounded' }], {});
    cy.getElementById('a').addClass('dimmed');

    applyGraphMerge(cy, [{ ...node('a', { label: 'new' }), classes: 'decision-status-superseded' }]);

    const a = cy.getElementById('a');
    expect(a.data('label')).toBe('new');
    expect(a.hasClass('decision-status-superseded')).toBe(true);
    expect(a.hasClass('grounded')).toBe(false);
    expect(a.hasClass('dimmed')).toBe(true); // runtime class untouched; afterMerge re-derives it
  });
});
