/**
 * UI-REFRESH-1 — the graph fetched once on mount and never again, so a memory saved from the CLI
 * or MCP stayed invisible until a page reload. `useGraphData(adapter, { refreshSignal })` now
 * refetches in the background whenever the host changes the signal (the console bumps it on
 * window focus, on a visible-tab interval, and after its own writes).
 *
 * A background refresh must not flash the loading state, must keep the current graph when it
 * fails (the failure is logged, not shown as an error screen), and must not hand the canvas new
 * arrays when nothing changed (that re-runs the merge for no reason).
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDom } from './helpers/dom.js';
import { useGraphData } from '../src/hooks/useGraphData.js';

let uninstall;
let root;
let latest;
const loadingSeen = [];

function Harness({ adapter, refreshSignal }) {
  latest = useGraphData(adapter, { refreshSignal });
  loadingSeen.push(latest.loading);
  return null;
}

async function render(adapter, refreshSignal) {
  await act(async () => {
    root.render(createElement(Harness, { adapter, refreshSignal }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const apiNode = (id) => ({ item_id: id, label: id, memory_type: 'semantic', category: 'memory' });

beforeEach(() => {
  uninstall = installDom();
  root = createRoot(document.getElementById('root'));
  loadingSeen.length = 0;
});
afterEach(() => {
  act(() => root.unmount());
  uninstall();
  vi.restoreAllMocks();
});

describe('useGraphData background refresh', () => {
  it('shows data written by another client after the refresh signal changes, without a reload', async () => {
    const fail = Object.assign(new Error('API 502'), { status: 502 });
    const adapter = {
      getFullGraph: vi.fn()
        .mockResolvedValueOnce({ nodes: [apiNode('a')], edges: [] })
        .mockResolvedValueOnce({ nodes: [apiNode('a'), apiNode('b')], edges: [] })
        .mockRejectedValueOnce(fail)
        .mockResolvedValueOnce({ nodes: [apiNode('a'), apiNode('b')], edges: [] }),
      listMemories: vi.fn().mockRejectedValue(fail),
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await render(adapter, 0);
    expect(latest.nodes.map((n) => n.id)).toEqual(['a']);
    const afterMount = loadingSeen.length;

    // Another client wrote "b"; the host bumps the signal (focus / interval / own write).
    await render(adapter, 1);
    expect(adapter.getFullGraph).toHaveBeenCalledTimes(2);
    expect(latest.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(loadingSeen.slice(afterMount)).not.toContain(true); // no loading flash

    // A failed background refresh keeps the graph and logs, it does not show an error.
    await render(adapter, 2);
    expect(latest.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(latest.error).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('background refresh failed'), expect.anything());

    // Same data again: the arrays keep their identity, so the canvas merge does not re-run.
    const before = latest.nodes;
    await render(adapter, 3);
    expect(adapter.getFullGraph).toHaveBeenCalledTimes(4);
    expect(latest.nodes).toBe(before);
  });
});
