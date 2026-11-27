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

function statusPill(node, state, effects) {
  if (state.ghost) return state.held ? 'Held, not saved' : 'Proposed, not saved';
  if (node.retiredAt && state.fading) return (node.retirement === 'retracted' ? 'Retracted ' : 'Replaced ') + formatDate(node.retiredAt);
  if (state.partner) return 'In conflict with the proposal';
  if (state.review) return state.review.state === 'checking' ? 'Checking' : 'Needs review';
  return 'In force';
}

function RelatedLinks({ items, onSelect }) {
  return <ul className="de-related">{items.map(({ id, label }) => <li key={id}>
    <button type="button" data-select={id} onClick={() => onSelect?.(id)} disabled={!onSelect}>{label}</button></li>)}</ul>;
}

export function DecisionCard({ node, data, effects, date, choices, onWhy, onSelect }) {
  const state = nodeState(node, effects, date, choices);
  const labels = new Map(data.nodes.filter(n => n.validFrom <= date).map(n => [n.id, n.label]));
  function related(type, outgoing) {
    const seen = new Set();
    return data.edges.filter(e => !(e.suggested && effects.suggestedLinks === 'suggest_only') && e.type === type && e[outgoing ? 'source' : 'target'] === node.id)
      .map(e => e[outgoing ? 'target' : 'source']).filter(id => labels.has(id) && !seen.has(id) && seen.add(id))
      .map(id => ({ id, label: labels.get(id) }));
  }
  const rejected = (node.rejected || []).map(label => ({ id: label, label }));
  const lists = [
    ['Replaced', related('supersedes', true)], ['Replaced by', related('supersedes', false)],
    ['Depends on', related('depends_on', true)], ['Depended on by', related('depends_on', false)],
    ['Comes from', related('comes_from', true)],
  ].filter(([, items]) => items.length);
  return <section className="de-detail" aria-label="Decision details">
    <h3>{node.label}</h3>
    {node.validFrom && <p className="de-decided">Decided {formatDate(node.validFrom)}</p>}
    <span className="de-status" data-status={state.partner ? 'conflict' : state.review ? 'review' : undefined}>{statusPill(node, state, effects)}</span>
    {node.reason && <p>{node.reason}</p>}
    {rejected.length > 0 && <div><h4>Options rejected</h4><ul>{rejected.map(r => <li key={r.id}>{r.label}</li>)}</ul></div>}
    {lists.map(([key, items]) => <div key={key}><h4>{key}</h4><RelatedLinks items={items} onSelect={onSelect} /></div>)}
    {state.review && <FreshnessChip result={state.review.freshness} />}
    {onWhy && <button onClick={onWhy}>Why?</button>}
  </section>;
}

export function CommitBar({ effects, unsettled, review, onConflict, onSave, onCancel, busy }) {
  const conflicts = effects.conflicts.length;
  return <footer className="de-commit" aria-label="Commit bar">
    <div><strong>{conflicts} conflict{conflicts === 1 ? '' : 's'} · {effects.replaces.length} replaced · {review.length} to review</strong>
      <div>{!onSave ? 'Writes unavailable' : unsettled.length ? <button onClick={() => onConflict(unsettled[0].id)}>Settle {unsettled.length} open conflict{unsettled.length === 1 ? '' : 's'}</button>
        : conflicts === 0 && !review.length && !effects.replaces.length ? 'Safe to save' : 'Ready to save'}</div></div>
    <div className="de-actions"><button onClick={onCancel} disabled={busy || !onCancel}>Cancel</button>
      {onSave && <button className="de-primary" disabled={busy || !!unsettled.length} onClick={onSave}>
        {effects.policy === 'propose' ? 'Send for review' : 'Save'}</button>}</div>
  </footer>;
}
