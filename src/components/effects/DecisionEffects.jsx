import { useCallback, useMemo, useRef, useState } from 'react';
import { effectiveTheme } from '../../internal/useCytoscape';
import EffectsCanvas, { FreshnessChip } from './EffectsCanvas';
import { CommitBar, ConflictCard, DecisionCard, RulesSlider } from './EffectControls';
import { focusWindow, graphLinks, visibleReview } from './focusGraph';
import SuggestedLinkActions from './SuggestedLinkActions';
import EffectsLegend from './EffectsLegend';
import './effects.css';


function usePanel() {
  const [panel, setPanel] = useState(null);
  const opener = useRef(null);
  function openPanel(kind, id) {
    opener.current = document.activeElement;
    setPanel({ kind, id });
  }
  function closePanel() {
    setPanel(null);
    opener.current?.focus();
  }
  return { panel, openPanel, closePanel, opener, setPanel };
}

function useCommit(effects, actions, draft, policyKnown, panel, closePanel) {
  const [choices, setChoices] = useState(() => Object.create(null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const cancel = actions.onCancel && (() => actions.onCancel(effects.focus));
  async function commit(resolutions) {
    if (!actions.onCommit || pending.current || !draft || !policyKnown) return;
    const answers = Object.create(null);
    for (const c of effects.conflicts) {
      const answer = c.resolution || resolutions[c.id];
      if (!answer) return;
      answers[c.id] = answer;
    }
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await actions.onCommit(effects.focus, answers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this decision.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function resolve(answer) {
    const next = Object.assign(Object.create(null), choices, { [panel.id]: answer });
    setChoices(next);
    closePanel();
  }
  return { choices, busy, error, cancel, resolve, commit };
}

function canvasPills(overflow, byId, effects, today, openPanel) {
  // Auxiliary pills live on the canvas. Layout IDs must never shadow a caller's node ID.
  const extras = [];
  function pill(label, anchor, onClick, stub = false) {
    let key = 'effects-pill-' + extras.length;
    while (byId.has(key)) key += '_';
    extras.push({ key, label, anchor, onClick, stub });
  }
  const branchesByHop = new Map();
  for (const { hop, branchId, count } of overflow) {
    if (!branchesByHop.has(hop)) branchesByHop.set(hop, new Map());
    const branches = branchesByHop.get(hop);
    branches.set(branchId, (branches.get(branchId) || 0) + count);
  }
  for (const [hop, branches] of branchesByHop) {
    const count = Array.from(branches.values()).reduce((sum, n) => sum + n, 0);
    pill('+' + count + ' more at hop ' + hop, effects.focus, () => openPanel('overflow', hop), true);
  }
  const related = effects.possibly_related ?? effects.possiblyRelated ?? [];
  if (today && related.length) {
    pill(related.length + ' possibly related', effects.focus, () => openPanel('related'));
  }
  return { extras, branchesByHop, related };
}

function DetailDrawer({ data, effects, actions, model }) {
  const { panel, byId, today, date, opener, closePanel, setPath, choices, busy, draft,
    policyKnown, resolve, cancel, focus, branchesByHop, related } = model;
  const selected = byId.get(panel?.id);
  const conflict = effects.conflicts.find(c => c.id === panel?.id);
  const suggestions = panel?.kind === 'link'
    ? data.edges.filter(edge => edge.id === panel.id && edge.suggested && effects.suggestedLinks !== 'suggest_only') :
    today && effects.suggestedLinks === 'suggest_only' && selected
      ? (effects.suggestions || []).filter(link => link.source === selected.id) : [];
  const selectedPath = selected && Object.hasOwn(effects.whyPaths || {}, selected.id) ? effects.whyPaths[selected.id] : null;
  const canShowPath = selectedPath?.length > 1 && selectedPath.length <= 6 &&
    selectedPath.every(id => byId.get(id)?.validFrom <= date);
  if (!panel) return null;
  return <aside className="de-aside" aria-label="Graph detail" ref={el => {
      if (el && !el.contains(document.activeElement) && document.activeElement === opener.current) el.focus();
    }} tabIndex={-1}>
      <button className="de-close" aria-label="Close detail" onClick={closePanel}>×</button>
      {panel.kind === 'node' && selected && <DecisionCard node={selected} data={data} effects={effects} date={date}
        choices={choices} onSelect={id => model.setPanel({ kind: 'node', id })} onWhy={canShowPath ? () => { setPath(selectedPath); closePanel(); } : null} />}
      {suggestions.length > 0 && <section className="de-detail" aria-label="Suggested links"><h3>Suggested links</h3>
        <ul>{suggestions.map(({ source, target, reason }) => <li key={JSON.stringify([source, target])}>
          {byId.get(source)?.label || source} → {byId.get(target)?.label || target}
          <p>Suggested by decision dependencies{reason && ' · ' + reason}</p>
          {today && <SuggestedLinkActions source={source} target={target} actions={actions} />}
        </li>)}</ul></section>}
      {panel.kind === 'conflict' && conflict && <ConflictCard key={panel.id} focus={focus} partner={selected || { label: conflict.id }}
        conflict={conflict} proposed={effects.phase === 'draft'} choice={conflict.resolution || choices[conflict.id]} busy={busy}
        onResolve={!conflict.resolution && draft && policyKnown && actions.onCommit ? resolve : null} onCancel={cancel} />}
      {panel.kind === 'overflow' && <section className="de-detail"><h3>Branches at hop {panel.id}</h3>
        <ul>{Array.from(branchesByHop.get(panel.id) || [], ([id, count]) =>
          <li key={id}><button disabled={!actions.onRefocus} onClick={() => actions.onRefocus(id)}>
            {byId.get(id)?.label || id}{count > 1 && ' (' + count + ' more)'}</button></li>)}</ul></section>}
      {panel.kind === 'related' && <section className="de-detail"><h3>Possibly related by wording</h3>
        <ul>{related.map(n => <li key={n.id}>{n.label}</li>)}</ul></section>}
    </aside>;

}

function useEffectsModel(data, effects, actions) {
  const [date, setDate] = useState(effects.today);
  const [showRetired, setRetired] = useState(false);
  const [path, setPath] = useState([]);
  const panels = usePanel();
  const { setPanel, openPanel } = panels;
  const today = date === effects.today;
  const draft = today && effects.phase === 'draft';
  const policyKnown = effects.policy === 'save' || effects.policy === 'propose';
  const state = useCommit(effects, actions, draft, policyKnown, panels.panel, panels.closePanel);
  const { choices } = state;
  const byId = useMemo(() => new Map(data.nodes.map(n => [n.id, n])), [data.nodes]);
  const { nodes, overflow } = useMemo(() => focusWindow(data, effects, date, showRetired, path),
    [data, effects, date, showRetired, path]);
  const links = useMemo(() => graphLinks(data, effects, nodes, today, path, choices), [data, effects, nodes, today, path, choices]);
  const first = data.nodes.reduce((start, n) => n.validFrom < start ? n.validFrom : start, effects.today.slice(0, 4) + '-01-01');
  const focus = byId.get(effects.focus);
  const review = today ? visibleReview(effects) : [];
  const unsettled = effects.conflicts.filter(c => !choices[c.id] && !c.resolution);
  const hidden = overflow.reduce((sum, s) => sum + s.count, 0);
  function changeDate(value) {
    setDate(value);
    setPanel(null);
    setPath([]);
  }
  return { ...panels, ...state, ...canvasPills(overflow, byId, effects, today, openPanel),
    byId, today, date, path, setPath, setRetired, showRetired, nodes, links, first, focus, draft,
    policyKnown, review, unsettled, hidden, changeDate };
}

function EffectsFrame({ model, data, effects, actions }) {
  const { today, hidden, path, links, setPath, nodes, date, choices, extras, openPanel } = model;
  return <div className="de-frame">
      <div className="de-frame-heading"><span>Decision neighbourhood{hidden > 0 && ` · ${hidden} more not shown`}</span>
        {!today && <strong>Review and conflict marks are shown for today only.</strong>}
        {today && effects.sweepWatermark && <span>Conflicts checked for changes since {effects.sweepWatermark} only.</span>}
      </div>
      {!!path.length && <div className="de-banner">Why this decision · {path.length - 1} {path.length === 2 ? 'link' : 'links'}
        {links.filter(link => link.kind === 'why' && link.freshness).map(link =>
          <span key={link.source + ':' + link.target}>Step {path.indexOf(link.target) + 1} <FreshnessChip result={link.freshness} /></span>)}
        <button onClick={() => setPath([])}>Clear path</button></div>}
      <EffectsCanvas nodes={nodes} links={links} effects={effects} date={date} path={path} choices={choices}
        extras={extras} onSuggestion={link => openPanel('link', link.id)} onSelect={id => openPanel('node', id)} onConflict={id => openPanel('conflict', id)} />

    <DetailDrawer model={model} data={data} effects={effects} actions={actions} />
  </div>;
}

function Sidebar({ model, effects, actions, proposal }) {
  const { today, review, openPanel, byId, error, draft, unsettled, busy, cancel, policyKnown, commit, choices } = model;
  return <div className="de-sidebar">
    {typeof proposal === 'function' ? proposal({ today }) : proposal}
    {today && effects.phase === 'standing' && !!review.length && <section className="de-review-list"><h3>Needs review</h3>
      <ul>{review.map(r => <li key={r.id}><button onClick={() => openPanel('node', r.id)} disabled={!byId.has(r.id)}>
        R{r.hop} · {byId.get(r.id)?.label || r.id}</button></li>)}</ul></section>}
    {error && <p role="alert">{error}</p>}
    {draft && <CommitBar effects={effects} unsettled={unsettled} review={review} busy={busy} onCancel={cancel}
      onConflict={id => openPanel('conflict', id)} onSave={policyKnown && actions.onCommit && (() => commit(choices))} />}
    <EffectsLegend />
  </div>;
}

export default function DecisionEffects({ data, effects, actions = {}, className = '', theme, mode, proposal }) {
  const applyTheme = useCallback(container => {
    if (container) container.style.colorScheme = effectiveTheme(theme, mode, container).mode;
  }, [theme, mode]);
  const palette = theme?.palette;
  const style = {
    '--de-node': palette?.node,
    '--de-edge': palette?.edge,
    '--de-label': palette?.label,
    '--de-selection': palette?.selectionBorder,
  };
  const model = useEffectsModel(data, effects, actions);
  const { focus, nodes, panel, closePanel, date, today, first, showRetired, changeDate, setRetired, setPanel, setPath } = model;
  if (!focus) return <p role="status">Decision effects unavailable: the focus is missing.</p>;
  return <section ref={applyTheme} style={style} className={'de-view ' + className} aria-label="Decision effects" onKeyDown={e => {
    if (e.key === 'Escape') {
      if (panel) closePanel();
      else setPath([]);
    }
  }}>
    <header className="de-header"><div><h2>Decision effects</h2>{(today || nodes.some(n => n.id === focus.id)) && <p>{focus.label}</p>}</div>
      {today && <FreshnessChip result={effects.freshness} />}</header>
    <Sidebar model={model} effects={effects} actions={actions} proposal={proposal} />
    <EffectsFrame model={model} effects={effects} data={data} actions={actions} />
    <RulesSlider first={first} today={effects.today} date={date} showRetired={showRetired}
      onDate={changeDate} onRetired={value => { setRetired(value); setPanel(null); setPath([]); }} />
  </section>;
}
