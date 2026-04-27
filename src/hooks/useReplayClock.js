/**
 * useReplayClock — React wrapper around ReplayClock for VIS-PIPELINE-DAG-1
 * Phase 3.
 *
 * Subscribes to a run's progress stream in replay mode (runId + fromSeq=0),
 * pumps events into a pure ReplayClock, and runs a 50ms tick interval that
 * advances virtual time and releases events to per-render React subscribers.
 *
 * Returns a stable handle:
 *
 *   {
 *     now,         // virtual epoch seconds (or null until first event)
 *     paused,      // boolean
 *     speed,       // 0.5 / 1 / 2 / etc.
 *     isReady,     // true once first event arrived
 *     error,       // last SSE error, or null
 *     firstTs,     // earliest buffered event ts (or null)
 *     lastTs,      // latest buffered event ts (or null)
 *     durationSec, // lastTs - firstTs (or 0)
 *     pause(), play(), setSpeed(s), seek(ts),
 *     subscribe(cb) → unsubscribe()    // cb(event) per released event
 *   }
 *
 * Phase 4 wires both <PipelineDag clock={clock}> and <GraphExplorer clock=...>
 * to the same instance for lockstep scrub.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { subscribeProgress } from '@smartmemory/sdk-js/progress';
import { ReplayClock } from '../core/replayClock';

const TICK_MS = 50;

/**
 * @param {Object} opts
 * @param {string} opts.runId
 * @param {string} [opts.baseUrl]
 * @param {string} [opts.token]
 * @param {boolean} [opts.enabled=true]
 * @param {boolean} [opts.autoplay=false]   - Start playing as soon as first event arrives.
 * @param {number}  [opts.tickMs=50]        - Override the tick interval (mostly for tests).
 */
export function useReplayClock({
  runId,
  baseUrl,
  token,
  enabled = true,
  autoplay = false,
  tickMs = TICK_MS,
} = {}) {
  // The clock instance survives across renders; its state is mirrored into
  // React state via the snapshot fields below so consumers re-render.
  const clockRef = useRef(null);
  if (clockRef.current === null) {
    clockRef.current = new ReplayClock();
  }

  const [snapshot, setSnapshot] = useState({
    now: null,
    paused: true,
    speed: 1.0,
    firstTs: null,
    lastTs: null,
    durationSec: 0,
    isReady: false,
    // Bumps on every reset (runId change, seek-backward) so consumers that
    // accumulate state from released events know to discard prior accumulator.
    resetGeneration: 0,
  });
  const [error, setError] = useState(null);
  const subscribersRef = useRef(new Set());
  const resetSubscribersRef = useRef(new Set());
  const subRef = useRef(null);
  const intervalRef = useRef(null);
  const autoplayRef = useRef(autoplay);
  useEffect(() => {
    autoplayRef.current = autoplay;
  }, [autoplay]);

  const sync = useCallback((extra = {}) => {
    const c = clockRef.current;
    setSnapshot((prev) => ({
      ...prev,
      now: c.now,
      paused: c.paused,
      speed: c.speed,
      firstTs: c.firstTs,
      lastTs: c.lastTs,
      durationSec: c.durationSec,
      isReady: c.isReady,
      ...extra,
    }));
  }, []);

  const fanoutEvents = useCallback((events) => {
    if (!events.length) return;
    for (const cb of subscribersRef.current) {
      for (const ev of events) {
        try {
          cb(ev);
        } catch (cbErr) {
          console.warn('[useReplayClock] subscriber threw:', cbErr);
        }
      }
    }
  }, []);

  const fanoutReset = useCallback(() => {
    for (const cb of resetSubscribersRef.current) {
      try {
        cb();
      } catch (cbErr) {
        console.warn('[useReplayClock] reset subscriber threw:', cbErr);
      }
    }
  }, []);

  // Snapshot mirror — used by seek() and the SSE reset effect to bump
  // resetGeneration without becoming a state-dep that would re-create the
  // closures on every snapshot change.
  const snapshotRef = useRef(snapshot);
  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  // --- SSE subscription ---
  useEffect(() => {
    // Reset clock + snapshot whenever runId / enabled changes.
    // Codex Round 2: must also notify reset-subscribers and bump
    // resetGeneration. Without this, when a parent switches runId, the
    // stable clock handle stays the same, so usePipelineDag's effect doesn't
    // re-fire — and old statusByStage would carry into the new run until
    // the next seek().
    clockRef.current = new ReplayClock();
    fanoutReset();
    setError(null);
    sync({ resetGeneration: snapshotRef.current.resetGeneration + 1 });

    if (!enabled || !runId) return undefined;

    let unmounted = false;

    const opts = {
      baseUrl,
      token,
      runId,
      fromSeq: 0,
      onEvent(progressEvent) {
        if (unmounted) return;
        const wasReady = clockRef.current.isReady;
        const ok = clockRef.current.addEvent(progressEvent);
        if (!ok) return;
        // First event just arrived — optionally autoplay.
        if (!wasReady && autoplayRef.current) {
          clockRef.current.play();
        }
        sync();
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
        /* tearing down */
      }
      subRef.current = null;
    };
  }, [runId, baseUrl, token, enabled, sync, fanoutReset]);

  // --- Tick interval ---
  useEffect(() => {
    if (!enabled) return undefined;
    intervalRef.current = setInterval(() => {
      const released = clockRef.current.tick(tickMs);
      if (released.length > 0) {
        fanoutEvents(released);
        sync();
      } else if (!clockRef.current.paused) {
        sync(); // refresh `now` even when no events released
      }
    }, tickMs);
    return () => {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [enabled, tickMs, fanoutEvents, sync]);

  // --- Imperative controls (stable identities) ---
  const play = useCallback(() => {
    clockRef.current.play();
    sync();
  }, [sync]);

  const pause = useCallback(() => {
    clockRef.current.pause();
    sync();
  }, [sync]);

  const setSpeed = useCallback((s) => {
    clockRef.current.setSpeed(s);
    sync();
  }, [sync]);

  const seek = useCallback((ts) => {
    // Notify subscribers FIRST so stateful consumers can reset their
    // accumulators (DAG terminal states are sticky — replaying released
    // events into existing state would not downgrade `complete` → `active`).
    fanoutReset();
    const released = clockRef.current.seek(ts);
    if (released.length > 0) fanoutEvents(released);
    // Bump resetGeneration so memoized consumers see the discontinuity.
    sync({ resetGeneration: snapshotRef.current.resetGeneration + 1 });
  }, [fanoutEvents, fanoutReset, sync]);

  const subscribe = useCallback((cb) => {
    subscribersRef.current.add(cb);
    return () => subscribersRef.current.delete(cb);
  }, []);

  const subscribeReset = useCallback((cb) => {
    resetSubscribersRef.current.add(cb);
    return () => resetSubscribersRef.current.delete(cb);
  }, []);

  // ---------------------------------------------------------------------
  // Stable handle (Codex Round 1 MUST FIX 1)
  //
  // Returning a fresh object every render would cause every consumer that
  // keys an effect on `clock` (e.g. usePipelineDag) to unsubscribe + reset
  // on every tick (~50ms). We give the handle a stable identity per mount
  // and mutate its mirrored snapshot fields in place; React re-renders are
  // still triggered via the snapshot setState above, so the snapshot fields
  // stay current.
  // ---------------------------------------------------------------------
  const handleRef = useRef(null);
  if (handleRef.current === null) {
    handleRef.current = {
      now: snapshot.now,
      paused: snapshot.paused,
      speed: snapshot.speed,
      firstTs: snapshot.firstTs,
      lastTs: snapshot.lastTs,
      durationSec: snapshot.durationSec,
      isReady: snapshot.isReady,
      resetGeneration: snapshot.resetGeneration,
      error,
      play,
      pause,
      setSpeed,
      seek,
      subscribe,
      subscribeReset,
    };
  } else {
    // Mutate mirrored fields in place — identity stays stable.
    Object.assign(handleRef.current, snapshot, { error });
    // Method identities are stable (useCallback) — assigning is harmless and
    // ensures the latest closures are exposed if React batching ever changes.
    handleRef.current.play = play;
    handleRef.current.pause = pause;
    handleRef.current.setSpeed = setSpeed;
    handleRef.current.seek = seek;
    handleRef.current.subscribe = subscribe;
    handleRef.current.subscribeReset = subscribeReset;
  }

  // Memo on snapshot identity so React-tree consumers see updates.
  // The handle object itself stays stable; useMemo just gates re-renders
  // when the snapshot has actually changed.
  return useMemo(
    () => handleRef.current,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot, error, play, pause, setSpeed, seek, subscribe, subscribeReset],
  );
}
