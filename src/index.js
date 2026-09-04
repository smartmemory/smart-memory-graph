/**
 * @smartmemory/graph — Shared graph visualization package.
 *
 * Public API: components, hooks, adapters, core utilities, and CSS.
 * Internal modules (useCytoscape, cytoscapeStyles, cytoscapeConvert) are NOT exported.
 */

// --- Components ---
export { default as GraphExplorer } from './components/GraphExplorer';
export { default as DetailPanel } from './components/DetailPanel';
export { default as FilterPanel } from './components/FilterPanel';
export { default as SearchBar } from './components/SearchBar';
export { default as Toolbar } from './components/Toolbar';
export { default as OperationsBar } from './components/OperationsBar';
export { default as CytoscapeCanvas } from './components/CytoscapeCanvas';
export { default as NodeTooltip } from './components/NodeTooltip';
export { default as WikipediaOverlay } from './components/WikipediaOverlay';
export { default as ReplayButton } from './components/ReplayButton';
export { default as TimeTravelSlider } from './components/TimeTravelSlider';
export { default as PipelineDag, buildElements as buildPipelineDagElements } from './components/PipelineDag';
export { default as ReplayScrubBar, fmtSeconds as formatReplayTime } from './components/ReplayScrubBar';
export { default as RunLogPanel } from './components/RunLogPanel';
export { default as DecisionDetailBlock } from './components/DecisionDetailBlock';
// DIST-LITE-9 — ask a question, get a grounded answer plus its evidence. Standalone:
// needs only an adapter, and pairs with GraphExplorer through its onSelect callback.
export { default as AskPanel } from './components/AskPanel';
export { default as AskResult } from './components/AskResult';

// --- Hooks ---
export { useGraphData } from './hooks/useGraphData';
export { useGraphFilters } from './hooks/useGraphFilters';
export { useGraphStream } from './hooks/useGraphStream';
export { useGraphInteraction } from './hooks/useGraphInteraction';
export { useDripFeed } from './hooks/useDripFeed';
export { useUrlState } from './hooks/useUrlState';
export { useMultiHopReplay } from './hooks/useMultiHopReplay';
export { useConnectionStatus } from './hooks/useConnectionStatus';
export { useEntityCorrections } from './hooks/useEntityCorrections';
export { usePipelineDag } from './hooks/usePipelineDag';
export { useReplayClock } from './hooks/useReplayClock';
export { ReplayClock, eventTimestamp } from './core/replayClock';

// --- Adapters ---
export { createFetchAdapter } from './adapters/fetchAdapter';
export { createSDKAdapter } from './adapters/sdkAdapter';

// --- Core utilities ---
export {
  getNodeColor,
  getNodeSize,
  getOriginPrefix,
  getOriginBorderColor,
  MEMORY_COLORS,
  ENTITY_COLORS,
  SPECIAL_COLORS,
  ORIGIN_BORDER_COLORS,
  NODE_SIZES,
  ALL_MEMORY_TYPES,
  ALL_ENTITY_TYPES,
  MEMORY_TYPE_SET,
} from './core/graphColors';

export { getOriginTier, getTierLabel } from './core/originTiers';

export {
  DECISION_STATUSES,
  DECISION_EDGE_STYLES,
  DECISION_NODE_SHAPE,
  DECISION_NODE_SIZE,
  DECISION_TYPES,
  DECISION_OVERLAY,
  DECISION_ROUTES,
  DECISION_CONTRADICTION_CLASS,
  DECISION_CHAIN_HIGHLIGHT_CLASS,
  DECISION_SUPERSEDES_EDGE_TYPE,
  DECISION_CONFLICT_EDGE_TYPE,
  resolveDecisionStatus,
  isDecisionNode,
} from './core/decisionStyles';

export { ENTITY_TYPES, LAYOUT_OPTIONS, RECIPROCAL_PAIRS } from './core/constants';
export { normalizeAPIResponse, normalizeExtractionResults } from './core/normalize';
export { coalesceGraphData } from './core/coalesce';
export { classifyEvent } from './core/classifyEvent';
export {
  eventToGraphNode,
  eventToGraphEdge,
  extractionEntityToData,
  extractionRelationToData,
} from './core/eventTransform';
export {
  deriveStageStatus,
  fillNeverEntered,
  UI_STATES as PIPELINE_DAG_UI_STATES,
} from './core/pipelineDagState';
export { searchWikipedia } from './core/wikipedia';
// DIST-LITE-9 — ask lifecycle + selection payloads, exported so a host can build its
// own ask UI (or its own onSelect mapping) over the same contract.
export {
  askReducer,
  normalizeAskResponse,
  relationEdgeId,
  evidenceSelection,
  relationSelection,
  runAsk,
  INITIAL_ASK_STATE,
  ASK_IDLE,
  ASK_LOADING,
  ASK_ANSWERED,
  ASK_ERROR,
} from './core/askState';
export {
  bfsExpand,
  buildAdjacency,
  DEFAULT_MAX_NODES_PER_HOP,
} from './core/multiHopBfs';
// GRAPH-MULTIHOP-VIZ-1 — retrieval-hop grouping. Sibling of multiHopBfs above, but
// groups by which SEARCH hop surfaced a result, not by graph distance.
export {
  groupByRetrievalHop,
  maxRetrievalHop,
  shouldEnterRetrievalReplay,
  assignBridgesToHops,
} from './core/retrievalHops';
// GRAPH-MULTIHOP-VIZ-1 — the frame/timing plan both hop groupings above feed into.
export {
  buildReplayPlan,
  buildBfsHopNodeSets,
  HOP_COLORS,
  HOP_DELAY_MS,
} from './core/hopReplayPlan';
export { exportPNG, exportSVG } from './core/export';
export { saveRecording, getLastRecording, getAllRecordings, clearRecordings } from './core/eventStore';

// --- Origin ---
export { default as OriginLegend } from './components/OriginLegend';

// --- Annotations ---
export { default as AnnotationLegend } from './components/AnnotationLegend';
export { buildAnnotationLegend } from './core/annotationLegend';
export { resolveAnnotationSets } from './core/resolveAnnotationSets';
export {
  ANNOTATION_COLORS,
  ANNOTATION_BORDERS,
  ANNOTATION_KINDS,
  ANNOTATION_PRECEDENCE,
  CHANNEL_LOCKED_KINDS,
} from './core/graphColors';
