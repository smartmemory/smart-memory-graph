/**
 * UI-REFRESH-FU-1 (H2 of the UI-REFRESH-1 post-land review) — a refresh signal that arrives while
 * a graph fetch is still in flight must not be dropped.
 *
 * Before: `useGraphData` recorded the new signal as handled, then skipped the fetch because one was
 * pending. The pending request carried the pre-write snapshot, so a save made during a focus or
 * interval refresh never showed until some later, unrelated signal.
 *
 * Rule: a skipped trigger marks the data dirty. When the in-flight request settles (success or
 * error), a dirty flag starts exactly one trailing fetch, and only while the tab is visible.
 * No loop, and no extra fetch when nothing arrived during the flight.
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDom } from './helpers/dom.js';
import { useGraphData } from '../src/hooks/useGraphData.js';

let uninstall;
let root;
let latest;
let visibility;

function Harness({ adapter, refreshSignal }) {
  latest = useGraphData(adapter, { refreshSignal });
  return null;
}

async function render(adapter, refreshSignal) {
  await act(async () => {
    root.render(createElement(Harness, { adapter, refreshSignal }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const apiNode = (id) => ({ item_id: id, label: id, memory_type: 'semantic', category: 'memory' });
const payload = (...ids) => ({ nodes: ids.map(apiNode), edges: [] });
const ids = () => latest.nodes.map((n) => n.id);

// An adapter whose Nth call is answered by the test: calls[n] = { resolve, reject }.
// Calls the test did not script resolve to the saved server state immediately.
function scriptedAdapter(held) {
  const calls = [];
  const adapter = {
    getFullGraph: vi.fn(() => {
      const n = calls.length;
      if (held.includes(n)) {
        return new Promise((resolve, reject) => { calls.push({ resolve, reject }); });
      }
      calls.push({});
      return Promise.resolve(n === 0 ? payload('a') : payload('a', 'saved'));
    }),
    listMemories: vi.fn().mockRejectedValue(Object.assign(new Error('API 502'), { status: 502 })),
  };
  return { adapter, calls };
}

const settleCall = (call, run) => act(async () => { run(call); await new Promise((r) => setTimeout(r, 0)); });
const setVisibility = (state) => {
  visibility = state;
  document.dispatchEvent(new document.defaultView.Event('visibilitychange'));
};

beforeEach(() => {
  uninstall = installDom();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  root = createRoot(document.getElementById('root'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  act(() => root.unmount());
  uninstall();
  vi.restoreAllMocks();
});

describe('useGraphData: a refresh signal during an in-flight fetch', () => {
  it('runs one trailing fetch and shows the write that arrived during the flight', async () => {
    const { adapter, calls } = scriptedAdapter([1]);
    await render(adapter, 0);
    await render(adapter, 1); // focus or interval refresh, held in flight with the pre-write snapshot
    expect(adapter.getFullGraph).toHaveBeenCalledTimes(2);
    await render(adapter, 2); // the console's own save finishes while that fetch is pending
    expect(adapter.getFullGraph).toHaveBeenCalledTimes(2); // not stacked on the pending one

    await settleCall(calls[1], (c) => c.resolve(payload('a')));

    expect(adapter.getFullGraph).toHaveBeenCalledTimes(3);
    expect(ids()).toEqual(['a', 'saved']);
    expect(latest.loading).toBe(false);
  });

  it('coalesces two signals during one flight into one trailing fetch', async () => {
    const { adapter, calls } = scriptedAdapter([1]);
    await render(adapter, 0);
    await render(adapter, 1);
    await render(adapter, 2);
    await render(adapter, 3);

    await settleCall(calls[1], (c) => c.resolve(payload('a')));

    expect(adapter.getFullGraph).toHaveBeenCalledTimes(3);
    expect(ids()).toEqual(['a', 'saved']);
  });

  it('runs no trailing fetch when nothing arrived during the flight', async () => {
    const { adapter, calls } = scriptedAdapter([1]);
    await render(adapter, 0);
    await render(adapter, 1);

    await settleCall(calls[1], (c) => c.resolve(payload('a', 'saved')));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    expect(adapter.getFullGraph).toHaveBeenCalledTimes(2);
    expect(ids()).toEqual(['a', 'saved']);
  });

  it('still runs the trailing fetch when the in-flight request fails', async () => {
    const { adapter, calls } = scriptedAdapter([1]);
    await render(adapter, 0);
    await render(adapter, 1);
    await render(adapter, 2);

    // A 500 on the in-flight request: the fallback is exercised too, and both fail.
    await settleCall(calls[1], (c) => c.reject(Object.assign(new Error('API 500'), { status: 500 })));

    expect(adapter.getFullGraph).toHaveBeenCalledTimes(3);
    expect(ids()).toEqual(['a', 'saved']);
    expect(latest.error).toBeNull();
  });

  it('waits for the tab to be visible before the trailing fetch', async () => {
    const { adapter, calls } = scriptedAdapter([1]);
    await render(adapter, 0);
    await render(adapter, 1);
    await render(adapter, 2);

    await act(async () => setVisibility('hidden'));
    await settleCall(calls[1], (c) => c.resolve(payload('a')));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(adapter.getFullGraph).toHaveBeenCalledTimes(2); // hidden: no fetch
    expect(ids()).toEqual(['a']);

    await act(async () => setVisibility('visible'));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(adapter.getFullGraph).toHaveBeenCalledTimes(3);
    expect(ids()).toEqual(['a', 'saved']);

    // The wait is one-shot: further visibility changes fetch nothing.
    await act(async () => setVisibility('hidden'));
    await act(async () => setVisibility('visible'));
    expect(adapter.getFullGraph).toHaveBeenCalledTimes(3);
  });

  it('a stale response never overwrites a newer one', async () => {
    const { adapter, calls } = scriptedAdapter([1]);
    await render(adapter, 0);
    await render(adapter, 1); // call 1 held
    await act(async () => { latest.refresh(); }); // foreground reload supersedes it (call 2, resolves at once)
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(ids()).toEqual(['a', 'saved']);

    await settleCall(calls[1], (c) => c.resolve(payload('a'))); // the older snapshot arrives last

    expect(ids()).toEqual(['a', 'saved']);
    expect(adapter.getFullGraph).toHaveBeenCalledTimes(3);
  });
});
