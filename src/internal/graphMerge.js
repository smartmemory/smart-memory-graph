import { DECISION_STATUS_CLASS_PREFIX } from '../core/decisionStyles';

// Classes that cytoscapeConvert derives from node data. Every other class on a live element
// (selection helpers, dimming, highlights, annotations) is runtime state the merge must keep.
const isDataClass = (cls) => cls === 'grounded' || cls.startsWith(DECISION_STATUS_CLASS_PREFIX);

const isEdgeDef = (el) => el.group === 'edges' || (el.data && 'source' in el.data);

const NEW_NODE_RADIUS = 90;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function syncDataClasses(ele, classes) {
  const wanted = new Set(String(classes || '').split(/\s+/).filter(Boolean));
  for (const cls of ele.classes()) {
    if (isDataClass(cls) && !wanted.has(cls)) ele.removeClass(cls);
  }
  for (const cls of wanted) ele.addClass(cls);
}

function graphCentre(cy, placedIds) {
  const placed = cy.nodes().filter((n) => placedIds.has(n.id()));
  if (placed.length) {
    const bb = placed.boundingBox();
    return { x: (bb.x1 + bb.x2) / 2, y: (bb.y1 + bb.y2) / 2 };
  }
  return { x: 0, y: 0 };
}

// Seed each new node beside an already-placed neighbour (falling back to the centre of the
// existing graph), spreading siblings on a golden-angle spiral so none share a spot.
function placeNewNodes(cy, newIds, edgeDefs, survivorIds) {
  const neighbours = new Map();
  for (const e of edgeDefs) {
    const { source, target } = e.data;
    if (!neighbours.has(source)) neighbours.set(source, []);
    if (!neighbours.has(target)) neighbours.set(target, []);
    neighbours.get(source).push(target);
    neighbours.get(target).push(source);
  }
  const placed = new Set(survivorIds);
  const pending = new Set(newIds);
  const childCount = new Map();
  const place = (id, anchorPos, anchorKey) => {
    const k = childCount.get(anchorKey) || 0;
    childCount.set(anchorKey, k + 1);
    const r = NEW_NODE_RADIUS * (1 + Math.floor(k / 8) * 0.6);
    const angle = k * GOLDEN_ANGLE;
    cy.getElementById(id).position({ x: anchorPos.x + r * Math.cos(angle), y: anchorPos.y + r * Math.sin(angle) });
    placed.add(id);
    pending.delete(id);
  };
  // Breadth-first: a new node connected only to other new nodes waits for one of them.
  let progressed = true;
  while (pending.size && progressed) {
    progressed = false;
    for (const id of [...pending]) {
      const anchor = (neighbours.get(id) || []).find((n) => placed.has(n));
      if (anchor) {
        place(id, cy.getElementById(anchor).position(), anchor);
        progressed = true;
      }
    }
  }
  if (pending.size) {
    const centre = graphCentre(cy, survivorIds);
    for (const id of [...pending]) place(id, centre, '__centre__');
  }
}

/**
 * Merge a fresh element set into a live Cytoscape instance, in place.
 *
 * UI-REFRESH-1: this used to remove every element and re-add the payload. That dropped the
 * user's selection and runtime classes on every refresh, left new nodes at the graph origin
 * (no layout runs on a refresh, so they stacked out of sight), and one edge whose endpoint was
 * missing from the payload threw out of cy.add() halfway through the batch. Now it diffs by id:
 * elements still present keep their identity, position and runtime classes (their data and
 * data-derived classes are updated), new ones are added and placed beside a neighbour, and
 * elements no longer in the payload are removed.
 *
 * @param {Object} cy - Cytoscape instance
 * @param {Array} elements - Cytoscape element definitions (the complete new set)
 * @param {{ afterMerge?: (cy: Object) => void }} [options]
 * @returns {{ isInitial: boolean, added: string[], removed: string[], skippedEdges: string[] }}
 */
export function applyGraphMerge(cy, elements, { afterMerge } = {}) {
  const isInitial = cy.nodes().length === 0;
  const nodeDefs = new Map();
  const edgeDefs = new Map();
  for (const el of elements || []) {
    const id = el?.data?.id;
    if (!id) continue;
    (isEdgeDef(el) ? edgeDefs : nodeDefs).set(id, el);
  }

  const added = [];
  const removed = [];
  const skippedEdges = [];

  cy.batch(() => {
    // 1. Edges that are gone, or whose endpoints changed under the same id.
    cy.edges().forEach((e) => {
      const def = edgeDefs.get(e.id());
      if (!def || def.data.source !== e.data('source') || def.data.target !== e.data('target')) {
        removed.push(e.id());
        e.remove();
      }
    });

    // 2. Nodes that are gone. Release compound children first: removing a parent removes them.
    cy.nodes().forEach((n) => {
      if (n.removed() || nodeDefs.has(n.id())) return;
      if (n.isParent()) n.children().move({ parent: null });
      removed.push(n.id());
      n.remove();
    });

    // 3. Nodes: update survivors in place, add new ones.
    const survivorIds = new Set();
    for (const [id, def] of nodeDefs) {
      const existing = cy.getElementById(id);
      if (existing.length && existing.isNode()) {
        existing.data(def.data);
        syncDataClasses(existing, def.classes);
        survivorIds.add(id);
      } else {
        if (existing.length) existing.remove();
        cy.add(def);
        added.push(id);
      }
    }

    // 4. Edges: update survivors, add new ones whose endpoints exist, skip the rest.
    const liveEdgeDefs = [];
    for (const [id, def] of edgeDefs) {
      const { source, target } = def.data;
      if (!cy.getElementById(source).length || !cy.getElementById(target).length) {
        skippedEdges.push(id);
        continue;
      }
      liveEdgeDefs.push(def);
      const existing = cy.getElementById(id);
      if (existing.length && existing.isEdge()) {
        existing.data(def.data);
      } else {
        if (existing.length) existing.remove();
        cy.add(def);
        added.push(id);
      }
    }

    // 5. A refresh runs no layout, so new nodes need a seat next to what they connect to.
    const newNodeIds = added.filter((id) => nodeDefs.has(id));
    if (!isInitial && newNodeIds.length) placeNewNodes(cy, newNodeIds, liveEdgeDefs, survivorIds);

    afterMerge?.(cy);
  });

  if (skippedEdges.length) {
    console.warn(
      `[graphMerge] skipped ${skippedEdges.length} edge(s) whose endpoint is not in the graph payload: ` +
        skippedEdges.slice(0, 5).join(', ') + (skippedEdges.length > 5 ? ', …' : '')
    );
  }

  return { isInitial, added, removed, skippedEdges };
}
