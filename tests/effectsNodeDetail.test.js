// DEMO-1204-RIPPLE-VIEW-FRAME-1 rows 21, 14, 17 (node detail content and node looks). Ground truth frozen from the
// unit brief and mockup index.html:560-590, written before the code: a decision's detail reads title, decided date,
// status pill, reason, options rejected, replaced, replaced by, depends on, depended on by, comes from; related items
// are links that select that node; an empty field is left out.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { DecisionCard } from '../src/components/effects/EffectControls.jsx';
import EffectsCanvas from '../src/components/effects/EffectsCanvas.jsx';

const today = '2026-11-27';
const computed = { kind: 'computed' };
const node = (id, label, extra = {}) => ({ id, label, type: 'decision', hop: 1, validFrom: '2026-03-18', ...extra });
const data = {
  nodes: [
    node('d', 'Email only on weekdays', { reason: 'Quiet weekends', rejected: ['Daily email'] }),
    node('old', 'Email any day'), node('new', 'Email weekdays v2'),
    node('base', 'Use the CRM'), node('top', 'Send reminders'),
    node('n1', 'Meeting note', { type: 'note' }),
  ],
  edges: [
    { id: 'e1', source: 'd', target: 'old', type: 'supersedes' },
    { id: 'e2', source: 'new', target: 'd', type: 'supersedes' },
    { id: 'e3', source: 'd', target: 'base', type: 'depends_on' },
    { id: 'e4', source: 'top', target: 'd', type: 'depends_on' },
    { id: 'e5', source: 'd', target: 'n1', type: 'comes_from' },
  ],
};
const effects = { focus: 'd', today, phase: 'standing', freshness: computed, replaces: [], conflicts: [], review: [] };
const card = (n, extra = {}) => renderToStaticMarkup(createElement(DecisionCard,
  { node: n, data, effects, date: today, choices: {}, onSelect() {}, ...extra }));

it('row 21: shows every field in the mockup order, with related items as links', () => {
  const html = card(data.nodes[0]);
  const order = ['Email only on weekdays', 'Decided 18 Mar', 'In force', 'Quiet weekends', 'Options rejected',
    'Replaced', 'Replaced by', 'Depends on', 'Depended on by', 'Comes from'];
  const at = order.map(s => html.indexOf(s));
  expect(at).not.toContain(-1);
  expect([...at].sort((a, b) => a - b)).toEqual(at);
  for (const [id, label] of [['old', 'Email any day'], ['new', 'Email weekdays v2'], ['base', 'Use the CRM'],
    ['top', 'Send reminders'], ['n1', 'Meeting note']]) {
    expect(html).toMatch(new RegExp('<button[^>]*data-select="' + id + '"[^>]*>' + label + '</button>'));
  }
});

it('row 21: a field with no data is left out, and a replaced decision says so in its pill', () => {
  const html = card(node('lonely', 'Lonely rule'));
  for (const gone of ['Options rejected', 'Replaced', 'Depends on', 'Depended on by', 'Comes from']) expect(html).not.toContain(gone);
  expect(html).toContain('Decided 18 Mar');
  const retired = card(node('r', 'Old rule', { retiredAt: '2026-11-01', retirement: 'replaced' }));
  expect(retired).toMatch(/de-status[^>]*>Replaced 1 Nov</);
});

it('row 21: clicking a related item selects that node', () => {
  const picked = [];
  const tree = DecisionCard({ node: data.nodes[0], data, effects, date: today, choices: {}, onSelect: id => picked.push(id) });
  const buttons = [];
  (function walk(el) {
    if (!el || typeof el !== 'object') return;
    if (Array.isArray(el)) return el.forEach(walk);
    if (el.type === 'button' && el.props['data-select']) buttons.push(el);
    walk(typeof el.type === 'function' ? el.type(el.props) : el.props?.children);
  })(tree);
  buttons.find(b => b.props['data-select'] === 'base').props.onClick();
  expect(picked).toEqual(['base']);
});

const canvasProps = (nodes, effectsOver = {}) => ({
  nodes, links: [], effects: { ...effects, ...effectsOver }, date: today, path: [], choices: {}, extras: [],
  onSelect() {}, onConflict() {}, onSuggestion() {},
});

it('row 14: a source note is a small grey chip, a decision stays a full card', () => {
  const html = renderToStaticMarkup(createElement(EffectsCanvas, canvasProps([data.nodes[0], data.nodes[5]])));
  expect(html).toMatch(/data-node="n1"[^>]*data-kind="note"/);
  expect(html).toMatch(/data-node="d"[^>]*data-kind="decision"/);
  const sizes = Object.fromEntries([...html.matchAll(/<foreignObject[^>]*width="(\d+)" height="(\d+)"[^>]*data-node="(\w+)"/g)]
    .map(m => [m[3], m[1] * m[2]]));
  expect(sizes.n1).toBeLessThan(sizes.d / 2);
});
