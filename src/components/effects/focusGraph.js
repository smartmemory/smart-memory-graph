const rankByKind = { focus: 0, retiring: 1, conflict: 2, review: 3, why: 4, neighbour: 5, outside: 6 };

export function visibleReview(effects) {
  return effects.review.filter(item => item.state !== 'reviewed');
}

// Pick the focused window before layout. Never query an adapter to fill a gap.
export function focusWindow(data, effects, date, showRetired, path) {
  const today = date === effects.today;
  const draft = effects.phase !== 'standing';
  const retire = new Set(today ? effects.replaces : []);
  const conflicts = new Set(today ? effects.conflicts.map(c => c.id) : []);
  const reviews = new Map(today ? visibleReview(effects).map(r => [r.id, r]) : []);
  const why = new Set(path);
  const overflow = [];
  for (const stub of effects.overflow || []) {
    if (stub.date === date && stub.count > 0) overflow.push({ ...stub });
  }
  const candidates = [];
  for (const node of data.nodes) {
    if (node.validFrom > date || (!today && draft && node.id === effects.focus)) continue;
    if (node.retiredAt < date && !showRetired && !why.has(node.id)) continue;
    let kind = 'neighbour';
    const hop = node.hop;
    if (node.id === effects.focus) kind = 'focus';
    else if (retire.has(node.id)) kind = 'retiring';
    else if (conflicts.has(node.id)) kind = 'conflict';
    else if (reviews.has(node.id) && reviews.get(node.id).hop <= 3) {
      kind = 'review';
    } else if (why.has(node.id)) kind = 'why';
    else if (hop > 2) kind = 'outside';
    candidates.push({ node, kind, hop });
  }
  candidates.sort((a, b) => rankByKind[a.kind] - rankByKind[b.kind] ||
    (a.kind === 'review' ? reviews.get(a.node.id).hop - reviews.get(b.node.id).hop : a.hop - b.hop) ||
    (b.node.importance || 0) - (a.node.importance || 0));
  const nodes = [];
  const reservedPath = new Set(candidates.filter(c => why.has(c.node.id)).map(c => c.node.id));
  const perHop = new Map();
  let subjects = 0;
  for (const { node, hop, kind } of candidates) {
    const count = perHop.get(hop) || 0;
    // Keep a provenance chain intact even when its intermediate hop is full.
    reservedPath.delete(node.id);
    const subjectFits = node.type !== 'entity' || subjects < 5 || why.has(node.id);
    const hopFits = count < 12 || why.has(node.id) || kind === 'focus';
    if (kind !== 'outside' && subjectFits && hopFits && nodes.length + reservedPath.size < 40) {
      if (node.type === 'entity') subjects++;
      nodes.push(node);
      perHop.set(hop, count + 1);
    } else {
      overflow.push({ hop, branchId: node.id, count: 1 });
    }
  }
  return { nodes, overflow: overflow };
}

export function graphLinks(data, effects, nodes, today, path, choices) {
  const ids = new Set(nodes.map(n => n.id));
  const links = [];
  const add = (source, target, kind, label, extra = {}) => {
    if (ids.has(source) && ids.has(target)) links.push({ source, target, kind, label, ...extra });
  };
  if (today) {
    for (const id of effects.replaces) add(effects.focus, id, 'replaces', 'replaces');
    for (const c of effects.conflicts) {
      const pending = choices[c.id];
      const kind = c.resolution ? 'settled' : pending ? 'pending' : 'conflict';
      const settled = c.resolution?.choice;
      const label = (settled === 'keep_both_scoped' ? 'scoped' : settled) || (pending ? 'pending: ' + pending.choice : 'conflict');
      add(effects.focus, c.id, kind, label + (c.freshness?.stale ? ' · ◷ stale' : ''),
        { partner: c.id, freshness: c.freshness });
    }
    for (const r of visibleReview(effects)) {
      if (r.hop <= 3) add(r.via, r.id, 'ripple', 'R' + r.hop);
    }
  }
  const pair = (a, b) => JSON.stringify([a, b].sort());
  const overlayPairs = new Set(links.map(e => pair(e.source, e.target)));
  for (const e of data.edges) {
    const i = path.indexOf(e.source);
    const j = path.indexOf(e.target);
    const onPath = i >= 0 && j >= 0 && Math.abs(i - j) === 1;
    if (onPath) {
      add(path[Math.min(i, j)], path[Math.max(i, j)], 'why', e.derived ? 'derived' : 'why', { freshness: e.freshness });
    } else if (!e.derived && !overlayPairs.has(pair(e.source, e.target))) {
      const label = { comes_from: 'source', supersedes: 'replaces', depends_on: 'depends on' }[e.type];
      add(e.source, e.target, e.type, label);
    }
  }
  return links;
}
