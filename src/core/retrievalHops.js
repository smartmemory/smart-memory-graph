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

/** Read a valid 0-based hop index off a result, or null when absent/malformed. */
function hopOf(result) {
  const hop = result?.metadata?.hop_index;
  return Number.isInteger(hop) && hop >= 0 ? hop : null;
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
 * Only when a follow-up hop actually contributed (`max >= 1`). A set whose
 * maximum hop is 0 means the planner stopped at hop 0: animating it produces a
 * single degenerate frame that reads as a broken animation rather than as a
 * demonstration of chaining. Callers should render everything at once instead.
 *
 * The hop-0-only case is warned about (project no-silent-degradation rule): the
 * results WERE stamped, so multi-hop ran and simply did not chain, and a caller
 * expecting an animation deserves to know why there isn't one. The absent-field
 * case is silent — that is just an ordinary single-hop search, not a degradation.
 *
 * @param {Array<object>} results
 * @returns {boolean}
 */
export function shouldEnterRetrievalReplay(results) {
  const max = maxRetrievalHop(results);
  if (max >= 1) return true;
  if (max === 0) {
    console.warn(
      '[@smartmemory/graph] multi-hop search returned hop-0 results only ' +
        '(the planner did not chain) — rendering all results at once instead of ' +
        'a single-frame hop animation.',
    );
  }
  return false;
}
