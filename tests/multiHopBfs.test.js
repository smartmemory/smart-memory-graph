/**
 * Unit tests for src/core/multiHopBfs.js — pure logic, no Cytoscape.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildAdjacency, bfsExpand, DEFAULT_MAX_NODES_PER_HOP } from '../src/core/multiHopBfs.js';

const triangle = {
  edges: [
    { id: 'e1', source: 'a', target: 'b', label: 'X' },
    { id: 'e2', source: 'b', target: 'c', label: 'X' },
    { id: 'e3', source: 'a', target: 'c', label: 'X' },
  ],
};

function star(centerId, n) {
  const edges = [];
  for (let i = 0; i < n; i++) {
    edges.push({ id: `e${i}`, source: centerId, target: `n${i}`, label: 'L' });
  }
  return { edges };
}

describe('buildAdjacency', () => {
  it('builds undirected adjacency by default', () => {
    const adj = buildAdjacency(triangle.edges);
    expect(adj.get('a').map((x) => x.id).sort()).toEqual(['b', 'c']);
    expect(adj.get('b').map((x) => x.id).sort()).toEqual(['a', 'c']);
    expect(adj.get('c').map((x) => x.id).sort()).toEqual(['a', 'b']);
  });

  it('respects directed=true', () => {
    const adj = buildAdjacency(triangle.edges, { directed: true });
    expect(adj.get('a').map((x) => x.id).sort()).toEqual(['b', 'c']);
    expect(adj.get('c')).toBeUndefined(); // no outgoing edges
  });

  it('skips malformed edges', () => {
    const adj = buildAdjacency([
      { source: 'a' }, // no target
      null,
      { id: 'ok', source: 'a', target: 'b' },
    ]);
    expect(adj.get('a').map((x) => x.id)).toEqual(['b']);
  });
});

describe('bfsExpand', () => {
  it('throws on missing startId', () => {
    expect(() => bfsExpand({ adjacency: new Map() })).toThrow(/startId/);
  });

  it('throws on non-Map adjacency', () => {
    expect(() => bfsExpand({ startId: 'a', adjacency: {} })).toThrow(/Map/);
  });

  it('throws on invalid maxHops', () => {
    expect(() => bfsExpand({ startId: 'a', adjacency: new Map(), maxHops: -1 })).toThrow(/maxHops/);
  });

  it('throws on invalid maxNodesPerHop', () => {
    expect(() => bfsExpand({ startId: 'a', adjacency: new Map(), maxNodesPerHop: 0 })).toThrow(/maxNodesPerHop/);
  });

  it('returns just the start node when maxHops=0', () => {
    const adj = buildAdjacency(triangle.edges);
    const out = bfsExpand({ startId: 'a', adjacency: adj, maxHops: 0 });
    expect([...out.nodes]).toEqual(['a']);
    expect(out.edges).toEqual([]);
    expect(out.hops).toEqual([]);
    expect(out.truncated).toBe(false);
  });

  it('expands one hop', () => {
    const adj = buildAdjacency(triangle.edges);
    const out = bfsExpand({ startId: 'a', adjacency: adj, maxHops: 1 });
    expect([...out.nodes].sort()).toEqual(['a', 'b', 'c']);
    expect(out.hops[0].kept).toBe(2);
    expect(out.hops[0].dropped).toBe(0);
    expect(out.truncated).toBe(false);
  });

  it('caps frontier at maxNodesPerHop and surfaces truncation', () => {
    const { edges } = star('hub', 250);
    const adj = buildAdjacency(edges);
    const warnSpy = vi.fn();
    const out = bfsExpand({
      startId: 'hub',
      adjacency: adj,
      maxHops: 1,
      maxNodesPerHop: 100,
      warn: warnSpy,
    });

    expect(out.hops[0].requested).toBe(250);
    expect(out.hops[0].kept).toBe(100);
    expect(out.hops[0].dropped).toBe(150);
    expect(out.hops[0].truncated).toBe(true);
    expect(out.truncated).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [msg, meta] = warnSpy.mock.calls[0];
    expect(msg).toMatch(/truncated/);
    expect(meta).toMatchObject({
      hop: 1,
      requested: 250,
      kept: 100,
      dropped: 150,
      maxNodesPerHop: 100,
      startId: 'hub',
    });
  });

  it('default cap is 100', () => {
    const { edges } = star('hub', 105);
    const adj = buildAdjacency(edges);
    const out = bfsExpand({
      startId: 'hub',
      adjacency: adj,
      maxHops: 1,
      warn: () => {}, // suppress
    });
    expect(out.hops[0].kept).toBe(DEFAULT_MAX_NODES_PER_HOP);
    expect(out.hops[0].dropped).toBe(5);
  });

  it('stops early when nothing new is discovered', () => {
    const adj = buildAdjacency(triangle.edges);
    const out = bfsExpand({ startId: 'a', adjacency: adj, maxHops: 5 });
    // Triangle: hop 1 finds b,c; hop 2 finds nothing new → break.
    expect(out.hops.length).toBeLessThanOrEqual(2);
    expect([...out.nodes].sort()).toEqual(['a', 'b', 'c']);
  });

  it('does not double-count edges across hops', () => {
    // a-b-c chain plus back-edge a-c
    const edges = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
      { id: 'e3', source: 'a', target: 'c' },
    ];
    const adj = buildAdjacency(edges);
    const out = bfsExpand({ startId: 'a', adjacency: adj, maxHops: 3 });
    const ids = out.edges.map((e) => e.id).sort();
    expect(ids).toEqual(['e1', 'e2', 'e3']);
  });
});
