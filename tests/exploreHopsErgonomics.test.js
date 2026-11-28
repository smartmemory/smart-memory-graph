/**
 * GRAPH-EXPLORE-HOPS-ERGONOMICS-1. Ground truth written before the code (owner 2026-11-28), never tuned to pass:
 *  1. Expand Neighbors = one hop, shown on the graph, no neighbour hidden by a left-hand filter.
 *  2. Explore Hops is stepped by the user (Next hop / Back, "hop N of M", count of what the step added).
 *  3. Show all, click outside the set, and Escape bring back the full graph.
 *  4. Expand Neighbors sits directly above the connections list.
 *  5. The search retrieval replay keeps working.
 * Same real-explorer jsdom harness as uiControlsFixGraph.test.js.
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDom } from './helpers/dom.js';
import { HOP_COLORS } from '../src/core/hopReplayPlan.js';

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
      if (prop === 'globalAlpha') return 1; // drawn faded elements multiply by it
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
// a - b - c - d (a chain of three hops from a), b - p1 (a person), ep alone (an episodic memory)
const CHAIN = {
  nodes: [mem('a'), mem('b'), mem('c'), mem('d'), ent('p1', 'person'), mem('ep', 'episodic')],
  edges: [link('a', 'b'), link('b', 'c'), link('c', 'd'), link('b', 'p1')],
};
const TRIANGLE = { nodes: [mem('a'), mem('b'), mem('c')], edges: [link('a', 'b'), link('b', 'c'), link('c', 'a')] };

let cleanupDom, host, reactRoot, neighborsOf;
const cy = () => globalThis.__tsCy;
const wait = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const SETTLE = 500; // longer than one reveal fade
const adapter = () => ({
  getFullGraph: vi.fn(async () => ({ nodes: [], edges: [] })),
  getNeighbors: vi.fn(async (id) => ({ neighbors: neighborsOf(id) })),
});

async function render(data, props = {}) {
  await act(async () => {
    reactRoot.render(createElement(GraphExplorer, { adapter: adapter(), data, ...props }));
  });
  await wait(30);
}
const tap = async (id) => { await act(async () => { cy().getElementById(id).emit('tap'); }); await wait(30); };
const tapBackground = async () => { await act(async () => { cy().emit('tap'); }); await wait(30); };
const click = async (el) => {
  await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  await wait(SETTLE);
};
const btn = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const opacity = (id) => Number(cy().getElementById(id).style('opacity'));
// lit = shown at full strength (a reveal fades 0.08 -> 1), dimmed = left at the 0.08 the reveal dims to
const lit = (id) => opacity(id) > 0.5;
const dimmedCount = () => cy().nodes().filter((n) => !lit(n.id())).length;
const panelText = () => host.textContent;
const pressEscape = async () => {
  await act(async () => { document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  await wait(SETTLE);
};

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
  host = document.createElement('div');
  document.body.appendChild(host);
  reactRoot = createRoot(host);
});
afterEach(async () => {
  await act(async () => reactRoot.unmount());
  vi.restoreAllMocks();
  cleanupDom();
});

describe('2. Explore Hops is stepped by the user', () => {
  it('starts at the node, never auto-plays, Next hop reveals one step, Back hides it', async () => {
    await render(CHAIN);
    await tap('a');
    await click(btn('Explore Hops'));
    expect(panelText()).toContain('hop 0 of 3');
    expect(lit('a')).toBe(true);
    expect(lit('b')).toBe(false);
    await wait(1600); // longer than the old auto-play (700 ms per hop)
    expect(panelText()).toContain('hop 0 of 3');
    expect(lit('b')).toBe(false);

    await click(btn('Next hop'));
    expect(panelText()).toContain('hop 1 of 3');
    expect(panelText()).toContain('+1 node'); // b only
    expect(lit('b')).toBe(true);
    expect(lit('p1')).toBe(false);
    expect(lit('c')).toBe(false);

    await click(btn('Next hop'));
    expect(panelText()).toContain('hop 2 of 3');
    expect(panelText()).toContain('+2 nodes'); // c and p1
    expect(lit('p1')).toBe(true);
    expect(lit('d')).toBe(false);
    await click(btn('Next hop'));
    expect(panelText()).toContain('hop 3 of 3');
    expect(lit('d')).toBe(true);
    expect(btn('Next hop')?.disabled ?? true).toBe(true);

    await click(btn('Back'));
    expect(panelText()).toContain('hop 2 of 3');
    expect(lit('d')).toBe(false);
    expect(lit('c')).toBe(true);
  });

  it('a node is never revealed twice: a triangle has one step holding both neighbours', async () => {
    await render(TRIANGLE);
    await tap('a');
    await click(btn('Explore Hops'));
    expect(panelText()).toContain('hop 0 of 1');
    await click(btn('Next hop'));
    expect(panelText()).toContain('hop 1 of 1');
    expect(panelText()).toContain('+2');
    expect(btn('Next hop')?.disabled ?? true).toBe(true);
  });
});

describe('3. Show all, click outside, Escape', () => {
  const dimmedStart = async () => {
    await render(CHAIN);
    await tap('a');
    await click(btn('Explore Hops'));
    expect(dimmedCount()).toBeGreaterThan(0);
  };

  it('Show all clears the dimming, keeps the node selected, does not move the layout', async () => {
    await dimmedStart();
    const before = cy().getElementById('c').position();
    await click(btn('Show all'));
    expect(dimmedCount()).toBe(0);
    expect(btn('Show all')).toBeUndefined();
    expect(cy().getElementById('a').selected()).toBe(true);
    expect(cy().getElementById('c').position()).toEqual(before);
  });

  it('a click on empty canvas shows the full graph', async () => {
    await dimmedStart();
    await tapBackground();
    await wait(SETTLE);
    expect(dimmedCount()).toBe(0);
  });

  it('a click on a dimmed node shows the full graph and selects that node', async () => {
    await dimmedStart();
    await tap('d');
    await wait(SETTLE);
    expect(dimmedCount()).toBe(0);
    expect(cy().getElementById('d').selected()).toBe(true);
    expect(panelText()).toContain('Node d');
  });

  it('a click on a dimmed link shows the full graph', async () => {
    await dimmedStart();
    await act(async () => { cy().getElementById('c-d').emit('tap'); });
    await wait(SETTLE);
    expect(dimmedCount()).toBe(0);
  });

  it('a click on a node inside the highlighted set keeps the view', async () => {
    await dimmedStart();
    await tap('a');
    await wait(SETTLE);
    expect(lit('d')).toBe(false);
  });

  it('Escape shows the full graph', async () => {
    await dimmedStart();
    await pressEscape();
    expect(dimmedCount()).toBe(0);
  });
});

describe('1. Expand Neighbors is one hop, shown on the graph', () => {
  const NEW_NEIGHBORS = (id) => (id === 'b' ? [
    { item_id: 'x1', memory_type: 'place', content: 'New place', link_type: 'LOCATED_AT', direction: 'outgoing' },
    { item_id: 'c', memory_type: 'semantic', content: 'Node c', link_type: 'RELATES_TO', direction: 'outgoing' },
  ] : []);

  it('adds the neighbour and its link, highlights the one hop the way Explore Hops does, dims the rest', async () => {
    neighborsOf = NEW_NEIGHBORS;
    await render(CHAIN);
    await tap('b');
    const nodesBefore = cy().nodes().length;
    await click(btn('Expand Neighbors'));
    expect(cy().nodes().length).toBe(nodesBefore + 1); // x1 only, c is not duplicated
    expect(cy().getElementById('b-x1:LOCATED_AT').length + cy().edges('[target = "x1"]').length).toBeGreaterThan(0);
    expect(lit('x1')).toBe(true);
    expect(lit('b')).toBe(true);
    expect(lit('c')).toBe(true);
    expect(lit('d')).toBe(false);
    expect(lit('ep')).toBe(false);
    // the same reveal code: hop 1 border colour from the shared hop palette
    expect(cy().getElementById('x1').style('border-color')).toBe(
      cy().getElementById('p1').style('border-color'),
    );
    expect(cy().getElementById('x1').style('border-color').toLowerCase()).not.toBe('');
    expect(HOP_COLORS.length).toBeGreaterThan(1);
    expect(btn('Show all')).toBeDefined();
  });

  it('a second expand on the same node adds nothing', async () => {
    neighborsOf = NEW_NEIGHBORS;
    await render(CHAIN);
    await tap('b');
    await click(btn('Expand Neighbors'));
    const nodes = cy().nodes().length;
    const edges = cy().edges().length;
    await click(btn('Expand Neighbors'));
    expect(cy().nodes().length).toBe(nodes);
    expect(cy().edges().length).toBe(edges);
  });

  it('a type switched off in the left bar is switched on for what the expand brought in; nothing else changes', async () => {
    localStorage.setItem('graph:filters:default', JSON.stringify({
      v: 1, memory: { hidden: ['episodic'] }, entity: { hidden: ['place'] },
    }));
    neighborsOf = NEW_NEIGHBORS;
    await render(CHAIN);
    expect(cy().getElementById('ep').hasClass('dimmed')).toBe(true);
    await tap('b');
    await click(btn('Expand Neighbors'));
    await wait(100);
    const x1 = cy().getElementById('x1');
    expect(x1.length).toBe(1);
    expect(x1.hasClass('dimmed')).toBe(false);
    expect(lit('x1')).toBe(true);
    const saved = JSON.parse(localStorage.getItem('graph:filters:default'));
    expect(saved.entity?.hidden ?? []).not.toContain('place');
    expect(saved.memory.hidden).toContain('episodic'); // the user's own choice stays
    expect(cy().getElementById('ep').hasClass('dimmed')).toBe(true);
  });

  it('a type that was never in the graph shows without any saved filter', async () => {
    neighborsOf = NEW_NEIGHBORS;
    await render(CHAIN);
    await tap('b');
    await click(btn('Expand Neighbors'));
    await wait(100);
    expect(cy().getElementById('x1').hasClass('dimmed')).toBe(false);
    expect(cy().getElementById('x1').visible()).toBe(true);
  });
});

describe('4. Expand Neighbors sits directly above the connections list', () => {
  it('no other panel section lies between the button and Connections; Content stays above it', async () => {
    neighborsOf = () => [];
    await render({ nodes: [{ ...mem('a'), content: 'Some content here' }, mem('b')], edges: [link('a', 'b')] });
    await tap('a');
    const expand = btn('Expand Neighbors');
    const headings = [...host.querySelectorAll('h3')];
    const connections = headings.find((h) => h.textContent.includes('Connections'));
    const content = headings.find((h) => h.textContent.trim() === 'Content');
    expect(expand).toBeDefined();
    expect(connections).toBeDefined();
    const follows = (x, y) => !!(x.compareDocumentPosition(y) & window.Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(content, expand)).toBe(true);
    expect(follows(expand, connections)).toBe(true);
    const between = headings.filter((h) => follows(expand, h) && follows(h, connections));
    expect(between).toEqual([]);
  });
});

describe('5. The search retrieval replay keeps working', () => {
  it('hopGroups still reveal by retrieval hop and end with Reset', async () => {
    await render(CHAIN, { hopGroups: [['a'], ['b', 'p1']], autoReplayKey: 1 });
    await wait(1800);
    expect(lit('a')).toBe(true);
    expect(lit('b')).toBe(true);
    expect(lit('d')).toBe(false);
    expect(panelText()).toContain('hop 1');
    expect(btn('Reset')).toBeDefined();
    await click(btn('Reset'));
    expect(dimmedCount()).toBe(0);
  });
});
