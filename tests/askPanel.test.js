/**
 * DIST-LITE-9 — AskPanel, AskResult, the ask lifecycle, and the adapter method.
 *
 * Contract: smart-memory-docs/docs/features/DIST-LITE-9/ask-contract.json
 *
 * The package's vitest environment is `node` and neither jsdom nor
 * @testing-library/react is a dependency, so interaction is exercised where the logic
 * actually lives — the reducer, the selection payload builders, and `runAsk` against a
 * fake adapter — while rendering is asserted through `react-dom/server`. The one thing
 * this cannot cover is a real browser click; the viewer wiring is the backstop for that.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import AskPanel from '../src/components/AskPanel.jsx';
import AskResult from '../src/components/AskResult.jsx';
import {
  ASK_ANSWERED,
  ASK_ERROR,
  ASK_LOADING,
  INITIAL_ASK_STATE,
  askReducer,
  evidenceSelection,
  normalizeAskResponse,
  relationEdgeId,
  relationSelection,
  runAsk,
} from '../src/core/askState.js';
import { createFetchAdapter } from '../src/adapters/fetchAdapter.js';
import { createSDKAdapter } from '../src/adapters/sdkAdapter.js';

const ASK_RESPONSE = {
  answer: 'No — Zed does not believe Yara stole the amulet.',
  reasoning: 'Zed trusts Yara and distrusts Xavier, who made the accusation.',
  evidence: [
    { item_id: 'mem_amulet', content: 'Zed says he does not believe Yara took the amulet.' },
  ],
  relations: [
    { source: 'Zed', type: 'distrusts', target: 'Xavier', source_id: 'ent_zed', target_id: 'ent_xavier' },
    { source: 'Zed', type: 'trusts', target: 'Yara', source_id: 'ent_zed', target_id: 'ent_yara' },
  ],
};

function fakeAdapter(overrides = {}) {
  return { ask: vi.fn().mockResolvedValue(ASK_RESPONSE), ...overrides };
}

describe('AskResult rendering', () => {
  it('renders the answer, every evidence row, and every relation row', () => {
    const html = renderToStaticMarkup(createElement(AskResult, { result: ASK_RESPONSE, onSelect: () => {} }));

    expect(html).toContain('No — Zed does not believe Yara stole the amulet.');
    expect(html).toContain('Zed says he does not believe Yara took the amulet.');
    expect(html).toContain('mem_amulet');
    expect(html).toContain('distrusts');
    expect(html).toContain('trusts');
    expect(html).toContain('Xavier');
  });

  it('makes each row addressable by the id a host would focus', () => {
    const html = renderToStaticMarkup(createElement(AskResult, { result: ASK_RESPONSE, onSelect: () => {} }));

    expect(html).toContain('data-item-id="mem_amulet"');
    expect(html).toContain('data-edge-id="ent_zed-&gt;ent_xavier:distrusts"');
  });

  it('disables rows when the host passed no onSelect', () => {
    const html = renderToStaticMarkup(createElement(AskResult, { result: ASK_RESPONSE }));
    expect(html).toContain('disabled=""');
  });

  it('says so when nothing grounded the answer, rather than showing empty lists', () => {
    const html = renderToStaticMarkup(
      createElement(AskResult, { result: { answer: 'I have nothing on that.', reasoning: '', evidence: [], relations: [] } })
    );
    expect(html).toContain('No stored memories matched this question');
  });

  it('renders nothing at all for a null result', () => {
    expect(renderToStaticMarkup(createElement(AskResult, { result: null }))).toBe('');
  });
});

describe('AskPanel initial render', () => {
  it('renders a question box and a disabled submit before anything is typed', () => {
    const html = renderToStaticMarkup(createElement(AskPanel, { adapter: fakeAdapter() }));

    expect(html).toContain('data-testid="ask-panel"');
    expect(html).toContain('data-testid="ask-input"');
    expect(html).toContain('Ask');
    expect(html).toContain('disabled=""');
  });

  it('mounts with only an adapter prop', () => {
    expect(() => renderToStaticMarkup(createElement(AskPanel, { adapter: fakeAdapter() }))).not.toThrow();
  });
});

describe('selection payloads', () => {
  it('an evidence row selects the memory item id', () => {
    expect(evidenceSelection(ASK_RESPONSE.evidence[0])).toEqual([
      'mem_amulet',
      { kind: 'evidence', item: ASK_RESPONSE.evidence[0] },
    ]);
  });

  it('a relation row selects the graph edge id and carries both node ids', () => {
    const [id, meta] = relationSelection(ASK_RESPONSE.relations[0]);

    expect(id).toBe('ent_zed->ent_xavier:distrusts');
    expect(meta.kind).toBe('relation');
    expect(meta.sourceId).toBe('ent_zed');
    expect(meta.targetId).toBe('ent_xavier');
  });

  it('the edge id matches the convention normalizeAPIResponse builds', () => {
    const relation = ASK_RESPONSE.relations[1];
    expect(relationEdgeId(relation)).toBe(`${relation.source_id}->${relation.target_id}:${relation.type}`);
  });

  it('a relation with no node ids is not selectable rather than guessing one', () => {
    expect(relationEdgeId({ source: 'Zed', type: 'trusts', target: 'Yara' })).toBeNull();
    expect(relationSelection({ source: 'Zed', type: 'trusts', target: 'Yara' })).toBeNull();
  });
});

describe('ask lifecycle', () => {
  it('submitting clears the previous answer instead of leaving it under a spinner', () => {
    const answered = askReducer(
      askReducer(INITIAL_ASK_STATE, { type: 'submit', question: 'q1' }),
      { type: 'resolve', question: 'q1', result: ASK_RESPONSE }
    );
    expect(answered.status).toBe(ASK_ANSWERED);

    const resubmitted = askReducer(answered, { type: 'submit', question: 'q2' });
    expect(resubmitted.status).toBe(ASK_LOADING);
    expect(resubmitted.result).toBeNull();
  });

  it('a slow reply to an abandoned question is ignored', () => {
    const inFlight = askReducer(INITIAL_ASK_STATE, { type: 'submit', question: 'q2' });
    const stale = askReducer(inFlight, { type: 'resolve', question: 'q1', result: ASK_RESPONSE });

    expect(stale).toBe(inFlight);
  });

  it('a failure lands as an error, never as an empty answer', () => {
    const inFlight = askReducer(INITIAL_ASK_STATE, { type: 'submit', question: 'q1' });
    const failed = askReducer(inFlight, { type: 'reject', question: 'q1', error: 'provider down' });

    expect(failed.status).toBe(ASK_ERROR);
    expect(failed.error).toBe('provider down');
    expect(failed.result).toBeNull();
  });
});

describe('runAsk against a fake adapter', () => {
  it('passes the trimmed question and the limit through', async () => {
    const adapter = fakeAdapter();
    const result = await runAsk(adapter, '  who stole the amulet?  ', { limit: 8 });

    expect(adapter.ask).toHaveBeenCalledWith('who stole the amulet?', { limit: 8 });
    expect(result.answer).toBe(ASK_RESPONSE.answer);
    expect(result.evidence).toHaveLength(1);
    expect(result.relations).toHaveLength(2);
  });

  it('rejects a blank question without calling the adapter', async () => {
    const adapter = fakeAdapter();
    await expect(runAsk(adapter, '   ')).rejects.toThrow(/Enter a question/);
    expect(adapter.ask).not.toHaveBeenCalled();
  });

  it('rejects an adapter that predates ask() instead of silently answering nothing', async () => {
    await expect(runAsk({}, 'anything')).rejects.toThrow(/has no ask\(\) method/);
  });

  it('rejects an answerless 200 rather than rendering a blank answer', async () => {
    const adapter = fakeAdapter({ ask: vi.fn().mockResolvedValue({ evidence: [], relations: [] }) });
    await expect(runAsk(adapter, 'anything')).rejects.toThrow(/no answer/);
  });

  it('propagates a transport failure', async () => {
    const adapter = fakeAdapter({ ask: vi.fn().mockRejectedValue(new Error('API 502: provider down')) });
    await expect(runAsk(adapter, 'anything')).rejects.toThrow(/502/);
  });

  it('drops malformed evidence and relation rows but keeps the good ones', () => {
    const normalized = normalizeAskResponse({
      answer: 'a',
      evidence: [{ item_id: 'ok', content: 'c' }, { content: 'no id' }, null],
      relations: [ASK_RESPONSE.relations[0], { source: 'x' }],
    });

    expect(normalized.evidence).toEqual([{ item_id: 'ok', content: 'c' }]);
    expect(normalized.relations).toEqual([ASK_RESPONSE.relations[0]]);
    expect(normalized.reasoning).toBe('');
  });
});

describe('adapter ask() hits POST /memory/ask', () => {
  it('fetchAdapter posts the contract body', async () => {
    const calls = [];
    const originalFetch = globalThis.fetch;
    const originalDocument = globalThis.document;
    globalThis.document = { cookie: '' };
    globalThis.fetch = (url, opts) => {
      calls.push({ url, opts });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(ASK_RESPONSE) });
    };
    try {
      const adapter = createFetchAdapter({
        apiUrl: 'http://localhost:9014',
        getToken: () => null,
        getTeamId: () => null,
      });
      const result = await adapter.ask('who stole it', { limit: 3 });

      expect(calls[0].url).toBe('http://localhost:9014/memory/ask');
      expect(calls[0].opts.method).toBe('POST');
      expect(JSON.parse(calls[0].opts.body)).toEqual({ question: 'who stole it', limit: 3 });
      expect(result).toEqual(ASK_RESPONSE);
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.document = originalDocument;
    }
  });

  it('fetchAdapter defaults the limit and omits the default reasoning flag', async () => {
    const calls = [];
    const originalFetch = globalThis.fetch;
    const originalDocument = globalThis.document;
    globalThis.document = { cookie: '' };
    globalThis.fetch = (url, opts) => {
      calls.push({ url, opts });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(ASK_RESPONSE) });
    };
    try {
      const adapter = createFetchAdapter({ apiUrl: '', getToken: () => null, getTeamId: () => null });
      await adapter.ask('who stole it');
      expect(JSON.parse(calls[0].opts.body)).toEqual({ question: 'who stole it', limit: 5 });

      await adapter.ask('who stole it', { reasoning: false });
      expect(JSON.parse(calls[1].opts.body).reasoning).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.document = originalDocument;
    }
  });

  it('sdkAdapter delegates to client.memories.ask', async () => {
    const client = { memories: { ask: vi.fn().mockResolvedValue(ASK_RESPONSE) }, auth: { tokenManager: { getAccessToken: () => null } } };
    const adapter = createSDKAdapter(client);

    await adapter.ask('who stole it', { limit: 2 });

    expect(client.memories.ask).toHaveBeenCalledWith('who stole it', { limit: 2, reasoning: true });
  });

  it('sdkAdapter falls back to raw HTTP on an SDK that predates memories.ask', async () => {
    const post = vi.fn().mockResolvedValue(ASK_RESPONSE);
    const client = { memories: {}, http: { post }, auth: { tokenManager: { getAccessToken: () => null } } };
    const adapter = createSDKAdapter(client);

    await adapter.ask('who stole it');

    expect(post).toHaveBeenCalledWith('/memory/ask', { question: 'who stole it', limit: 5 });
  });
});
