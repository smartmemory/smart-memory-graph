import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthCore } from '@smartmemory/sdk-js';
import { useGraphStream } from '../src/hooks/useGraphStream.js';
import { useConnectionStatus } from '../src/hooks/useConnectionStatus.js';
import { installDom } from './helpers/dom.js';
let cleanupDom, root, current, options, calls, controllers, auth, transport;
const frame = (seq) => `id: 123000-${seq}\ndata: ${JSON.stringify({ run_id: 'run', scope: 'ws', seq, ts: 123, kind: 'graph.node', status: 'ok', payload: { data: { id: `node-${seq}`, content: `Node ${seq}`, memory_type: 'semantic' } } })}\n\n`;
function Harness() { current = useGraphStream(options); return null; }
async function settle(ms = 0) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function render() { await act(async () => { root.render(createElement(Harness)); }); }
function push(index, seq) { controllers[index].enqueue(new TextEncoder().encode(frame(seq))); }
beforeEach(() => {
  cleanupDom = installDom(); vi.useFakeTimers(); vi.spyOn(console, 'warn').mockImplementation(() => {});
  root = createRoot(document.getElementById('root')); calls = []; controllers = [];
  transport = vi.fn(async (url, init) => {
    calls.push({ url: String(url), ...init, headers: new Headers(init.headers) });
    return new Response(new ReadableStream({ start(c) { controllers.push(c); } }), { headers: { 'content-type': 'text/event-stream' } });
  });
  window.fetch = transport; vi.stubGlobal('fetch', transport);
  auth = new AuthCore({ mode: 'sso', storage: 'memory', apiBaseUrl: 'https://api.test', fetchFn: transport });
  auth.currentToken = 'old'; auth.tokenManager.setWorkspaceId('ws');
  options = { sseBaseUrl: auth.apiBaseUrl, auth, workspaceId: 'ws', onElementAdded: vi.fn() };
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.restoreAllMocks(); cleanupDom(); });
it('reopens EOF with fresh credentials and exact cursor, deduplicates replay, and cleans up', async () => {
  await render(); push(0, 1); await settle(210);
  expect(options.onElementAdded).toHaveBeenCalledTimes(1);
  await act(async () => controllers[0].close());
  expect(current.status).toBe('reconnecting'); expect(auth.connection.snapshot.status).toBe('reconnecting');
  auth.currentToken = 'fresh'; await settle(1000);
  expect(calls[1].headers.get('Authorization')).toBe('Bearer fresh');
  expect(calls[1].url).toContain('since=123000-1');
  expect(calls[1].headers.get('Last-Event-ID')).toBe('123000-1'); expect(current.status).toBe('connected');
  push(1, 1); push(1, 2); await settle(210);
  expect(options.onElementAdded).toHaveBeenCalledTimes(2); expect(options.onElementAdded.mock.calls[1][0].id).toBe('node-2');
  options = { ...options, enabled: false }; await render(); expect(calls[1].signal.aborted).toBe(true);
  window.dispatchEvent(new window.Event('online')); await settle(60000); expect(calls).toHaveLength(2);
});
it('uses real refresh after stream 401, including a cookie-only session', async () => {
  auth.currentToken = null;
  transport.mockImplementationOnce(async (url, init) => { calls.push({ url, ...init }); return new Response('', { status: 401 }); })
    .mockImplementationOnce(async (url, init) => { calls.push({ url, ...init }); return new Response('{"access_token":"renewed"}'); });
  await render(); await settle();
  expect(calls[1].url).toBe('https://api.test/auth/refresh'); expect(calls[0].credentials).toBe('include');
  expect(calls[2].headers.get('Authorization')).toBe('Bearer renewed'); expect(auth.currentToken).toBe('renewed');
});
it('visibility and online resume with current headers; scope changes discard old queues and cursor', async () => {
  await render(); push(0, 1); await settle(210); auth.currentToken = 'visible-token';
  await act(async () => document.dispatchEvent(new window.Event('visibilitychange'))); await settle();
  expect(calls[0].signal.aborted).toBe(true); expect(calls[1].headers.get('Authorization')).toBe('Bearer visible-token');
  auth.currentToken = 'online-token'; await act(async () => window.dispatchEvent(new window.Event('online'))); await settle();
  expect(calls[2].headers.get('Authorization')).toBe('Bearer online-token');
  push(2, 2); await settle(); auth.tokenManager.setWorkspaceId('other'); options = { ...options, workspaceId: 'other' };
  await render(); await settle(210); expect(calls[2].signal.aborted).toBe(true);
  expect(calls[3].url).not.toContain('since='); expect(calls[3].headers.get('X-Workspace-Id')).toBe('other');
  expect(options.onElementAdded).toHaveBeenCalledTimes(1);
});
it('permission denial stays terminal across timers and browser resume', async () => {
  transport.mockResolvedValue(new Response('', { status: 403 })); await render(); await settle();
  expect(current.status).toBe('disconnected');
  await act(async () => auth.connection.report('/health', null));
  expect(current.status).toBe('disconnected');
  expect(current.error).toContain('403'); expect(console.warn).toHaveBeenCalledWith('[useGraphStream] SSE error:', expect.any(Error));
  window.dispatchEvent(new window.Event('online')); await settle(60000); expect(transport).toHaveBeenCalledOnce();
});
it('existing health poller survives a network error and succeeds on the next tick', async () => {
  function HealthHarness() { current = useConnectionStatus({ healthUrl: 'https://api.test/health' }); return null; }
  transport.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(new Response('ok'));
  await act(async () => root.render(createElement(HealthHarness))); await act(async () => current.markDisconnected());
  await settle(5000); expect(current.connected).toBe(false);
  await settle(5000); expect(current.connected).toBe(true); expect(transport).toHaveBeenCalledTimes(2);
});
