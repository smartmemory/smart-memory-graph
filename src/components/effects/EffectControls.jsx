import { useRef, useState } from 'react';
import { formatDate, FreshnessChip, nodeState, reviewLabel } from './EffectsCanvas';

const dayMs = 86400000;
const day = date => Date.parse(date + 'T00:00:00Z') / dayMs;

function monthTicks(first, today) {
  const start = new Date(first + 'T00:00:00Z');
  const end = new Date(today + 'T00:00:00Z');
  const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth() + 1;
  const stride = Math.ceil(months / 12);
  const tick = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + (start.getUTCDate() > 1 ? 1 : 0), 1));
  const ticks = [];
  while (tick <= end) {
    const label = tick.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC', ...(months > 12 && { year: '2-digit' }) });
    ticks.push({ label, position: 100 * (tick - start) / Math.max(dayMs, end - start) });
    tick.setUTCMonth(tick.getUTCMonth() + stride);
  }
  return ticks;
}

export function RulesSlider({ first, loadingRange, today, drawnDate, pending, date, showRetired, onDate, onRetired }) {
  const drag = useRef(null);
  function finishDrag() {
    const value = drag.current?.date;
    drag.current = null;
    if (value) onDate(value);
  }
  return <div className="de-time">
    <div className="de-date-label">Rules in force on<strong>{formatDate(drawnDate)} {drawnDate.slice(0, 4)}{drawnDate === today && ' (today)'}</strong>
      {pending && <span role="status">Loading {formatDate(date)} {date.slice(0, 4)}…</span>}</div>
    <div className="de-date-track">
      <input type="range" disabled={loadingRange} min={day(first)} max={day(today)} value={day(date)}
        aria-label="Rules in force on" aria-valuetext={date}
        onPointerDown={e => {
          if (!e.isPrimary || e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = {};
        }}
        onLostPointerCapture={finishDrag}
        onChange={e => {
          const value = new Date(e.target.valueAsNumber * dayMs).toISOString().slice(0, 10);
          if (drag.current) drag.current.date = value;
          onDate(value, Boolean(drag.current));
        }} />
      <div className="de-months" aria-hidden="true">{monthTicks(first, today).map(tick =>
        <span key={tick.position} style={{ left: tick.position + '%' }}>{tick.label}</span>)}</div>
    </div>
    <button onClick={() => onDate(today)} disabled={date === today}>Today</button>
    <label><input type="checkbox" checked={showRetired} onChange={e => onRetired(e.target.checked)} /> Show retired</label>
  </div>;
}

export function ConflictCard({ focus, partner, conflict, proposed, choice, onResolve, onCancel, busy }) {
  const [scope, setScope] = useState(choice?.scope || '');
  return <section className="de-detail de-conflict-card" aria-label="Conflict details">
    <h3>Conflict</h3>
    <div className="de-pair">
      <strong><small>{proposed ? 'Proposed today' : 'Selected decision'}</small>{focus.label}</strong>
      <strong><small>{partner.validFrom ? 'In force since ' + formatDate(partner.validFrom) + ' ' + partner.validFrom.slice(0, 4)
        : 'In-force date unavailable'}</small>{partner.label}</strong>
    </div>
    <p><b>Why they clash:</b> {conflict.why}</p><FreshnessChip result={conflict.freshness} />
    {onResolve && <fieldset className="de-choices" disabled={busy}>
      <div><button onClick={() => onResolve({ choice: 'replace' })}>Replace the old rule</button>
        <p>When the new decision takes effect, the old rule is retired.</p></div>
      <div><button disabled={!scope.trim()} onClick={() => onResolve({ choice: 'scoped', scope: scope.trim() })}>Keep both with a scope</button>
        <p>Both rules stay in force. The new decision applies only within the scope you enter.</p>
        <label>Scope <input value={scope} placeholder="Where does the new decision apply?"
          onChange={e => setScope(e.target.value)} /></label></div>
      <div><button onClick={onCancel} disabled={!onCancel}>Cancel</button>
        <p>Discard this proposal and return to the standing decision.</p></div>
    </fieldset>}
    {!onResolve && choice && <p>{choice.choice === 'scoped' || choice.choice === 'keep_both_scoped' ? 'Scoped: ' + choice.scope : 'Replaced'}</p>}
  </section>;
}

function statusPill(node, state) {
  if (node.retiredAt && state.fading) return (node.retirement === 'retracted' ? 'Retracted ' : 'Replaced ') + formatDate(node.retiredAt);
  if (state.partner) return 'In conflict with the proposal';
  if (state.review) return reviewLabel(state.review.state);
  return 'In force';
}

function RelatedLinks({ items, onSelect }) {
  return <ul className="de-related">{items.map(({ id, label }) => <li key={id}>
    <button type="button" data-select={id} onClick={() => onSelect?.(id)} disabled={!onSelect}>{label}</button></li>)}</ul>;
}

export function DecisionCard({ node, data, effects, date, choices, onWhy, onSelect }) {
  const state = nodeState(node, effects, date, choices);
  const savedDecision = node.type === 'decision' && !state.ghost;
  const title = node.label.trim();
  const reason = node.reason?.trim();
  const labels = new Map(data.nodes.filter(n => n.validFrom <= date).map(n => [n.id, n.label.trim()]));
  function related(type, outgoing) {
    const seen = new Set();
    return data.edges.filter(e => !(e.suggested && effects.suggestedLinks === 'suggest_only') && e.type === type && e[outgoing ? 'source' : 'target'] === node.id)
      .map(e => e[outgoing ? 'target' : 'source']).filter(id => labels.get(id) && !seen.has(id) && seen.add(id))
      .map(id => ({ id, label: labels.get(id) }));
  }
  const rejected = (node.rejected || []).map(label => label.trim()).filter(Boolean);
  const lists = [
    ['Replaced', related('supersedes', true)], ['Replaced by', related('supersedes', false)],
    ['Depends on', related('depends_on', true)], ['Depended on by', related('depends_on', false)],
    ['Comes from', related('comes_from', true)],
  ].filter(([, items]) => items.length);
  return <section className="de-detail de-node-detail" aria-label={node.type === 'note' ? 'Source note details' : node.type === 'entity' ? 'Subject details' : 'Decision details'}>
    {title && <h3>{title}</h3>}
    {savedDecision && node.validFrom && <p className="de-decided">Decided {formatDate(node.validFrom)}</p>}
    {savedDecision && <span className="de-status" data-status={state.partner ? 'conflict' : state.review ? 'review' : undefined}>{statusPill(node, state)}</span>}
    {reason && <p>{reason}</p>}
    {rejected.length > 0 && <div><h4>Options rejected</h4><ul>{rejected.map((label, index) => <li key={index}>{label}</li>)}</ul></div>}
    {lists.map(([key, items]) => <div key={key}><h4>{key}</h4><RelatedLinks items={items} onSelect={onSelect} /></div>)}
    {state.review && <FreshnessChip result={state.review.freshness} />}
    {onWhy && <button onClick={onWhy}>Why?</button>}
  </section>;
}

export function checkAllowsSave(check) {
  if (!check || check.omitted !== 0) return false;
  return (check.state === 'checked' && check.checked > 0)
    || (check.state === 'nothing_to_check' && check.checked === 0);
}

function coverageMessage(check, hasReplacements) {
  if (check?.state === 'nothing_to_check' && checkAllowsSave(check)) {
    return hasReplacements ? 'No other rules in force to check against.' : 'No rules in force to check against.';
  }
  const checked = check?.checked || 0;
  const counted = checked + (checked === 1 ? ' rule' : ' rules');
  if (checkAllowsSave(check)) return 'Checked against ' + counted + '.';
  if (check?.omitted > 0) {
    const outcome = checked ? 'Partial check. Checked ' + counted : 'Could not check for conflicts';
    return outcome + '. ' + check.omitted
      + ' left out of the single judge call (up to ' + check.cap + ' rules within the text limit).';
  }
  if (checked > 0) return 'Partial check. Checked ' + counted + '. Could not finish checking.';
  return 'Could not check for conflicts. Try again.';
}

function nextStep(effects, unsettled, review, onSave, canSave) {
  if (!onSave) return 'Saving is unavailable for this preview.';
  if (!canSave) return 'Saving waits for a complete conflict check.';
  if (unsettled.length) return 'Resolve the conflict with the rule in force before saving.';
  if (effects.policy === 'propose') return 'Send the proposal for review to request approval.';
  if (effects.conflicts.length) return 'Save the decision to apply your conflict choices.';
  if (effects.replaces.length && review.length) return 'Saving replaces the old rules and marks the affected decisions for review.';
  if (effects.replaces.length) return 'Saving replaces the rules shown in the preview.';
  if (review.length) return 'Saving marks the affected decisions for review.';
  if (effects.conflict_check?.state === 'checked') return 'Safe to save. Save this decision to put it in force.';
  return 'Save this decision to put it in force.';
}

export function CommitBar({ effects, unsettled, review, onConflict, onSave, onCancel, busy }) {
  const conflicts = unsettled.length;
  const check = effects.conflict_check;
  const canSave = checkAllowsSave(check);
  const summary = conflicts || effects.conflicts.length || canSave
    ? conflicts + ' conflict' + (conflicts === 1 ? '' : 's') : 'Conflicts not checked';
  return <footer className="de-commit" aria-label="Commit bar">
    <h3>What would change</h3>
    <strong>{summary} · {effects.replaces.length} replaced · {review.length} to review</strong>
    <p className="de-coverage">{coverageMessage(check, effects.replaces.length > 0)}</p>
    <p>{nextStep(effects, unsettled, review, onSave, canSave)}</p>
    <div className="de-actions">
      {conflicts > 0 && <button className="de-primary" disabled={busy}
        onClick={() => onConflict(unsettled[0].id)}>Resolve conflict</button>}
      {onSave && <button className={conflicts ? '' : 'de-primary'} disabled={busy || !!conflicts || !canSave} onClick={onSave}>
        {effects.policy === 'propose' ? 'Send for review' : 'Save decision'}</button>}
      <button onClick={onCancel} disabled={busy || !onCancel}>Discard</button>
    </div>
  </footer>;
}
