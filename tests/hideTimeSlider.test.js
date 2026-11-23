/**
 * UI-HIDE-TIME-SLIDER-1: the Time button, slider and "Viewing: <date>" label render only when the host
 * passes `enableTimeTravel`. With it off, a past time in the URL (#asof=...) is ignored: the live graph
 * shows and no snapshot is fetched. Same real-explorer jsdom harness as lightModeExplorer.test.js.
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
const cy = () => globalThis.__tsCy;
let snapshotSpy;
const adapter = () => ({ getFullGraph: vi.fn(async () => ({ nodes: [], edges: [] })), getTemporalSnapshot: snapshotSpy });

async function render(props = {}) {
  await act(async () => {
    reactRoot.render(createElement(GraphExplorer, { adapter: adapter(), data: DATA, ...props }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
}

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
  snapshotSpy = vi.fn(async () => ({ state: [] }));
  host = document.createElement('div');
  document.body.appendChild(host);
  reactRoot = createRoot(host);
});
afterEach(async () => {
  await act(async () => reactRoot.unmount());
  vi.restoreAllMocks();
  cleanupDom();
});

const timeButton = () => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Time');

describe('GraphExplorer enableTimeTravel prop', () => {
  it('default: no Time button', async () => {
    await render();
    expect(timeButton()).toBeUndefined();
  });

  it('enableTimeTravel: the Time button is present', async () => {
    await render({ enableTimeTravel: true });
    expect(timeButton()).toBeDefined();
  });

  it('default: a past time in the URL is ignored, live graph, no slider, no past-date label', async () => {
    window.location.hash = '#asof=2026-01-01T00:00:00.000Z';
    await render();
    expect(snapshotSpy).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('Viewing:');
    expect(cy().nodes().length).toBe(3);
  });

  it('enableTimeTravel: a past time in the URL loads the snapshot and shows the label', async () => {
    window.location.hash = '#asof=2026-01-01T00:00:00.000Z';
    await render({ enableTimeTravel: true });
    expect(snapshotSpy).toHaveBeenCalledWith('2026-01-01T00:00:00.000Z');
    expect(host.textContent).toContain('Viewing:');
  });
});
