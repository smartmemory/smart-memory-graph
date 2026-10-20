// STUDIO-RUN-INSPECTOR-EMPTY-GRAPH-1: follow mode releases every arriving event at once, so a completed run opens at its
// END state (its recorded drips span ~30 virtual minutes). seek() and pause() leave follow mode.
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let deliver;
vi.mock('@smartmemory/sdk-js/progress', () => ({
  subscribeProgress: vi.fn((opts) => { deliver = opts.onEvent; return { close() {} }; }),
}));

import { useReplayClock } from '../src/hooks/useReplayClock.js';
import { installDom } from './helpers/dom.js';

let cleanupDom, root, current, options, released;
function Harness() { current = useReplayClock(options); return null; }
async function settle(ms = 0) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function render() { await act(async () => { root.render(createElement(Harness)); }); }
// Drips 0..5, ten minutes apart (0 to 50 virtual minutes).
const ev = (seq) => ({ run_id: 'run_1', seq, ts: 1000 + seq * 600, kind: 'graph.node', payload: { data: { id: `n${seq}` } } });
async function deliverAll(n = 6) { await act(async () => { for (let i = 0; i < n; i += 1) deliver(ev(i)); }); }

beforeEach(() => {
  cleanupDom = installDom(); vi.useFakeTimers();
  root = createRoot(document.getElementById('root'));
  released = [];
  options = { runId: 'run_1', baseUrl: 'https://api.test', autoplay: true };
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.restoreAllMocks(); cleanupDom(); });

async function mountAndSubscribe() {
  await render();
  await act(async () => { current.subscribe((e) => released.push(e.seq)); });
}

it('without follow, a 50-minute run releases only its first event in the first seconds (the repro)', async () => {
  await mountAndSubscribe();
  await deliverAll();
  await settle(2000);
  expect(released).toEqual([0]);
  expect(current.following).toBe(false);
});

it('follow releases every arriving event at once and the playhead sits at the end', async () => {
  options = { ...options, follow: true };
  await mountAndSubscribe();
  expect(current.following).toBe(true);
  await deliverAll();
  expect(released).toEqual([0, 1, 2, 3, 4, 5]);
  expect(current.now).toBe(1000 + 5 * 600);
});

it('seek leaves follow mode; later arrivals wait for the playhead', async () => {
  options = { ...options, follow: true };
  await mountAndSubscribe();
  await act(async () => { deliver(ev(0)); });
  await act(async () => { current.seek(1000); });
  expect(current.following).toBe(false);
  released = [];
  await act(async () => { deliver(ev(3)); });
  expect(released).toEqual([]);
});

it('pause leaves follow mode', async () => {
  options = { ...options, follow: true };
  await mountAndSubscribe();
  await act(async () => { current.pause(); });
  expect(current.following).toBe(false);
  await act(async () => { deliver(ev(0)); deliver(ev(2)); });
  expect(released).toEqual([]);
});

it('maxGapSec makes the 50-minute replay watchable after a seek to the start', async () => {
  options = { ...options, follow: true, maxGapSec: 1 };
  await mountAndSubscribe();
  await deliverAll();
  released = [];
  await act(async () => { current.seek(1000); current.play(); });
  await settle(6000); // five 600 s gaps, each capped at 1 s of virtual time at 1x
  expect(released).toEqual([0, 1, 2, 3, 4, 5]);
});
