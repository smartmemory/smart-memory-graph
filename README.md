# @smartmemory/graph

**Version:** 0.2.3

Shared graph visualization package for SmartMemory. Provides Cytoscape.js-powered graph components, hooks, and adapters that can be consumed by any React app.

## Usage

```jsx
import { GraphExplorer, createFetchAdapter } from '@smartmemory/graph';
import '@smartmemory/graph/src/graph.css';

const adapter = createFetchAdapter({
  apiUrl: 'http://localhost:9001',
  getToken: () => localStorage.getItem('token'),
  getTeamId: () => localStorage.getItem('team_id'),
});

function App() {
  return <GraphExplorer adapter={adapter} wsUrl="ws://localhost:9001/ws/insights" />;
}
```

### Show a decision ripple

Select a saved decision in the normal graph and choose **Show ripple**. You can also Tab to the button and press Enter or Space. The graph calls `adapter.getDecisionEffects(id)` once and keeps the layout in place as the pulse travels outward. Red marks conflicts, amber marks decisions needing review, and a faded outline marks replacements.

**Replay** runs the same snapshot again. **Clear** restores the previous graph styling. The **+N off screen** count includes affected nodes outside the displayed graph and any overflow reported by the service. The animation uses 450 ms per hop and shortens the interval on long chains. With reduced motion enabled, all highlights appear together.

### Controlled decision effects

For a dedicated screen, render `DecisionEffects` with `data`, `effects`, `actions` and the optional `proposal` sidebar slot. Key the view by workspace, focus and snapshot revision so a new draft starts with fresh choices.
Resolve each conflict in the drawer, then use **Save decision** to apply the choices. **Discard** drops the preview.


Pass a focused graph and its effects snapshot to preview a draft, follow its
dependencies, inspect the source path, or view rules on an earlier date.

```jsx
<GraphExplorer
  enableDecisionEffects
  workspaceId={workspaceId}
  decisionEffectsLoading={loading}
  data={focusedGraph}
  decisionEffects={snapshot}
  decisionEffectsActions={{ onCommit, onCancel, onRefocus, onConfirmLink, onRemoveLink }}
/>
```

The flag defaults to `false`. With the flag enabled the component reads only
its props. The host supplies the focus, calendar date, graph edges, lifecycle
dates, review hops with their immediate predecessor, and result freshness.
See the [typed inputs](src/components/effects/types.d.ts) and the
[frozen-note example](tests/fixtures/decisionEffects.js).
Pass the complete conflict, replacement and review lists for accurate counts,
plus dated overflow counts for branches outside the supplied graph.

Pass the current workspace ID so switching workspaces clears the draft and view state.
Use `adapter.getDecisionEffects(id)` for a standing decision and `adapter.previewDecisionEffects(text)` for a draft.
Pass the returned snapshot as `decisionEffects` and its `data` as the graph data.
Supply `onConfirmLink(source, target)` and `onRemoveLink(source, target)` for hosts that allow suggested-link changes.
After a successful change, reload the snapshot to update the graph.

While a read is outstanding, set `decisionEffectsLoading`.

The host owns writes. Without an explicit policy, the preview is read-only.
With `policy="save"`, **Save decision** calls
`onCommit(focus, resolutions)`. Under `policy="propose"` the user chooses
**Send for review**. Return the acknowledged standing or held snapshot to
display the outcome. A rejected save leaves the draft available to retry.
For a suggested dependency, **Confirm** and **Remove** stage the choice. **Save link change** applies it.

`onCancel` restores the host's standing snapshot. An overflow stub lists the hidden branches at that hop. Selecting a branch
calls `onRefocus(branchId)` so the host can supply that branch.

Run the browser acceptance scenarios with `npm run test:decision-effects`.
Set `CHROMIUM_EXECUTABLE_PATH` to a local Chromium executable or install the
matching browser with `npx playwright-core install chromium`. Optionally set
`DECISION_EFFECTS_SCREENSHOTS` to capture the verified elements as PNGs.

### Controls hidden until fully built

`GraphExplorer` hides these behind props that default to `false`. Nothing is deleted: pass the prop to bring a control back.

| Prop | Brings back | Why hidden |
|---|---|---|
| `enableTimeTravel` | Time button, slider, `#asof=` in a link | time travel not fully built |
| `showPlaybackBar` | bottom live-feed bar (status, pause, speed, ticker, Replay) and the "Replaying recording" banner | feed and replay not fully built |
| `enableEntityEditing` | detail panel: change entity type, rename, Remove grounding | the local Lite server has no write routes for them |
| `enableGrounding` | detail panel: Ground (Wikipedia picker) | Accept does not save anywhere yet |
| `enableDecisionTools` | decision block: Find conflicts, Load provenance | the local Lite server has no routes for them |
| `enableSvgExport` | Export > SVG | needs the `cytoscape-svg` plugin, not installed |

## Architecture

```
src/
├── components/       # 11 React components (GraphExplorer, DetailPanel, etc.)
├── hooks/            # 8 React hooks (useGraphData, useGraphStream, etc.)
├── adapters/         # Transport abstraction (fetchAdapter, sdkAdapter)
├── core/             # Pure functions (colors, constants, normalize, coalesce)
├── internal/         # Cytoscape internals (NOT exported)
├── index.js          # Barrel export
└── graph.css         # Graph-specific styles
```

### Key Concepts

- **GraphNode/GraphEdge**: Canonical domain types (`{ id, label, type, category }`). Components work with these.
- **Cytoscape elements**: Internal rendering format. Conversion happens only inside `GraphExplorer`.
- **Adapter pattern**: `GraphAPIAdapter` interface (14 methods). `fetchAdapter` for standalone apps, `sdkAdapter` for JS SDK consumers.
- **Controlled/uncontrolled**: Pass `data` prop for controlled mode, or let `GraphExplorer` fetch via adapter.

## Exports

### Components
`GraphExplorer`, `DetailPanel`, `FilterPanel`, `SearchBar`, `Toolbar`, `OperationsBar`, `CytoscapeCanvas`, `NodeTooltip`, `WikipediaOverlay`, `ReplayButton`, `TimeTravelSlider`

### Hooks
`useGraphData`, `useGraphFilters`, `useGraphStream`, `useGraphInteraction`, `useDripFeed`, `useUrlState`, `useConnectionStatus`, `useEntityCorrections`

### Adapters
`createFetchAdapter`, `createSDKAdapter`

### Core Utilities
`getNodeColor`, `getNodeSize`, `MEMORY_COLORS`, `ENTITY_COLORS`, `SPECIAL_COLORS`, `NODE_SIZES`, `ALL_MEMORY_TYPES`, `ALL_ENTITY_TYPES`, `MEMORY_TYPE_SET`, `ENTITY_TYPES`, `LAYOUT_OPTIONS`, `RECIPROCAL_PAIRS`, `normalizeAPIResponse`, `normalizeExtractionResults`, `coalesceGraphData`, `classifyEvent`, `eventToGraphNode`, `eventToGraphEdge`, `searchWikipedia`, `exportPNG`, `exportSVG`, `saveRecording`, `getLastRecording`, `clearRecordings`

## Scripts

| Command | Description |
|---------|-------------|
| `npm test` | Run tests (vitest) |
| `npm run test:watch` | Watch mode |

## Consumers

- **smart-memory-viewer** — Standalone graph viewer (uses `fetchAdapter`)
- **smart-memory-web** — Main web app (planned, will use `sdkAdapter`)
- **smart-memory-studio** — Pipeline lab (planned)

## Documentation

Full SmartMemory documentation: https://docs.smartmemory.ai
