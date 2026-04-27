/**
 * Unit tests for VIS-PIPELINE-DAG-1 Phase 3 — pure ReplayClock state machine.
 *
 * No timers, no SSE, no React. Caller pumps events via addEvent() and time
 * via tick(deltaMs); we assert virtual time advancement, event release order,
 * and seek behavior.
 */

import { describe, it, expect } from 'vitest';
import { ReplayClock, eventTimestamp } from '../src/core/replayClock.js';

function makeEvent(ts, kind = 'pipeline.stage', extra = {}) {
  return {
    run_id: 'r',
    scope: 'workspace:test',
    seq: ts, // doesn't matter for clock semantics, just needs to be different
    ts,
    kind,
    status: 'progress',
    payload: { original_ts: ts, ...extra },
  };
}

// ---------------------------------------------------------------------------
// eventTimestamp helper
// ---------------------------------------------------------------------------

describe('eventTimestamp', () => {
  it('prefers payload.original_ts', () => {
    expect(eventTimestamp({ ts: 100, payload: { original_ts: 200 } })).toBe(200);
  });

  it('falls back to top-level ts when no original_ts', () => {
    expect(eventTimestamp({ ts: 100, payload: {} })).toBe(100);
    expect(eventTimestamp({ ts: 100 })).toBe(100);
  });

  it('returns null when neither is present', () => {
    expect(eventTimestamp({})).toBeNull();
    expect(eventTimestamp(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// addEvent + initial state
// ---------------------------------------------------------------------------

describe('ReplayClock initial state and addEvent', () => {
  it('starts paused with null now', () => {
    const c = new ReplayClock();
    expect(c.paused).toBe(true);
    expect(c.now).toBeNull();
    expect(c.isReady).toBe(false);
    expect(c.speed).toBe(1.0);
  });

  it('first addEvent sets now to that event ts', () => {
    const c = new ReplayClock();
    c.addEvent(makeEvent(1700000000));
    expect(c.now).toBe(1700000000);
    expect(c.isReady).toBe(true);
  });

  it('subsequent addEvent does not change now', () => {
    const c = new ReplayClock();
    c.addEvent(makeEvent(1700000000));
    c.addEvent(makeEvent(1700000005));
    expect(c.now).toBe(1700000000);
  });

  it('rejects events without a usable timestamp', () => {
    const c = new ReplayClock();
    expect(c.addEvent({})).toBe(false);
    expect(c.now).toBeNull();
  });

  it('inserts events in ts order even when added out of order', () => {
    const c = new ReplayClock();
    c.addEvent(makeEvent(1700000005));
    c.addEvent(makeEvent(1700000001));
    c.addEvent(makeEvent(1700000003));
    expect(c._events.map((e) => e.ts)).toEqual([1700000001, 1700000003, 1700000005]);
  });
});

// ---------------------------------------------------------------------------
// tick — virtual time advancement and event release
// ---------------------------------------------------------------------------

describe('ReplayClock.tick', () => {
  it('does nothing when paused', () => {
    const c = new ReplayClock();
    c.addEvent(makeEvent(1700000000));
    c.addEvent(makeEvent(1700000005));
    expect(c.tick(1000)).toEqual([]);
    expect(c.now).toBe(1700000000);
  });

  it('advances now by realDelta * speed when playing', () => {
    const c = new ReplayClock();
    c.addEvent(makeEvent(1000));
    c.play();
    c.tick(2000); // 2s real time, speed 1 → +2s virtual
    expect(c.now).toBe(1002);
  });

  it('honors speed multiplier', () => {
    const c = new ReplayClock();
    c.addEvent(makeEvent(1000));
    c.setSpeed(2);
    c.play();
    c.tick(1000); // 1s real, 2x speed → +2s virtual
    expect(c.now).toBe(1002);
  });

  it('releases events whose ts is ≤ new now', () => {
    const c = new ReplayClock();
    c.addEvent(makeEvent(1000)); // first event sets now=1000
    c.addEvent(makeEvent(1002));
    c.addEvent(makeEvent(1005));
    c.play();
    // Tick 3s: now goes 1000 → 1003. Releases event @ 1000, 1002. Not 1005.
    const released = c.tick(3000);
    expect(released.map((e) => e.payload.original_ts)).toEqual([1000, 1002]);
  });

  it('does not re-release events on subsequent ticks', () => {
    const c = new ReplayClock();
    c.addEvent(makeEvent(1000));
    c.addEvent(makeEvent(1010));
    c.play();
    const r1 = c.tick(5000); // now → 1005, releases @ 1000
    const r2 = c.tick(10000); // now → 1015, releases @ 1010
    expect(r1.map((e) => e.payload.original_ts)).toEqual([1000]);
    expect(r2.map((e) => e.payload.original_ts)).toEqual([1010]);
  });

  it('releases multiple events in one tick if they all fall in the window', () => {
    const c = new ReplayClock();
    c.addEvent(makeEvent(1000));
    c.addEvent(makeEvent(1001));
    c.addEvent(makeEvent(1002));
    c.addEvent(makeEvent(1003));
    c.play();
    const released = c.tick(10000);
    expect(released).toHaveLength(4);
  });

  it('rejects non-positive deltas', () => {
    const c = new ReplayClock();
    c.addEvent(makeEvent(1000));
    c.play();
    expect(c.tick(0)).toEqual([]);
    expect(c.tick(-100)).toEqual([]);
    expect(c.now).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// pause / play / setSpeed
// ---------------------------------------------------------------------------

describe('ReplayClock controls', () => {
  it('pause stops time advancement', () => {
    const c = new ReplayClock();
    c.addEvent(makeEvent(1000));
    c.play();
    c.tick(1000);
    expect(c.now).toBe(1001);
    c.pause();
    c.tick(5000);
    expect(c.now).toBe(1001);
  });

  it('play resumes from current position', () => {
    const c = new ReplayClock();
    c.addEvent(makeEvent(1000));
    c.play();
    c.tick(2000);
    c.pause();
    c.play();
    c.tick(1000);
    expect(c.now).toBe(1003);
  });

  it('setSpeed rejects non-positive values', () => {
    const c = new ReplayClock();
    c.setSpeed(2);
    c.setSpeed(-1);   // ignored
    c.setSpeed(0);    // ignored
    c.setSpeed('x'); // ignored
    expect(c.speed).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// seek — re-release semantics
// ---------------------------------------------------------------------------

describe('ReplayClock.seek', () => {
  it('jumps now to target and re-releases events from start', () => {
    const c = new ReplayClock();
    c.addEvent(makeEvent(1000));
    c.addEvent(makeEvent(1005));
    c.addEvent(makeEvent(1010));
    c.play();
    c.tick(2000); // now=1002, released @ 1000

    const released = c.seek(1007);
    expect(released.map((e) => e.payload.original_ts)).toEqual([1000, 1005]);
    expect(c.now).toBe(1007);
  });

  it('seek backward re-releases earlier events', () => {
    const c = new ReplayClock();
    c.addEvent(makeEvent(1000));
    c.addEvent(makeEvent(1005));
    c.play();
    c.tick(10000); // way past — released both
    const released = c.seek(1003);
    expect(released.map((e) => e.payload.original_ts)).toEqual([1000]);
    expect(c.now).toBe(1003);
  });

  it('seek to a time before any event releases nothing', () => {
    const c = new ReplayClock();
    c.addEvent(makeEvent(1000));
    c.addEvent(makeEvent(2000));
    expect(c.seek(500)).toEqual([]);
    expect(c.now).toBe(500);
  });

  it('seek ignores non-numeric targets', () => {
    const c = new ReplayClock();
    c.addEvent(makeEvent(1000));
    c.seek('not a number');
    expect(c.now).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// derived properties
// ---------------------------------------------------------------------------

describe('ReplayClock derived properties', () => {
  it('firstTs / lastTs / durationSec', () => {
    const c = new ReplayClock();
    expect(c.firstTs).toBeNull();
    expect(c.lastTs).toBeNull();
    expect(c.durationSec).toBe(0);

    c.addEvent(makeEvent(1000));
    c.addEvent(makeEvent(1010));
    c.addEvent(makeEvent(1003));
    expect(c.firstTs).toBe(1000);
    expect(c.lastTs).toBe(1010);
    expect(c.durationSec).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// out-of-order arrival edge case
// ---------------------------------------------------------------------------

describe('ReplayClock out-of-order event arrival', () => {
  it('inserting an event before the released cursor still yields it on seek', () => {
    const c = new ReplayClock();
    c.addEvent(makeEvent(1000));
    c.addEvent(makeEvent(1010));
    c.play();
    c.tick(15000); // releases both, now=1015

    // Late-arriving event before now — should be in buffer
    c.addEvent(makeEvent(1005));
    expect(c._events.map((e) => e.ts)).toEqual([1000, 1005, 1010]);

    // Seek backward to release everything up to 1006 — should include the late one
    const released = c.seek(1006);
    expect(released.map((e) => e.payload.original_ts)).toEqual([1000, 1005]);
  });
});

// ---------------------------------------------------------------------------
// Codex Round 1 SHOULD ADJUST: dedupe by (run_id, seq) per PLAT-PROGRESS-1
// ---------------------------------------------------------------------------

describe('ReplayClock dedupe by (run_id, seq)', () => {
  function ev(seq, ts) {
    return {
      run_id: 'run-1',
      seq,
      ts,
      kind: 'pipeline.stage',
      status: 'progress',
      payload: { original_ts: ts },
    };
  }

  it('rejects duplicate (run_id, seq) on re-add', () => {
    const c = new ReplayClock();
    expect(c.addEvent(ev(0, 1000))).toBe(true);
    expect(c.addEvent(ev(0, 1000))).toBe(false); // duplicate
    expect(c._events).toHaveLength(1);
  });

  it('accepts same seq from a different run_id', () => {
    const c = new ReplayClock();
    c.addEvent({ ...ev(0, 1000), run_id: 'a' });
    c.addEvent({ ...ev(0, 1000), run_id: 'b' });
    expect(c._events).toHaveLength(2);
  });

  it('uses seq as a tie-breaker for events with the same ts', () => {
    const c = new ReplayClock();
    c.addEvent(ev(2, 1000));
    c.addEvent(ev(0, 1000));
    c.addEvent(ev(1, 1000));
    expect(c._events.map((e) => e.event.seq)).toEqual([0, 1, 2]);
  });

  it('events without seq or run_id are not deduped (test stubs / pre-contract producers)', () => {
    const c = new ReplayClock();
    // makeEvent's helper sets seq = ts and run_id = "r" — would dedupe.
    // Strip seq+run_id to simulate a pre-contract producer.
    const stripped = (ts) => {
      const e = makeEvent(ts);
      delete e.seq;
      delete e.run_id;
      return e;
    };
    expect(c.addEvent(stripped(1000))).toBe(true);
    expect(c.addEvent(stripped(1000))).toBe(true); // not deduped — no (run_id, seq) key
    expect(c._events).toHaveLength(2);
  });
});
