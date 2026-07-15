# Changelog

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
