/**
 * usePipelineDag — subscribe to a run's progress stream and maintain
 * pipeline-DAG topology + per-node UI state.
 *
 * Topology comes from the one-shot `pipeline.dag` event; UI state advances
 * on subsequent `pipeline.stage` events using the derivation rules in
 * docs/features/VIS-PIPELINE-DAG-1/design.md. The per-stage event log
 * (`eventsByStage`, feeds RunLogPanel) is kind-agnostic: any event naming a
 * stage is kept (e.g. Studio `studio.job` wrapper events like relink), while
 * `statusByStage`/`errorByStage` stay `pipeline.stage`-derived.
 *
 * UI state machine (derived from contract status + payload.reason):
 *   pending      → declared in DAG, no event yet
 *   active       → most recent event status ∈ {started, progress}
 *   complete     → terminal status=ok
 *   skipped      → terminal status=warn, reason ∈ {skipped, procedure_match}
 *   timed_out    → terminal status=warn, reason=timed_out
 *   errored      → terminal status=error
 *   never_entered → declared in DAG; no event ever arrived
 *
 * Returns { topology, statusByStage, isReady, error }.
 *
 * VIS-PIPELINE-DAG-1 Phase 1b.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeProgress } from '@smartmemory/sdk-js/progress';
import { appendStagedEvent, deriveStageStatus, fillNeverEntered } from '../core/pipelineDagState';

/**
 * @param {Object} opts
 * @param {string} opts.runId               - Run to replay/follow.
 * @param {string} [opts.baseUrl]           - SSE base URL.
 * @param {string} [opts.token]             - Bearer token for authenticated SSE.
 * @param {boolean} [opts.enabled=true]     - Set to false to disconnect.
 * @param {Object} [opts.clock]             - Optional shared replay clock from
 *   useReplayClock(). When provided, this hook does NOT subscribe to SSE
 *   directly — it consumes events released by the clock at recorded
 *   `payload.original_ts` pacing. Use this when multiple views (e.g.
 *   `<PipelineDag>` + `<GraphExplorer>`) must scrub in lockstep against the
 *   same run. When omitted, falls back to the original direct-subscription
 *   behavior used in Phase 1b.
 */
export function usePipelineDag({ runId, baseUrl, token, enabled = true, clock = null }) {
  const [topology, setTopology] = useState(null);
  const [statusByStage, setStatusByStage] = useState({});
  // Phase 5: per-stage event log + error capture for tooltip / log-panel.
  const [eventsByStage, setEventsByStage] = useState({});
  const [errorByStage, setErrorByStage] = useState({});
  const [error, setError] = useState(null);
  const subRef = useRef(null);
  const topologyRef = useRef(null);

  /**
   * Caller signals that the run has terminated (e.g. saw an ingest.complete event,
   * or external signal like the Run Inspector's "run ended" state). Fills any
   * stages declared in the DAG but never seen with `never_entered`.
   */
  const markRunComplete = useCallback(() => {
    setStatusByStage((prev) =>
      fillNeverEntered(topologyRef.current?.nodes || [], prev),
    );
  }, []);

  // Pure event handler — same logic for both clock-driven and SSE-driven paths.
  const handleEventRef = useRef(null);
  handleEventRef.current = (progressEvent) => {
    const { kind, stage, status, payload } = progressEvent || {};
    if (kind === 'pipeline.dag') {
      topologyRef.current = payload || null;
      setTopology(payload || null);
      return;
    }
    if (!stage) return;
    if (kind === 'pipeline.stage') {
      // DAG state machine + node error tooltips derive from pipeline.stage
      // events ONLY — other kinds must not advance or clobber node states.
      setStatusByStage((prev) => {
        const nextUiState = deriveStageStatus({
          previous: prev[stage],
          status,
          payload,
        });
        if (nextUiState === prev[stage]) return prev;
        return { ...prev, [stage]: nextUiState };
      });
      // Phase 5: capture error message for hover tooltip.
      if (status === 'error' && payload?.error) {
        setErrorByStage((prev) => ({
          ...prev,
          [stage]: typeof payload.error === 'string'
            ? { message: payload.error }
            : payload.error,
        }));
      }
    }
    // Log panel is kind-agnostic: every staged event (pipeline.stage,
    // studio.job, evolver.result, …) is kept, latest 50 per stage, so
    // wrapper-job events like Studio's relink are visible in the run log.
    setEventsByStage((prev) => appendStagedEvent(prev, progressEvent));
  };

  // --- Clock-driven path (Phase 3): consume events from the shared clock ---
  // Codex Round 1 MUST FIX 1: depend on stable subscribe/subscribeReset
  // identities, not the whole clock object. (The clock handle is now stable
  // across renders, but keying on members is still safer.)
  const subscribe = clock?.subscribe;
  const subscribeReset = clock?.subscribeReset;
  useEffect(() => {
    if (!enabled || !subscribe) return undefined;

    // Reset DAG accumulator on first attach (clock might already have events
    // released — those get re-played to us if we call subscribeReset+seek,
    // but on first mount we just start fresh).
    setTopology(null);
    topologyRef.current = null;
    setStatusByStage({});
    setEventsByStage({});
    setErrorByStage({});
    setError(null);

    const unsubEvents = subscribe((ev) => {
      handleEventRef.current?.(ev);
    });
    // Codex Round 1 MUST FIX 2: when the clock seeks (esp. backward),
    // sticky terminal states would prevent correct re-derivation. The clock
    // fires reset BEFORE re-fanning released events; we wipe accumulator on
    // that signal so the replayed events derive cleanly.
    const unsubReset = subscribeReset
      ? subscribeReset(() => {
          setTopology(null);
          topologyRef.current = null;
          setStatusByStage({});
    setEventsByStage({});
    setErrorByStage({});
        })
      : () => {};

    return () => {
      try { unsubEvents(); } catch (_) { /* tearing down */ }
      try { unsubReset(); } catch (_) { /* tearing down */ }
    };
  }, [subscribe, subscribeReset, enabled]);

  // --- Direct SSE path (Phase 1b fallback): only when no clock is provided ---
  // Key on `subscribe` truthiness rather than the whole clock identity to
  // avoid spurious teardowns if a parent passes a freshly-built clock object.
  const hasClock = !!subscribe;
  useEffect(() => {
    if (hasClock) return undefined; // clock owns subscription
    // Always clear stale state when runId/enabled changes — even when disabling.
    setTopology(null);
    topologyRef.current = null;
    setStatusByStage({});
    setEventsByStage({});
    setErrorByStage({});
    setError(null);

    if (!enabled || !runId) return undefined;

    let unmounted = false;

    const opts = {
      baseUrl,
      token,
      runId,
      fromSeq: 0, // replay from start so we never miss the pipeline.dag event
      onEvent(progressEvent) {
        if (unmounted) return;
        handleEventRef.current?.(progressEvent);
      },
      onError(err) {
        if (unmounted) return;
        setError(err);
      },
    };

    subRef.current = subscribeProgress(opts);

    return () => {
      unmounted = true;
      try {
        subRef.current?.close?.();
      } catch (_) {
        /* swallow — tearing down */
      }
      subRef.current = null;
    };
  }, [runId, baseUrl, token, enabled, hasClock]);

  return {
    topology,
    statusByStage,
    eventsByStage,
    errorByStage,
    isReady: topology !== null,
    error,
    markRunComplete,
  };
}
