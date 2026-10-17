/**
 * One refresh rule for every view that refetches its data in the background (UI-REFRESH-FU-2).
 *
 * The same file lives in smart-memory-graph (src/core/refreshScheduler.js) and smart-memory-web
 * (src/lib/refreshScheduler.js), byte for byte: web's tests run one row table against both copies
 * and fail if they differ. Edit both together.
 *
 * The rule:
 * 1. A trigger (signal, interval, focus, own write) is never dropped. With nothing in flight it
 *    runs now. While a request is in flight it marks the data dirty, and when the last request
 *    settles (success or error) exactly ONE trailing run starts, however many triggers arrived.
 *    No trigger during a flight, no trailing run, so the scheduler cannot loop.
 * 2. Nothing runs while the document is hidden, from any entry point. A trigger (or a trailing
 *    run) that comes due while hidden waits on one visibilitychange listener and runs once when the
 *    tab is visible again. A foreground fetch (first mount, a user action) is not a trigger: the
 *    view starts it itself and only reports it with begin().
 * 3. Every request the view starts, foreground or background, reports itself with begin() and
 *    calls the returned end() when it settles. begin() must run synchronously at the start of the
 *    fetch, before the first await, so the scheduler always knows what is in flight.
 *    - begin({ fresh: true }) (the default): this request reads everything the view shows, after
 *      every trigger so far, so it clears the dirty flag.
 *    - begin({ fresh: false }): an append (Load More). It does not cover a trigger.
 *    - end({ superseded: true }): the view's latest-request guard threw this fresh response away
 *      because a newer request started. If no newer FRESH request started (only an append), the
 *      data this request was meant to show was never shown: it counts as a trigger again.
 *    The view keeps its own sequence id so a stale response never overwrites a newer one.
 *
 * @param {(reasons: string[]) => *} run - starts one background refresh. Receives the reasons of
 *   the triggers it covers (for example 'write' or 'live'); returns whatever the view's fetch returns.
 */
export function createRefreshScheduler(run) {
  let inFlight = 0;
  let dirty = false;
  let reasons = new Set();
  let freshEpoch = 0;
  let active = true;
  let stopWaiting = null;

  const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

  const waitForVisible = () => {
    if (stopWaiting) return; // one listener, however many triggers arrive while hidden
    const onVisibilityChange = () => {
      if (isHidden()) return;
      stopWaiting?.();
      drain();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    stopWaiting = () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stopWaiting = null;
    };
  };

  function drain() {
    if (!active || !dirty || inFlight > 0) return undefined;
    if (isHidden()) {
      waitForVisible();
      return undefined;
    }
    stopWaiting?.(); // visible again by another route: the wait is over
    const covered = [...reasons];
    dirty = false;
    reasons = new Set();
    return run(covered);
  }

  return {
    /** A reason to refetch. Returns run()'s result when it ran now, otherwise undefined. */
    trigger(reason = 'signal') {
      if (!active) return undefined;
      dirty = true;
      reasons.add(reason);
      return drain();
    },
    /** Report a request the view is starting. Returns end(), to call once when it settles. */
    begin({ fresh = true } = {}) {
      inFlight += 1;
      const epoch = fresh ? ++freshEpoch : null;
      if (fresh) {
        dirty = false;
        reasons = new Set();
      }
      let ended = false;
      return ({ superseded = false } = {}) => {
        if (ended) return;
        ended = true;
        inFlight -= 1;
        if (superseded && epoch !== null && epoch === freshEpoch) {
          dirty = true;
          reasons.add('superseded');
        }
        drain();
      };
    },
    /** Mounted: accept triggers again, and run one that was left pending. */
    start() {
      active = true;
      drain();
    },
    /** Unmounted: ignore triggers and remove the visibility listener. */
    stop() {
      active = false;
      stopWaiting?.();
    },
  };
}
