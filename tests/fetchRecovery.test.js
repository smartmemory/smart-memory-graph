import { afterEach, expect, it, vi } from 'vitest';
import { AuthCore } from '@smartmemory/sdk-js';
import { createAuthFetch } from '@smartmemory/sdk-js/fetch';
import { createFetchAdapter } from '../src/adapters/fetchAdapter.js';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function setup(responses, cookieOnly = false) {
  vi.stubGlobal('document', { cookie: 'sm_csrf=csrf; sm_team_id=ws' });
  const calls = [];
  const fetchFn = vi.fn(async (url, opts) => {
    calls.push({ url, ...opts });
    return responses.shift();
  });
  const auth = new AuthCore({ mode: 'sso', storage: 'memory', apiBaseUrl: 'https://api.test', fetchFn });
  auth.currentToken = cookieOnly ? null : 'expired';
  auth.tokenManager.setWorkspaceId('ws');
  const adapter = createFetchAdapter({ apiUrl: auth.apiBaseUrl,
    getToken: () => auth.currentToken, getTeamId: () => 'ws',
    fetchFn: createAuthFetch(auth, { fetchFn, apiBases: [auth.apiBaseUrl] }),
  });
  return { adapter, calls, auth };
}
it.each([false, true])('refreshes and retries with fresh credentials, cookie-only=%s', async (cookieOnly) => {
  const { adapter, calls } = setup([
    new Response('', { status: 401 }), new Response('{"access_token":"fresh"}'),
    new Response('{"answer":"yes"}'),
  ], cookieOnly);
  expect(await adapter.ask('question')).toEqual({ answer: 'yes' });
  expect(calls.map(c => c.url)).toEqual(['https://api.test/memory/ask', 'https://api.test/auth/refresh', 'https://api.test/memory/ask']);
  expect(new Headers(calls[0].headers).get('Authorization')).toBe(cookieOnly ? null : 'Bearer expired');
  expect(new Headers(calls[2].headers).get('Authorization')).toBe('Bearer fresh');
  expect(calls[2].body).toBe(calls[0].body);
  expect(new Headers(calls[2].headers).get('X-Workspace-Id')).toBe('ws');
  expect(new Headers(calls[1].headers).get('x-csrf-token')).toBe('csrf');
  expect(calls[1].credentials).toBe('include');
});
it('surfaces permission denial without refreshing', async () => {
  const { adapter, calls, auth } = setup([new Response('denied', { status: 403 })]);
  await expect(adapter.getFullGraph()).rejects.toThrow('API 403: denied');
  expect(calls).toHaveLength(1);
  expect(auth.currentToken).toBe('expired');
});
it('preserves default raw cookie transport for embedded/local callers', async () => {
  vi.stubGlobal('document', { cookie: '' });
  const fetchFn = vi.fn().mockResolvedValue(new Response('{"nodes":[]}'));
  vi.stubGlobal('fetch', fetchFn);
  const adapter = createFetchAdapter({ apiUrl: '/api/graph', getToken: () => null, getTeamId: () => null });
  await adapter.getFullGraph();
  expect(fetchFn).toHaveBeenCalledOnce();
  expect(fetchFn.mock.calls[0][1]).toEqual({ method: 'GET', headers: { 'Content-Type': 'application/json' }, credentials: 'include' });
});
