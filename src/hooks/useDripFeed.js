import { useState, useEffect, useCallback, useRef } from 'react';
import { graphNodeToCyElement, graphEdgeToCyElement } from '../internal/cytoscapeConvert';
import { coalesceGraphData } from '../core/coalesce';
import { getFitElements, getFitPadding, STREAMING_LAYOUT } from '../internal/useCytoscape';

const GLOW_DURATION = 2500;

// ---------------------------------------------------------------------------
// original_ts-delta pacing (PLAT-PROGRESS-1 T016)
//
// Speed multiplier name → numeric factor.
// Infinity = "fast" mode: emit all events as quickly as possible (delay 0).
// ---------------------------------------------------------------------------

export const SPEED_FACTORS = { '1x': 1, '2x': 2, '4x': 4, fast: Infinity };

/**
 * Compute the animation delay (ms) between two consecutive replay events.
 *
 * Contract (per PLAT-PROGRESS-1 plan Task 11, progress-event-contract.json PayloadConventions):
 * - delay = (curr.payload.original_ts - prev.payload.original_ts) * 1000 ms
 * - speedFactor divides the raw delta BEFORE clamp
 * - Clamp to [0, 500ms] so a 10-minute real run can still replay reasonably
 * - If original_ts is missing: log WARNING (no-silent-degradation.md) and use fallback
 *
 * @param {Object} curr - event or item with payload.original_ts
 * @param {Object} prev - previous event or item with payload.original_ts
 * @param {number} speedFactor - 1 | 2 | 4 | Infinity
 * @param {number} [fallbackMs=200] - delay when original_ts is absent
 * @returns {number} delay in ms, clamped to [0, 500]
 */
export function computeEventDelay(curr, prev, speedFactor = 1, fallbackMs = 200) {
  const MAX_DELAY = 500;
  const MIN_DELAY = 0;

  const currTs = curr?.payload?.original_ts;
  const prevTs = prev?.payload?.original_ts;

  if (currTs == null || prevTs == null) {
    console.warn(
      '[useDripFeed] original_ts missing on event — falling back to wall-clock delta',
      { curr, prev },
    );
    return Math.max(MIN_DELAY, Math.min(MAX_DELAY, fallbackMs));
  }

  const rawDeltaMs = (currTs - prevTs) * 1000;
  const scaled = speedFactor === Infinity ? 0 : rawDeltaMs / speedFactor;
  return Math.max(MIN_DELAY, Math.min(MAX_DELAY, scaled));
}

/**
 * Run a 2-cycle border-width pulse (4→6→4→6→4) on a freshly arrived node,
 * then remove the streaming-new class. Total pulse duration: ~800ms.
 */
function pulseStreamingNode(node) {
  if (!node.inside()) return;
  const step = (from, to, next) =>
    node.animate(
      { style: { 'border-width': to } },
      { duration: 200, easing: 'ease-in-out-sine', complete: next || undefined }
    );
  step(4, 6, () =>
    step(6, 4, () =>
      step(4, 6, () =>
        step(6, 4, () => { if (node.inside()) node.removeClass('streaming-new'); })
      )
    )
  );
}

/**
 * Drip-feed animation queue and replay logic.
 * Extracted from GraphExplorer.jsx:97-287 (R1).
 *
 * @param {Object} options
 * @param {Object} options.cytoscape - useCytoscape return value
 * @param {Object} options.filters - useGraphFilters return value (for registerStreamedElements)
 * @param {function} options.incrementStats - from useGraphData
 * @param {string} options.layout - current layout name
 * @param {Object} options.stream - useGraphStream return value
 * @param {string} [options.speedMultiplier='1x'] - replay speed: '1x' | '2x' | '4x' | 'fast'
 */
export function useDripFeed({ cytoscape, filters, incrementStats, layout, stream, onGroundingFlash, onStageChange, speedMultiplier = '1x' }) {
  const [dripInterval, setDripInterval] = useState(() => {
    const stored = localStorage.getItem('graph:dripInterval');
    return stored ? Number(stored) : 200;
  });
  const dripIntervalRef = useRef(dripInterval);
  useEffect(() => {
    dripIntervalRef.current = dripInterval;
    localStorage.setItem('graph:dripInterval', String(dripInterval));
  }, [dripInterval]);

  const [isReplaying, setIsReplaying] = useState(false);
  const userInteractedRef = useRef(false);
  const entityIndexRef = useRef(0);
  const relayoutTimerRef = useRef(null);
  const panTimerRef = useRef(null);
  const dripTimersRef = useRef([]);
  const dripQueueRef = useRef([]);
  // Entity nodes buffered until their connecting edge arrives — so node+edge appear together.
  const pendingNodesRef = useRef(new Map());

  // NOTE: there is intentionally NO per-burst layout. Nodes appear by
  // accretion (positionStreamedNode seeds them at their parent); the graph
  // is arranged by a SINGLE gentle cola settle when the command's stream
  // goes quiet (see scheduleQuietLayout). Per-burst cola re-sim lurched the
  // canvas; per-burst lock-established strung the graph out as it grew.
  // One settle per command is both calm and produces a clean layout.

  // Position a node during streaming: entity nodes born at parent position,
  // cola physics drifts them to their settled location (unfurling effect).
  const positionStreamedNode = useCallback((cy, cyEl) => {
    if (cyEl.group !== 'nodes') return;
    const node = cy.getElementById(cyEl.data.id);
    if (!node.length) return;

    const parentId = cyEl.data.parentId;
    if (parentId) {
      // Born at parent position — cola physics drifts it outward
      const parent = cy.getElementById(parentId);
      if (parent.length) {
        node.position({ x: parent.position().x, y: parent.position().y });
      }
    } else {
      // Memory node: place along horizontal row at the centre of the *current viewport*
      // (not cy.width()/2 which is a pixel dimension, not a graph coordinate).
      const pan = cy.pan();
      const zoom = cy.zoom();
      const cx = (cy.width()  / 2 - pan.x) / zoom;
      const cyy = (cy.height() / 2 - pan.y) / zoom;
      const memoryNodes = cy.nodes().filter(n => n.data('category') === 'memory');
      const count = memoryNodes.length;
      node.position({ x: cx + (count - 1) * 200, y: cyy });
      entityIndexRef.current = 0;
    }
  }, []);

  // Animate a single soft glowing orb traveling source → target along the edge.
  // Ghost edge overlays the real edge (same bezier path) but is excluded from
  // cola layout via the eles filter, preventing parallel-edge oscillation.
  const animateEdgePulse = useCallback((edge) => {
    const cy = edge.cy();
    if (!cy) return;
    const ghostId = `_pulse_${edge.id()}`;
    if (cy.getElementById(ghostId).length > 0) return;

    const ghost = cy.add({
      group: 'edges',
      data: { id: ghostId, source: edge.data('source'), target: edge.data('target'), _isPulse: true },
    });

    ghost.style({
      'curve-style': 'bezier',
      'line-style': 'dashed',
      'line-dash-pattern': [10, 9999], // single dot, gap larger than any edge
      'line-dash-offset': 0,
      'line-cap': 'round',             // circular orb
      'line-color': '#a5f3fc',         // sky-200 — soft glow
      width: 7,
      opacity: 0.85,
      'target-arrow-shape': 'none',
      label: '',
      'z-index': 1002,
    });

    ghost.animate(
      { style: { 'line-dash-offset': -10009, opacity: 0 } },
      {
        duration: dripIntervalRef.current,  // speed tracks the drip slider
        easing: 'ease-in-out-sine',
        complete: () => { if (ghost.inside()) cy.remove(ghost); },
      }
    );
  }, []);

  // Add a node to cy with its entry animation. Used for immediate nodes and
  // for buffered nodes that are flushed when their edge arrives.
  const addNodeAnimated = useCallback((cy, el, cyEl) => {
    if (cy.getElementById(cyEl.data.id).length > 0) return;
    filters.registerStreamedElements([el]);
    try {
      const added = cy.add(cyEl);
      positionStreamedNode(cy, cyEl);
      incrementStats([el], 0);
      const targetW = added.style('width');
      const targetH = added.style('height');
      added.style({ width: 0, height: 0, opacity: 0 });
      added.animate(
        { style: { width: targetW, height: targetH, opacity: 1 } },
        {
          duration: 250,
          easing: 'ease-out-cubic',
          complete: () => {
            added.addClass('streaming-new');
            pulseStreamingNode(added);
          },
        }
      );
    } catch { /* ignore */ }
  }, [filters, incrementStats, positionStreamedNode]);

  // When a command's stream goes quiet (800ms after the last element), do
  // the ONE gentle full settle + a single calm fit. This is the only
  // layout/fit per command — no per-burst work — so the graph grows by
  // accretion during the burst then elegantly arranges once. Flushes any
  // entity nodes whose edge never arrived first so they're included.
  const scheduleQuietLayout = useCallback(() => {
    if (relayoutTimerRef.current) clearTimeout(relayoutTimerRef.current);
    relayoutTimerRef.current = setTimeout(() => {
      relayoutTimerRef.current = null;
      const cy = cytoscape.cy.current;
      if (!cy || cy.nodes().length === 0) return;
      if (pendingNodesRef.current.size > 0) {
        for (const { el, cyEl } of pendingNodesRef.current.values()) {
          addNodeAnimated(cy, el, cyEl);
        }
        pendingNodesRef.current.clear();
      }
      // Gentle full settle, then frame it once it's stable (fit AFTER the
      // settle, not racing it — avoids a mid-settle viewport jump).
      const layout = cy.layout({ ...STREAMING_LAYOUT, eles: cy.elements().not('[_isPulse]') });
      layout.one('layoutstop', () => {
        if (!userInteractedRef.current) {
          cy.animate(
            { fit: { eles: getFitElements(cy), padding: getFitPadding(cy) } },
            { duration: 400, easing: 'ease-in-out-sine' },
          );
        }
      });
      layout.run();
    }, 800);
  }, [cytoscape, addNodeAnimated]);

  // Process next element from the drip queue
  const processNextDrip = useCallback(() => {
    const queue = dripQueueRef.current;
    if (queue.length === 0) {
      scheduleQuietLayout();
      return;
    }
    const el = queue.shift();
    const cy = cytoscape.cy.current;
    if (!cy) return;

    // Convert GraphNode/GraphEdge to Cytoscape element
    const cyEl = ('source' in el) ? graphEdgeToCyElement(el) : graphNodeToCyElement(el);

    if (cy.getElementById(cyEl.data.id).length > 0) {
      const timer = setTimeout(processNextDrip, 50);
      dripTimersRef.current.push(timer);
      return;
    }

    const isNode = !('source' in el);

    // Non-memory nodes (entity, grounding): buffer until their edge arrives so
    // node and edge appear together. Memory nodes (no parentId) appear immediately.
    if (isNode && el.parentId) {
      pendingNodesRef.current.set(cyEl.data.id, { el, cyEl });
      // Skip to the next drip immediately — don't waste a drip interval on an invisible op.
      const timer = setTimeout(processNextDrip, 0);
      dripTimersRef.current.push(timer);
      return;
    }

    // Register with filter panel
    filters.registerStreamedElements([el]);
    try {
      if (isNode) {
        // Memory / root node — appear immediately
        const added = cy.add(cyEl);
        positionStreamedNode(cy, cyEl);
        incrementStats([el], 0);
        const targetW = added.style('width');
        const targetH = added.style('height');
        added.style({ width: 0, height: 0, opacity: 0 });
        added.animate(
          { style: { width: targetW, height: targetH, opacity: 1 } },
          {
            duration: 250,
            easing: 'ease-out-cubic',
            complete: () => {
              added.addClass('streaming-new');
              pulseStreamingNode(added);
            },
          }
        );
      } else {
        // Edge: flush any buffered endpoint nodes first so they appear with the edge
        for (const nodeId of [el.source, el.target]) {
          const buffered = pendingNodesRef.current.get(nodeId);
          if (buffered) {
            pendingNodesRef.current.delete(nodeId);
            addNodeAnimated(cy, buffered.el, buffered.cyEl);
          }
        }
        // Add the edge
        incrementStats(0, 1);
        const added = cy.add(cyEl);
        added.style({ opacity: 0 });
        added.animate(
          { style: { opacity: 1 } },
          {
            duration: 150,
            easing: 'ease-out-sine',
            complete: () => {
              animateEdgePulse(added);
            },
          }
        );
      }
      // ────────────────────────────────────────────────────────────────────
    } catch {
      // Edge endpoint missing
    }

    // NO mid-stream re-fit. Re-zooming the viewport on every burst made the
    // whole canvas lurch each command. The single calm fit in
    // scheduleQuietLayout (800ms after the stream goes quiet) is enough;
    // the established graph stays put while new nodes arrive.

    if (queue.length > 0) {
      const timer = setTimeout(processNextDrip, dripIntervalRef.current);
      dripTimersRef.current.push(timer);
    } else {
      scheduleQuietLayout();
    }
  }, [cytoscape, filters, incrementStats, positionStreamedNode, scheduleQuietLayout, addNodeAnimated, animateEdgePulse]);

  // Enqueue a GraphNode or GraphEdge for drip-feed animation
  const enqueue = useCallback((el) => {
    const wasEmpty = dripQueueRef.current.length === 0;
    dripQueueRef.current.push(el);
    if (wasEmpty) {
      if (relayoutTimerRef.current) {
        clearTimeout(relayoutTimerRef.current);
        relayoutTimerRef.current = null;
      }
      const timer = setTimeout(processNextDrip, dripIntervalRef.current);
      dripTimersRef.current.push(timer);
    }
  }, [processNextDrip]);

  // Replay a recording through the same drip-feed pipeline
  const replayRecording = useCallback(async (recording) => {
    if (!recording?.events?.length) return;
    dripTimersRef.current.forEach(clearTimeout);
    dripTimersRef.current = [];
    dripQueueRef.current = [];
    entityIndexRef.current = 0;
    cytoscape.setElements([]);
    userInteractedRef.current = false;
    stream?.clearOperations?.();
    setIsReplaying(true);

    // Coalesce recording elements (they're already GraphNode/GraphEdge from the refactored stream)
    const rawNodes = recording.events.filter(e => e.category === 'node_added').map(e => e.element);
    const rawEdges = recording.events.filter(e => e.category === 'edge_added').map(e => e.element);
    const { nodes: coalescedNodes, edges: coalescedEdges, idRemap } = coalesceGraphData(rawNodes, rawEdges, {});

    // Rebuild interleaved order
    const coalescedNodeMap = Object.fromEntries(coalescedNodes.map(n => [n.id, n]));
    const emittedIds = new Set();
    const allItems = [];

    // Build a map of element id → original_ts from recording events for pacing.
    // original_ts comes from evt.meta?.payload?.original_ts (ProgressEvent convention).
    // Falls back to evt.timestamp (ISO string converted to epoch seconds) if available.
    const elementOriginalTs = new Map();
    for (const evt of recording.events) {
      const ts = evt.meta?.payload?.original_ts
        ?? (evt.timestamp ? Date.parse(evt.timestamp) / 1000 : null);
      const elId = evt.element?.id || evt.nodeId || null;
      if (elId && ts != null) elementOriginalTs.set(elId, ts);
    }

    for (const evt of recording.events) {
      // Pipeline stage: inject marker so replay shows the same stage transitions as live
      if (evt.category === 'pipeline_stage') {
        const stage = evt.meta?.operation || evt.label?.replace(/^Pipeline:\s*/i, '').replace(/\s*\(\d+ms\)$/, '');
        const ts = evt.meta?.payload?.original_ts ?? (evt.timestamp ? Date.parse(evt.timestamp) / 1000 : null);
        if (stage) allItems.push({ _stageChange: true, stage, durationMs: evt.meta?.duration_ms ?? null, payload: { original_ts: ts } });
        continue;
      }
      // Grounding flash: no element, just a nodeId marker — keep in order for replay timing
      if (evt.category === 'grounding_flash' && evt.nodeId) {
        const ts = elementOriginalTs.get(evt.nodeId) ?? null;
        allItems.push({ _groundingFlash: true, nodeId: evt.nodeId, payload: { original_ts: ts } });
        continue;
      }
      const el = evt.element;
      if (!el) continue;
      // Attach original_ts to each element item for pacing
      const elTs = elementOriginalTs.get(el.id) ?? null;
      if (!('source' in el)) {
        // Node
        if (idRemap[el.id]) continue;
        if (coalescedNodeMap[el.id] && !emittedIds.has(el.id)) {
          allItems.push({ ...coalescedNodeMap[el.id], payload: { original_ts: elTs } });
          emittedIds.add(el.id);
        }
      } else {
        // Edge
        const src = idRemap[el.source] || el.source;
        const tgt = idRemap[el.target] || el.target;
        for (const ce of coalescedEdges) {
          if (emittedIds.has(ce.id)) continue;
          if ((ce.source === src && ce.target === tgt) || (ce.source === tgt && ce.target === src)) {
            allItems.push({ ...ce, payload: { original_ts: elTs } });
            emittedIds.add(ce.id);
            break;
          }
        }
      }
    }
    for (const ce of coalescedEdges) {
      if (!emittedIds.has(ce.id)) {
        allItems.push({ ...ce, payload: { original_ts: null } });
        emittedIds.add(ce.id);
      }
    }

    if (allItems.length === 0) {
      setIsReplaying(false);
      return;
    }

    const replayPendingNodes = new Map();

    // Compute cumulative absolute delay for each item using original_ts deltas.
    // Falls back to dripInterval-based spacing when original_ts is absent.
    // Per no-silent-degradation.md: missing original_ts logs WARNING (handled inside computeEventDelay).
    const speedFactor = SPEED_FACTORS[speedMultiplier] ?? 1;
    const cumulativeDelays = new Array(allItems.length).fill(0);
    for (let i = 1; i < allItems.length; i++) {
      const delay = computeEventDelay(
        allItems[i],
        allItems[i - 1],
        speedFactor,
        dripIntervalRef.current,
      );
      cumulativeDelays[i] = cumulativeDelays[i - 1] + delay;
    }

    allItems.forEach((el, i) => {
      const timer = setTimeout(() => {
        // Stage change marker — fire callback and return (no graph element)
        if (el._stageChange) {
          if (onStageChange) onStageChange({ stage: el.stage, durationMs: el.durationMs });
          return;
        }
        // Grounding flash marker — no graph element, just trigger the node flash animation
        if (el._groundingFlash) {
          if (onGroundingFlash) onGroundingFlash(el.nodeId);
          return;
        }

        const cy = cytoscape.cy.current;
        if (!cy) return;
        const cyEl = ('source' in el) ? graphEdgeToCyElement(el) : graphNodeToCyElement(el);
        if (cy.getElementById(cyEl.data.id).length > 0) return;

        const isNode = !('source' in el);

        // Non-memory nodes: buffer until their edge arrives
        if (isNode && el.parentId) {
          replayPendingNodes.set(cyEl.data.id, { el, cyEl });
          return;
        }

        filters.registerStreamedElements([el]);
        try {
          if (!isNode) {
            // Flush buffered endpoint nodes so they appear with the edge
            for (const nodeId of [el.source, el.target]) {
              const buffered = replayPendingNodes.get(nodeId);
              if (buffered) {
                replayPendingNodes.delete(nodeId);
                addNodeAnimated(cy, buffered.el, buffered.cyEl);
                // Push node_added breadcrumb for the flushed entity node
                stream?.pushOperation?.({
                  id: `replay-node-${i}-${buffered.el.id}`,
                  timestamp: new Date().toISOString(),
                  category: 'node_added',
                  label: `Node "${buffered.el.label || buffered.el.id}"`,
                  nodeId: buffered.el.id,
                  meta: { data: buffered.el },
                });
              }
            }
            incrementStats(0, 1);
            const added = cy.add(cyEl);
            added.style({ opacity: 0 });
            added.animate(
              { style: { opacity: 1 } },
              {
                duration: 150,
                easing: 'ease-out-sine',
                complete: () => {
                  animateEdgePulse(added);
                },
              }
            );
          } else {
            // Memory node — appear immediately
            const added = cy.add(cyEl);
            positionStreamedNode(cy, cyEl);
            incrementStats([el], 0);
            const targetW = added.style('width');
            const targetH = added.style('height');
            added.style({ width: 0, height: 0, opacity: 0 });
            added.animate(
              { style: { width: targetW, height: targetH, opacity: 1 } },
              {
                duration: 250,
                easing: 'ease-out-cubic',
                complete: () => {
                  added.addClass('streaming-new');
                  pulseStreamingNode(added);
                },
              }
            );
          }

          // Push breadcrumb
          const category = !('source' in el) ? 'node_added' : 'edge_added';
          const label = !('source' in el)
            ? `Node "${el.label || el.id}"`
            : `Edge "${el.label || el.type || 'link'}"`;
          stream?.pushOperation?.({
            id: `replay-${i}-${el.id}`,
            timestamp: new Date().toISOString(),
            category,
            label,
            nodeId: !('source' in el) ? el.id : el.source,
            meta: { data: el },
          });
        } catch {
          // Edge endpoint missing
        }
        // NO mid-stream re-fit (mirrors processNextDrip) — the single calm
        // fit in scheduleQuietLayout is enough; avoids the per-burst lurch.

        if (i === allItems.length - 1) {
          scheduleQuietLayout();
          setTimeout(() => setIsReplaying(false), GLOW_DURATION);
        }
      }, cumulativeDelays[i]);
      dripTimersRef.current.push(timer);
    });
  }, [cytoscape, incrementStats, positionStreamedNode, scheduleQuietLayout, filters, stream, addNodeAnimated, animateEdgePulse, onGroundingFlash, onStageChange, speedMultiplier]);

  // Detect manual zoom/pan
  useEffect(() => {
    const cy = cytoscape.cy.current;
    if (!cy) return;
    const markInteracted = () => { userInteractedRef.current = true; };
    cy.on('scrollzoom', markInteracted);
    cy.on('dragpan', markInteracted);
    return () => {
      cy.off('scrollzoom', markInteracted);
      cy.off('dragpan', markInteracted);
    };
  }, [cytoscape.cy, cytoscape.ready]);

  // Cleanup on unmount
  useEffect(() => () => {
    dripTimersRef.current.forEach(clearTimeout);
    if (relayoutTimerRef.current) clearTimeout(relayoutTimerRef.current);
    if (panTimerRef.current) clearTimeout(panTimerRef.current);

    // Remove any ghost pulse edges still in flight
    const cy = cytoscape.cy.current;
    if (cy) cy.remove('[_isPulse]');
  }, [cytoscape.cy]);

  // Reset helpers
  const resetDrip = useCallback(() => {
    dripTimersRef.current.forEach(clearTimeout);
    dripTimersRef.current = [];
    dripQueueRef.current = [];
    entityIndexRef.current = 0;
    userInteractedRef.current = false;
    pendingNodesRef.current.clear();
    if (relayoutTimerRef.current) { clearTimeout(relayoutTimerRef.current); relayoutTimerRef.current = null; }
    if (panTimerRef.current) { clearTimeout(panTimerRef.current); panTimerRef.current = null; }
  }, []);

  return {
    enqueue,
    replayRecording,
    isReplaying,
    setIsReplaying,
    dripInterval,
    setDripInterval,
    resetDrip,
    userInteractedRef,
    dripTimersRef,
  };
}
