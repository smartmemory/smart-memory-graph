/**
 * Verify the fetch + sdk adapters expose the decision endpoints with the URL
 * shapes mandated by contracts/decisions.json. We stub the network layer and
 * assert the adapter calls the right path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFetchAdapter } from '../src/adapters/fetchAdapter.js';
import { createSDKAdapter } from '../src/adapters/sdkAdapter.js';
import { DECISION_ROUTES } from '../src/core/decisionStyles.js';

describe('createFetchAdapter: decision endpoints', () => {
  let calls;
  beforeEach(() => {
    calls = [];
    globalThis.fetch = vi.fn(async (url, opts) => {
      calls.push({ url, method: opts.method });
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    });
    globalThis.document = { cookie: '' };
  });

  const adapter = () => createFetchAdapter({
    apiUrl: 'http://test',
    getToken: () => 't',
    getTeamId: () => 'team-1',
  });

  it('listActiveDecisions hits GET /memory/decisions', async () => {
    await adapter().listActiveDecisions();
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toBe('http://test/memory/decisions');
  });

  it('listActiveDecisions appends query parameters when supplied', async () => {
    await adapter().listActiveDecisions({ domain: 'infra', decisionType: 'choice', minConfidence: 0.5, limit: 25 });
    expect(calls[0].url).toBe(
      'http://test/memory/decisions?domain=infra&decision_type=choice&min_confidence=0.5&limit=25',
    );
  });

  it('getDecisionProvenance hits GET /memory/decisions/{id}/provenance', async () => {
    await adapter().getDecisionProvenance('abc 123');
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toBe('http://test/memory/decisions/abc%20123/provenance');
  });

  it('findDecisionConflicts hits POST /memory/decisions/{id}/conflicts', async () => {
    await adapter().findDecisionConflicts('d1');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('http://test/memory/decisions/d1/conflicts');
  });

  it('getDecisionCausalChain hits GET .../causal-chain with default direction+depth', async () => {
    await adapter().getDecisionCausalChain('d1');
    expect(calls[0].url).toBe('http://test/memory/decisions/d1/causal-chain?direction=both&max_depth=3');
  });
});

describe('createSDKAdapter: falls back to underlying http when client.decisions is missing', () => {
  it('routes through client.http.get for getDecisionProvenance', async () => {
    const get = vi.fn(async () => ({}));
    const post = vi.fn(async () => ({}));
    const client = {
      graph: {}, ontology: {}, temporal: {}, memories: {},
      auth: { tokenManager: { getAccessToken: () => null } },
      http: { get, post },
    };
    const adapter = createSDKAdapter(client);
    await adapter.getDecisionProvenance('d1');
    expect(get).toHaveBeenCalledWith('/memory/decisions/d1/provenance');
    await adapter.findDecisionConflicts('d1');
    expect(post).toHaveBeenCalledWith('/memory/decisions/d1/conflicts');
  });
});

describe('DECISION_ROUTES constant matches the in-repo service contract', () => {
  it('contains all the routes the adapter calls', () => {
    expect(DECISION_ROUTES.list_active).toBe('GET /memory/decisions');
    expect(DECISION_ROUTES.provenance).toBe('GET /memory/decisions/{decision_id}/provenance');
    expect(DECISION_ROUTES.conflicts).toBe('POST /memory/decisions/{decision_id}/conflicts');
    expect(DECISION_ROUTES.causal_chain).toBe('GET /memory/decisions/{decision_id}/causal-chain');
  });
});

const id = 'first/id';
const target = 'next id';
const text = 'Move email';
const resolutions = { eu: { choice: 'keep_both_scoped', scope: 'Marketing' } };
it.each([
  ['getDecisionEffects', [id], 'GET', '/first%2Fid/effects'],
  ['previewDecisionEffects', [text], 'POST', '/effects/preview', { text }],
  ['commitDecisionEffects', [text, resolutions], 'POST', '/effects/commit', { text, resolutions }],
  ['addDecisionDependsOn', [id, target], 'POST', '/first%2Fid/depends-on', { target_id: target }],
  ['confirmDecisionDependsOn', [id, target], 'POST', '/first%2Fid/depends-on/next%20id/confirm'],
  ['removeDecisionDependsOn', [id, target], 'DELETE', '/first%2Fid/depends-on/next%20id'],
])('%s preserves the fetch and SDK contract', async (name, args, method, path, body) => {
  const reply = { source: id, target };
  const fetchFn = vi.fn(async () => Response.json(reply));
  const fetchAdapter = createFetchAdapter({ apiUrl: '', getToken: () => null, getTeamId: () => 'workspace', fetchFn });
  expect(await fetchAdapter[name](...args)).toEqual(reply);
  const [[url, options]] = fetchFn.mock.calls;
  expect(url).toBe('/memory/decisions' + path);
  expect(options.method).toBe(method);
  expect(options.body).toBe(JSON.stringify(body));
  const sdkMethod = vi.fn(async () => reply);
  expect(await createSDKAdapter({ decisions: { [name]: sdkMethod } })[name](...args)).toBe(reply);
  expect(sdkMethod).toHaveBeenCalledWith(...args);
  await expect(createSDKAdapter({})[name](...args)).rejects.toThrow(name + ' unavailable');
});
