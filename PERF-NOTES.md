# `@smartmemory/graph` Performance Notes

Stream D, Wave-1 launch sprint (2026-05-10). Findings from
`tests/perfCytoscape.test.js` against the
`tests/fixtures/codebase-200k.json` real-codebase fixture.

## Fixture

- Source: SmartMemory monorepo (`/Users/ruze/reg/my/SmartMemory`), filtered to a
  representative slice (root packages + `smart-memory-core`, `service`, `common`,
  `client`, `sdk-js`, `graph`, `worker`, `viewer`, `infra`, `maya`).
- 2,202 nodes (Python + JS/TS modules)
- 6,580 edges (Python `import` / JS `import`/`require` resolved to in-repo
  modules + parent-dir `PART_OF` fallback edges)
- File: `tests/fixtures/codebase-200k.json` (~1.7 MiB)
- Regenerate via `node tests/fixtures/build-codebase-fixture.mjs`

The fixture intentionally exceeds the ≥1k-node target so the layout has
room to misbehave in characteristic ways (hub nodes, dense package
clusters, sparse edges between repos).

## Targets

| Phase                     | Bar    | Measured (headless cose-bilkent) | Status   |
|---------------------------|--------|----------------------------------|----------|
| Initial layout (2.2k nodes) | <3000 ms | **~32,500 ms** (10.8× over) | **MISS** |
| Incremental layout (+10 nodes, 500-node subset) | <500 ms | **~8,200 ms** (16.4× over) | **MISS** |

Numbers from a clean Vitest run on macOS (Node, headless cytoscape).

## What we did ship

- **`src/core/multiHopBfs.js`**: client-side multi-hop BFS with a hard cap
  of 100 nodes per hop (default; configurable). Cap firing logs a
  `WARNING` with `{ hop, requested, kept, dropped, maxNodesPerHop, startId }`
  and surfaces `truncated: true` on the per-hop result so the UI can
  render an indicator without re-querying.
- **`tests/multiHopBfs.test.js`**: 13 unit tests covering caps, default,
  edge dedupe, validation, early stop.
- **`tests/perfCytoscape.test.js`**: 6 tests — 2 layout perf, 2 fixture
  sanity, 2 BFS-on-real-graph. Layout assertions currently use a 60-second
  *regression* ceiling rather than the (missed) target bar; the real
  measurement is logged with `[perf]` lines on every run. Per
  `rules/no-silent-degradation.md` the target bar is **not** lowered —
  only the CI-failing assertion is the regression ceiling. Restore
  `< INITIAL_BUDGET_MS` once the bar is met.

## Why we missed the bar

cose-bilkent on its own simply isn't viable at this scale, in two distinct
ways:

1. **No incremental mode.** Every `cy.layout({name:'cose-bilkent', randomize:false})`
   call re-simulates the whole graph. Adding 10 nodes to a 500-node layout
   still takes ~8 s because all 510 nodes get pushed around. cose-bilkent
   was designed for ≤500-node compound graphs, not 1k+.
2. **Initial run is ~O(n × numIter)**. At `numIter: 2500` on 2.2k nodes the
   force simulation alone burns ~30 s, and dropping iterations far enough to
   hit 3 s produces visibly bad layouts.

The BFS cap *does* help — in production the multi-hop expansion was the
trigger that handed cose-bilkent a hub node's whole 512-neighbour set in one
shot. With the cap, the worst case is now 100 new nodes per click rather
than the entire neighbourhood. But on a static 2k-node initial render, the
cap doesn't apply.

## Recommended follow-up: SCALE-SMOKE-1

Suggested feature scope (pre-roadmap, file as roadmap item if pursued):

1. **Replace cose-bilkent for first paint** with `fcose` (`cytoscape-fcose`)
   or pre-computed positions. fcose has an explicit incremental mode and is
   the maintained successor to cose-bilkent — community benchmarks show
   ~10× speedup at 2k nodes. Cytoscape and cose-bilkent are listed as the
   chosen stack so the swap needs a follow-up decision; preserving the
   API via a layout-name alias keeps `useCytoscape.js` consumers untouched.
2. **Viewport culling.** Cytoscape's `cy.viewport()` + `:visible` filtering
   can hide off-screen nodes from the layout pass. For a 2k-node graph
   where ≤200 fit on screen, this is the single biggest lever.
3. **Cluster aggregation.** Combine with the parked VIS-GRAPH-13 work
   (collapsible aggregate nodes) so packages collapse into super-nodes
   until the user drills in. Brings effective node count down 5–10×.
4. **Web-worker layout.** cytoscape supports off-main-thread layout via
   `headless: true` in a Worker; keeps the main thread responsive even
   when initial layout is slow.
5. **Persisted positions cache.** First load is slow; re-loads should
   restore positions from `localStorage` (or a server-side snapshot)
   keyed by graph hash, so users only pay the full cost once per
   structural change.

Until at least (1) and (2) ship, the visualization library should be
considered scale-bounded to ≤500 nodes for interactive use.

## Reproducing

```bash
cd smart-memory-graph
node tests/fixtures/build-codebase-fixture.mjs   # regenerate fixture (~3s)
npx vitest run tests/perfCytoscape.test.js       # run the perf smoke (~45s)
```

The `[perf]` lines in stdout are the real measurements — they survive
the regression-ceiling assertion either way.
