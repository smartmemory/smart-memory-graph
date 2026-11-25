import { useId, useMemo } from 'react';
import dagre from 'dagre';

const width = 204;
const height = 136;

function layout(nodes, links, extras) {
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({ rankdir: 'LR', ranksep: 28, nodesep: 30, marginx: 22, marginy: 24 });
  graph.setDefaultEdgeLabel(() => ({}));
  nodes.forEach(n => graph.setNode(n.id, { width, height }));
  links.forEach((link, i) => graph.setEdge(link.source, link.target,
    { width: Math.max(32, link.label.length * 7 + 12), height: 22, labelpos: 'c' }, String(i)));
  extras.forEach(({ key, anchor }) => {
    graph.setNode(key, { width: 158, height: 44 });
    if (graph.hasNode(anchor)) graph.setEdge(anchor, key, {});
  });
  dagre.layout(graph);
  return graph;
}

export function FreshnessChip({ result }) {
  if (!result) return null;
  if (result.kind === 'computed') return <span className="de-chip">computed now</span>;
  return <span className="de-chip" data-stale={result.stale || undefined}>
    {result.stale ? '◷ stale · ' : ''}checked <time dateTime={result.checked_as_of}>{result.checked_as_of}</time>
  </span>;
}

function markers(id) {
  return ['link', 'ripple', 'conflict', 'why', 'replaces'].map(kind =>
    <marker key={kind} id={id + kind} viewBox="0 0 12 12" refX="11" refY="6"
      markerWidth="9" markerHeight="9" orient="auto" className={'de-marker de-' + kind}>
      <path d={kind === 'conflict' ? 'M0 1L8 6L0 11Z M10 1V11' : 'M1 1L10 6L1 11Z'} />
    </marker>);
}

function Edge({ edge, geometry, marker, dim, onConflict }) {
  const { x, y, points, width: w } = geometry;
  const d = points.map((p, i) => (i ? 'L' : 'M') + p.x + ' ' + p.y).join(' ');
  const hasButton = !!edge.partner;
  return <g data-edge={edge.kind} data-source={edge.source} data-target={edge.target}
    className={'de-edge de-' + edge.kind} data-dimmed={dim || undefined}>
    <title>{edge.label}{edge.freshness?.stale ? ' · stale' : ''}</title>
    <path d={d} markerEnd={'url(#' + marker + ')'} />
    {hasButton ? <foreignObject x={x - w / 2 - 6} y={y - 14} width={w + 12} height="30">
      <button className="de-link-button" onClick={() => onConflict(edge.partner)}>{edge.label}</button>
    </foreignObject> : <g className="de-edge-label">
      <rect x={x - w / 2} y={y - 9} width={w} height="18" rx="8" />
      <text x={x} y={y + 4} textAnchor="middle">{edge.label}</text>
    </g>}
  </g>;
}

export function nodeState(node, effects, date, choices) {
  const today = date === effects.today;
  const focus = node.id === effects.focus;
  const ghost = focus && effects.phase !== 'standing';
  const held = ghost && effects.phase === 'held';
  const review = today ? effects.review.find(r => r.id === node.id && r.hop <= 3 && r.state !== 'reviewed') : undefined;
  const retiring = today && effects.phase === 'draft' && effects.replaces.includes(node.id);
  const retired = node.retiredAt && node.retiredAt <= date;
  const conflict = today && effects.conflicts.some(c => (focus || c.id === node.id) && !choices[c.id] && !c.resolution);
  const tags = [];
  if (ghost) tags.push(held ? 'held' : 'proposed');
  if (retiring) tags.push('retiring');
  if (retired) tags.push((node.retirement || 'replaced') + ' ' + formatDate(node.retiredAt));
  if (conflict) tags.push('× conflict');
  if (review) tags.push('R' + review.hop + ' · ' + (review.state === 'checking' ? 'checking' : 'needs review'));
  if ((node.ruleKind || node.check) && today) tags.push('check ' + ({ compiled: 'ok', unchecked: '?', stale: 'stale' })[node.check || 'unchecked']);
  return { ghost, held, fading: !!(retiring || retired), review, tags };
}

export function formatDate(date) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(date + 'T00:00:00Z'));
}

export default function EffectsCanvas({ nodes, links, effects, date, path, choices, extras, onSelect, onConflict }) {
  const id = 'de' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const graph = useMemo(() => layout(nodes, links, extras), [nodes, links, extras]);
  if (!nodes.length) return <p className="de-empty">No rules in force on this date.</p>;
  const { width: w, height: h } = graph.graph();
  return <div className="de-scroll" tabIndex={0} role="region" aria-label="Scrollable decision graph">
    <svg className="de-canvas" role="group" aria-label="Decision graph"
      viewBox={'0 0 ' + w + ' ' + h} style={{ minWidth: w * 0.78, minHeight: h * 0.78, maxHeight: h + 20 }}>
      <defs>{markers(id)}</defs>
      {links.map((edge, i) => {
        const marker = ['conflict', 'ripple', 'why', 'replaces'].includes(edge.kind) ? edge.kind : 'link';
        return <Edge key={i} edge={edge} geometry={graph.edge(edge.source, edge.target, String(i))}
          dim={path.length > 0 && edge.kind !== 'why'} marker={id + marker} onConflict={onConflict} />;
      })}
      {extras.map(extra => {
        const { x, y } = graph.node(extra.key);
        const points = graph.edge(extra.anchor, extra.key)?.points;
        return <g key={extra.key} data-stub={extra.stub || undefined} data-dimmed={path.length > 0 || undefined}>
          {points && <polyline className="de-dotted" points={points.map(p => p.x + ',' + p.y).join(' ')} />}
          <foreignObject x={x - 79} y={y - 22} width="158" height="44" className="de-pill-wrap">
            <button className="de-pill" onClick={extra.onClick} disabled={!extra.onClick}>{extra.label}</button>
          </foreignObject>
        </g>;
      })}
      {nodes.map(node => {
        const p = graph.node(node.id);
        const state = nodeState(node, effects, date, choices);
        const step = path.indexOf(node.id);
        return <foreignObject key={node.id} x={p.x - width / 2} y={p.y - height / 2}
          width={width} height={height} data-node={node.id} data-dimmed={path.length > 0 && step < 0 || undefined}>
          <button className="de-node" onClick={() => onSelect(node.id)} title={node.label}
            data-ghost={state.ghost || undefined} data-retired={state.fading || undefined}
            data-review={state.review?.hop} style={{ '--hop': state.review?.hop || 0 }}>
            <span className="de-meta">{step >= 0 && <b className="de-step"> {step + 1} </b>}
              {node.type === 'note' ? 'Source note' : node.type === 'entity' ? 'Subject' : 'Decision'} · {formatDate(node.validFrom)}</span>
            <strong>{state.ghost ? 'Draft: ' : ''}{node.label}</strong>
            <span className="de-tags">{state.tags.map(tag => <span key={tag}>{tag}</span>)}
              {state.review?.freshness.stale && <span>◷ stale</span>}</span>
          </button>
        </foreignObject>;
      })}
    </svg>
  </div>;
}
