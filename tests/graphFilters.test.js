/**
 * UI-REFRESH-1 — a type that first appears after the user touched a filter must not vanish.
 *
 * Filter state used to snapshot "the types that were active" at the first toggle. A type that
 * arrived later (a refresh brings the first decision, a new entity type, a new relation) was not
 * in the snapshot, so its nodes were filtered out (`dimmed` is `display: none`): "expected graph
 * nodes missing after update". Turning one type off now records only what was turned off.
 * "Deselect all" still means "show only what I pick", so a new type stays hidden after it.
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installDom } from './helpers/dom.js';
import { useGraphFilters } from '../src/hooks/useGraphFilters.js';

let uninstall;
let root;
let latest;

function Harness({ nodes, edges }) {
  latest = useGraphFilters(nodes, edges);
  return null;
}

function render(nodes, edges) {
  act(() => root.render(createElement(Harness, { nodes, edges })));
}

beforeEach(() => {
  uninstall = installDom();
  root = createRoot(document.getElementById('root'));
});
afterEach(() => {
  act(() => root.unmount());
  uninstall();
});

const mem = (id, type) => ({ id, type, category: 'memory', label: id });
const ent = (id, type) => ({ id, type, category: 'entity', label: id });
const rel = (source, target, type) => ({ id: `${source}->${target}:${type}`, source, target, type });

// One row per filter family. `before` is the graph the user filtered; `after(t)` adds an
// element of type `t` the user has never seen; `sees(f, t)` reads whether type `t` is shown.
const ROWS = [
  {
    family: 'memory types',
    before: { nodes: [mem('m1', 'semantic'), mem('m2', 'episodic')], edges: [] },
    off: 'episodic',
    toggle: (f, t) => f.toggleMemoryType(t),
    deselectAll: (f) => f.deselectAllMemoryTypes(),
    after: (t) => ({ nodes: [mem('m1', 'semantic'), mem('m2', 'episodic'), mem(`new-${t}`, t)], edges: [] }),
    sees: (f, t) => f.visibleNodeIds.has(`new-${t}`),
    seesOff: (f) => f.visibleNodeIds.has('m2'),
  },
  {
    family: 'entity types',
    before: { nodes: [ent('e1', 'person'), ent('e2', 'place')], edges: [] },
    off: 'place',
    toggle: (f, t) => f.toggleEntityType(t),
    deselectAll: (f) => f.deselectAllEntityTypes(),
    after: (t) => ({ nodes: [ent('e1', 'person'), ent('e2', 'place'), ent(`new-${t}`, t)], edges: [] }),
    sees: (f, t) => f.visibleNodeIds.has(`new-${t}`),
    seesOff: (f) => f.visibleNodeIds.has('e2'),
  },
  {
    family: 'relation types',
    before: { nodes: [mem('a', 'semantic'), mem('b', 'semantic')], edges: [rel('a', 'b', 'CITES'), rel('b', 'a', 'MENTIONS')] },
    off: 'MENTIONS',
    toggle: (f, t) => f.toggleRelationType(t),
    deselectAll: (f) => f.deselectAllRelationTypes(),
    after: (t) => ({
      nodes: [mem('a', 'semantic'), mem('b', 'semantic')],
      edges: [rel('a', 'b', 'CITES'), rel('b', 'a', 'MENTIONS'), rel('a', 'b', t)],
    }),
    sees: (f, t) => f.activeEdgeTypes.has(t),
    seesOff: (f) => f.activeEdgeTypes.has('MENTIONS'),
  },
];

describe('useGraphFilters with types that arrive after a toggle', () => {
  it.each(ROWS)('$family: a new type stays visible after one type is turned off', (row) => {
    render(row.before.nodes, row.before.edges);
    act(() => row.toggle(latest, row.off));

    const next = row.after('fresh');
    render(next.nodes, next.edges);
    expect(row.sees(latest, 'fresh')).toBe(true);
    expect(row.seesOff(latest)).toBe(false);

    // "Deselect all", then pick one: the user asked to see only what they pick, so a newer type
    // stays hidden there.
    act(() => row.deselectAll(latest));
    act(() => row.toggle(latest, 'fresh'));
    const later = row.after('later');
    render([...later.nodes, ...next.nodes.filter((n) => n.id === 'new-fresh')], [...later.edges, ...next.edges]);
    expect(row.sees(latest, 'fresh')).toBe(true);
    expect(row.sees(latest, 'later')).toBe(false);
  });
});
