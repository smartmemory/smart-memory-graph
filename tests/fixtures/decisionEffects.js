// DECISION-EFFECTS-GRAPH-1, frozen notes blob 28833d649534a3f49594927a75bbb635868385c5.
// A small host supplies the answers, including the lifecycle changes it acknowledges.
// The graph package never parses natural language or treats wording as a conflict.
const today = '2026-11-24';
const computed = { kind: 'computed' };
const checked = { kind: 'stored', checked_as_of: '2026-11-24T04:41:00Z' };
const rows = [
  ['eu', '2026-03-04', 'Customer data stays in the EU region', 'Most customers are in the EU and our contracts promise EU storage.',
    ['Store data wherever hosting is cheapest', 'Let each customer pick a region']],
  ['vendor', '2026-03-18', 'Use the Frankfurt vendor for email', 'The only shortlisted vendor that keeps all processing inside the EU.',
    ['The US vendor (cheaper, but data leaves the EU)', 'Run our own mail servers']],
  ['support', '2026-04-09', 'Support may export tickets for analysis', 'Trend reviews need raw ticket text, which lives with the email vendor.'],
  ['growth', '2026-04-22', 'Email templates are owned by the growth team', "Templates live in the vendor's editor and growth edits them daily."],
  ['exports', '2026-06-10', 'Ticket exports are anonymised before sharing', 'Exports left the support team twice in May.'],
  ['manager', '2026-01-08', 'All refunds need a manager', 'Small team, few refunds.'],
  ['refund', '2026-05-06', 'Refunds under 200 need no approval', 'Most refunds are small and were waiting days for a sign-off.'],
  ['release', '2026-02-02', 'Weekly release on Thursdays'],
  ['quarter', '2026-06-15', 'No deploys in the last week of the quarter'],
  ['hotfix', '2026-07-03', 'Hotfixes may ship on any day'],
  ['pilot', '2026-08-01', 'Pilots get a 30-day free period'],
  ['billing', '2026-08-01', 'Pilot billing starts on day 31'],
  ['legal', '2026-03-02', 'Legal review note'],
  ['A', today, 'Move email to the US vendor to cut cost'],
  ['B', today, 'Send the release notes email every Friday'],
  ['C', today, 'Pilots get 14 days free instead of 30'],
];
const nodes = rows.map(([id, validFrom, label, reason, rejected]) => ({
  id, validFrom, label, reason, rejected, type: id === 'legal' ? 'note' : 'decision',
  ...(id === 'eu' && { ruleKind: 'must' }),
  ...(id === 'manager' && { retiredAt: '2026-05-06' }),
}));

const edge = (source, target, type = 'depends_on') => ({ id: source + '-' + target, source, target, type });
const edges = [
  edge('eu', 'legal', 'comes_from'), edge('vendor', 'eu'), edge('support', 'vendor'),
  edge('growth', 'vendor'), edge('exports', 'support'), edge('refund', 'manager', 'supersedes'),
  edge('quarter', 'release'), edge('hotfix', 'release'), edge('billing', 'pilot'), edge('B', 'release'),
];
const whyPaths = { exports: ['legal', 'eu', 'vendor', 'support', 'exports'], eu: ['legal', 'eu'] };
const review = (id, via, hop) => ({ id, via, hop, state: 'preview', freshness: computed });

function snapshot(focus, phase, distances, extras = {}) {
  const subset = nodes.filter(n => Object.hasOwn(distances, n.id)).map(n => ({ ...n, hop: distances[n.id] }));
  return {
    data: { nodes: subset, edges: edges.filter(e => Object.hasOwn(distances, e.source) && Object.hasOwn(distances, e.target)) },
    decisionEffects: { focus, phase, today, freshness: computed, replaces: [], conflicts: [], review: [], whyPaths, ...extras },
  };
}

export const email = snapshot('A', 'draft', { A: 0, vendor: 1, eu: 1, support: 2, growth: 2, exports: 3, legal: 2 }, {
  replaces: ['vendor'],
  conflicts: [{ id: 'eu', why: 'The US vendor would store and process customer email addresses outside the EU.', freshness: checked }],
  review: [review('support', 'vendor', 1), review('growth', 'vendor', 1), review('exports', 'support', 2)],
  possiblyRelated: [{ id: 'mention', label: 'Meeting note mentioning EU' }],
});
export const friday = snapshot('B', 'draft', { B: 0, release: 1, quarter: 2, hotfix: 2 });
export const pilots = snapshot('C', 'draft', { C: 0, pilot: 1, billing: 2 }, {
  replaces: ['pilot'], review: [review('billing', 'pilot', 1)],
});
export const refunds = snapshot('refund', 'standing', { refund: 0, manager: 1 });
export const standing = snapshot('vendor', 'standing', { vendor: 0, eu: 1, legal: 2, growth: 1, support: 1, exports: 2 });

export function committedEmail(answers) {
  const retired = ['vendor', ...(answers.eu.choice === 'replace' ? ['eu'] : [])];
  return {
    data: {
      nodes: email.data.nodes.map(n => retired.includes(n.id) ? { ...n, retiredAt: today } : n),
      edges: [...email.data.edges, ...retired.map(id => edge('A', id, 'supersedes'))],
    },
    decisionEffects: {
      ...email.decisionEffects, phase: 'standing', freshness: checked,
      conflicts: email.decisionEffects.conflicts.map(c => ({ ...c, resolution: answers[c.id] })),
      review: email.decisionEffects.review.map(r => ({ ...r, state: 'flagged', freshness: checked })),
    },
  };
}

// The frozen overflow honesty check requires more decisions than the twelve notes supply.
// Extend only this shape check: a retired rule has twelve dependents at each of three hops.
export function crowded() {
  const subset = pilots.data.nodes.filter(n => n.id !== 'billing');
  const dependents = [];
  for (let level = 1; level <= 3; level++) {
    for (let i = 0; i < 12; i++) {
      const id = 'review-' + level + '-' + i;
      const via = level === 1 ? 'pilot' : 'review-' + (level - 1) + '-' + i;
      subset.push({ id, type: 'decision', validFrom: today, label: 'Pilot billing rule ' + level + '.' + (i + 1), hop: level + 1 });
      dependents.push(review(id, via, level));
    }
  }
  const peers = Array.from({ length: 9 }, (_, i) => ({
    id: 'term-' + i, type: 'decision', validFrom: today, label: 'Pilot term ' + (i + 1), hop: 1,
  }));
  return {
    data: { nodes: [...subset, ...peers], edges: peers.map(n => edge('C', n.id)) },
    decisionEffects: { ...pilots.decisionEffects, review: dependents },
  };
}
