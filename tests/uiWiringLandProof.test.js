/**
 * OPS-UI-WIRING-AUDIT-1 graph land proofs (same real-explorer harness as uiControlsFixGraph.test.js).
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
    globalThis.__layouts = [];
    cy.layout = (cfg) => { globalThis.__layouts.push(cfg.name); return { one() {}, run() {}, stop() {} }; };
    return cy;
  };
  Object.assign(wrapped, real);
  return { ...mod, default: wrapped };
});

import GraphExplorer from '../src/components/GraphExplorer.jsx';

function installCanvasStub() {
  const ctx = new Proxy(function () {}, {
    get: (_t, prop) => {
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

const DATA = {
  nodes: [
    { id: 'm1', label: 'Memory one', type: 'semantic', category: 'memory', origin: 'api:test' },
    { id: 'm2', label: 'Memory two', type: 'episodic', category: 'memory', origin: 'api:test' },
    { id: 'e1', label: 'Entity one', type: 'person', category: 'entity', origin: 'api:test' },
    { id: 'd1', label: 'Decision one', type: 'decision', category: 'memory', supersedes: ['m2'], origin: 'api:test' },
  ],
  edges: [{ id: 'x1', source: 'm1', target: 'e1', type: 'MENTIONS' }],
};
const NO_ORIGIN = { nodes: DATA.nodes.map(({ origin, ...n }) => n), edges: DATA.edges };

let cleanupDom, host, reactRoot, findPath;
const cy = () => globalThis.__tsCy;
const adapter = (extra = {}) => ({
  getFullGraph: vi.fn(async () => ({ nodes: [], edges: [] })),
  getGroundingStatus: vi.fn(async () => ({ grounded: true, wikipedia: { url: 'https://en.wikipedia.org/wiki/X', title: 'X' } })),
  findPath,
  findDecisionConflicts: vi.fn(async () => ({ conflicts: [] })),
  getDecisionProvenance: vi.fn(async () => ({})),
  // Entity editing needs an adapter that can write (OPS-UI-WIRING-AUDIT-1).
  updateEntityNode: vi.fn(async () => ({})),
  ...extra,
});

async function render(props = {}, data = DATA) {
  await act(async () => {
    reactRoot.render(createElement(GraphExplorer, { adapter: adapter(props.extra), data, ...props }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
}
const tap = (id) => act(async () => { cy().getElementById(id).emit('tap'); await new Promise((r) => setTimeout(r, 30)); });
const click = (el) => act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 10)); });
const btn = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const has = (sel) => host.querySelector(sel) !== null;

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
  findPath = vi.fn(async () => ({ path: [], path_found: false }));
  host = document.createElement('div');
  document.body.appendChild(host);
  reactRoot = createRoot(host);
});
afterEach(async () => {
  await act(async () => reactRoot.unmount());
  vi.restoreAllMocks();
  cleanupDom();
});


// Each proof drives the real GraphExplorer (real cytoscape, jsdom) to the adapter
// boundary and checks what the user sees. Fix ids: report-n2-fix-graph.md.
describe('OPS-UI-WIRING-AUDIT-1 graph land proofs', () => {
  it('Web H17 / Viewer 14: a failed type save says so and keeps the old type', async () => {
    const updateEntityNode = vi.fn(async () => { throw new Error('500'); });
    await render({ enableEntityEditing: true, extra: { updateEntityNode } });
    await tap('e1');
    const badge = host.querySelector('[title="Click to change entity type"]');
    await click(badge);
    const option = [...badge.parentElement.querySelectorAll('button')].find((b) => b !== badge && b.textContent.trim() && b.textContent.trim() !== 'person');
    await click(option);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(updateEntityNode).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Could not save the entity change.');
    expect(cy().getElementById('e1').data('type')).toBe('person');
  });

  it('Viewer 11: Link says so when the clipboard write fails, never "Copied!"', async () => {
    vi.stubGlobal('navigator', { ...window.navigator, clipboard: { writeText: vi.fn(async () => { throw new Error('denied'); }) } });
    await render({ getShareableUrl: () => 'https://example.test/#g' });
    await click(btn('Link'));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(host.textContent).toContain('Could not copy link.');
    expect(host.textContent).not.toContain('Copied!');
  });

  it('Web H14: Highlight chain follows the causal chain from the adapter', async () => {
    const getDecisionCausalChain = vi.fn(async () => ({ causes: [{ node_id: 'm1' }], effects: [] }));
    await render({ extra: { getDecisionCausalChain } });
    await tap('d1');
    await click(btn('Highlight chain'));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(getDecisionCausalChain).toHaveBeenCalledWith('d1');
    // m1 comes only from the adapter's causal chain; m2 from the node's own supersedes.
    expect(cy().getElementById('m1').hasClass('highlighted')).toBe(true);
    expect(cy().getElementById('m2').hasClass('highlighted')).toBe(true);
    expect(cy().getElementById('d1').hasClass('highlighted')).toBe(true);
    expect(cy().getElementById('e1').hasClass('highlighted')).toBe(false);
  });

  it('Viewer 13: expanding a node with no neighbours says so', async () => {
    const getNeighbors = vi.fn(async () => ({ nodes: [], edges: [] }));
    await render({ extra: { getNeighbors } });
    await tap('m2');
    await click(btn('Expand Neighbors'));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(getNeighbors).toHaveBeenCalled();
    expect(host.textContent).toContain('No neighbors found.');
  });
});
