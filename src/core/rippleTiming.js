// Project a decision-effects snapshot onto canvas IDs. Distances come from the snapshot.
const STEP_MS = 450;
const MAX_MS = 4000;
// Snapshot names and their corresponding stored graph relations.
const effectRelation = new Map([['derived_from', 'comes_from'], ['replaces', 'supersedes']]);

// Schedule each visible node once, even when a cycle returns to the focus.
export function planRipple(snapshot, canvasIds, canvasEdges, reducedMotion = false) {
  const nodes = indexedNodes(snapshot);
  const visible = new Set(canvasIds);
  let maxHop = 1;
  const overflow = (snapshot.overflow || []).reduce((sum, row) => sum + row.count, 0);
  let offScreen = overflow;
  for (const node of nodes.values()) {
    maxHop = Math.max(maxHop, node.hop);
    if (!visible.has(node.id) && node.id !== snapshot.focus) offScreen++;
  }
  const step = reducedMotion ? 0 : Math.min(STEP_MS, MAX_MS / maxHop);
  const events = [];
  for (const { id, hop, kind } of nodes.values()) {
    if (visible.has(id)) events.push({ element: 'node', id, kind, at: hop * step });
  }
  const links = edgeEvents(snapshot.data.edges, canvasEdges, nodes, visible, step);
  const ordered = events.concat(links).sort((a, b) => a.at - b.at);
  return { events: ordered, offScreen, affected: nodes.size - 1 + overflow };
}

// Preserve the shortest supplied distance and the effect view's state precedence.
function indexedNodes(snapshot) {
  const kinds = new Map((snapshot.review || []).filter(r => r.state !== 'reviewed').map(r => [r.id, 'review']));
  for (const { id } of snapshot.conflicts || []) kinds.set(id, 'conflict');
  for (const id of snapshot.replaces || []) kinds.set(id, 'replaced');
  const nodes = new Map([[snapshot.focus, { id: snapshot.focus, hop: 0, kind: 'focus' }]]);
  for (const { id, hop, retirement } of snapshot.data.nodes) {
    if (!Number.isInteger(hop) || hop <= 0 || nodes.get(id)?.hop <= hop) continue;
    const kind = retirement === 'replaced' ? 'replaced' : kinds.get(id) || 'affected';
    nodes.set(id, { id, hop, kind });
  }
  return nodes;
}

// Normal graph links can have a different ID or uppercase relationship name.
function edgeKey({ source, target, type }) {
  const name = type?.toLowerCase();
  return JSON.stringify([source, target, effectRelation.get(name) || name]);
}

// An edge leads its farther endpoint, including edges directed back toward the focus.
function edgeEvents(snapshotEdges, canvasEdges, nodes, visible, step) {
  const keys = new Set(snapshotEdges.map(edgeKey));
  const ids = new Set(snapshotEdges.map(edge => edge.id));
  const events = [];
  for (const edge of canvasEdges) {
    if (!ids.has(edge.id) && !keys.has(edgeKey(edge))) continue;
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target || source === target || !visible.has(source.id) || !visible.has(target.id)) continue;
    const far = source.hop > target.hop ? source : target;
    events.push({ element: 'edge', id: edge.id, kind: far.kind, at: (far.hop - 0.2) * step });
  }
  return events;
}
