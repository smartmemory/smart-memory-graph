/**
 * SAME-ANSWER-U5 (DECK-TRUE-SAME-ANSWER-1): the "Current decision" block in the Ask panel.
 *
 * Every body under tests/fixtures/same-answer-u5/ is a raw response captured byte for byte from the hosted
 * `POST /memory/ask` route (service SAME-ANSWER-U4, throwaway stores, frozen notes Q2-Q4): not a hand-written
 * mock of the server. Frozen notes W1-W8: smart-memory-ops/units/DECK-TRUE-SAME-ANSWER-1/notes-frozen-u5.md.
 * Rendering is asserted through react-dom/server (the package's vitest environment is node).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import AskPanel from '../src/components/AskPanel.jsx';
import AskResult from '../src/components/AskResult.jsx';
import { evidenceSelection, normalizeAskResponse, normalizeInitialAnswer } from '../src/core/askState.js';

const capture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/same-answer-u5/${name}.json`, import.meta.url), 'utf8'));
const render = (raw, props = {}) =>
  renderToStaticMarkup(createElement(AskResult, { result: normalizeAskResponse(raw), onSelect: () => {}, ...props }));

const D_NEW = 'We deploy the Acme site on Cloudflare Pages.';
const D_OLD = 'We deploy the Acme site on Netlify.';
const REASON = "Netlify bandwidth pricing went over Acme&#x27;s $50 a month budget.";

describe('W1 Q2 shows the current decision first', () => {
  const html = render(capture('q2'));

  it('has a Current decision block with the rule, the replaced rule, the reason and the date', () => {
    expect(html).toContain('data-testid="ask-decision"');
    expect(html).toContain('Current decision');
    expect(html).toMatch(/data-testid="ask-decision-row"[^>]*>.*We deploy the Acme site on Cloudflare Pages\./s);
    expect(html).toMatch(/data-testid="ask-decision-replaced"[^>]*>.*Replaced.*We deploy the Acme site on Netlify\./s);
    expect(html).toMatch(/data-testid="ask-decision-reason"[^>]*>.*Why.*Netlify bandwidth pricing went over/s);
    expect(html).toMatch(/data-testid="ask-decision-date"[^>]*>.*2026-11-26/s);
  });

  it('comes before the written answer', () => {
    expect(html.indexOf('data-testid="ask-decision"')).toBeLessThan(html.indexOf('data-testid="ask-answer"'));
  });

  it('is selected the way an evidence row is: by the decision id', () => {
    const q2 = capture('q2');
    const picked = [];
    const el = createElement(AskResult, { result: normalizeAskResponse(q2), onSelect: (id, meta) => picked.push([id, meta]) });
    const tree = el.type(el.props);
    const button = findByTestId(tree, 'ask-decision-row');
    button.props.onClick();
    const expected = evidenceSelection({ item_id: q2.decision.decision_id, content: D_NEW });
    expect(picked).toEqual([expected]);
    expect(picked[0][1].kind).toBe('evidence');
    expect(html).toContain(`data-item-id="${q2.decision.decision_id}"`);
  });
});

describe('W2 Q3 shows no block', () => {
  it('renders no Current decision block and no partial-answer line', () => {
    const html = render(capture('q3'));
    expect(html).not.toContain('Current decision');
    expect(html).not.toContain('ask-decision');
    expect(html).not.toContain('ask-partial');
    expect(html).toContain('data-testid="ask-answer"');
  });
});

describe('W3 Q4 shows a block with nothing replaced', () => {
  it('shows the rule and neither a Replaced line nor a Why line', () => {
    const html = render(capture('q4'));
    expect(html).toContain('We use Sanity as the CMS for the Acme site.');
    expect(html).toContain('data-testid="ask-decision"');
    expect(html).not.toContain('ask-decision-replaced');
    expect(html).not.toContain('ask-decision-reason');
  });
});

describe('W4 record-only', () => {
  const raw = capture('q2-record-only');
  const html = render(raw);

  it('the capture is the record, cited: the answer is the rule plus its citation', () => {
    expect(raw.answer).toBe(`${D_NEW} [${raw.decision.decision_id}]`);
  });

  it('shows the block as in W1', () => {
    expect(html).toContain('data-testid="ask-decision"');
    expect(html).toContain(D_OLD);
  });

  it('does not print the rule a second time as a written answer', () => {
    expect(html).not.toContain('data-testid="ask-answer"');
    // The rule appears once in the block and once as the first evidence row, never as an answer paragraph.
    expect(html.split(D_NEW).length - 1).toBe(2);
  });

  it('still prints a written answer that differs from the rule (the live Q2 answer)', () => {
    // q2's answer is a written sentence around the rule, so it stays.
    expect(capture('q2').answer.startsWith('The record says:')).toBe(true);
    expect(render(capture('q2'))).toContain('data-testid="ask-answer"');
  });
});

describe('W5 a partial answer says so', () => {
  it('shows one plain line when lanes_failed is non-empty', () => {
    const html = render(capture('q2-lanes-failed'));
    expect(html.split('data-testid="ask-partial"').length - 1).toBe(1);
    expect(html).toContain('may be incomplete');
    expect(html).not.toContain('ask-decision"');
    expect(html).toContain('data-testid="ask-answer"');
  });

  it('shows no such line when lanes_failed is empty', () => {
    expect(render(capture('q2'))).not.toContain('ask-partial');
    expect(render(capture('q3'))).not.toContain('ask-partial');
  });
});

describe('W7 a saved answer replays with its block', () => {
  it('keeps the block through the saved-answer path, and a pre-change answer replays as before', () => {
    const q2 = capture('q2');
    const saved = normalizeInitialAnswer({ question: 'Where do we deploy the Acme site?', result: normalizeAskResponse(q2) });
    expect(saved.result.decision.content).toBe(D_NEW);
    expect(saved.result.decision.replaced[0].content).toBe(D_OLD);
    const panel = renderToStaticMarkup(createElement(AskPanel, { adapter: { ask: async () => q2 }, initialAnswer: saved }));
    expect(panel).toContain('Current decision');
    expect(render(q2)).toBe(renderFromSaved(saved));

    const { decision, lanes_failed, ...old } = q2; // eslint-disable-line no-unused-vars
    const before = normalizeInitialAnswer({ question: 'q', result: old });
    expect(before.result.decision).toBeNull();
    expect(before.result.lanes_failed).toEqual([]);
    expect(renderToStaticMarkup(createElement(AskResult, { result: before.result }))).not.toContain('Current decision');
  });
});

describe('W8 a malformed block never breaks the panel', () => {
  const q2 = capture('q2');
  const cases = {
    'decision is a string': 'We deploy on Cloudflare',
    'decision is an array': [q2.decision],
    'decision is a number': 7,
    'content is an object': { ...q2.decision, content: { toString: null } },
    'decision_id is an object': { ...q2.decision, decision_id: { toString: null } },
    'content is empty': { ...q2.decision, content: '' },
  };
  for (const [name, decision] of Object.entries(cases)) {
    it(`${name}: no block, no throw, the answer still renders`, () => {
      const html = render({ ...q2, decision });
      expect(html).not.toContain('ask-decision"');
      expect(html).toContain('data-testid="ask-answer"');
      expect(html).toContain('data-testid="ask-evidence-row"');
    });
  }

  it('non-text fields inside a good block are dropped, not rendered', () => {
    const html = render({
      ...q2,
      decision: {
        ...q2.decision,
        effective_at: { toString: null },
        reason: { toString: null },
        replaced: [{ decision_id: 'x', content: { toString: null }, reason: 5 }, { decision_id: 'y', content: D_OLD, reason: { a: 1 } }, 'junk', null],
        extra: { toString: null },
      },
    });
    expect(html).toContain('data-testid="ask-decision"');
    expect(html.split('data-testid="ask-decision-replaced"').length - 1).toBe(1);
    expect(html).not.toContain('ask-decision-reason');
    expect(html).not.toContain('ask-decision-date');
  });

  it('lanes_failed that is not a list of text is a list of the text entries only', () => {
    expect(normalizeAskResponse({ ...q2, lanes_failed: 'decision-match' }).lanes_failed).toEqual([]);
    expect(normalizeAskResponse({ ...q2, lanes_failed: [{ toString: null }, 'decision-match', 3, ''] }).lanes_failed).toEqual(['decision-match']);
  });
});

// A saved answer is replayed through the same view the live answer uses.
function renderFromSaved(saved) {
  return renderToStaticMarkup(createElement(AskResult, { result: saved.result, onSelect: () => {} }));
}

function findByTestId(node, id) {
  if (node == null || typeof node !== 'object') return null;
  // Expand function components (the block is its own component) the way the renderer would.
  if (typeof node.type === 'function') return findByTestId(node.type(node.props), id);
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findByTestId(child, id);
      if (hit) return hit;
    }
    return null;
  }
  if (node.props && node.props['data-testid'] === id) return node;
  return node.props ? findByTestId(node.props.children, id) : null;
}
