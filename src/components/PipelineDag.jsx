/**
 * PipelineDag — Cytoscape renderer for the machinery view of a pipeline run.
 *
 * Subscribes to a run via PLAT-PROGRESS-1 (replay-from-start so the one-shot
 * pipeline.dag event is always seen), renders nodes/edges from that
 * topology, and animates per-node UI state from subsequent pipeline.stage
 * events.
 *
 * Sibling to GraphExplorer. Both consume the same event stream by run_id;
 * Phase 4 wires them with a shared replay clock for lockstep scrub.
 *
 * VIS-PIPELINE-DAG-1 Phase 1b.
 */

import { useEffect, useMemo, useRef } from 'react';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import { usePipelineDag } from '../hooks/usePipelineDag';
import { UI_STATES } from '../core/pipelineDagState';

let _dagreRegistered = false;
function ensureDagre() {
  if (_dagreRegistered) return;
  try {
    cytoscape.use(dagre);
    _dagreRegistered = true;
  } catch (err) {
    // cytoscape.use throws if the extension is already registered globally
    // (e.g. by useCytoscape.js). That's the only acceptable failure here —
    // re-throw anything else so we don't mask real bugs.
    const msg = String(err && err.message ? err.message : err);
    if (/already.*register/i.test(msg)) {
      _dagreRegistered = true;
    } else {
      throw err;
    }
  }
}

const STYLE = [
  {
    selector: 'node',
    style: {
      'background-color': '#374151',
      'border-color': '#6b7280',
      'border-width': 1,
      label: 'data(label)',
      color: '#e5e7eb',
      'font-size': 11,
      'text-valign': 'center',
      'text-halign': 'center',
      'text-wrap': 'wrap',
      'text-max-width': 90,
      width: 110,
      height: 38,
      shape: 'round-rectangle',
    },
  },
  {
    selector: `node[ui_state = "${UI_STATES.ACTIVE}"]`,
    style: {
      'background-color': '#0891b2',
      'border-color': '#22d3ee',
      'border-width': 2,
    },
  },
  {
    selector: `node[ui_state = "${UI_STATES.COMPLETE}"]`,
    style: {
      'background-color': '#065f46',
      'border-color': '#10b981',
    },
  },
  {
    selector: `node[ui_state = "${UI_STATES.SKIPPED}"]`,
    style: {
      'background-color': '#1f2937',
      'border-color': '#9ca3af',
      'border-style': 'dashed',
    },
  },
  {
    selector: `node[ui_state = "${UI_STATES.TIMED_OUT}"]`,
    style: {
      'background-color': '#78350f',
      'border-color': '#f59e0b',
      'border-width': 2,
    },
  },
  {
    selector: `node[ui_state = "${UI_STATES.ERRORED}"]`,
    style: {
      'background-color': '#7f1d1d',
      'border-color': '#ef4444',
      'border-width': 2,
    },
  },
  {
    selector: `node[ui_state = "${UI_STATES.NEVER_ENTERED}"]`,
    style: {
      'background-color': '#111827',
      'border-color': '#374151',
      opacity: 0.5,
    },
  },
  {
    selector: 'edge',
    style: {
      'curve-style': 'bezier',
      'line-color': '#4b5563',
      'target-arrow-color': '#4b5563',
      'target-arrow-shape': 'triangle',
      width: 1.5,
    },
  },
];

// Phase 5: glyph prefix per UI state — distinguishes failure modes by shape,
// not just color (color-blind accessibility).
const STATE_GLYPH = {
  [UI_STATES.PENDING]: '○ ',
  [UI_STATES.ACTIVE]: '▶ ',
  [UI_STATES.COMPLETE]: '✓ ',
  [UI_STATES.SKIPPED]: '⤼ ',
  [UI_STATES.TIMED_OUT]: '⏱ ',
  [UI_STATES.ERRORED]: '✗ ',
  [UI_STATES.NEVER_ENTERED]: '· ',
};

function labelFor(node, uiState) {
  const base = node.label || node.id;
  return `${STATE_GLYPH[uiState] || ''}${base}`;
}

/**
 * Build Cytoscape elements from topology + per-stage UI states.
 * Pure function — exported so it can be unit-tested without rendering.
 */
export function buildElements(topology, statusByStage) {
  if (!topology) return [];
  const nodes = (topology.nodes || []).map((n) => {
    const uiState = statusByStage[n.id] || UI_STATES.PENDING;
    return {
      data: {
        id: n.id,
        label: labelFor(n, uiState),
        kind: n.kind || 'stage',
        parent: n.parent || undefined,
        ui_state: uiState,
      },
    };
  });
  const edges = (topology.edges || []).map((e, i) => ({
    data: {
      id: `${e.from}->${e.to}#${i}`,
      source: e.from,
      target: e.to,
      kind: e.kind || 'sequence',
    },
  }));
  return [...nodes, ...edges];
}

/**
 * @param {Object} props
 * @param {string} props.runId
 * @param {string} [props.baseUrl]
 * @param {string} [props.token]
 * @param {boolean} [props.enabled=true]
 * @param {Object} [props.clock] - Optional shared replay clock from
 *   useReplayClock(). When provided, the DAG advances its frontier by
 *   clock-released events instead of subscribing directly. Use for
 *   side-by-side replay with other views.
 * @param {(stageId: string) => void} [props.onNodeClick]
 * @param {(stageId: string | null, info: {uiState: string, error: ?Object}) => void} [props.onNodeHover]
 *   Phase 5: fires on hover (stageId=null on un-hover) with the stage's UI
 *   state and any captured error payload, so the parent can render a tooltip
 *   / error details outside Cytoscape.
 * @param {Object} [props.style] - Container style.
 */
export default function PipelineDag({
  runId,
  baseUrl,
  token,
  enabled = true,
  clock = null,
  onNodeClick,
  onNodeHover,
  style,
}) {
  const containerRef = useRef(null);
  const cyRef = useRef(null);

  // Hook MUST be called before refs that close over its return values
  // (Codex Round 1 HIGH: TDZ ReferenceError otherwise).
  const { topology, statusByStage, errorByStage, error } = usePipelineDag({
    runId,
    baseUrl,
    token,
    enabled,
    clock,
  });

  // Ref-backed callbacks so parent inline callbacks don't reset Cytoscape
  // (layout/pan/zoom) on every render.
  const onNodeClickRef = useRef(onNodeClick);
  const onNodeHoverRef = useRef(onNodeHover);
  const statusRef = useRef(statusByStage);
  const errorRef = useRef(errorByStage);
  useEffect(() => { onNodeClickRef.current = onNodeClick; }, [onNodeClick]);
  useEffect(() => { onNodeHoverRef.current = onNodeHover; }, [onNodeHover]);
  useEffect(() => { statusRef.current = statusByStage; }, [statusByStage]);
  useEffect(() => { errorRef.current = errorByStage; }, [errorByStage]);

  // Codex Round 1 MEDIUM: while the user keeps hovering a node, the clock
  // can advance the node's status (e.g. active → errored). Cytoscape only
  // emits mouseover/mouseout, so without a re-fire the parent tooltip stays
  // stale. Track which node Cytoscape currently has hovered and re-emit
  // hover info whenever statusByStage/errorByStage changes for that node.
  const hoveredNodeIdRef = useRef(null);
  useEffect(() => {
    const hoveredId = hoveredNodeIdRef.current;
    const h = onNodeHoverRef.current;
    if (!hoveredId || !h) return;
    h(hoveredId, {
      uiState: statusByStage[hoveredId] || UI_STATES.PENDING,
      error: errorByStage[hoveredId] || null,
    });
  }, [statusByStage, errorByStage]);

  const elements = useMemo(
    () => buildElements(topology, statusByStage),
    [topology, statusByStage],
  );

  // Initialize Cytoscape once we have a container + topology. Init runs only
  // when topology changes (new DAG declaration); subsequent state updates go
  // through the patch effect below.
  useEffect(() => {
    if (!containerRef.current || !topology || cyRef.current) return undefined;
    ensureDagre();
    cyRef.current = cytoscape({
      container: containerRef.current,
      elements,
      style: STYLE,
      layout: { name: 'dagre', rankDir: 'LR', nodeSep: 30, rankSep: 60 },
      wheelSensitivity: 0.2,
    });
    cyRef.current.on('tap', 'node', (evt) => {
      const handler = onNodeClickRef.current;
      if (handler) handler(evt.target.id());
    });
    // Phase 5: hover events — let parent render error tooltip / details panel.
    cyRef.current.on('mouseover', 'node', (evt) => {
      const id = evt.target.id();
      hoveredNodeIdRef.current = id;
      const h = onNodeHoverRef.current;
      if (!h) return;
      h(id, {
        uiState: statusRef.current[id] || UI_STATES.PENDING,
        error: errorRef.current[id] || null,
      });
    });
    cyRef.current.on('mouseout', 'node', () => {
      hoveredNodeIdRef.current = null;
      const h = onNodeHoverRef.current;
      if (h) h(null, { uiState: null, error: null });
    });
    // Phase 5: native browser tooltip (qtip) on hover, showing UI state +
    // error message for errored nodes. Cytoscape doesn't render HTML tooltips
    // natively without a plugin; we set the DOM element's title via the
    // node-content extension is heavy. Instead, expose error/state via a data
    // attribute on the cytoscape container's `cy.elements().data()` which
    // consumers can inspect via the tap handler — and surface the error in
    // the Run Inspector's hover panel. The node label glyph already conveys
    // failure mode at a glance.
    return () => {
      try {
        cyRef.current?.destroy?.();
      } catch (_) {
        /* swallow */
      }
      cyRef.current = null;
    };
  }, [topology]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update existing Cytoscape instance when statusByStage changes.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !topology) return;
    cy.batch(() => {
      for (const node of topology.nodes || []) {
        const cyNode = cy.getElementById(node.id);
        if (cyNode.nonempty()) {
          cyNode.data('ui_state', statusByStage[node.id] || UI_STATES.PENDING);
        }
      }
    });
  }, [statusByStage, topology]);

  return (
    <div
      ref={containerRef}
      data-testid="pipeline-dag-canvas"
      style={{ width: '100%', height: '100%', minHeight: 200, ...style }}
    >
      {error && (
        <div role="alert" style={{ color: '#f87171', padding: 8, fontSize: 12 }}>
          Pipeline DAG stream error: {String(error?.message || error)}
        </div>
      )}
    </div>
  );
}
