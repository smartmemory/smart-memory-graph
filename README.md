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

### Controlled decision effects

Pass a focused graph and its effects snapshot to preview a draft, follow its
dependencies, inspect the source path, or view rules on an earlier date.

```jsx
<GraphExplorer
  enableDecisionEffects
  data={focusedGraph}
  decisionEffects={snapshot}
  decisionEffectsActions={{ onCommit, onCancel, onRefocus }}
/>
```

The flag defaults to `false`. With the flag enabled the component reads only
its props. The host supplies the focus, calendar date, graph edges, lifecycle
dates, review hops with their immediate predecessor, and result freshness.
See the [typed inputs](src/components/effects/types.d.ts) and the
[frozen-note example](tests/fixtures/decisionEffects.js).
Pass the complete conflict, replacement and review lists for accurate counts,
plus dated overflow counts for branches outside the supplied graph.

The host owns writes. In direct-save mode settling the final conflict calls
`onCommit(focus, resolutions)`. Under `policy="propose"` the user chooses
**Send for review**. Return the acknowledged standing or held snapshot to
display the outcome. A rejected save leaves the draft available to retry.
`onCancel` restores the host's standing snapshot. Clicking an overflow stub
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
