# Changelog

## 0.2.3

### Added

- **Optional `theme` prop on `<GraphExplorer>`** — opt-in per-consumer canvas theming without affecting other apps. Shape: `{ mode: 'light'|'dark', palette?: { node, edge, label, labelOutline, selectionBorder } }`. `palette` fields are direct CSS colors (hex, rgb(), named, or live values from `getComputedStyle`); each field overrides the corresponding mode default. `palette.node` collapses the per-type memory/entity/grounding fills to one color while preserving size differentiation. Annotation overlays (search match, contradictions) keep their signal colors regardless of theme. Theme changes re-apply at runtime via `cy.style().fromJson(...).update()` keyed on the serialized theme. Default behavior unchanged when `theme` is omitted — web/studio/insights render identically. Used by smartmemory-obsidian to mirror Obsidian's `--graph-node`/`--graph-line`/`--graph-text` CSS variables.

## Unreleased

### Added

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
