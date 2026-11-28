import { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { createSDKAdapter } from '../../src/adapters/sdkAdapter';
import { GraphExplorer } from '../../src';
import { email, committedEmail, friday, pilots, refunds, standing, crowded, suggestedPilots } from './decisionEffects';

import recordings from './standing-history.json';

function fixture(name) {
  const checks = {
    empty: { state: 'nothing_to_check', checked: 0, cap: 10, omitted: 0 },
    failed: { state: 'could_not_check', checked: 0, cap: 10, omitted: 0 },
    partial: { state: 'partial', checked: 100, cap: 10, omitted: 2, ceiling: 100, save_allowed: false, omitted_at_least: false },
    'partial-allowed': { state: 'partial', checked: 100, cap: 10, omitted: 7, ceiling: 100, save_allowed: true, omitted_at_least: true },
    unfinished: { state: 'could_not_check', checked: 10, cap: 10, omitted: 0 },
    norelated: { state: 'no_related_rule', checked: 0, cap: 10, omitted: 0 },
    legacy: undefined,
  };
  if (Object.hasOwn(checks, name)) return { ...friday, decisionEffects: { ...friday.decisionEffects, conflict_check: checks[name] } };
  if (name === 'standing-marks') {
    const edges = standing.data.edges.map(edge => edge.type === 'depends_on'
      ? { ...edge, suggested: edge.source === 'growth' } : edge);
    const data = { ...standing.data, edges };
    return { data, decisionEffects: { ...standing.decisionEffects, data } };
  }
  if (name === 'unknown-policy') return { ...email, decisionEffects: { ...email.decisionEffects, policy: undefined } };
  if (name === 'reject') return email;
  if (name === 'crowded') return crowded();
  if (name === 'stale') return { ...email, decisionEffects: {
    ...email.decisionEffects,
    conflicts: email.decisionEffects.conflicts.map(c => ({ ...c, freshness: { kind: 'stored', checked_as_of: '2026-11-24T04:41:00Z', stale: true } })),
    review: email.decisionEffects.review.map(r => r.id !== 'support' ? r : {
      ...r, state: 'checking', freshness: { kind: 'stored', checked_as_of: '2026-11-20T03:00:00Z', stale: true },
    }),
  } };
  if (name === 'drop') return { ...pilots, decisionEffects: { ...pilots.decisionEffects,
    drops: [{ id: 'pilot', dropped: 'stop dosing when ALT is above 5 times ULN' }] } };
  if (name === 'drop-partial') return { ...pilots, decisionEffects: { ...pilots.decisionEffects,
    drops: [{ id: 'pilot', dropped: 'stop dosing when ALT is above 5 times ULN' }], conflict_check: checks.partial } };
  if (name === 'propose') return { ...pilots, decisionEffects: { ...pilots.decisionEffects, policy: 'propose' } };
  if (name === 'multi') return { ...email, decisionEffects: { ...email.decisionEffects,
    conflicts: [...email.decisionEffects.conflicts, { ...email.decisionEffects.conflicts[0], id: 'growth' }] } };
  return { email, friday, pilots, refunds, standing }[name];
}

function Host({ name, workspaceId, loading, reply, graphTheme }) {
  const [snapshot, setSnapshot] = useState(() => reply ? { data: reply.data, decisionEffects: reply } : fixture(name));
  const [branch, setBranch] = useState('');
  if (name === 'off') return <GraphExplorer data={{ nodes: [], edges: [] }} decisionEffects={email.decisionEffects} />;
  if (name === 'missing') return <GraphExplorer enableDecisionEffects decisionEffectsLoading={loading} />;
  const { decisionEffects: effects } = snapshot;
  const actions = {
    ...(recordings[name] && { onReadHistory: async (id, options, { signal }) => {
      window.historyReads.push(options);
      await window.holdHistory?.(options, signal);
      const key = options.as_of + '/' + options.show_retired;
      const reply = recordings[id][key];
      if (!reply) throw Error('Date unavailable');
      return reply;
    } }),
    onCommit(focus, answers) {
      if (name === 'reject' && !window.lastCommit) {
        window.lastCommit = { focus, answers };
        return Promise.reject(new Error('Write rejected'));
      }
      window.lastCommit = { focus, answers };
      if (effects.policy === 'propose') {
        setSnapshot({ ...snapshot, decisionEffects: { ...effects, phase: 'held', review: [], conflicts: [], replaces: [] } });
      } else if (focus === 'A') setSnapshot(committedEmail(answers));
      else setSnapshot({ ...snapshot, decisionEffects: { ...effects, phase: 'standing' } });
    },
    onCancel() { setSnapshot(standing); },
    onRefocus: setBranch,
    ...(name !== 'readonly' && {
      onConfirmLink: (...pair) => { window.lastLink = ['confirm', ...pair]; },
      onRemoveLink: (...pair) => { window.lastLink = ['remove', ...pair]; },
    }),
  };
  return <><GraphExplorer enableDecisionEffects workspaceId={workspaceId} {...graphTheme} {...snapshot} decisionEffectsActions={actions} />
    {branch && <output>Refocus requested: {branch}</output>}</>;
}

const root = createRoot(document.getElementById('root'));
let generation = 0;
const render = (name, workspaceId, loading, reply, graphTheme) => flushSync(() =>
  root.render(<Host key={generation} name={name} workspaceId={workspaceId} loading={loading} reply={reply} graphTheme={graphTheme} />));
window.updateHost = render;
window.loadCase = async (name, graphTheme) => {
  window.lastCommit = null;
  generation++;
  window.historyReads = [];
  let reply = recordings[name]?.['2026-11-28/false'];
  const draftA = 'Move email to the US vendor to cut cost. This replaces the Frankfurt vendor decision.';
  const draftH = 'Pilots get 14 days free instead of 30. This replaces the 30-day free period.';
  const adapter = createSDKAdapter({ decisions: {
    async previewDecisionEffects(text) {
      if (text === draftA) return email.decisionEffects;
      if (text === draftH) return suggestedPilots(name);
      throw new Error('Unknown fixture draft');
    },
    async getDecisionEffects(id) {
      if (id !== 'billing') throw new Error('Unknown fixture id');
      return suggestedPilots('suggest_only', true);
    },
  } });
  if (name === 'email') reply = await adapter.previewDecisionEffects(draftA);
  if (['dashed', 'treat_as_real', 'suggest_only'].includes(name)) reply = await adapter.previewDecisionEffects(draftH);
  if (['billing-list', 'readonly'].includes(name)) reply = await adapter.getDecisionEffects('billing');
  render(name, 'first', false, reply, graphTheme);
};
