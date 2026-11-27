// DEMO-1204-RIPPLE-NO-HOP-LIMIT-1: ripples have no hop limit (OWNER 2026-11-27, verbatim: "no hop limit just no
// loops"). Ground truth case 1 of the unit: a chain D1..D7, D1 replaced, D2..D7 need review at hops 1..6. The reply
// below is the shape core answers for that chain (focus D1); every one of the six is drawn, linked and tagged.
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { expect, it } from 'vitest';
import schema from '../contracts/decision-effects.json';
import { focusWindow, graphLinks } from '../src/components/effects/focusGraph.js';
import { nodeState } from '../src/components/effects/EffectsCanvas.jsx';

const today = '2026-11-27';
const computed = { kind: 'computed' };
const ids = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'];

function chain() {
  const nodes = ids.map((id, n) => ({
    id, label: 'Chain rule ' + (n + 1), type: 'decision', hop: n, validFrom: '2026-11-01',
    ...(n === 0 ? { retirement: 'replaced', retiredAt: today } : {}),
  }));
  const edges = ids.slice(1).map((id, n) => ({ id: id + '-depends_on-' + ids[n], source: id, target: ids[n], type: 'depends_on' }));
  const data = { nodes, edges };
  const review = ids.slice(1).map((id, n) => ({ id, via: ids[n], hop: n + 1, state: 'flagged', freshness: computed }));
  return {
    data,
    effects: {
      focus: 'd1', today, phase: 'standing', policy: 'save', freshness: computed, data,
      replaces: [], conflicts: [], review, possibly_related: [], overflow: [], whyPaths: {},
      counts: { conflicts: 0, replaced: 0, to_review: review.length },
    },
  };
}

it('accepts a review at hop 6 on the wire', () => {
  const ajv = new Ajv2020();
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const { effects } = chain();
  expect(validate(effects), JSON.stringify(validate.errors)).toBe(true);
});

it('draws, links and tags every dependent of a six-hop chain', () => {
  const { data, effects } = chain();
  const { nodes } = focusWindow(data, effects, today, false, []);
  expect(nodes.map(n => n.id).sort()).toEqual([...ids].sort());
  const links = graphLinks(data, effects, nodes, true, [], {}).filter(l => l.kind === 'ripple');
  expect(links.map(l => [l.source, l.target, l.label])).toEqual(
    ids.slice(1).map((id, n) => [ids[n], id, 'R' + (n + 1)]),
  );
  const deepest = nodeState(nodes.find(n => n.id === 'd7'), effects, today, {});
  expect(deepest.tags).toContain('R6 · needs review');
});
