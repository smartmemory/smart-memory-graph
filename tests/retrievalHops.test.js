import { describe, it, expect, vi } from 'vitest';
import {
  groupByRetrievalHop,
  maxRetrievalHop,
  shouldEnterRetrievalReplay,
} from '../src/core/retrievalHops';

/**
 * GRAPH-MULTIHOP-VIZ-1 — grouping search results by the retrieval hop that
 * surfaced them. Contract:
 * smart-memory-docs/docs/features/GRAPH-MULTIHOP-VIZ-1/hop-index-contract.json
 *
 * Retrieval hop is NOT graph distance: these tests deliberately never build an
 * adjacency view. Grouping reads `metadata.hop_index` and nothing else.
 */

const r = (id, hop) => ({
  item_id: id,
  metadata: hop === undefined ? {} : { hop_index: hop },
});

describe('maxRetrievalHop', () => {
  it('returns -1 for an empty result set', () => {
    expect(maxRetrievalHop([])).toBe(-1);
  });

  it('returns -1 when no result carries hop_index (single-hop search)', () => {
    expect(maxRetrievalHop([r('a'), r('b')])).toBe(-1);
  });

  it('returns -1 for null/undefined input rather than throwing', () => {
    expect(maxRetrievalHop(null)).toBe(-1);
    expect(maxRetrievalHop(undefined)).toBe(-1);
  });

  it('returns the highest hop present', () => {
    expect(maxRetrievalHop([r('a', 0), r('b', 2), r('c', 1)])).toBe(2);
  });

  it('returns 0 when the planner stopped at hop 0', () => {
    expect(maxRetrievalHop([r('a', 0), r('b', 0)])).toBe(0);
  });

  it('ignores non-integer and negative hop_index values', () => {
    expect(maxRetrievalHop([r('a', 'two'), r('b', -1), r('c', 1)])).toBe(1);
  });
});

describe('groupByRetrievalHop', () => {
  it('indexes groups by hop number', () => {
    const groups = groupByRetrievalHop([r('a', 0), r('b', 1), r('c', 1), r('d', 2)]);
    expect(groups).toEqual([['a'], ['b', 'c'], ['d']]);
  });

  it('preserves result order within a hop', () => {
    const groups = groupByRetrievalHop([r('z', 0), r('y', 0), r('x', 0)]);
    expect(groups[0]).toEqual(['z', 'y', 'x']);
  });

  it('emits an empty array for a hop that surfaced nothing, keeping indices aligned', () => {
    // hop 1 contributed no NEW results; hop 2 did. Index must still mean hop number.
    const groups = groupByRetrievalHop([r('a', 0), r('c', 2)]);
    expect(groups).toEqual([['a'], [], ['c']]);
  });

  it('skips results with no hop_index rather than bucketing them at 0', () => {
    const groups = groupByRetrievalHop([r('a', 0), r('nohop'), r('b', 1)]);
    expect(groups).toEqual([['a'], ['b']]);
  });

  it('returns an empty array for empty or nullish input', () => {
    expect(groupByRetrievalHop([])).toEqual([]);
    expect(groupByRetrievalHop(null)).toEqual([]);
  });

  it('accepts id or item_id as the node identifier', () => {
    const groups = groupByRetrievalHop([
      { id: 'from_id', metadata: { hop_index: 0 } },
      { item_id: 'from_item_id', metadata: { hop_index: 1 } },
    ]);
    expect(groups).toEqual([['from_id'], ['from_item_id']]);
  });

  it('drops a result carrying no usable identifier', () => {
    const groups = groupByRetrievalHop([r('a', 0), { metadata: { hop_index: 0 } }]);
    expect(groups).toEqual([['a']]);
  });

  it('de-duplicates an id repeated within the same hop', () => {
    const groups = groupByRetrievalHop([r('a', 0), r('a', 0)]);
    expect(groups).toEqual([['a']]);
  });

  it('keeps the earliest hop when the same id appears in two hops', () => {
    // Core stamps first-appearance-wins, but a caller may merge result sets by hand.
    const groups = groupByRetrievalHop([r('a', 0), r('a', 2)]);
    expect(groups).toEqual([['a'], [], []]);
  });

  it('keeps the earliest hop when the LATER hop is seen first (out-of-order input)', () => {
    // Exercises the move/splice branch: a naive "first input occurrence wins" would
    // leave 'a' at hop 2. Results are not guaranteed to arrive in hop order.
    const groups = groupByRetrievalHop([r('a', 2), r('a', 0)]);
    expect(groups).toEqual([['a'], [], []]);
  });

  it('moves only the duplicate, preserving the order of other ids in both groups', () => {
    const groups = groupByRetrievalHop([r('x', 2), r('a', 2), r('y', 2), r('a', 0), r('b', 0)]);
    expect(groups[0]).toEqual(['a', 'b']);
    expect(groups[2]).toEqual(['x', 'y']);
  });

  it('refuses an absurd hop_index instead of allocating a huge array', () => {
    // Core deliberately preserves a pre-existing hop_index, so a stale or malformed
    // value can reach the client. Array.from({length: 2**32}) throws RangeError.
    expect(() => groupByRetrievalHop([r('a', 0), r('boom', 4294967295)])).not.toThrow();
    const groups = groupByRetrievalHop([r('a', 0), r('boom', 4294967295)]);
    expect(groups).toEqual([['a']]);
  });
});

describe('shouldEnterRetrievalReplay', () => {
  it('is true when a follow-up hop contributed results', () => {
    expect(shouldEnterRetrievalReplay([r('a', 0), r('b', 1)])).toBe(true);
  });

  it('is false for a hop-0-only set, which would animate one degenerate frame', () => {
    expect(shouldEnterRetrievalReplay([r('a', 0), r('b', 0)])).toBe(false);
  });

  it('is false when hop_index is absent entirely', () => {
    expect(shouldEnterRetrievalReplay([r('a'), r('b')])).toBe(false);
  });

  it('is false when dedup collapses every follow-up hop to empty', () => {
    // Raw max is 2, but earliest-hop dedup leaves [['a'], [], []] — every follow-up
    // frame is empty, so replay would show two blank hops. Must refuse.
    expect(shouldEnterRetrievalReplay([r('a', 0), r('a', 2)])).toBe(false);
  });

  it('is true when a follow-up hop still has content after dedup', () => {
    expect(shouldEnterRetrievalReplay([r('a', 0), r('a', 2), r('b', 1)])).toBe(true);
  });

  it('refuses an absurd hop_index rather than entering replay on it', () => {
    expect(shouldEnterRetrievalReplay([r('a', 0), r('boom', 4294967295)])).toBe(false);
  });

  it('warns when it refuses a stamped-but-degenerate set (no silent degradation)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    shouldEnterRetrievalReplay([r('a', 0), r('b', 0)]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not warn when hop_index is simply absent (an ordinary single-hop search)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    shouldEnterRetrievalReplay([r('a'), r('b')]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
