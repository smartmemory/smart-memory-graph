/**
 * ReplayClock — pure state machine for VIS-PIPELINE-DAG-1 Phase 3.
 *
 * Owns:
 *   - virtual `now` (epoch seconds, matching payload.original_ts scale)
 *   - playback controls: paused / speed
 *   - sorted event buffer
 *   - "released cursor" — events whose original_ts ≤ now have been emitted
 *
 * Does NOT own:
 *   - any SSE subscription (caller pumps events in via addEvent())
 *   - any timer (caller pumps real time in via tick(deltaMs))
 *   - any React state (the useReplayClock hook handles re-renders)
 *
 * This split makes the pure logic deterministically testable without timers
 * or SSE infrastructure. The React hook is a thin wrapper.
 *
 * Events use payload.original_ts when present, falling back to top-level ts
 * (per PLAT-PROGRESS-1 PayloadConventions: original_ts MUST equal ts at
 * first emission, so the two are equivalent for live events).
 */

const DEFAULT_SPEED = 1.0;

export function eventTimestamp(event) {
  if (!event) return null;
  const ots = event.payload && event.payload.original_ts;
  if (typeof ots === 'number') return ots;
  if (typeof event.ts === 'number') return event.ts;
  return null;
}

export class ReplayClock {
  constructor() {
    this.now = null;          // virtual epoch seconds; null until first event
    this.paused = true;       // starts paused — caller must play() when ready
    this.speed = DEFAULT_SPEED;
    /** @type {{ts: number, event: object}[]} sorted ascending by (ts, seq) */
    this._events = [];
    /** Index of next event to release on tick. */
    this._releasedIdx = 0;
    /** Set of seen (run_id, seq) keys for reconnect-dedupe per
     *  PLAT-PROGRESS-1 contract: "Clients order and dedupe on this [seq]." */
    this._seen = new Set();
  }

  /**
   * Insert an event into the buffer in ts order. Sets `now` to the first
   * event's ts so the clock has a starting point. Does NOT release events —
   * release happens on tick() / seek().
   *
   * Per PLAT-PROGRESS-1: dedupes on (run_id, seq). Reconnect can re-deliver
   * events from the stream window; without deduping, the same DAG/stage
   * event would be released multiple times.
   *
   * Returns true if the event was inserted; false if it was rejected
   * (no usable timestamp, or duplicate (run_id, seq)).
   */
  addEvent(event) {
    const ts = eventTimestamp(event);
    if (ts === null) return false;

    // Dedupe by (run_id, seq) when both are present. Falls through if either
    // is missing — test stubs and out-of-process producers may omit them.
    if (event && event.run_id != null && typeof event.seq === 'number') {
      const key = `${event.run_id}::${event.seq}`;
      if (this._seen.has(key)) return false;
      this._seen.add(key);
    }

    // Insert sorted by (ts, seq) — seq breaks ties so two events with the
    // same original_ts release in producer order. Events from a single SSE
    // replay arrive approximately in order; the loop is short on the happy
    // path.
    const item = { ts, event };
    const seq = typeof event?.seq === 'number' ? event.seq : 0;
    let i = this._events.length;
    while (i > 0) {
      const prev = this._events[i - 1];
      if (prev.ts < ts) break;
      if (prev.ts === ts) {
        const prevSeq = typeof prev.event?.seq === 'number' ? prev.event.seq : 0;
        if (prevSeq <= seq) break;
      }
      i--;
    }
    this._events.splice(i, 0, item);

    // If the inserted event is at or before the released cursor's position,
    // we need to bump the cursor so the new event isn't silently skipped.
    // (Happens when out-of-order events arrive after we've already advanced.)
    if (i < this._releasedIdx) {
      this._releasedIdx += 1;
    }

    // First event sets the starting `now`. Caller is responsible for play().
    if (this.now === null) {
      this.now = ts;
    }
    return true;
  }

  /**
   * Advance virtual time by `realDeltaMs * speed` and release any events
   * whose ts is now ≤ the new virtual time. Returns the list of released
   * events in order.
   *
   * No-op when paused or before the first event arrives.
   */
  tick(realDeltaMs) {
    if (this.paused || this.now === null) return [];
    if (typeof realDeltaMs !== 'number' || realDeltaMs <= 0) return [];
    this.now += (realDeltaMs / 1000) * this.speed;
    return this._releaseUpTo(this.now);
  }

  /** Release any unreleased events with ts ≤ virtualTs. */
  _releaseUpTo(virtualTs) {
    const released = [];
    while (
      this._releasedIdx < this._events.length
      && this._events[this._releasedIdx].ts <= virtualTs
    ) {
      released.push(this._events[this._releasedIdx].event);
      this._releasedIdx += 1;
    }
    return released;
  }

  play() {
    this.paused = false;
  }

  pause() {
    this.paused = true;
  }

  setSpeed(speed) {
    if (typeof speed !== 'number' || speed <= 0) return;
    this.speed = speed;
  }

  /**
   * Jump virtual time to `targetTs`. Resets the released cursor and
   * re-releases all events with ts ≤ targetTs. Consumers must be idempotent
   * (the DAG state machine is — terminal states are sticky and re-derivation
   * gives the same result).
   *
   * Returns the list of released events from the new playhead position.
   */
  seek(targetTs) {
    if (typeof targetTs !== 'number') return [];
    this.now = targetTs;
    this._releasedIdx = 0;
    return this._releaseUpTo(targetTs);
  }

  /** Earliest event ts in the buffer, or null if empty. */
  get firstTs() {
    return this._events.length > 0 ? this._events[0].ts : null;
  }

  /** Latest event ts in the buffer, or null if empty. */
  get lastTs() {
    return this._events.length > 0 ? this._events[this._events.length - 1].ts : null;
  }

  /** Total duration of the buffer in seconds, or 0. */
  get durationSec() {
    if (this._events.length < 2) return 0;
    return this.lastTs - this.firstTs;
  }

  /** True once the first event has been received. */
  get isReady() {
    return this.now !== null;
  }
}
