/**
 * UI-REFRESH-FU-2: the one refresh mechanism (src/core/refreshScheduler.js) and the graph's
 * consumer of it (src/hooks/useGraphData.js).
 *
 * Before: useGraphData deferred its trailing fetch while the tab was hidden, but a new refresh
 * signal while still hidden went straight to the adapter (UI-REFRESH-FU-1 review H2).
 *
 * The mechanism rows below are the same table smart-memory-web runs against both copies
 * (src/__tests__/refresh-mechanism.test.jsx there); web also checks the two files are
 * byte-identical. The in-flight and stale-order rows for useGraphData are in
 * graphDataRefreshInFlight.test.js.
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDom } from './helpers/dom.js';
import { createRefreshScheduler } from '../src/core/refreshScheduler.js';
import { useGraphData } from '../src/hooks/useGraphData.js';

let uninstall;
let visibility;
const setVisibility = (state) => {
  visibility = state;
  document.dispatchEvent(new document.defaultView.Event('visibilitychange'));
};

beforeEach(() => {
  uninstall = installDom();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  uninstall();
  vi.restoreAllMocks();
});

// A view the way the consumers use the scheduler: every request reports itself with begin() and
// calls end() when it settles; background runs go through the scheduler.
function makeView() {
  const requests = [];
  const view = {
    requests,
    runs: [],
    fetch({ fresh = true } = {}) {
      const end = view.scheduler.begin({ fresh });
      let settle;
      const promise = new Promise((resolve, reject) => { settle = { resolve, reject }; });
      const request = {
        resolve: async ({ superseded = false } = {}) => { settle.resolve(); await promise; end({ superseded }); },
        reject: async () => { settle.reject(new Error('API 500')); await promise.catch(() => {}); end(); },
      };
      requests.push(request);
      return request;
    },
  };
  view.scheduler = createRefreshScheduler((reasons) => {
    view.runs.push(reasons);
    return view.fetch();
  });
  return view;
}

const MECHANISM = [
  {
    row: 'one signal during a flight: exactly one trailing run when it settles',
    run: async (view) => {
      const first = view.fetch();
      view.scheduler.trigger('signal');
      expect(view.requests).toHaveLength(1);
      await first.resolve();
      expect(view.requests).toHaveLength(2);
      expect(view.runs).toEqual([['signal']]);
    },
  },
  {
    row: 'two signals during one flight: still exactly one trailing run',
    run: async (view) => {
      const first = view.fetch();
      view.scheduler.trigger('signal');
      view.scheduler.trigger('write');
      await first.resolve();
      expect(view.requests).toHaveLength(2);
      await view.requests[1].resolve();
      expect(view.requests).toHaveLength(2);
    },
  },
  {
    row: 'no signal during a flight: no trailing run',
    run: async (view) => {
      await view.fetch().resolve();
      expect(view.requests).toHaveLength(1);
    },
  },
  {
    row: 'a flight that fails still runs the pending trailing run',
    run: async (view) => {
      const first = view.fetch();
      view.scheduler.trigger('live');
      await first.reject();
      expect(view.requests).toHaveLength(2);
    },
  },
  {
    row: 'hidden: a signal makes no request, then exactly one on visible',
    run: async (view) => {
      setVisibility('hidden');
      view.scheduler.trigger('signal');
      view.scheduler.trigger('live');
      expect(view.requests).toHaveLength(0);
      setVisibility('visible');
      expect(view.requests).toHaveLength(1);
      setVisibility('hidden');
      setVisibility('visible');
      expect(view.requests).toHaveLength(1);
    },
  },
  {
    row: 'hidden after a deferred trailing run: a new signal still makes no request, one on visible',
    run: async (view) => {
      const first = view.fetch();
      view.scheduler.trigger('signal');
      setVisibility('hidden');
      await first.resolve();
      view.scheduler.trigger('signal');
      expect(view.requests).toHaveLength(1);
      setVisibility('visible');
      expect(view.requests).toHaveLength(2);
    },
  },
  {
    row: 'a fresh request superseded by an append counts as a trigger again',
    run: async (view) => {
      const refresh = view.fetch();
      const append = view.fetch({ fresh: false });
      await refresh.resolve({ superseded: true });
      expect(view.requests).toHaveLength(2);
      await append.resolve();
      expect(view.requests).toHaveLength(3);
      expect(view.runs).toEqual([['superseded']]);
    },
  },
  {
    row: 'a fresh request superseded by a newer fresh request does not trail',
    run: async (view) => {
      const older = view.fetch();
      const newer = view.fetch();
      await newer.resolve();
      await older.resolve({ superseded: true });
      expect(view.requests).toHaveLength(2);
    },
  },
  {
    row: 'many hidden triggers add one visibility listener; stop removes it and ignores triggers',
    run: async (view) => {
      const add = vi.spyOn(document, 'addEventListener');
      const remove = vi.spyOn(document, 'removeEventListener');
      const visibilityCalls = (spy) => spy.mock.calls.filter(([type]) => type === 'visibilitychange');
      setVisibility('hidden');
      for (let i = 0; i < 25; i += 1) view.scheduler.trigger('signal');
      expect(visibilityCalls(add)).toHaveLength(1);
      view.scheduler.stop();
      expect(visibilityCalls(remove)).toHaveLength(1);
      view.scheduler.trigger('signal');
      setVisibility('visible');
      expect(view.requests).toHaveLength(0);
    },
  },
];

describe('refreshScheduler', () => {
  for (const { row, run } of MECHANISM) it(row, () => run(makeView()));
});

// useGraphData through the scheduler, with the tab hidden.
let root;
let latest;
function Harness({ adapter, refreshSignal }) {
  latest = useGraphData(adapter, { refreshSignal });
  return null;
}
async function render(adapter, refreshSignal) {
  await act(async () => { root.render(createElement(Harness, { adapter, refreshSignal })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const apiNode = (id) => ({ item_id: id, label: id, memory_type: 'semantic', category: 'memory' });
const payload = (...ids) => ({ nodes: ids.map(apiNode), edges: [] });
const ids = () => latest.nodes.map((n) => n.id);
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

// Call n is held when listed, else answers with the current server state at once.
function scriptedAdapter(held, server) {
  const calls = [];
  const adapter = {
    getFullGraph: vi.fn(() => {
      const snapshot = payload(...server.ids);
      if (held.includes(calls.length)) {
        return new Promise((resolve) => { calls.push({ release: () => resolve(snapshot) }); });
      }
      calls.push({});
      return Promise.resolve(snapshot);
    }),
    listMemories: vi.fn().mockRejectedValue(Object.assign(new Error('API 502'), { status: 502 })),
  };
  return { adapter, calls };
}

const GRAPH_ROWS = [
  {
    row: 'hidden: a refresh signal makes no request, one on visible',
    run: async () => {
      const server = { ids: ['a'] };
      const { adapter } = scriptedAdapter([], server);
      await render(adapter, 0);
      await act(async () => setVisibility('hidden'));
      server.ids = ['a', 'saved'];
      await render(adapter, 1);
      await render(adapter, 2);
      await flush();
      expect(adapter.getFullGraph).toHaveBeenCalledTimes(1);
      expect(ids()).toEqual(['a']);
      await act(async () => setVisibility('visible'));
      await flush();
      expect(adapter.getFullGraph).toHaveBeenCalledTimes(2);
      expect(ids()).toEqual(['a', 'saved']);
    },
  },
  {
    // UI-REFRESH-FU-1 review H2, GRAPH_HIDDEN_SIGNAL.
    row: 'hidden: a new signal while the trailing fetch waits for visibility still makes no request',
    run: async () => {
      const server = { ids: ['a'] };
      const { adapter, calls } = scriptedAdapter([1], server);
      await render(adapter, 0);
      await render(adapter, 1); // call 1 held with the old snapshot
      server.ids = ['a', 'saved'];
      await render(adapter, 2); // during the flight
      await act(async () => setVisibility('hidden'));
      await act(async () => { calls[1].release(); });
      await flush();
      expect(adapter.getFullGraph).toHaveBeenCalledTimes(2);
      await render(adapter, 3); // an own write finishing after the user left the tab
      await flush();
      expect(adapter.getFullGraph).toHaveBeenCalledTimes(2);
      expect(ids()).toEqual(['a']);
      await act(async () => setVisibility('visible'));
      await flush();
      expect(adapter.getFullGraph).toHaveBeenCalledTimes(3);
      expect(ids()).toEqual(['a', 'saved']);
    },
  },
  {
    row: 'unmount while waiting for visibility removes the listener: nothing runs on visible',
    run: async () => {
      const server = { ids: ['a'] };
      const { adapter } = scriptedAdapter([], server);
      await render(adapter, 0);
      await act(async () => setVisibility('hidden'));
      await render(adapter, 1);
      const remove = vi.spyOn(document, 'removeEventListener');
      act(() => root.unmount());
      expect(remove.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(1);
      await act(async () => setVisibility('visible'));
      await flush();
      expect(adapter.getFullGraph).toHaveBeenCalledTimes(1);
      root = createRoot(document.getElementById('root')); // afterEach unmounts it
    },
  },
];

describe('useGraphData: the refresh signal never fetches while the tab is hidden', () => {
  beforeEach(() => { root = createRoot(document.getElementById('root')); });
  afterEach(() => { act(() => root.unmount()); });

  for (const { row, run } of GRAPH_ROWS) it(row, run);
});
