import { describe, it, expect } from 'vitest';
import {
  buildReplayPlan,
  buildBfsHopNodeSets,
  HOP_COLORS,
  HOP_DELAY_MS,
  FADE_DURATION_MS,
  SEED_BORDER_WIDTH,
  HOP_BORDER_WIDTH,
} from '../src/core/hopReplayPlan';
import { buildAdjacency, bfsExpand } from '../src/core/multiHopBfs';
import { groupByRetrievalHop } from '../src/core/retrievalHops';

/**
 * GRAPH-MULTIHOP-VIZ-1 G3 — the frame/timing plan extracted out of
 * `useMultiHopReplay` so that BOTH hop groupings (graph distance and retrieval
 * provenance) drive one animation driver.
 *
 * The load-bearing property under test is that extracting it did not move the
 * BFS timeline: the seeded plan must reproduce the shipped schedule exactly
 * (start node at t=0, hop i at i*HOP_DELAY_MS), while the unseeded retrieval
 * plan starts its hop 0 at t=0 instead of leaving a blank leading beat.
 */

describe('buildReplayPlan — retrieval mode (no seed)', () => {
  it('maps hop N to frame N, so hop 0 renders immediately', () => {
    const { frames } = buildReplayPlan([['a', 'b'], ['c'], ['d']]);

    expect(frames.map((f) => f.hop)).toEqual([0, 1, 2]);
    expect(frames.map((f) => f.delayMs)).toEqual([0, HOP_DELAY_MS, 2 * HOP_DELAY_MS]);
    expect(frames[0].nodeIds).toEqual(['a', 'b']);
    expect(frames[0].isSeed).toBe(false);
  });

  it('colours frame N with HOP_COLORS[N]', () => {
    const { frames } = buildReplayPlan([['a'], ['b'], ['c']]);
    expect(frames.map((f) => f.color)).toEqual(HOP_COLORS.slice(0, 3));
  });

  it('cycles the palette past its length rather than emitting undefined', () => {
    const sets = Array.from({ length: HOP_COLORS.length + 2 }, (_, i) => [`n${i}`]);
    const { frames } = buildReplayPlan(sets);

    expect(frames).toHaveLength(HOP_COLORS.length + 2);
    for (const frame of frames) {
      expect(HOP_COLORS).toContain(frame.color);
    }
    expect(frames[HOP_COLORS.length].color).toBe(HOP_COLORS[0]);
  });

  it('gives every frame the ordinary hop border width', () => {
    const { frames } = buildReplayPlan([['a'], ['b']]);
    expect(frames.every((f) => f.borderWidth === HOP_BORDER_WIDTH)).toBe(true);
  });

  it('KEEPS an empty hop as its own frame — hop N must stay hop N', () => {
    // A hop that surfaced nothing new still owns its colour and its beat.
    // Collapsing it would relabel every later hop one number lower.
    const { frames } = buildReplayPlan([['a'], [], ['c']]);

    expect(frames).toHaveLength(3);
    expect(frames[1].nodeIds).toEqual([]);
    expect(frames[2].hop).toBe(2);
    expect(frames[2].delayMs).toBe(2 * HOP_DELAY_MS);
    expect(frames[2].color).toBe(HOP_COLORS[2]);
  });

  it('returns an empty plan for empty or non-array input rather than throwing', () => {
    expect(buildReplayPlan([]).frames).toEqual([]);
    expect(buildReplayPlan([]).totalMs).toBe(0);
    expect(buildReplayPlan(null).frames).toEqual([]);
    expect(buildReplayPlan(undefined).frames).toEqual([]);
  });

  it('drops non-string ids inside a group instead of passing them to Cytoscape', () => {
    const { frames } = buildReplayPlan([['a', null, 42, '', 'b']]);
    expect(frames[0].nodeIds).toEqual(['a', 'b']);
  });

  it('reports totalMs as the last frame plus its fade', () => {
    const { totalMs } = buildReplayPlan([['a'], ['b'], ['c']]);
    expect(totalMs).toBe(2 * HOP_DELAY_MS + FADE_DURATION_MS);
  });
});

describe('buildReplayPlan — BFS mode (seeded)', () => {
  it('reproduces the shipped schedule: seed at t=0, hop i at i*HOP_DELAY_MS', () => {
    const { frames } = buildReplayPlan([['b', 'c'], ['d']], { seedNodeId: 'a' });

    expect(frames).toHaveLength(3);
    expect(frames[0]).toMatchObject({
      hop: 0,
      nodeIds: ['a'],
      delayMs: 0,
      color: HOP_COLORS[0],
      borderWidth: SEED_BORDER_WIDTH,
      isSeed: true,
    });
    expect(frames[1]).toMatchObject({ nodeIds: ['b', 'c'], delayMs: HOP_DELAY_MS, color: HOP_COLORS[1] });
    expect(frames[2]).toMatchObject({ nodeIds: ['d'], delayMs: 2 * HOP_DELAY_MS, color: HOP_COLORS[2] });
  });

  it('marks only the seed frame as the seed', () => {
    const { frames } = buildReplayPlan([['b'], ['c']], { seedNodeId: 'a' });
    expect(frames.filter((f) => f.isSeed)).toHaveLength(1);
    expect(frames.slice(1).every((f) => f.borderWidth === HOP_BORDER_WIDTH)).toBe(true);
  });

  it('shifts the SAME groups one frame later than the unseeded plan', () => {
    const sets = [['b'], ['c']];
    const seeded = buildReplayPlan(sets, { seedNodeId: 'a' });
    const unseeded = buildReplayPlan(sets);

    expect(seeded.frames[1].delayMs - unseeded.frames[0].delayMs).toBe(HOP_DELAY_MS);
    expect(seeded.frames[2].delayMs - unseeded.frames[1].delayMs).toBe(HOP_DELAY_MS);
  });
});

describe('buildBfsHopNodeSets', () => {
  // a — b — d
  //  \
  //   c
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'd' },
    { source: 'a', target: 'c' },
  ];

  const setsFor = (startNodeId, maxHops) => {
    const adjacency = buildAdjacency(edges);
    const result = bfsExpand({ startId: startNodeId, adjacency, maxHops, maxNodesPerHop: 50 });
    return buildBfsHopNodeSets({
      startNodeId,
      adjacency,
      reachable: result.nodes,
      hopCount: result.hops.length,
    });
  };

  it('groups neighbours by graph distance from the start node', () => {
    const { hopNodeSets } = setsFor('a', 3);
    expect(hopNodeSets[0].sort()).toEqual(['b', 'c']);
    expect(hopNodeSets[1]).toEqual(['d']);
  });

  it('never revisits a node already placed at a nearer hop', () => {
    const { hopNodeSets, visited } = setsFor('a', 3);
    const flat = hopNodeSets.flat();
    expect(new Set(flat).size).toBe(flat.length);
    expect(visited.has('a')).toBe(true);
  });

  it('excludes nodes bfsExpand did not deem reachable', () => {
    const adjacency = buildAdjacency(edges);
    const { hopNodeSets } = buildBfsHopNodeSets({
      startNodeId: 'a',
      adjacency,
      reachable: new Set(['b']), // 'c' and 'd' withheld
      hopCount: 2,
    });
    expect(hopNodeSets.flat()).toEqual(['b']);
  });
});

describe('the two grouping sources feed the same plan', () => {
  it('accepts retrieval groups and BFS groups interchangeably', () => {
    const results = [
      { item_id: 'm1', metadata: { hop_index: 0 } },
      { item_id: 'm2', metadata: { hop_index: 1 } },
    ];
    const retrieval = buildReplayPlan(groupByRetrievalHop(results));

    const adjacency = buildAdjacency([{ source: 'm1', target: 'm2' }]);
    const expanded = bfsExpand({ startId: 'm1', adjacency, maxHops: 2, maxNodesPerHop: 50 });
    const bfs = buildReplayPlan(
      buildBfsHopNodeSets({
        startNodeId: 'm1',
        adjacency,
        reachable: expanded.nodes,
        hopCount: expanded.hops.length,
      }).hopNodeSets,
      { seedNodeId: 'm1' },
    );

    // Same shape, different provenance — and the retrieval plan puts m1 and m2
    // one beat apart while the BFS plan agrees only by coincidence of topology.
    expect(retrieval.frames[0].nodeIds).toEqual(['m1']);
    expect(retrieval.frames[1].nodeIds).toEqual(['m2']);
    expect(bfs.frames[0].nodeIds).toEqual(['m1']);
    expect(bfs.frames[1].nodeIds).toEqual(['m2']);
    expect(bfs.frames[0].isSeed).toBe(true);
    expect(retrieval.frames[0].isSeed).toBe(false);
  });
});
