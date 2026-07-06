import { useState, useEffect, useRef, useCallback } from 'react';
import { classifyEvent } from '../core/classifyEvent';
import {
  eventToGraphNode,
  eventToGraphEdge,
  extractionEntityToData,
  extractionRelationToData,
} from '../core/eventTransform';
import { coalesceGraphData } from '../core/coalesce';
import { saveRecording, shouldSaveToIDB } from '../core/eventStore';
import { subscribeProgress } from '@smartmemory/sdk-js/progress';

/**
 * React hook for real-time graph event streaming via SmartMemory SSE progress bus.
 *
 * Transport: uses `subscribeProgress` from the JS SDK (fetch-based SSE, header auth).
 * WS transport is removed — the Insights WebSocket endpoint is no longer the
 * graph viewer's data source. The new source is GET /memory/progress/stream.
 *
 * @param {Object} options
 * @param {string} [options.sseBaseUrl] - SmartMemory API base URL (e.g. 'http://localhost:9001')
 * @param {string} [options.token] - Bearer JWT for SSE auth
 * @param {boolean} [options.enabled=true] - Toggle connection
 * @param {number} [options.bufferSize=100] - Ring buffer capacity
 * @param {string} [options.runId] - When set, subscribes in replay mode (run_id + from_seq=0)
 * @param {Function} [options.onElementAdded] - Callback with GraphNode | GraphEdge
 * @param {Function} [options.onElementRemoved] - Callback with { nodeIds, edgeIds, edges }
 * @param {Function} [options.onSearchHighlight] - Callback with array of matching node IDs
 * @param {Function} [options.onPipelineProgress] - Callback with { nodeId, stage, durationMs }
 * @param {Function} [options.onGraphCleared] - Callback when graph is cleared
 * @param {Function} [options.onReconnect] - Callback on SSE reconnection
 * @param {Function} [options.onGroundingFlash] - Callback with nodeId when entity is grounded
 * @param {Object} [options.clock] - Optional shared replay clock from
 *   useReplayClock(). When provided, this hook does NOT subscribe to SSE
 *   directly — it consumes events released by the clock at recorded
 *   `payload.original_ts` pacing, with the same classify→batch→callback
 *   pipeline. Use this when a single playhead drives multiple views
 *   (Run Inspector: <PipelineDag clock={c}> + <GraphExplorer clock={c}>).
 *   On clock reset (e.g. seek-backward, runId change), pending state is
 *   cleared and `onGraphCleared` fires so the graph view re-builds.
 */
export function useGraphStream(options = {}) {
  const {
    sseBaseUrl = '',
    token,
    enabled = true,
    bufferSize = 100,
    runId,
    onElementAdded,
    onElementRemoved,
    onSearchHighlight,
    onPipelineProgress,
    onGraphCleared,
    onReconnect,
    onGroundingFlash,
    onReplayNotFound,
    clock = null,
  } = options;

  const [status, setStatus] = useState('disconnected');
  const [operations, setOperations] = useState(() => {
    try {
      const saved = sessionStorage.getItem('graph:operations');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [opsPerSecond, setOpsPerSecond] = useState(0);
  const isPausedRef = useRef(false);
  const [isPaused, setIsPaused] = useState(false);

  const callbacksRef = useRef({ onElementAdded, onElementRemoved, onSearchHighlight, onPipelineProgress, onGraphCleared, onReconnect, onGroundingFlash, onReplayNotFound });
  callbacksRef.current = { onElementAdded, onElementRemoved, onSearchHighlight, onPipelineProgress, onGraphCleared, onReconnect, onGroundingFlash, onReplayNotFound };

  const batchRef = useRef([]);
  const batchTimerRef = useRef(null);
  const opsTimestampsRef = useRef([]);
  const unmountedRef = useRef(false);
  const pendingElementsRef = useRef([]);
  const recordingBufferRef = useRef({});
  const RECORDING_FLUSH_DELAY = 2000;
  const canonicalMapRef = useRef({});
  // Set to a non-null string when SSE fails for the retry budget — gates IDB writes.
  const sseFailedReasonRef = useRef(null);

  const flushBatch = useCallback(() => {
    if (unmountedRef.current || isPausedRef.current) return;
    const batch = batchRef.current;
    batchRef.current = [];
    if (batch.length === 0) return;

    const now = Date.now();
    opsTimestampsRef.current.push(...batch.map(() => now));
    const cutoff = now - 5000;
    opsTimestampsRef.current = opsTimestampsRef.current.filter((t) => t > cutoff);
    const timestamps = opsTimestampsRef.current;
    const elapsed = timestamps.length > 1 ? Math.max((now - timestamps[0]) / 1000, 1) : 1;
    const windowSec = Math.min(elapsed, 5);
    setOpsPerSecond(Math.round((timestamps.length / windowSec) * 10) / 10);

    setOperations((prev) => {
      const next = [...batch, ...prev];
      const result = next.length > bufferSize ? next.slice(0, bufferSize) : next;
      try { sessionStorage.setItem('graph:operations', JSON.stringify(result)); } catch {}
      return result;
    });

    const cbs = callbacksRef.current;
    const searchIds = [];
    const removedNodeIds = [];
    const removedEdgeIds = [];
    const removedEdges = [];

    // Build GraphNode/GraphEdge list preserving backend order
    const rawElements = [];
    const rawElementIndex = new Map();
    let graphCleared = false;
    for (const op of batch) {
      if (op.category === 'graph_cleared') {
        graphCleared = true;
      } else if (op.category === 'node_added') {
        const el = eventToGraphNode(op.meta?.data, op.meta?.payload);
        if (el) {
          const previousIndex = rawElementIndex.get(el.id);
          if (previousIndex != null) rawElements[previousIndex] = null;
          rawElementIndex.set(el.id, rawElements.length);
          rawElements.push(el);
        }
      } else if (op.category === 'edge_added') {
        const el = eventToGraphEdge(op.meta?.data, op.meta?.payload);
        if (el) {
          const previousIndex = rawElementIndex.get(el.id);
          if (previousIndex != null) rawElements[previousIndex] = null;
          rawElementIndex.set(el.id, rawElements.length);
          rawElements.push(el);
        }
      } else if (op.category === 'node_removed' && op.nodeId) {
        const pendingIndex = rawElementIndex.get(op.nodeId);
        if (pendingIndex != null) rawElements[pendingIndex] = null;
        removedNodeIds.push(op.nodeId);
      } else if (op.category === 'edge_removed') {
        if (op.edgeId) removedEdgeIds.push(op.edgeId);
        const pendingIndex = op.edgeId ? rawElementIndex.get(op.edgeId) : null;
        if (pendingIndex != null) rawElements[pendingIndex] = null;
        const sourceId = op.meta?.data?.source_id || op.meta?.data?.source || null;
        const targetId = op.meta?.data?.target_id || op.meta?.data?.target || null;
        const edgeType = op.meta?.data?.edge_type || op.meta?.data?.link_type || null;
        if (sourceId || targetId || edgeType) {
          rawElements.forEach((el, idx) => {
            if (!el || !('source' in el)) return;
            if (sourceId && el.source !== sourceId) return;
            if (targetId && el.target !== targetId) return;
            if (edgeType && el.type !== edgeType && el.edge_type !== edgeType) return;
            rawElements[idx] = null;
          });
        }
        removedEdges.push({
          edgeId: op.edgeId || null,
          sourceId,
          targetId,
          edgeType,
        });
      } else if (op.category === 'search_highlight' && op.matchIds?.length) {
        searchIds.push(...op.matchIds);
      } else if (op.category === 'pipeline_stage' && cbs.onPipelineProgress) {
        cbs.onPipelineProgress({ nodeId: op.nodeId, stage: op.meta?.operation, durationMs: op.meta?.duration_ms });
      } else if (op.category === 'grounding_flash' && op.nodeId && cbs.onGroundingFlash) {
        cbs.onGroundingFlash(op.nodeId);
      }
    }

    if (graphCleared && cbs.onGraphCleared) {
      pendingElementsRef.current = [];
      canonicalMapRef.current = {};
      cbs.onGraphCleared();
      return;
    }

    if ((removedNodeIds.length > 0 || removedEdgeIds.length > 0 || removedEdges.length > 0) && cbs.onElementRemoved) {
      cbs.onElementRemoved({
        nodeIds: [...new Set(removedNodeIds)],
        edgeIds: [...new Set(removedEdgeIds)],
        edges: removedEdges,
      });
    }

    // Coalesce — now operates on GraphNode/GraphEdge
    const orderedElements = rawElements.filter(Boolean);
    const rawNodes = orderedElements.filter(el => !('source' in el));
    const rawEdges = orderedElements.filter(el => 'source' in el);
    const { nodes: coalescedNodes, edges: coalescedEdges, idRemap } = coalesceGraphData(
      rawNodes, rawEdges, canonicalMapRef.current
    );

    // Rebuild interleaved order
    const coalescedNodeIds = new Set(coalescedNodes.map(n => n.id));
    const coalescedNodeMap = Object.fromEntries(coalescedNodes.map(n => [n.id, n]));
    const emittedIds = new Set();
    const interleavedElements = [];

    for (const raw of orderedElements) {
      if (!('source' in raw)) {
        // Node
        if (idRemap[raw.id]) continue;
        if (coalescedNodeIds.has(raw.id) && !emittedIds.has(raw.id)) {
          interleavedElements.push(coalescedNodeMap[raw.id]);
          emittedIds.add(raw.id);
        }
      } else {
        // Edge: find coalesced version
        const src = idRemap[raw.source] || raw.source;
        const tgt = idRemap[raw.target] || raw.target;
        for (const ce of coalescedEdges) {
          if (emittedIds.has(ce.id)) continue;
          if ((ce.source === src && ce.target === tgt) || (ce.source === tgt && ce.target === src)) {
            interleavedElements.push(ce);
            emittedIds.add(ce.id);
            break;
          }
        }
      }
    }
    for (const ce of coalescedEdges) {
      if (!emittedIds.has(ce.id)) {
        interleavedElements.push(ce);
        emittedIds.add(ce.id);
      }
    }

    pendingElementsRef.current.push(...interleavedElements);

    // Recording accumulation
    const batchKey = batch[0]?.traceId || `batch-${Date.now()}`;
    for (const op of batch) {
      // Pipeline stage: record so replay can show the same stage indicator transitions.
      if (op.category === 'pipeline_stage') {
        const groupKey = op.traceId || batchKey;
        const buf = recordingBufferRef.current;
        if (!buf[groupKey]) buf[groupKey] = { elements: [], label: '', timer: null };
        buf[groupKey].elements.push({
          category: 'pipeline_stage',
          meta: op.meta,
          label: op.label,
          timestamp: op.timestamp,
        });
        continue;
      }

      // Grounding flash: no graph element, but record nodeId so replay can trigger the flash animation.
      if (op.category === 'grounding_flash' && op.nodeId) {
        const groupKey = op.traceId || batchKey;
        const buf = recordingBufferRef.current;
        if (buf[groupKey]) {
          buf[groupKey].elements.push({ category: 'grounding_flash', nodeId: op.nodeId, timestamp: op.timestamp });
        }
        continue;
      }

      const el = op.category === 'node_added' ? eventToGraphNode(op.meta?.data, op.meta?.payload)
        : op.category === 'edge_added' ? eventToGraphEdge(op.meta?.data, op.meta?.payload)
        : null;
      if (!el) continue;

      const groupKey = op.traceId || batchKey;
      const buf = recordingBufferRef.current;
      if (!buf[groupKey]) {
        buf[groupKey] = { elements: [], label: '', timer: null };
      }
      const rec = buf[groupKey];
      rec.elements.push({ category: op.category, element: el, timestamp: op.timestamp });
      if (!rec.label && op.category === 'node_added' && el.content) {
        rec.label = el.content.substring(0, 60);
      }
      if (rec.timer) clearTimeout(rec.timer);
      const capturedKey = groupKey;
      rec.timer = setTimeout(() => {
        const finalRec = buf[capturedKey];
        if (finalRec && finalRec.elements.length > 0) {
          // IDB write only on offline / SSE-failure path (no-silent-degradation.md).
          // In the common case (online + SSE connected) shouldSaveToIDB returns false.
          if (shouldSaveToIDB(sseFailedReasonRef.current)) {
            saveRecording({
              traceId: capturedKey,
              label: finalRec.label || `Recording ${new Date().toLocaleTimeString()}`,
              events: finalRec.elements,
            });
          }
        }
        delete buf[capturedKey];
      }, RECORDING_FLUSH_DELAY);
    }

    // Dispatch
    if (interleavedElements.length > 0 && cbs.onElementAdded) {
      for (const el of interleavedElements) {
        cbs.onElementAdded(el);
      }
    }
    if (searchIds.length > 0 && cbs.onSearchHighlight) {
      cbs.onSearchHighlight([...new Set(searchIds)]);
    }
  }, [bufferSize]);

  // VIS-PIPELINE-DAG-1 Phase 4: clock-driven path. When a shared clock is
  // provided, consume events from it instead of opening a direct SSE
  // subscription — the clock owns SSE for all consumers in the Run Inspector.
  // Stable identities (subscribe / subscribeReset) are pulled out so the
  // effect doesn't re-fire on every snapshot update.
  const clockSubscribe = clock?.subscribe;
  const clockSubscribeReset = clock?.subscribeReset;
  useEffect(() => {
    if (!enabled || !clockSubscribe) return undefined;

    unmountedRef.current = false;
    setStatus('connected');

    const handleEvent = (progressEvent) => {
      if (unmountedRef.current || isPausedRef.current) return;
      const classified = classifyProgressEvent(progressEvent);
      if (!classified) return;
      batchRef.current.push(classified);
      // No 200ms batch timer in clock-driven mode — flush synchronously per
      // released batch so the playhead and graph stay perceptually in sync
      // with the DAG view also driven by the same clock.
      flushBatch();
    };

    const unsubEvents = clockSubscribe(handleEvent);
    // Codex Round 1 MUST FIX 1 + Round 3 SHOULD ADJUST: shared reset body
    // used by both the seek-backward reset signal AND clock-prop teardown
    // (e.g. parent swaps the clock instance). Without the teardown call,
    // `batchRef`/`canonicalMapRef`/recording timers would leak across clock
    // changes and corrupt the rebuilt graph in the next clock-driven run.
    const resetStreamState = ({ notifyGraphCleared }) => {
      batchRef.current = [];
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current);
        batchTimerRef.current = null;
      }
      pendingElementsRef.current = [];
      canonicalMapRef.current = {};
      opsTimestampsRef.current = [];
      const buf = recordingBufferRef.current;
      for (const key of Object.keys(buf)) {
        if (buf[key]?.timer) clearTimeout(buf[key].timer);
      }
      recordingBufferRef.current = {};
      if (notifyGraphCleared) {
        callbacksRef.current.onGraphCleared?.();
      }
    };

    const unsubReset = clockSubscribeReset
      ? clockSubscribeReset(() => resetStreamState({ notifyGraphCleared: true }))
      : () => {};

    return () => {
      unmountedRef.current = true;
      try { unsubEvents(); } catch (_) { /* tearing down */ }
      try { unsubReset(); } catch (_) { /* tearing down */ }
      // Wipe stream state on teardown so a subsequent clock-prop swap or
      // SSE-path fallback starts clean. Don't fire onGraphCleared during
      // unmount — consumer is also tearing down.
      resetStreamState({ notifyGraphCleared: false });
    };
  }, [enabled, clockSubscribe, clockSubscribeReset, flushBatch]);

  // SSE connection via subscribeProgress (skipped when a clock is provided)
  useEffect(() => {
    unmountedRef.current = false;

    if (!enabled) {
      setStatus('disconnected');
      return;
    }
    if (clockSubscribe) {
      // Clock owns the subscription — see effect above.
      return undefined;
    }

    let unmounted = false;
    let subscription = null;

    // Reset SSE-failed gate on each new connection attempt
    sseFailedReasonRef.current = null;
    setStatus('connecting');

    const subscribeOpts = {
      baseUrl: sseBaseUrl,
      onEvent(progressEvent) {
        if (unmounted || isPausedRef.current) return;

        // Translate ProgressEvent into the legacy classified-event shape so the
        // existing batching + callback-dispatch pipeline (flushBatch) is unchanged.
        const classified = classifyProgressEvent(progressEvent);
        if (!classified) return;

        batchRef.current.push(classified);

        if (!batchTimerRef.current) {
          batchTimerRef.current = setTimeout(() => {
            batchTimerRef.current = null;
            flushBatch();
          }, 200);
        }
      },
      onError(err) {
        if (unmounted) return;
        const errMsg = err?.message || String(err) || '';
        const reason = errMsg || 'SSE connection failed after retries';
        console.warn('[useGraphStream] SSE error:', err);
        setStatus('disconnected');
        // Flip the IDB gate on so subsequent recording flushes persist for offline replay.
        // shouldSaveToIDB(reason) will log the warning per no-silent-degradation.md.
        sseFailedReasonRef.current = reason;

        // 404: run has expired from the stream window — try IDB, then surface "not available"
        if (runId && errMsg.includes('404')) {
          import('../core/eventStore').then(({ getRecordingByRunId }) =>
            getRecordingByRunId(runId)
          ).then((recording) => {
            if (unmounted) return;
            callbacksRef.current.onReplayNotFound?.(recording);
          });
        }
      },
      onReconnect() {
        if (unmounted) return;
        callbacksRef.current.onReconnect?.();
      },
    };

    if (token) {
      subscribeOpts.token = token;
    }

    // Replay mode: pass runId + fromSeq=0
    if (runId) {
      subscribeOpts.runId = runId;
      subscribeOpts.fromSeq = 0;
    }

    subscription = subscribeProgress(subscribeOpts);
    setStatus('connected');

    return () => {
      unmounted = true;
      unmountedRef.current = true;
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current);
        batchTimerRef.current = null;
      }
      // Clear recording buffer timers to prevent memory leak
      const buf = recordingBufferRef.current;
      for (const key of Object.keys(buf)) {
        if (buf[key]?.timer) clearTimeout(buf[key].timer);
      }
      recordingBufferRef.current = {};
      if (subscription) {
        subscription.close();
      }
    };
  }, [sseBaseUrl, token, enabled, runId, flushBatch, clockSubscribe]);

  const pause = useCallback(() => {
    isPausedRef.current = true;
    setIsPaused(true);
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
      batchTimerRef.current = null;
    }
    batchRef.current = [];
  }, []);

  const resume = useCallback(() => {
    isPausedRef.current = false;
    setIsPaused(false);
  }, []);

  const drainPending = useCallback(() => {
    const elements = pendingElementsRef.current;
    pendingElementsRef.current = [];
    return elements;
  }, []);

  const clearOperations = useCallback(() => {
    setOperations([]);
    setOpsPerSecond(0);
    opsTimestampsRef.current = [];
    try { sessionStorage.removeItem('graph:operations'); } catch {}
  }, []);

  const pushOperation = useCallback((op) => {
    setOperations((prev) => {
      const next = [op, ...prev];
      return next.length > bufferSize ? next.slice(0, bufferSize) : next;
    });
  }, [bufferSize]);

  const getStateUpTo = useCallback((opId) => {
    const idx = operations.findIndex(o => o.id === opId);
    if (idx === -1) return null;
    const relevant = operations.slice(idx);
    const nodes = [];
    const edges = [];
    for (const op of relevant) {
      if (op.category === 'node_added') {
        const el = eventToGraphNode(op.meta?.data, op.meta?.payload);
        if (el) nodes.push(el);
      } else if (op.category === 'edge_added') {
        const el = eventToGraphEdge(op.meta?.data, op.meta?.payload);
        if (el) edges.push(el);
      }
    }
    const { nodes: cn, edges: ce } = coalesceGraphData(nodes, edges, {});
    return { nodes: cn, edges: ce };
  }, [operations]);

  return { status, operations, opsPerSecond, isPaused, pause, resume, drainPending, clearOperations, pushOperation, getStateUpTo, recordingBufferRef };
}

// ---------------------------------------------------------------------------
// ProgressEvent → classified event adapter
//
// The existing flushBatch() dispatch pipeline (and the recording accumulator)
// work on the "classified" shape produced by classifyEvent(rawWsFrame).
// ProgressEvents have a different wire shape (kind, stage, payload.data, etc.).
// This adapter bridges the two without changing classifyEvent or flushBatch.
// ---------------------------------------------------------------------------

/**
 * Translate a ProgressEvent from the SSE bus into the classified-event shape
 * that useGraphStream's flushBatch + recording accumulator expect.
 *
 * Returns null for event kinds the graph viewer doesn't handle.
 *
 * @param {Object} progressEvent - ProgressEvent per progress-event-contract.json
 */
export function classifyProgressEvent(progressEvent) {
  if (!progressEvent) return null;

  const { kind, stage, status, payload, run_id, seq, ts } = progressEvent;
  const id = `pe-${run_id}-${seq}`;
  const timestamp = ts ? new Date(ts * 1000).toISOString() : new Date().toISOString();
  const traceId = run_id;
  const base = { id, timestamp, traceId, meta: progressEvent };
  const deletionActions = new Set(['delete', 'deleted', 'remove', 'removed']);
  const updateActions = new Set(['update', 'updated', 'replace', 'replaced']);
  const actionFor = (data) => String(payload?.action || payload?.operation || data?.action || data?.operation || '').toLowerCase();

  // Graph node events
  if (kind === 'graph.node' && payload?.data) {
    const data = payload.data;
    const nodeId = data.memory_id || data.item_id || data.node_id || data.id || null;
    if (nodeId && nodeId.startsWith('wikipedia:')) return null;
    const action = actionFor(data);
    if (deletionActions.has(action)) {
      return {
        ...base,
        category: 'node_removed',
        label: `Node "${data.label || nodeId || 'unknown'}" removed`,
        nodeId,
        meta: { ...progressEvent, data, operation: 'delete_node' },
      };
    }
    return {
      ...base,
      category: 'node_added',
      label: `Node "${data.label || nodeId || 'unknown'}" ${updateActions.has(action) ? 'updated' : 'added'}`,
      nodeId,
      meta: { ...progressEvent, data, operation: updateActions.has(action) ? 'update_node' : 'add_node' },
    };
  }

  // Graph edge events
  if (kind === 'graph.edge' && payload?.data) {
    const data = payload.data;
    const src = data.source_id || data.source || '';
    const tgt = data.target_id || data.target || '';
    const edgeType = data.edge_type || data.link_type || 'RELATES_TO';
    const action = actionFor(data);
    const edgeId = data.edge_id || (src && tgt ? `${src}->${tgt}` : null);

    if (deletionActions.has(action)) {
      return {
        ...base,
        category: 'edge_removed',
        label: `Edge "${edgeType}" removed`,
        nodeId: src || null,
        edgeId,
        meta: { ...progressEvent, data, operation: 'delete_edge' },
      };
    }

    if (edgeType === 'GROUNDED_IN' || src.startsWith('wikipedia:') || tgt.startsWith('wikipedia:')) {
      const groundedNodeId = src.startsWith('wikipedia:') ? tgt : src;
      const wikiId = src.startsWith('wikipedia:') ? src : tgt;
      const wikiName = wikiId.replace('wikipedia:', '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      return { ...base, category: 'grounding_flash', label: `Grounded "${wikiName}"`, nodeId: groundedNodeId };
    }

    return {
      ...base,
      category: 'edge_added',
      label: `Edge "${edgeType}"`,
      nodeId: src || null,
      edgeId,
      meta: { ...progressEvent, data, operation: 'add_edge' },
    };
  }

  // Pipeline DAG topology declaration (VIS-PIPELINE-DAG-1)
  if (kind === 'pipeline.dag') {
    const pipeline = payload?.pipeline || 'pipeline';
    const nodeCount = payload?.nodes?.length || 0;
    return {
      ...base,
      category: 'pipeline_dag',
      label: `Pipeline DAG: ${pipeline} (${nodeCount} stages)`,
      nodeId: null,
      meta: { ...progressEvent, operation: 'pipeline_dag' },
    };
  }

  // Pipeline stage events
  if (kind === 'pipeline.stage') {
    // VIS-PIPELINE-DAG-1 Phase 2: post-extraction batched drip
    // (IDEA-85 fold-in). pipeline.stage events from llm_extract carrying
    // payload.entity / payload.relation are projected as graph elements
    // so the viewer drip-feeds them during the rest of the pipeline.
    if (stage === 'llm_extract' && payload?.entity) {
      const data = extractionEntityToData(payload.entity);
      if (data) {
        return {
          ...base,
          category: 'node_added',
          label: `Extracted entity "${payload.entity.name}"`,
          nodeId: data.id,
          meta: { ...progressEvent, data, operation: 'add_node' },
        };
      }
      // Drip event was present but unprojectable — surface per
      // no-silent-degradation.md instead of falling through silently.
      console.warn(
        '[useGraphStream] llm_extract drip entity payload unprojectable; skipping graph element',
        payload.entity,
      );
    }
    if (stage === 'llm_extract' && payload?.relation) {
      const data = extractionRelationToData(payload.relation);
      if (data) {
        return {
          ...base,
          category: 'edge_added',
          label: `Extracted relation "${data.edge_type}"`,
          nodeId: data.source_id,
          edgeId: data.id,
          meta: { ...progressEvent, data, operation: 'add_edge' },
        };
      }
      console.warn(
        '[useGraphStream] llm_extract drip relation payload unprojectable; skipping graph element',
        payload.relation,
      );
    }

    const stageName = stage || 'unknown';
    const durationMs = payload?.duration_ms;
    const durationStr = durationMs != null ? ` (${Math.round(durationMs)}ms)` : '';
    return {
      ...base,
      category: 'pipeline_stage',
      label: `Pipeline: ${stageName.replace(/_/g, ' ')}${durationStr}`,
      nodeId: payload?.memory_id || null,
      meta: { ...progressEvent, operation: stageName, duration_ms: durationMs },
    };
  }

  // Graph clear events
  if (kind === 'graph.cleared') {
    return { ...base, category: 'graph_cleared', label: 'Graph cleared', nodeId: null };
  }

  // Search result events
  if (kind === 'search.result' && payload?.result_ids) {
    return {
      ...base,
      category: 'search_highlight',
      label: `Search: ${payload.result_ids.length} results`,
      nodeId: null,
      matchIds: payload.result_ids,
    };
  }

  // Ingest start events
  if (kind === 'ingest.started') {
    const preview = payload?.content?.substring(0, 30) || payload?.memory_id || '';
    return { ...base, category: 'ingest_started', label: `Ingesting: "${preview}..."`, nodeId: payload?.memory_id || null };
  }

  return null;
}
