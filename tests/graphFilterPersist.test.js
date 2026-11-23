/**
 * UI-GRAPH-FILTER-PERSIST-1: the left bar's type choices survive a refresh (a remount of the hook
 * over the same localStorage). Behaviours E1-E9 from units/UI-GRAPH-FILTER-PERSIST-1/expected.md.
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDom } from './helpers/dom.js';
import { useGraphFilters } from '../src/hooks/useGraphFilters.js';

let uninstall;
let root;
let latest;
let warn;

function Harness({ nodes, edges, wk }) {
  latest = useGraphFilters(nodes, edges, wk);
  return null;
}
const mount = (data, wk) => {
  root = createRoot(document.getElementById('root'));
  act(() => root.render(createElement(Harness, { ...data, wk })));
};
const rerender = (data, wk) => act(() => root.render(createElement(Harness, { ...data, wk })));
// A refresh: tear the hook down and mount it again; localStorage stays.
const refresh = (data, wk) => { act(() => root.unmount()); mount(data, wk); };

const n = (id, category, type) => ({ id, type, category, label: id });
const edge = (s, t, type) => ({ id: `${s}${t}${type}`, source: s, target: t, type });
const DATA = {
  nodes: [n('m1', 'memory', 'semantic'), n('m2', 'memory', 'episodic'), n('m3', 'memory', 'working'),
    n('e1', 'entity', 'person'), n('e2', 'entity', 'place')],
  edges: [edge('e1', 'e2', 'AT'), edge('m1', 'e1', 'MENTIONS')],
};
const act_ = (f) => ({ m: [...f.activeMemoryTypes].sort(), e: [...f.activeEntityTypes].sort(), r: [...f.activeEdgeTypes].sort() });

beforeEach(() => {
  uninstall = installDom();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  act(() => root.unmount());
  warn.mockRestore();
  uninstall();
});

describe('left-bar type filter persistence', () => {
  it('E1 none stays none, per family', () => {
    mount(DATA, 'ws');
    act(() => latest.deselectAllMemoryTypes());
    act(() => latest.deselectAllEntityTypes());
    act(() => latest.deselectAllRelationTypes());
    refresh(DATA, 'ws');
    expect(act_(latest)).toEqual({ m: [], e: [], r: [] });
  });

  it('E2 a specific set stays that set', () => {
    mount(DATA, 'ws');
    act(() => latest.deselectAllMemoryTypes());
    act(() => latest.toggleMemoryType('semantic'));
    refresh(DATA, 'ws');
    expect(act_(latest).m).toEqual(['semantic']);
    expect(act_(latest).e).toEqual(['person', 'place']);
  });

  it('E3 all stays all and stores nothing', () => {
    mount(DATA, 'ws');
    act(() => latest.deselectAllEntityTypes());
    act(() => latest.selectAllEntityTypes());
    expect(localStorage.getItem('graph:filters:ws')).toBeNull();
    refresh(DATA, 'ws');
    expect(act_(latest).e).toEqual(['person', 'place']);
  });

  it('E4 one type turned off stays off', () => {
    mount(DATA, 'ws');
    act(() => latest.toggleRelationType('AT'));
    refresh(DATA, 'ws');
    expect(act_(latest).r).toEqual(['MENTIONS']);
  });

  it('E5 a type first seen after the save shows checked (specific set and hidden set)', () => {
    mount(DATA, 'ws');
    act(() => latest.deselectAllMemoryTypes());
    act(() => latest.toggleMemoryType('semantic'));
    act(() => latest.toggleEntityType('place'));
    const more = { nodes: [...DATA.nodes, n('m4', 'memory', 'decision'), n('e3', 'entity', 'org')], edges: DATA.edges };
    refresh(more, 'ws');
    expect(act_(latest).m).toEqual(['decision', 'semantic']);
    expect(act_(latest).e).toEqual(['org', 'person']);
  });

  it('E6 a saved type that no longer exists is ignored', () => {
    mount(DATA, 'ws');
    act(() => latest.toggleEntityType('place'));
    const fewer = { nodes: DATA.nodes.filter((x) => x.type !== 'place'), edges: [] };
    refresh(fewer, 'ws');
    expect(act_(latest).e).toEqual(['person']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('E7 workspace A does not show in workspace B, and switching reloads', () => {
    mount(DATA, 'A');
    act(() => latest.deselectAllMemoryTypes());
    refresh(DATA, 'B');
    expect(act_(latest).m).toEqual(['episodic', 'semantic', 'working']);
    act(() => latest.toggleEntityType('person'));
    rerender(DATA, 'A');
    expect(act_(latest)).toEqual({ m: [], e: ['person', 'place'], r: ['AT', 'MENTIONS'] });
    rerender(DATA, 'B');
    expect(act_(latest).e).toEqual(['place']);
    // no workspace id -> default key
    rerender(DATA, undefined);
    act(() => latest.toggleEntityType('place'));
    expect(localStorage.getItem('graph:filters:default')).not.toBeNull();
  });

  it('E8 corrupt saved values fall back with one WARNING', () => {
    for (const bad of ['{not json', JSON.stringify({ v: 2, memory: { none: true } }), JSON.stringify({ v: 1, memory: { hidden: 'x' } })]) {
      warn.mockClear();
      localStorage.setItem('graph:filters:ws', bad);
      mount(DATA, 'ws');
      expect(act_(latest).m).toEqual(['episodic', 'semantic', 'working']);
      expect(warn).toHaveBeenCalledTimes(1);
      act(() => root.unmount());
    }
    root = createRoot(document.getElementById('root'));
  });

  it('E9 unavailable storage does not break the panel', () => {
    vi.spyOn(Object.getPrototypeOf(localStorage), 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Object.getPrototypeOf(localStorage), 'setItem').mockImplementation(() => { throw new Error('denied'); });
    mount(DATA, 'ws');
    // one WARNING per read site: the type filters and the cascade-edge checkbox
    expect(warn).toHaveBeenCalledTimes(2);
    act(() => latest.toggleMemoryType('working'));
    expect(act_(latest).m).toEqual(['episodic', 'semantic']);
    expect(warn).toHaveBeenCalledTimes(3);
  });
});
