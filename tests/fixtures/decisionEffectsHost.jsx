import { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { GraphExplorer } from '../../src';
import { email, committedEmail, friday, pilots, refunds, standing, crowded } from './decisionEffects';

function fixture(name) {
  if (name === 'crowded') return crowded();
  if (name === 'stale') return { ...email, decisionEffects: {
    ...email.decisionEffects,
    review: email.decisionEffects.review.map(r => r.id !== 'support' ? r : {
      ...r, state: 'checking', freshness: { kind: 'stored', checked_as_of: '2026-11-20T03:00:00Z', stale: true },
    }),
  } };
  if (name === 'propose') return { ...pilots, decisionEffects: { ...pilots.decisionEffects, policy: 'propose' } };
  if (name === 'multi') return { ...email, decisionEffects: { ...email.decisionEffects,
    conflicts: [...email.decisionEffects.conflicts, { ...email.decisionEffects.conflicts[0], id: 'growth' }] } };
  return { email, friday, pilots, refunds, standing }[name];
}

function Host({ name }) {
  const [snapshot, setSnapshot] = useState(() => fixture(name));
  const [branch, setBranch] = useState('');
  if (name === 'off') return <GraphExplorer data={{ nodes: [], edges: [] }} decisionEffects={email.decisionEffects} />;
  if (name === 'missing') return <GraphExplorer enableDecisionEffects />;
  const { decisionEffects: effects } = snapshot;
  const actions = {
    onCommit(focus, answers) {
      window.lastCommit = { focus, answers };
      if (effects.policy === 'propose') {
        setSnapshot({ ...snapshot, decisionEffects: { ...effects, phase: 'held', review: [], conflicts: [], replaces: [] } });
      } else if (focus === 'A') setSnapshot(committedEmail(answers));
      else setSnapshot({ ...snapshot, decisionEffects: { ...effects, phase: 'standing' } });
    },
    onCancel() { setSnapshot(standing); },
    onRefocus: setBranch,
  };
  return <><GraphExplorer enableDecisionEffects {...snapshot} decisionEffectsActions={actions} />
    {branch && <output>Refocus requested: {branch}</output>}</>;
}

const root = createRoot(document.getElementById('root'));
let generation = 0;
window.loadCase = name => {
  window.lastCommit = null;
  flushSync(() => root.render(<Host key={++generation} name={name} />));
};
