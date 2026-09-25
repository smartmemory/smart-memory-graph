# Changelog

## Unreleased

### Fixed (2026-09-25) — UI-IDLE-DISCONNECT-1

- Added injectable fetchFn transport and GraphExplorer auth/workspaceId props. Streams now use SDK session recovery, backoff, cursor resume, visibility/online recovery, replay deduplication, and scoped cleanup. Existing static-token/local adapters remain supported.

### Removed (2026-09-04) — PLAT-PUSH-SSE-1

- **`GraphExplorer`'s `wsUrl` prop.** It was declared and never read: the component moved
  to Server-Sent Events some time ago and the WebSocket endpoints it named no longer exist.
  Passing it was a no-op, which made hosts believe they had configured streaming when they
  had not. `wsToken` survives as a deprecated alias for `sseToken` for the one caller that
  still passes it (smart-memory-studio); pass `sseToken` instead.

### Added (2026-09-04) — DIST-LITE-9 Ask Panel

- **`AskPanel`** — a question box over `POST /memory/ask`. Renders the answer, an optional
  reasoning disclosure, the memories it was grounded in, and the relations it used. Needs
  only an `adapter` prop, has no viewer-specific imports and no dependency on
  `GraphExplorer`: a host places the two side by side and connects them through `onSelect`.
- **`AskResult`** — the pure presentational half, exported so a host can drive its own
  state. `AskPanel` is a thin container over it.
- **`onSelect(id, meta)`** — evidence rows pass `(item_id, {kind:'evidence', item})`;
  relation rows pass `(edgeId, {kind:'relation', relation, sourceId, targetId})` where
  `edgeId` is `${source_id}->${target_id}:${type}`, the same id `normalizeAPIResponse`
  builds. A relation the server sent without node ids renders but is not clickable —
  guessing an id would silently select the wrong edge.
- **`ask(question, {limit, reasoning})`** on `createFetchAdapter` and `createSDKAdapter`.
  The SDK adapter falls back to raw HTTP when the installed SDK predates `memories.ask`.
- **`core/askState.js`** exported from the index: `askReducer`, `runAsk`,
  `normalizeAskResponse`, `relationEdgeId`, `evidenceSelection`, `relationSelection` and
  the status constants, so a host can build its own ask UI over the same contract.
- Ask-panel styles in `graph.css`, self-contained so a host needs no Tailwind for it.

### Fixed (2026-09-04)

- **Component tests could not render.** vitest's esbuild transform defaulted to the classic
  JSX runtime, so any test that rendered a component died on `React is not defined` while
  every consuming app built fine. `vitest.config.js` now sets `jsx: 'automatic'`.

## 0.2.13

### Added (2026-08-13) — GRAPH-MULTIHOP-VIZ-1 G3

- **`hopReplayPlan.js` (new, pure).** The frame/timing plan `useMultiHopReplay` used to derive
  internally, extracted so BOTH hop groupings drive one animation driver: `buildReplayPlan`
  (frames, colours, delays), `buildBfsHopNodeSets` (the BFS derivation lifted out of the hook),
  and the exported `HOP_COLORS` / `HOP_DELAY_MS`. The hook now holds no grouping logic at all.
  BFS timing is unchanged and pinned by test: a seeded plan reproduces the shipped schedule
  exactly (start node at t=0, hop *i* at *i*x700ms). An unseeded retrieval plan renders hop 0 at
  t=0 rather than leaving a blank leading beat.
- **`useMultiHopReplay().startRetrievalReplay(hopNodeSets)`.** Second entry point taking
  precomputed groups (from `groupByRetrievalHop`) instead of BFS. Also returns `replayMode`
  (`'bfs' | 'retrieval'`) and `frameCount`, and now clears its timers on unmount — a replay
  started just before a route change kept firing into a destroyed canvas.
- **`assignBridgesToHops(hopGroups, bridges)`** in `retrievalHops.js`. Places bridge nodes
  (entities shared by several results) on the hop timeline at the earliest hop of any result they
  touch. Multi-hop chains THROUGH entities, which are never search results, so without this the
  hops render as disconnected clusters. A bridge touching no grouped result is dropped, never
  defaulted into hop 0 — the same refusal unstamped results get.
- **`GraphExplorer` props `hopGroups` + `autoReplayKey`.** Drive a retrieval-hop replay from a
  caller-supplied grouping; a changed key re-plays. Both are grouping-source-agnostic — the
  component never learns what a search result is. No new DATA prop was needed: controlled mode
  (`data`, no `adapter`) already existed.

### Fixed (2026-08-13, incl. Codex adversarial-review findings) — mostly pre-existing in `useMultiHopReplay`

- **`stopReplay` threw and left the canvas permanently dimmed.** It animated
  `{'border-color': null}`; Cytoscape lowercases every animated value as a colour string, so the
  restore aborted with `Cannot read properties of null (reading 'toLowerCase')` and every element
  stayed at opacity 0.08 with no way back. Latent before this release (only a user click reached
  it), immediate once autoplay did. Colours are now removed via `removeStyle`, never animated to
  null.
- **Edges lit before their endpoints.** The `visited` set was fully populated before the first
  frame fired, so an edge into a hop-3 node drew bright at hop 1 against a still-dimmed endpoint.
  The code contradicted its own comment ("connecting to previously-revealed nodes"); the comment
  was right. Reveal is now progressive, and edges within a single hop are drawn too.
- **The hop indicator showed at most 4 dots and mislabelled retrieval hops.** Dot count came from
  `HOP_COLORS.length` via `hopStats`, so a 6-hop replay lost two beats; it now comes from
  `frameCount`. Frame 0 is labelled `start` only in BFS mode — in retrieval mode it is `hop 0`,
  the original query's own result set.

- **`removeStyle` does not cancel an in-flight Cytoscape animation.** An element stopped
  mid-reveal simply finished and reapplied its hop colour *after* the restore had run, so the
  `border-color` fix above was necessary but not sufficient. `cy.elements().stop(true)` now
  precedes both a reset and a re-run. Reset also clears every replay-owned bypass (`opacity`,
  `border-width`, `border-color`, `line-color`, edge `width`) once the fade completes, instead of
  leaving the canvas on animated values the stylesheet no longer controls.
- **A running replay was not cancelled when the canvas data was replaced.** New `cancelReplay()`
  (abandon without the restore animation, for when the animated elements are about to be replaced),
  fired by `GraphExplorer` on data identity change. Without it, an earlier run's timers kept driving
  the hop indicator and recolouring ids shared with the new data — and if the new data never started
  a replay, the old one ran to completion over it.
- **`assignBridgesToHops` could justify a bridge with another bridge.** Assigned bridges were
  written into the same map used as provenance evidence, so a bridge attached only to *another*
  bridge silently inherited a hop, contradicting the function's stated rule. Evidence is now an
  immutable result-only map, input groups are deduped by earliest hop while cloning, and dropped
  orphan/malformed bridges WARN rather than vanishing.

Neither of the first two was reachable by unit test (this package's vitest environment is `node`,
with no DOM and no Cytoscape canvas); both were found by mounting the real component against a
real captured multi-hop payload in a browser. The bridge-provenance regression is mutation-tested:
reintroducing it fails exactly two of the new tests. 28 new tests, 353 across the package.

## 0.2.12

### Fixed (2026-08-12, Codex adversarial-review findings on 0.2.11) — GRAPH-MULTIHOP-VIZ-1

- **`shouldEnterRetrievalReplay` decided on the raw max hop, not the deduped groups.**
  `[a@hop0, a@hop2]` has a raw max of 2, but earliest-hop dedup groups it to
  `[['a'], [], []]` — every follow-up frame empty. Replay was entered and played two
  blank hops, the same degenerate animation the hop-0-only rule exists to refuse. It now
  decides on the grouping (does any hop >= 1 still hold results?), and its warning
  distinguishes "the planner did not chain" from "every follow-up hop held only
  duplicates".
- **An implausible `hop_index` could crash or freeze the page.** `groupByRetrievalHop`
  allocates a dense `max + 1` array, so a single row carrying `hop_index: 4294967295`
  threw `RangeError: Invalid array length`, and smaller values forced huge allocations.
  This is reachable because core deliberately preserves a pre-existing `hop_index`, so a
  stale value written by an older build can reach the client. Values above the new
  exported `MAX_HONOURED_HOP` (64) are now treated as unstamped, with a WARNING.

New tests cover out-of-order duplicates (`[a@2, a@0]`, which exercises the move/splice
branch the original suite never reached), duplicate-move ordering, the dedup-collapse
replay refusal, and the absurd-hop guard. 26 tests here, 325 across the package.

## 0.2.11

### Added (2026-08-12) — retrieval-hop grouping (GRAPH-MULTIHOP-VIZ-1)

- **`src/core/retrievalHops.js`**: `groupByRetrievalHop`, `maxRetrievalHop`,
  `shouldEnterRetrievalReplay`. Groups search results by the hop that surfaced them,
  read from `metadata.hop_index` (stamped by core's `MultiHopSearch.execute()`).

  This is deliberately a **sibling of, not a replacement for, `multiHopBfs.js`**. That
  module groups by graph distance from a clicked node ("what is near this?"); this one
  groups by retrieval provenance ("how did the search get here?"). They disagree — a
  result first surfaced at retrieval hop 2 may sit one edge away in the graph, or be
  unconnected in the loaded subgraph. Only the retrieval grouping demonstrates
  multi-hop retrieval, so both feed the same animation as separate inputs.

  Two behaviours are contract, not incidental: the returned array is indexed **by hop
  number** (a hop that surfaced nothing leaves an empty slot, so hop N keeps its colour
  and timing regardless of hop N-1), and `shouldEnterRetrievalReplay` refuses a
  hop-0-only set — animating one group produces a single degenerate frame that reads as
  a bug. The refusal warns, since the results *were* stamped and the caller expecting an
  animation deserves to know why there isn't one; an absent `hop_index` stays silent
  because that is just an ordinary single-hop search.

  Results with no `hop_index` are skipped rather than bucketed into hop 0 — bucketing
  would silently assert they were directly retrieved.

  20 tests. No existing behaviour changed; `useMultiHopReplay`'s BFS path is untouched.

## 0.2.10

### Fixed (2026-07-15, adversarial-review finding on 0.2.9)

- **Per-event re-render amplification**: the 0.2.9 kind-agnostic log enqueued a React state
  update for every staged event in every `usePipelineDag` instance — including `PipelineDag`'s
  internal instance, which discards `eventsByStage`, and including `graph.node`/`graph.edge`
  drip events that arrive in the thousands. New `collectEvents: false` option (used by
  `PipelineDag`) skips accumulation entirely, and `shouldLogEvent` excludes the drip kinds
  (`LOG_EXCLUDED_KINDS`) from the log — the 50-row cap bounds memory, these bound update load.

## 0.2.9

### Changed (2026-07-15)

- **RunLogPanel / `usePipelineDag`**: the per-stage event log (`eventsByStage`) is now
  kind-agnostic — every progress event that names a stage is kept (latest 50 per stage),
  not just `kind=pipeline.stage`. Studio wrapper-job events (`studio.job`, e.g. relink)
  now appear in the Run Inspector log; previously they were fetched by the replay clock
  and silently dropped at render. The DAG state machine and node error tooltips
  (`statusByStage`/`errorByStage`) remain derived from `pipeline.stage` events only.
- **RunLogPanel rows** render `payload.message` when present and tag non-`pipeline.stage`
  kinds (e.g. `[studio.job]`) so interleaved wrapper rows are distinguishable.
- New pure helper `appendStagedEvent` (+ `MAX_EVENTS_PER_STAGE`) exported from
  `core/pipelineDagState`, with unit coverage in `tests/runLogPanel.test.js`.

## 0.2.6

### Changed (CORE-DECISION-PROVENANCE-LOOKUP-1, 2026-05-23)

- **`contracts/decisions.json`** (source-of-truth) extended with `_list_active_params` block documenting the new optional `provenance_memory_id` query parameter on `GET /memory/decisions`. No `Decision` schema changes; visual + lifecycle surface unchanged. Mirror at `contracts/decisions.json` (monorepo root) updated in sync. Thin feature-folder extension contract at `smart-memory-docs/docs/features/CORE-DECISION-PROVENANCE-LOOKUP-1/decision-provenance-contract.json` documents the consumer wiring (REST, MCP, Python SDK, JS SDK).

## 0.2.5

### Fixed

- **DetailPanel:** Hide the Origin section for entity nodes (`category === 'entity'`). Entities don't carry an `origin` field in core; the panel was rendering "unknown" / dashed-red chip for them, which conflated "field absent" (correct, by schema) with "untagged write path" (a real producer bug). Memory items still show the chip and the "Untagged write path" hint when their origin is genuinely `unknown`.

## 0.2.4

### Changed

- **Toolbar:** Removed the "Select" selection-mode toggle from the menubar. Per-node click + Delete-key shortcut still work; `selectionMode`/`onSelectionModeChange` props remain on the component for any external controller.

### Added

- **DetailPanel:** New optional `onDelete(nodeId)` prop renders a sticky-footer "Delete Node" button with inline Confirm/Cancel. Footer is hidden when the prop is omitted, so embeds can opt out (same pattern as `hideSelectionToolbar`). `GraphExplorer` wires this to a single-node deletion that reuses the same backend routing as multi-select delete (`adapter.deleteNode` for `category === 'memory'`, `adapter.deleteEntityNode` otherwise), then closes the panel.

## 0.2.3

### Added

- **Optional `theme` prop on `<GraphExplorer>`** — opt-in per-consumer canvas theming without affecting other apps. Shape: `{ mode: 'light'|'dark', palette?: { node, edge, label, labelOutline, selectionBorder } }`. `palette` fields are direct CSS colors (hex, rgb(), named, or live values from `getComputedStyle`); each field overrides the corresponding mode default. `palette.node` collapses the per-type memory/entity/grounding fills to one color while preserving size differentiation. Annotation overlays (search match, contradictions) keep their signal colors regardless of theme. Theme changes re-apply at runtime via `cy.style().fromJson(...).update()` keyed on the serialized theme. Default behavior unchanged when `theme` is omitted — web/studio/insights render identically. Used by smartmemory-obsidian to mirror Obsidian's `--graph-node`/`--graph-line`/`--graph-text` CSS variables.

## Unreleased

### Added

- **VIS-DECISION-1 (Wave-2, Stream F): Decision memory as a first-class graph citizen.**
  - New `contracts/decisions.json` — single-source-of-truth for decision visual + lifecycle: shape (`hexagon`), per-status colors/border styles (active=solid emerald, superseded=dashed amber, retracted=dotted red, pending=dashed slate, unknown=dashed red), `SUPERSEDES`/`CONFLICTS_WITH` edge styling, contradiction overlay tokens, and a frozen `_routes` map mirroring `smart-memory-service/memory_service/api/routes/decisions.py`.
  - New `src/core/decisionStyles.js` exporting `DECISION_STATUSES`, `DECISION_EDGE_STYLES`, `DECISION_OVERLAY`, `DECISION_TYPES`, `resolveDecisionStatus()`, `isDecisionNode()`, plus class-name constants. Resolver logs `WARN` once when a decision arrives without a recognized status (per `rules/no-silent-degradation.md`) and renders the distinct "unknown" border.
  - New `src/components/DecisionDetailBlock.jsx` — DetailPanel sub-block for decisions: status badge with contract color, decision-type, reinforcement/contradiction counts, supersession chain block (prev/next links + "Highlight chain" button), conflicts panel (lazy-loaded via `adapter.findDecisionConflicts`), provenance block (lazy-loaded via `adapter.getDecisionProvenance`).
  - `internal/cytoscapeStyles.js` extended: hexagon decision node with status-driven border (amber dashed when superseded, dotted red when retracted), `decision-contradiction` overlay class (pulsing red ring), `decision-chain-highlight` class for canvas chain emphasis, `SUPERSEDES`/`CONFLICTS_WITH` edge styling.
  - `internal/cytoscapeConvert.js` extended: pass-through for `status`, `decision_type`, `supersedes`, `superseded_by`, `reinforcement_count`, `contradiction_count`; auto-applies `decision-status-{key}` class.
  - `adapters/fetchAdapter.js` + `adapters/sdkAdapter.js`: new `listActiveDecisions`, `getDecision`, `getDecisionProvenance`, `getDecisionCausalChain`, `findDecisionConflicts` methods (SDK falls back to underlying http when `client.decisions.*` is missing).
  - `components/Toolbar.jsx`: optional `Conflicts` button (visible when `onToggleContradictionOverlay` is provided).
  - `contracts/graph-colors.json` extended with `decisionStatus` and `decisionEdges` blocks (mirrored to legacy `/contracts/graph-colors.json`).
  - 22 new tests in `tests/decisionStyles.test.js` (15) + `tests/decisionAdapter.test.js` (7). All 277 vitest tests pass; perf-sanity logs `[perf] decision-styled 200-node init: <8 ms` (well under the 4s ceiling). The 2.2k-node SCALE-SMOKE-1 baseline (`styleEnabled:false`) is unaffected because decision styles are skipped when styling is disabled.

- **SCALE-SMOKE-1 (Wave-1, Stream D): multi-hop BFS cap + perf smoke.**
  - New `src/core/multiHopBfs.js` exporting `bfsExpand({ startId, adjacency, maxHops, maxNodesPerHop })` and `buildAdjacency(edges)`. Default cap is **100 nodes per hop**. Cap firing logs `WARNING` with `{ hop, requested, kept, dropped, maxNodesPerHop, startId }` and surfaces `truncated: true` on the per-hop result so the UI can render a "+N more" affordance without re-querying. Pure / dependency-free.
  - New `tests/fixtures/codebase-200k.json` — 2,202 nodes / 6,580 edges generated from the SmartMemory monorepo by `tests/fixtures/build-codebase-fixture.mjs`. Real-codebase fixture for layout + BFS perf work.
  - New `tests/perfCytoscape.test.js` (6 tests) and `tests/multiHopBfs.test.js` (13 tests). Perf tests run cose-bilkent headless against the fixture and emit real measurements via `[perf]` log lines.
  - **Findings (see `PERF-NOTES.md`):** cose-bilkent on the 2.2k-node fixture measures ~32.5 s initial (10.8× over the <3 s bar) and ~8.2 s incremental on a 500-node subset (16.4× over the <500 ms bar). Per `rules/no-silent-degradation.md` the target bars are **not** lowered — perf assertions use a 60 s regression ceiling and the real numbers print on every run. Recommended follow-ups: fcose swap, viewport culling, VIS-GRAPH-13 cluster aggregation, off-main-thread layout, persisted-position cache.

- **VIS-PIPELINE-DAG-1: Live pipeline DAG view + shared replay clock.** New public exports: `PipelineDag`, `ReplayScrubBar`, `RunLogPanel`, `useReplayClock`, `usePipelineDag`, `ReplayClock`, `eventTimestamp`, `extractionEntityToData`, `extractionRelationToData`, `deriveStageStatus`, `fillNeverEntered`, `PIPELINE_DAG_UI_STATES`, `formatReplayTime`.
  - **`<PipelineDag>`** — Cytoscape DAG renderer (left-to-right dagre layout) showing pipeline-stage topology with live frontier animation. Per-UI-state glyph prefixes (○ pending, ▶ active, ✓ complete, ⤼ skipped, ⏱ timed_out, ✗ errored, · never_entered) for color-blind a11y. `onNodeClick(stageId)` and `onNodeHover(stageId, {uiState, error})` callbacks; hover state re-emits when underlying status/error change so tooltips don't go stale.
  - **`useReplayClock({runId})`** — shared replay clock for synchronizing multiple views on one playhead. Pure `ReplayClock` state machine with `(run_id, seq)` dedupe (per PLAT-PROGRESS-1) and seq tie-breaker for same-`ts` events. React wrapper exposes a **stable handle identity** + `subscribe(cb)` for fanout + `subscribeReset(cb)` for seek-backward correctness (sticky terminal states are wiped before re-released events arrive).
  - **`<ReplayScrubBar clock={clock}>`** — pause/play, 0.5×/1×/2× speed, seek slider, elapsed/total labels.
  - **`<RunLogPanel eventsByStage stageFilter onClearFilter>`** — sorted progress event log with optional per-stage filter.
  - **`<GraphExplorer clock={clock}>`** — new optional `clock` prop. When set: subscribes via `clock.subscribe`/`subscribeReset` instead of opening its own SSE; bypasses `useDripFeed` (applies elements directly to Cytoscape so pause is lockstep); `onGraphCleared` wipes the canvas instead of re-fetching live state. Backward-compatible — clock-less usage unchanged.
  - **`useGraphStream({clock})`** — same clock contract; clock reset wipes ALL stream internals (`batchRef`, `canonicalMapRef`, `opsTimestampsRef`, `recordingBufferRef`, all timers); `pipeline.dag` events classified for log consumers.
  - **`eventToGraphNode(data, payload)` / `eventToGraphEdge(data, payload)`** — new optional `payload` arg surfaces `payload.original_ts` on the GraphNode/GraphEdge for replay-clock pacing. Backward-compatible (single-arg callers unchanged).
  - 49 new tests across `pipelineDagState`, `replayClock`, `replayClockIntegration`, `useGraphStreamClock`, `extractionDrip`, and `runLogPanel`. 236/236 vitest, zero regressions.
  - Codex CLEAN after 2–3 rounds per phase. Notable catches: stable handle identity (50ms unsubscribe storm avoided), TDZ ReferenceError on first render, hover-tooltip stale-refresh, drip-feed pause-lockstep gap.

### Changed — BREAKING

- **CORE-MEMORY-DYNAMICS-1 M1b: `working` → `pending` in graph-colors contract.** `contracts/graph-colors.json` memoryTypes key renamed from `"working"` to `"pending"` (color preserved at `#fb923c`). Mirrors the same rename in `smart-memory-insights/contracts/` and the monorepo-root legacy `contracts/` directory.

## 0.2.1 (2026-03-26)

### Fixed
- Refresh/operation scrub no longer drops active filter or isolation dimming (setElements/mergeElements now restore dimming state)
- WebSocket-streamed nodes now respect active filters (addElements re-applies dimming after adding)
- Hoisted filter/isolation refs to stable declaration order for consistent state restoration

## 0.2.0 (2026-03-26)

### Added
- Origin provenance visualization (CORE-ORIGIN-1 Phase 4)
  - Color-coded node borders by origin prefix (evolver=amber, code=green, conversation=indigo, enricher=teal, hook=gray, import=blue, unknown=red dashed, user=none)
  - Origin display in node detail panel with tier label
  - OriginLegend component (visible by default in GraphExplorer)
  - Origin extraction in normalize.js with triple fallback for backend compat
  - `getOriginPrefix()`, `getOriginBorderColor()`, `getOriginTier()`, `getTierLabel()` utilities
  - `originPrefixes` section in graph-colors.json contract
  - `origin-contract.json` with full origin taxonomy and tier assignments

## 0.1.0 (2026-02-17)

Initial release — extracted from `smart-memory-viewer`.

### Added
- 11 React components: GraphExplorer, DetailPanel, FilterPanel, SearchBar, Toolbar, OperationsBar, CytoscapeCanvas, NodeTooltip, WikipediaOverlay, ReplayButton, TimeTravelSlider
- 8 React hooks: useGraphData, useGraphFilters, useGraphStream, useGraphInteraction, useDripFeed, useUrlState, useConnectionStatus, useEntityCorrections
- 2 adapter factories: createFetchAdapter (raw fetch), createSDKAdapter (JS SDK stub)
- Core utilities: graph colors, constants, event classification, normalization, coalescing, wikipedia search, PNG/SVG export, event recording
- Canonical GraphNode/GraphEdge types with single conversion boundary to Cytoscape
- 24 unit tests for classifyEvent and eventTransform
