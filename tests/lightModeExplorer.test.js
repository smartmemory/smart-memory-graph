/**
 * UI-LIGHT-MODE-LM1-1: the mounted explorer follows the `mode` prop.
 *
 * The real GraphExplorer (real useCytoscape, real cytoscape) in jsdom with a stubbed adapter,
 * the same harness as graphExplorerKeyboard.test.js. Rows: no mode (default dark), light,
 * dark again. A flip must restyle in place: no node moves and no layout runs.
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
    globalThis.__lmCy = cy;
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
    { id: 'm1', label: 'Memory one', type: 'semantic', category: 'memory' },
    { id: 'm2', label: 'Memory two', type: 'episodic', category: 'memory' },
    { id: 'e1', label: 'Entity one', type: 'person', category: 'entity' },
  ],
  edges: [{ id: 'x1', source: 'm1', target: 'e1', type: 'MENTIONS' }],
};

let cleanupDom, host, reactRoot;
const cy = () => globalThis.__lmCy;
const adapter = () => ({ getFullGraph: vi.fn(async () => ({ nodes: [], edges: [] })) });

async function render(props = {}) {
  await act(async () => {
    reactRoot.render(createElement(GraphExplorer, { adapter: adapter(), data: DATA, ...props }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
}
const snapshot = () => ({
  label: cy().getElementById('m1').style('color'),
  edge: cy().getElementById('x1').style('line-color'),
  fills: cy().nodes().map((n) => `${n.id()}=${n.style('background-color')}`),
  pos: cy().nodes().map((n) => `${n.id()}@${Math.round(n.position('x'))},${Math.round(n.position('y'))}`),
});

beforeEach(async () => {
  cleanupDom = installDom();
  installCanvasStub();
  window.HTMLElement.prototype.attachEvent = () => {};
  window.HTMLElement.prototype.detachEvent = () => {};
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(() => fn(Date.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('getComputedStyle', window.getComputedStyle.bind(window));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  globalThis.__lmCy = null;
  host = document.createElement('div');
  host.style.setProperty('--ring', '221 83% 53%');
  document.body.appendChild(host);
  reactRoot = createRoot(host);
});
afterEach(async () => {
  await act(async () => reactRoot.unmount());
  vi.restoreAllMocks();
  cleanupDom();
});

describe('GraphExplorer mode prop', () => {
  it('no mode prop renders the dark canvas (existing consumers unchanged)', async () => {
    await render();
    expect(cy().scratch('_smMode')).toBe('dark');
    expect(snapshot().label).toBe('rgb(203,213,225)'); // #cbd5e1
  });

  it("mode='light' restyles labels, edges and the selection border, keeps fills and positions", async () => {
    await render();
    const dark = snapshot();
    // jsdom does not inherit custom properties from an ancestor the way a browser does, so the host
    // token is set on the canvas container itself (inheritance is checked in the real-browser shots).
    cy().container().style.setProperty('--ring', '221 83% 53%');
    await render({ mode: 'light' });
    const light = snapshot();
    expect(cy().scratch('_smMode')).toBe('light');
    expect(light.label).toBe('rgb(15,23,42)'); // #0f172a
    expect(light.edge).toBe('rgb(148,163,184)'); // #94a3b8
    expect(light.label).not.toBe(dark.label);
    expect(light.edge).not.toBe(dark.edge);
    expect(light.fills).toEqual(dark.fills);
    expect(light.pos).toEqual(dark.pos);
    await act(async () => { cy().getElementById('m1').select(); });
    expect(cy().getElementById('m1').style('border-color')).toBe('rgb(36,99,235)'); // --ring 221 83% 53%
  });

  it('flipping light then dark restores the dark values without a layout run', async () => {
    await render();
    const dark = snapshot();
    const layoutSpy = vi.spyOn(cy(), 'layout');
    await render({ mode: 'light' });
    await render({ mode: 'dark' });
    expect(snapshot()).toEqual(dark);
    expect(layoutSpy).not.toHaveBeenCalled();
  });

  it('an explicit theme.mode beats the mode prop', async () => {
    await render({ mode: 'dark', theme: { mode: 'light' } });
    expect(cy().scratch('_smMode')).toBe('light');
    expect(snapshot().label).toBe('rgb(15,23,42)');
  });
});
