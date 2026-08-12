/**
 * Group search results by the RETRIEVAL hop that surfaced them
 * (GRAPH-MULTIHOP-VIZ-1).
 *
 * This is the sibling of `multiHopBfs.js`, and the distinction between them is
 * the whole point of this module:
 *
 *   • `multiHopBfs` groups by GRAPH DISTANCE — how many edges a node sits from
 *     a clicked start node in the loaded subgraph. It answers "what is near
 *     this thing?"
 *   • This module groups by RETRIEVAL PROVENANCE — which hop of a multi-hop
 *     search first surfaced each result, read from `metadata.hop_index` as
 *     stamped by `MultiHopSearch.execute()` in core. It answers "how did the
 *     search actually get here?"
 *
 * They disagree in practice: a result first surfaced at retrieval hop 2 may sit
 * one edge away in the graph, or be unconnected in the loaded subgraph
 * entirely. Only the retrieval grouping demonstrates multi-hop retrieval, so
 * the two are kept as separate inputs to the same animation rather than being
 * conflated.
 *
 * Pure and dependency-free (no React, no Cytoscape) so it unit-tests directly.
 * Contract:
 * smart-memory-docs/docs/features/GRAPH-MULTIHOP-VIZ-1/hop-index-contract.json
 */

/** Read a usable node identifier off a result, or null. */
function resultId(result) {
  const id = result?.item_id ?? result?.id;
  return typeof id === 'string' && id ? id : null;
}

/**
 * Upper bound on a hop index we will honour.
 *
 * Core's `max_hops` is a small integer (the service default is 3), so anything past
 * this is stale or malformed rather than a real traversal depth. The bound is load
 * bearing, not defensive dressing: `groupByRetrievalHop` allocates a dense array of
 * `max + 1` slots, so an unbounded value turns one bad row into a `RangeError:
 * Invalid array length` (at 2**32) or a multi-gigabyte allocation that freezes the
 * page. Core deliberately preserves a pre-existing `hop_index`, so a value written by
 * an older build can reach the client and must not be trusted blindly.
 */
export const MAX_HONOURED_HOP = 64;

/** Read a valid 0-based hop index off a result, or null when absent/malformed/absurd. */
function hopOf(result) {
  const hop = result?.metadata?.hop_index;
  if (!Number.isInteger(hop) || hop < 0) return null;
  if (hop > MAX_HONOURED_HOP) {
    console.warn(
      `[@smartmemory/graph] ignoring implausible hop_index=${hop} ` +
        `(max honoured ${MAX_HONOURED_HOP}) — treating the result as unstamped.`,
    );
    return null;
  }
  return hop;
}

/**
 * Highest retrieval hop present in a result set.
 *
 * @param {Array<object>} results
 * @returns {number} the max hop_index, or -1 when the field is absent entirely
 *   (an ordinary single-hop search) or the input is empty/nullish.
 */
export function maxRetrievalHop(results) {
  if (!Array.isArray(results)) return -1;
  let max = -1;
  for (const result of results) {
    const hop = hopOf(result);
    if (hop !== null && hop > max) max = hop;
  }
  return max;
}

/**
 * Group result ids by hop, as an array indexed BY HOP NUMBER.
 *
 * The array index is the hop number, not a dense sequence: a hop that surfaced
 * no new results yields an empty slot rather than collapsing, so consumers can
 * colour and time hop N consistently whether or not hop N-1 contributed. That
 * matters because the animation's colour is chosen by index.
 *
 * Results with no `hop_index` are skipped rather than bucketed into hop 0 —
 * bucketing an unstamped result at 0 would silently assert it was directly
 * retrieved, which is exactly the claim this feature exists to make honestly.
 *
 * @param {Array<object>} results — search results carrying `metadata.hop_index`
 * @returns {Array<Array<string>>} index = hop number, value = ordered ids
 */
export function groupByRetrievalHop(results) {
  if (!Array.isArray(results) || results.length === 0) return [];

  const max = maxRetrievalHop(results);
  if (max < 0) return [];

  const groups = Array.from({ length: max + 1 }, () => []);
  const placed = new Map(); // id -> hop it was placed in (earliest wins)

  for (const result of results) {
    const hop = hopOf(result);
    if (hop === null) continue;
    const id = resultId(result);
    if (!id) continue;

    const existing = placed.get(id);
    if (existing !== undefined) {
      if (existing <= hop) continue; // already placed at an earlier-or-equal hop
      // Later duplicate is earlier than the one we kept — move it.
      const prev = groups[existing];
      const at = prev.indexOf(id);
      if (at !== -1) prev.splice(at, 1);
    }
    groups[hop].push(id);
    placed.set(id, hop);
  }

  return groups;
}

/**
 * Should the canvas enter retrieval-hop replay for this result set?
 *
 * Only when some follow-up hop still has content AFTER earliest-hop dedup. Two
 * distinct sets fail that test and both would animate blank or single frames:
 * a planner that stopped at hop 0, and a set whose only later-hop entries are
 * duplicates of hop-0 ids (raw max says 2, every follow-up group is empty).
 * Callers should render everything at once instead.
 *
 * Refusal warns whenever results were stamped at all (project no-silent-degradation
 * rule): multi-hop ran and simply did not produce animatable chaining, and a caller
 * expecting an animation deserves to know why there isn't one. An entirely absent
 * `hop_index` is silent — that is an ordinary single-hop search, not a degradation.
 *
 * @param {Array<object>} results
 * @returns {boolean}
 */
export function shouldEnterRetrievalReplay(results) {
  // Decide on the GROUPS, not the raw max. Earliest-hop dedup can empty every
  // follow-up group while leaving a high raw max: `[a@hop0, a@hop2]` has max 2 but
  // groups to [['a'], [], []], which would replay two blank frames — the same
  // degenerate animation the hop-0-only rule exists to refuse.
  const groups = groupByRetrievalHop(results);
  if (groups.some((group, hop) => hop >= 1 && group.length > 0)) return true;

  if (groups.length > 0) {
    const reason =
      groups.length === 1
        ? 'the planner did not chain'
        : 'every follow-up hop held only duplicates of earlier results';
    console.warn(
      `[@smartmemory/graph] multi-hop search produced no animatable chaining (${reason}) — ` +
        'rendering all results at once instead of a degenerate hop animation.',
    );
  }
  return false;
}
