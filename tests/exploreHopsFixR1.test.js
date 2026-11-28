/**
 * GRAPH-EXPLORE-HOPS-ERGONOMICS-1 fix round 1 (review-r1 H1, H2, M1, M2, M3, L1, L2 and the left-out
 * sentence of ground-truth item 2). Written red on 37288b9. Each case asserts what the user sees:
 * which nodes are lit or dimmed, which filter boxes are on, what the hop control says.
 * Same real-explorer jsdom harness as exploreHopsErgonomics.test.js.
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDom } from './helpers/dom.js';

vi.mock('cytoscape', async (importOriginal) => {
  const mod = await importOriginal();
  const real = mod.default;
  const wrapped = (...args) => {
    const cy = real(...args);
    globalThis.__tsCy = cy;
    cy.layout = () => ({ one() {}, run() {}, stop() {} });
    return cy;
  };
  Object.assign(wrapped, real);
  return { ...mod, default: wrapped };
});

import GraphExplorer from '../src/components/GraphExplorer.jsx';

function installCanvasStub() {
  const ctx = new Proxy(function () {}, {
    get: (_t, prop) => {
      if (prop === 'globalAlpha') return 1;
      if (typeof prop === 'symbol') return undefined;
      if (prop === 'canvas') return document.createElement('canvas');
      if (/PixelRatio$/.test(prop)) return 1;
      if (prop === 'measureText') return () => ({ width: 0 });
      return ctx;
    },
    set: () => true,
    apply: () => ctx,
  });
  vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx);
}

const mem = (id, type = 'semantic') => ({ id, label: `Node ${id}`, type, category: 'memory', origin: 'api:test' });
const ent = (id, type) => ({ id, label: `Entity ${id}`, type, category: 'entity', origin: 'api:test' });
const link = (s, t) => ({ id: `${s}-${t}`, source: s, target: t, type: 'RELATES_TO' });
const row = (id, extra = {}) => ({ item_id: id, memory_type: 'semantic', content: `Row ${id}`, link_type: 'RELATES_TO', direction: 'outgoing', ...extra });
// a - b - c - d, b - p1 (a person)
const CHAIN = {
  nodes: [mem('a'), mem('b'), mem('c'), mem('d'), ent('p1', 'person')],
  edges: [link('a', 'b'), link('b', 'c'), link('c', 'd'), link('b', 'p1')],
};

let cleanupDom, host, reactRoot, neighborsOf, getNeighbors, currentProps;
const cy = () => globalThis.__tsCy;
const wait = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const SETTLE = 500;
const makeAdapter = () => ({
  getFullGraph: vi.fn(async () => ({ nodes: [], edges: [] })),
  getNeighbors,
});

async function render(data, props = {}) {
  currentProps = { adapter: makeAdapter(), data, ...props };
  await act(async () => { reactRoot.render(createElement(GraphExplorer, currentProps)); });
  await wait(30);
}
async function rerender(extra) {
  currentProps = { ...currentProps, ...extra };
  await act(async () => { reactRoot.render(createElement(GraphExplorer, currentProps)); });
  await wait(30);
}
const tap = async (id) => { await act(async () => { cy().getElementById(id).emit('tap'); }); await wait(30); };
const click = async (el) => {
  await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  await wait(SETTLE);
};
const btn = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const opacity = (id) => Number(cy().getElementById(id).style('opacity'));
const lit = (id) => opacity(id) > 0.5;
const dimmedCount = () => cy().nodes().filter((n) => !lit(n.id())).length;
const panelText = () => host.textContent;
const filterHidden = (id) => cy().getElementById(id).hasClass('dimmed');
/** The rendered checkbox for `type` under the left-hand section headed `heading`. */
function checkbox(heading, type) {
  const h3 = [...host.querySelectorAll('[data-testid="graph-filter-panel"] h3')].find((h) => h.textContent === heading);
  const section = h3?.closest('section');
  const label = [...(section?.querySelectorAll('label') || [])].find((l) => l.querySelector('span')?.textContent === type.replace(/_/g, ' '));
  return label?.querySelector('input[type="checkbox"]');
}
function countBadge(heading, type) {
  const box = checkbox(heading, type);
  const spans = box?.closest('label')?.querySelectorAll('span');
  return spans && spans.length > 1 ? spans[spans.length - 1].textContent : null;
}
const saveFilters = (f) => localStorage.setItem('graph:filters:default', JSON.stringify({ v: 1, ...f }));
const savedFilters = () => JSON.parse(localStorage.getItem('graph:filters:default'));

beforeEach(async () => {
  cleanupDom = installDom();
  window.location.hash = '';
  installCanvasStub();
  window.HTMLElement.prototype.attachEvent = () => {};
  window.HTMLElement.prototype.detachEvent = () => {};
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(() => fn(Date.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('getComputedStyle', window.getComputedStyle.bind(window));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  neighborsOf = () => [];
  getNeighbors = vi.fn(async (id) => ({ neighbors: neighborsOf(id) }));
  host = document.createElement('div');
  document.body.appendChild(host);
  reactRoot = createRoot(host);
});
afterEach(async () => {
  await act(async () => reactRoot.unmount());
  vi.restoreAllMocks();
  cleanupDom();
});

describe('H1. Expand switches on exactly the types the graph reader gives what it brought in', () => {
  it('a loaded person returned as a semantic row turns the person box on and leaves semantic as it was', async () => {
    saveFilters({ entity: { hidden: ['person'] } });
    neighborsOf = (id) => (id === 'b' ? [row('p1', { memory_type: 'semantic' })] : []);
    await render(CHAIN);
    expect(filterHidden('p1')).toBe(true);
    expect(checkbox('Entity Types', 'person').checked).toBe(false);
    await tap('b');
    await click(btn('Expand Neighbors'));
    expect(checkbox('Entity Types', 'person').checked).toBe(true);
    expect(savedFilters().entity?.hidden ?? []).not.toContain('person');
    expect(filterHidden('p1')).toBe(false);
    expect(lit('p1')).toBe(true);
  });

  it('a new row the service calls an entity does not switch on a memory type the user turned off', async () => {
    saveFilters({ memory: { hidden: ['semantic'] } });
    const data = { nodes: [mem('a'), mem('b', 'episodic'), mem('c', 'episodic')], edges: [link('a', 'b'), link('b', 'c')] };
    neighborsOf = (id) => (id === 'b' ? [row('o1', { memory_type: 'semantic', node_category: 'entity' })] : []);
    await render(data);
    expect(filterHidden('a')).toBe(true);
    await tap('b');
    await click(btn('Expand Neighbors'));
    expect(checkbox('Memory Types', 'semantic').checked).toBe(false);
    expect(savedFilters().memory.hidden).toContain('semantic');
    expect(filterHidden('a')).toBe(true); // the user's semantic memory stays hidden
    expect(filterHidden('o1')).toBe(false);
    expect(lit('o1')).toBe(true);
    expect(checkbox('Entity Types', 'semantic')?.checked).toBe(true);
  });
});

describe('H2. Every neighbour Expand fetched is lit, whatever the neighbour count', () => {
  it('a hub with 60 loaded neighbours lights the new leaf it fetched', async () => {
    const spokes = Array.from({ length: 60 }, (_, i) => `n${i}`);
    const data = { nodes: [mem('h'), ...spokes.map((id) => mem(id))], edges: spokes.map((id) => link('h', id)) };
    neighborsOf = (id) => (id === 'h' ? [row('leaf')] : []);
    await render(data);
    await tap('h');
    await click(btn('Expand Neighbors'));
    expect(cy().getElementById('leaf').length).toBe(1);
    expect(lit('leaf')).toBe(true);
    expect(lit('h')).toBe(true);
    const leafEdge = cy().edges('[target = "leaf"]');
    expect(Number(leafEdge.style('opacity'))).toBeGreaterThan(0.5);
  });
});

describe('M1. Hop frames describe what the canvas shows after the filters change', () => {
  it('a place Expand switches on elsewhere in the graph is counted and lit at its hop', async () => {
    saveFilters({ entity: { hidden: ['place'] } });
    const data = {
      nodes: [mem('a'), mem('b'), mem('c'), mem('d'), ent('pl', 'place')],
      edges: [link('a', 'b'), link('b', 'c'), link('c', 'd'), link('c', 'pl')],
    };
    neighborsOf = (id) => (id === 'b' ? [row('x1', { memory_type: 'place', link_type: 'LOCATED_AT' })] : []);
    await render(data);
    expect(filterHidden('pl')).toBe(true);
    await tap('b');
    await click(btn('Expand Neighbors'));
    expect(panelText()).toContain('hop 1 of 2');
    await click(btn('Next hop'));
    expect(panelText()).toContain('hop 2 of 2');
    expect(panelText()).toContain('+2 nodes'); // d and pl
    expect(lit('pl')).toBe(true);
  });

  it('a type switched off while stepping is left out of the steps and their counts', async () => {
    await render(CHAIN);
    await tap('a');
    await click(btn('Explore Hops'));
    expect(panelText()).toContain('hop 0 of 3');
    await click(checkbox('Entity Types', 'person'));
    expect(filterHidden('p1')).toBe(true);
    await click(btn('Next hop'));
    await click(btn('Next hop'));
    expect(panelText()).toContain('hop 2 of 3');
    expect(panelText()).toContain('+1 node'); // c only, p1 is switched off
    expect(lit('c')).toBe(true);
  });
});

describe('M2. A late Expand response never replaces the newer view', () => {
  const deferredNeighbors = () => {
    let release;
    getNeighbors = vi.fn(() => new Promise((resolve) => { release = () => resolve({ neighbors: [row('x1')] }); }));
    return () => act(async () => { release(); });
  };

  it('selecting another node while Expand is pending keeps that selection and the full graph', async () => {
    const release = deferredNeighbors();
    await render(CHAIN);
    await tap('b');
    await act(async () => { btn('Expand Neighbors').dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    await tap('d');
    await release();
    await wait(SETTLE);
    expect(cy().getElementById('x1').length).toBe(1); // the data still lands
    expect(dimmedCount()).toBe(0);
    expect(btn('Show all')).toBeUndefined();
    expect(cy().getElementById('d').selected()).toBe(true);
  });

  it('starting Explore Hops on another node while Expand is pending keeps that exploration', async () => {
    const release = deferredNeighbors();
    await render(CHAIN);
    await tap('b');
    await act(async () => { btn('Expand Neighbors').dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    await tap('d');
    await click(btn('Explore Hops'));
    expect(panelText()).toContain('hop 0 of');
    await release();
    await wait(SETTLE);
    expect(panelText()).toContain('hop 0 of');
    expect(lit('d')).toBe(true);
    expect(lit('b')).toBe(false);
  });
});

describe('M3. Escape belongs to the explorer the user is in', () => {
  const explore = async (props) => {
    await render(CHAIN, props);
    await tap('a');
    await click(btn('Explore Hops'));
    expect(btn('Show all')).toBeDefined();
  };

  it('Escape pressed on a control outside the explorer keeps the hop view', async () => {
    await explore();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    await act(async () => { outside.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    await wait(SETTLE);
    expect(btn('Show all')).toBeDefined();
    expect(lit('b')).toBe(false);
  });

  it('Escape while the viewer is in a hidden tab keeps the hop view for when the user returns', async () => {
    await explore();
    await rerender({ active: false });
    await act(async () => { document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    await wait(SETTLE);
    await rerender({ active: true });
    expect(btn('Show all')).toBeDefined();
    expect(panelText()).toContain('hop 0 of 3');
  });
});

describe('Item 2, last sentence: Next hop fetches the next step when the loaded graph runs out', () => {
  it('fetches the frontier once, reveals what came back as the next hop, then says nothing further', async () => {
    neighborsOf = (id) => (id === 'd' ? [row('e1')] : []);
    await render(CHAIN);
    await tap('a');
    await click(btn('Explore Hops'));
    for (let i = 0; i < 3; i++) await click(btn('Next hop'));
    expect(panelText()).toContain('hop 3 of 3');
    expect(btn('Next hop').disabled).toBe(false); // the server has more for d
    await click(btn('Next hop'));
    expect(panelText()).toContain('hop 4 of 4');
    expect(panelText()).toContain('+1 node');
    expect(lit('e1')).toBe(true);
    expect(btn('Next hop').disabled).toBe(true);
    expect(panelText()).toContain('nothing further');
    await click(btn('Back'));
    await click(btn('Next hop'));
    expect(lit('e1')).toBe(true);
    const calls = getNeighbors.mock.calls.map(([id]) => id);
    expect(calls.filter((id) => id === 'd')).toHaveLength(1);
    expect(calls.filter((id) => id === 'e1')).toHaveLength(1);
    expect(new Set(calls).size).toBe(calls.length); // no node fetched twice
  });

  it('more than 10 nodes at the last step: no request, one message', async () => {
    const spokes = Array.from({ length: 11 }, (_, i) => `n${i}`);
    await render({ nodes: [mem('s'), ...spokes.map((id) => mem(id))], edges: spokes.map((id) => link('s', id)) });
    await tap('s');
    getNeighbors.mockClear();
    await click(btn('Explore Hops'));
    await click(btn('Next hop'));
    expect(panelText()).toContain('hop 1 of 1');
    expect(panelText()).toContain('more than 10 nodes at this step, expand one of them');
    expect(btn('Next hop').disabled).toBe(true);
    expect(getNeighbors).not.toHaveBeenCalled();
  });
});

describe('L1 and L2', () => {
  it('L1: the filter count includes what Expand brought in', async () => {
    neighborsOf = (id) => (id === 'b' ? [row('x1', { memory_type: 'place', link_type: 'LOCATED_AT' }), row('x2', { memory_type: 'place', link_type: 'LOCATED_AT' })] : []);
    await render(CHAIN);
    expect(countBadge('Memory Types', 'semantic')).toBe('4');
    await tap('b');
    await click(btn('Expand Neighbors'));
    expect(countBadge('Entity Types', 'place')).toBe('2');
    expect(countBadge('Relations', 'LOCATED_AT')).toBe('2');
  });

  it('L2: a chain longer than 200 hops can be stepped to its end', async () => {
    const ids = Array.from({ length: 203 }, (_, i) => `k${i}`);
    const data = { nodes: ids.map((id) => mem(id)), edges: ids.slice(1).map((id, i) => link(ids[i], id)) };
    await render(data);
    await tap('k0');
    await click(btn('Explore Hops'));
    expect(panelText()).toContain('hop 0 of 202');
  });
});
