// STUDIO-RUN-INSPECTOR-STREAM-ERROR-1: useReplayClock forwards SDK auth, so the replay request carries the selected
// workspace and cookie credentials (the progress route is team_required), and a refused run stays a terminal error.
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthCore } from '@smartmemory/sdk-js';
import { useReplayClock } from '../src/hooks/useReplayClock.js';
import { installDom } from './helpers/dom.js';

let cleanupDom, root, current, options, calls, transport, auth;
function Harness() { current = useReplayClock(options); return null; }
async function settle(ms = 0) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function render() { await act(async () => { root.render(createElement(Harness)); }); }
const frame = `id: 1-0\ndata: ${JSON.stringify({ run_id: 'run_1', scope: 'workspace:ws', seq: 0, ts: 100, kind: 'pipeline.stage', status: 'ok', stage: 'extraction', payload: {} })}\n\n`;

beforeEach(() => {
  cleanupDom = installDom(); vi.useFakeTimers(); vi.spyOn(console, 'warn').mockImplementation(() => {});
  root = createRoot(document.getElementById('root')); calls = [];
  transport = vi.fn(async (url, init) => {
    calls.push({ url: String(url), ...init, headers: new Headers(init.headers) });
    return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(frame)); } }),
      { headers: { 'content-type': 'text/event-stream' } });
  });
  window.fetch = transport; vi.stubGlobal('fetch', transport);
  auth = new AuthCore({ mode: 'sso', storage: 'memory', apiBaseUrl: 'https://api.test', fetchFn: transport });
  auth.currentToken = null; auth.tokenManager.setWorkspaceId('ws');
  options = { runId: 'run_1', baseUrl: 'https://api.test', auth };
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.restoreAllMocks(); cleanupDom(); });

it('replays with the selected workspace and cookie credentials from SDK auth', async () => {
  await render(); await settle();
  expect(calls[0].url).toBe('https://api.test/memory/progress/stream?run_id=run_1&from_seq=0');
  expect(calls[0].headers.get('X-Workspace-Id')).toBe('ws');
  expect(calls[0].credentials).toBe('include');
  expect(current.isReady).toBe(true); expect(current.error).toBeNull();
});

it('a refused run (404) is a terminal error, never retried', async () => {
  transport.mockResolvedValue(new Response('{"detail":"No events found"}', { status: 404 }));
  await render(); await settle();
  expect(current.error?.message).toContain('HTTP 404'); expect(current.isReady).toBe(false);
  await settle(60000); expect(transport).toHaveBeenCalledOnce();
});

it('without auth, a static token is still sent (legacy callers)', async () => {
  options = { runId: 'run_1', baseUrl: 'https://api.test', token: 'static' };
  await render(); await settle();
  expect(calls[0].headers.get('Authorization')).toBe('Bearer static');
  expect(calls[0].headers.get('X-Workspace-Id')).toBeNull();
});
