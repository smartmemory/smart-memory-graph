import { useState } from 'react';
import { formatDate, FreshnessChip, nodeState } from './EffectsCanvas';

const dayMs = 86400000;
const day = date => Date.parse(date + 'T00:00:00Z') / dayMs;

export function RulesSlider({ first, today, date, showRetired, onDate, onRetired }) {
  return <div className="de-time">
    <label><span>Rules in force on <strong>{formatDate(date)} {date.slice(0, 4)}</strong></span>
      <input type="range" min={day(first)} max={day(today)} value={day(date)}
        aria-label="Rules in force on" aria-valuetext={date}
        onChange={e => onDate(new Date(e.target.valueAsNumber * dayMs).toISOString().slice(0, 10))} />
    </label>
    <label><input type="checkbox" checked={showRetired} onChange={e => onRetired(e.target.checked)} /> Show retired</label>
  </div>;
}

export function ConflictCard({ focus, partner, conflict, choice, onResolve, onCancel, busy }) {
  const [scope, setScope] = useState(choice?.scope || '');
  return <section className="de-detail de-conflict-card" aria-label="Conflict details">
    <h3>Settle conflict</h3>
    <div className="de-pair"><strong>{focus.label}</strong><strong>{partner.label}</strong></div>
    <p>{conflict.why}</p><FreshnessChip result={conflict.freshness} />
    {onResolve && <fieldset disabled={busy}>
      <label>Scope <input value={scope} placeholder="e.g. Marketing email only" onChange={e => setScope(e.target.value)} /></label>
      <div className="de-actions">
        <button onClick={() => onResolve({ choice: 'replace' })}>Replace the old rule</button>
        <button disabled={!scope.trim()} onClick={() => onResolve({ choice: 'scoped', scope: scope.trim() })}>Keep both with a scope</button>
        <button onClick={onCancel} disabled={!onCancel}>Cancel</button>
      </div>
    </fieldset>}
    {!onResolve && choice && <p>{choice.choice === 'scoped' || choice.choice === 'keep_both_scoped' ? 'Scoped: ' + choice.scope : 'Replaced'}</p>}
  </section>;
}

export function DecisionCard({ node, data, effects, date, choices, onWhy }) {
  const state = nodeState(node, effects, date, choices);
  const labels = new Map(data.nodes.filter(n => n.validFrom <= date).map(n => [n.id, n.label]));
  function related(type, outgoing) {
    return data.edges.filter(e => !(e.suggested && effects.suggestedLinks === 'suggest_only') && e.type === type && e[outgoing ? 'source' : 'target'] === node.id)
      .map(e => labels.get(e[outgoing ? 'target' : 'source'])).filter(Boolean);
  }
  const detail = [
    ['Options rejected', node.rejected], ['Replaced', related('supersedes', true)],
    ['Replaced by', related('supersedes', false)], ['Depends on', related('depends_on', true)],
    ['Depended on by', related('depends_on', false)], ['Source notes', related('comes_from', true)],
  ];
  return <section className="de-detail" aria-label="Decision details">
    <h3>{node.label}</h3>
    {state.tags.length > 0 && <p>{state.tags.join(' · ')}</p>}
    {node.reason && <p>{node.reason}</p>}
    <dl>{detail.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value?.join(' · ') || 'None'}</dd></div>)}</dl>
    {state.review && <FreshnessChip result={state.review.freshness} />}
    {onWhy && <button onClick={onWhy}>Why?</button>}
  </section>;
}

function nextStep(effects, unsettled, review, onSave) {
  if (!onSave) return 'Saving is unavailable for this preview.';
  if (unsettled.length) return 'Resolve the conflict with the rule in force before saving.';
  if (effects.policy === 'propose') return 'Send the proposal for review to request approval.';
  if (effects.conflicts.length) return 'Save the decision to apply your conflict choices.';
  if (effects.replaces.length && review.length) return 'Saving replaces the old rules and marks the affected decisions for review.';
  if (effects.replaces.length) return 'Saving replaces the rules shown in the preview.';
  if (review.length) return 'Saving marks the affected decisions for review.';
  return 'Save this decision to put it in force.';
}

export function CommitBar({ effects, unsettled, review, onConflict, onSave, onCancel, busy }) {
  const conflicts = unsettled.length;
  return <footer className="de-commit" aria-label="Commit bar">
    <h3>What would change</h3>
    <strong>{conflicts} conflict{conflicts === 1 ? '' : 's'} · {effects.replaces.length} replaced · {review.length} to review</strong>
    <p>{nextStep(effects, unsettled, review, onSave)}</p>
    <div className="de-actions">
      {conflicts > 0 && <button className="de-primary" disabled={busy}
        onClick={() => onConflict(unsettled[0].id)}>Resolve conflict</button>}
      {onSave && <button className={conflicts ? '' : 'de-primary'} disabled={busy || !!conflicts} onClick={onSave}>
        {effects.policy === 'propose' ? 'Send for review' : 'Save decision'}</button>}
      <button onClick={onCancel} disabled={busy || !onCancel}>Discard</button>
    </div>
  </footer>;
}
