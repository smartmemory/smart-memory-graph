/**
 * UI-CONTROLS-AUDIT-1 (graph): hides behind props (default off) and small fixes. Same real-explorer jsdom
 * harness as hideTimeSlider.test.js. Frozen expectations: smart-memory-ops/units/UI-CONTROLS-AUDIT-1/expected-graph.md.
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
const adapter = () => ({
  getFullGraph: vi.fn(async () => ({ nodes: [], edges: [] })),
  getGroundingStatus: vi.fn(async () => ({ grounded: true, wikipedia: { url: 'https://en.wikipedia.org/wiki/X', title: 'X' } })),
  findPath,
  findDecisionConflicts: vi.fn(async () => ({ conflicts: [] })),
  getDecisionProvenance: vi.fn(async () => ({})),
  // Entity editing needs an adapter that can write (OPS-UI-WIRING-AUDIT-1).
  updateEntityNode: vi.fn(async () => ({})),
});

async function render(props = {}, data = DATA) {
  await act(async () => {
    reactRoot.render(createElement(GraphExplorer, { adapter: adapter(), data, ...props }));
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

describe('entity editing and grounding (rows 40-44, 47)', () => {
  it('default: no type dropdown, no rename, no Ground, no Remove grounding; read-only Grounded status stays', async () => {
    await render();
    await tap('e1');
    expect(has('[title="Click to change entity type"]')).toBe(false);
    expect(has('[title="Click to rename"]')).toBe(false);
    expect(has('[title="Remove grounding"]')).toBe(false);
    expect(btn('Ground')).toBeUndefined();
    expect(host.textContent).toContain('Grounded');
    expect(host.textContent).toContain('Entity one');
  });
  it('enableEntityEditing: type dropdown, rename and Remove grounding are back', async () => {
    await render({ enableEntityEditing: true });
    await tap('e1');
    expect(has('[title="Click to change entity type"]')).toBe(true);
    expect(has('[title="Click to rename"]')).toBe(true);
    expect(has('[title="Remove grounding"]')).toBe(true);
  });
  it('enableGrounding: Ground button shows on an ungrounded entity, default does not', async () => {
    const a = adapter();
    a.getGroundingStatus = vi.fn(async () => ({ grounded: false }));
    await act(async () => { reactRoot.render(createElement(GraphExplorer, { adapter: a, data: DATA, enableGrounding: true })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    await tap('e1');
    expect(btn('Ground')).toBeDefined();
    await act(async () => { reactRoot.render(createElement(GraphExplorer, { adapter: a, data: DATA })); });
    await tap('e1');
    expect(btn('Ground')).toBeUndefined();
  });
});

describe('decision block (rows 53-57)', () => {
  it('default: no Find conflicts / Load provenance, but chain controls are there', async () => {
    await render();
    await tap('d1');
    expect(btn('Find conflicts')).toBeUndefined();
    expect(btn('Load provenance')).toBeUndefined();
    expect(btn('Highlight chain')).toBeDefined();
  });
  it('enableDecisionTools: conflicts and provenance buttons are back', async () => {
    await render({ enableDecisionTools: true });
    await tap('d1');
    expect(btn('Find conflicts')).toBeDefined();
    expect(btn('Load provenance')).toBeDefined();
  });
  it('Highlight chain highlights the chain on the canvas and Clear removes it', async () => {
    await render();
    await tap('d1');
    await click(btn('Highlight chain'));
    expect(cy().getElementById('m2').hasClass('highlighted')).toBe(true);
    expect(cy().getElementById('d1').hasClass('highlighted')).toBe(true);
    await click(btn('Clear'));
    expect(cy().getElementById('m2').hasClass('highlighted')).toBe(false);
  });
  it('clicking a superseded decision id opens that node', async () => {
    await render();
    await tap('d1');
    await click(btn('m2'));
    expect(host.textContent).toContain('Memory two');
  });
});

describe('export, path, legend, link', () => {
  it('Export menu: PNG only by default, SVG with enableSvgExport', async () => {
    await render();
    await click(btn('Export'));
    expect(btn('PNG (2x)')).toBeDefined();
    expect(btn('SVG')).toBeUndefined();
    await render({ enableSvgExport: true });
    expect(btn('SVG')).toBeDefined();
  });
  it('Path: asks for the START then the END node, and says so when there is no path', async () => {
    await render();
    await click(btn('Path'));
    expect(host.textContent).toContain('Click the START node');
    await tap('m1');
    expect(host.textContent).toContain('Click the END node');
    await tap('e1');
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(findPath).toHaveBeenCalledWith('m1', 'e1');
    expect(host.textContent).toContain('No path between these nodes');
  });
  it('Path: a found path is highlighted and raises no error', async () => {
    findPath.mockResolvedValue({ path: [{ item_id: 'm1' }, { item_id: 'e1' }], path_found: true });
    await render();
    await click(btn('Path'));
    await tap('m1');
    await tap('e1');
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(cy().getElementById('e1').hasClass('highlighted')).toBe(true);
    expect(host.textContent).not.toContain('No path between');
  });
  it('Legend checkbox only when some node carries an origin', async () => {
    await render({}, NO_ORIGIN);
    expect(host.textContent).not.toContain('Legend');
    await render({}, DATA);
    expect(host.textContent).toContain('Legend');
  });
  it('Link: "Copied!" only when the clipboard write succeeds', async () => {
    await render();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(() => Promise.reject(new Error('denied'))) } });
    await click(btn('Link'));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(btn('Copied!')).toBeUndefined();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(() => Promise.resolve()) } });
    await click(btn('Link'));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(btn('Copied!')).toBeDefined();
  });
  it('Link: a #layout= in the URL is used for the first layout', async () => {
    window.location.hash = '#layout=grid';
    vi.spyOn(window.HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 });
    await render();
    expect(globalThis.__layouts[0]).toBe('grid');
  });
  it('Link: an unknown #layout= falls back to the force layout', async () => {
    window.location.hash = '#layout=bogus';
    vi.spyOn(window.HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 });
    await render();
    expect(globalThis.__layouts[0]).toBe('cose-bilkent');
  });
});

describe('replay banner (row 63)', () => {
  it('is gated by showPlaybackBar (same prop as the bar that starts a replay)', async () => {
    await render();
    expect(host.textContent).not.toContain('Replaying recording');
  });
});
