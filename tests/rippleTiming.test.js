import { describe, expect, it } from 'vitest';
import { planRipple } from '../src/core/rippleTiming.js';

const node = (id, hop) => ({ id, hop });
const edge = (id, source, target, type = 'depends_on') => ({ id, source, target, type });
const edges = [edge('af', 'a', 'F'), edge('bc', 'b', 'c'), edge('cd', 'c', 'd')];
const data = { nodes: [node('F', 0), node('a', 1), node('b', 1), node('c', 2), node('d', 5),
  node('a', 3), node('F', 4), node('missing', 2)], edges };
const snapshot = { focus: 'F', data, conflicts: [{ id: 'a' }], review: [{ id: 'd', state: 'flagged' }], replaces: ['c'] };
const canvasIds = ['F', 'a', 'b', 'c', 'd', 'unrelated'];
const canvasEdges = [edge('canvas-af', 'a', 'F', 'DEPENDS_ON'), ...edges.slice(1), edge('extra', 'a', 'unrelated'),
  edge('other-kind', 'a', 'F', 'mentions')];

describe('decision ripple on the existing canvas', () => {
  it('lights the focus once, batches equal hops, and preserves gaps and effect states', () => {
    const { events, offScreen } = planRipple(snapshot, canvasIds, canvasEdges);
    expect(events.filter(e => e.element === 'node').map(e => [e.id, e.at, e.kind])).toEqual([
      ['F', 0, 'focus'], ['a', 450, 'conflict'], ['b', 450, 'affected'],
      ['c', 900, 'replaced'], ['d', 2250, 'review'],
    ]);
    expect(offScreen).toBe(1);
  });

  it('lights only matching canvas edges shortly before the farther endpoint in either direction', () => {
    const { events } = planRipple(snapshot, canvasIds, canvasEdges);
    const arrivals = [450, 900, 2250];
    const links = events.filter(e => e.element === 'edge');
    expect(links.map(e => e.id)).toEqual(['canvas-af', 'bc', 'cd']);
    links.forEach((e, index) => {
      expect(e.at).toBeLessThan(arrivals[index]);
      expect(e.at).toBeGreaterThan(arrivals[index] - 225);
    });
  });

  it('shortens the step for arbitrarily long chains and includes reported overflow', () => {
    const far = { ...snapshot, overflow: [{ count: 4 }], data: { ...data, nodes: [...data.nodes, node('far', 1000)] } };
    const { events, offScreen } = planRipple(far, [...canvasIds, 'far'], canvasEdges);
    expect(events.at(-1)).toMatchObject({ id: 'far', at: 4000 });
    expect(events.find(e => e.id === 'a').at).toBe(4);
    expect(offScreen).toBe(5);
  });

  it('delivers every visible item at time zero with reduced motion', () => {
    const { events } = planRipple(snapshot, canvasIds, canvasEdges, true);
    expect(events.map(e => e.id).sort()).toEqual(['F', 'a', 'b', 'c', 'd', 'canvas-af', 'bc', 'cd'].sort());
    expect(events.every(e => e.at === 0)).toBe(true);
  });
});
