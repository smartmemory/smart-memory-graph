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

// ---------------------------------------------------------------------------
// STUDIO-RUN-INSPECTOR-EMPTY-GRAPH-1: advanceTo (follow mode) and the idle-gap cap
// ---------------------------------------------------------------------------

describe('ReplayClock.advanceTo', () => {
  const ts = (evs) => evs.map((e) => e.payload.original_ts);
  // One row per case: setup events, the advanceTo target, released ts, resulting now.
  const ROWS = [
    { name: 'releases everything up to ts', add: [1000, 1010, 1020], to: 1010, released: [1000, 1010], now: 1010 },
    { name: 'to the last event releases the whole buffer', add: [1000, 1800, 2800], to: 2800, released: [1000, 1800, 2800], now: 2800 },
    { name: 'never moves now backward', add: [1000, 1010], pre: 1010, to: 1000, released: [], now: 1010 },
    { name: 'before the first event sets now', add: [], to: 500, released: [], now: 500 },
    { name: 'non-numeric ts is a no-op', add: [1000], to: 'x', released: [], now: 1000 },
  ];
  it.each(ROWS)('$name', ({ add, pre, to, released, now }) => {
    const c = new ReplayClock();
    add.forEach((t) => c.addEvent(makeEvent(t)));
    if (pre !== undefined) c.advanceTo(pre);
    expect(ts(c.advanceTo(to))).toEqual(released);
    expect(c.now).toBe(now);
  });

  it('releases an event that arrived behind the released cursor (follow mode never loses it)', () => {
    const c = new ReplayClock();
    c.addEvent(makeEvent(1000));
    c.addEvent(makeEvent(1010));
    expect(ts(c.advanceTo(1010))).toEqual([1000, 1010]);
    c.addEvent(makeEvent(1005)); // late arrival, behind the cursor
    expect(ts(c.advanceTo(1005))).toEqual([1005]);
    expect(ts(c.advanceTo(1010))).toEqual([]); // released once only
    expect(c.now).toBe(1010);
  });

  it('seek drops pending late arrivals (seek re-releases them itself)', () => {
    const c = new ReplayClock();
    c.addEvent(makeEvent(1000));
    c.addEvent(makeEvent(1010));
    c.advanceTo(1010);
    c.addEvent(makeEvent(1005));
    expect(ts(c.seek(1010))).toEqual([1000, 1005, 1010]);
    expect(ts(c.advanceTo(1010))).toEqual([]);
  });

  it('is independent of pause (follow releases while paused)', () => {
    const c = new ReplayClock();
    c.addEvent(makeEvent(1000));
    expect(c.paused).toBe(true);
    expect(ts(c.advanceTo(1000))).toEqual([1000]);
  });
});

describe('ReplayClock maxGapSec (idle-gap cap in tick)', () => {
  // A 30-minute run: two events 1800 s apart. Rows: cap, tick ms, expected released ts after one tick, now.
  const ROWS = [
    { name: 'no cap waits the full gap', cap: undefined, tickMs: 1000, released: [1000], now: 1001 },
    { name: 'cap 2s: jumps to next - 2, then advances 1s', cap: 2, tickMs: 1000, released: [1000], now: 2799 },
    { name: 'cap 2s: a 2s tick reaches the next event', cap: 2, tickMs: 2000, released: [1000, 2800], now: 2800 },
    { name: 'gap within the cap is not shortened', cap: 5000, tickMs: 1000, released: [1000], now: 1001 },
    { name: 'non-positive cap is ignored', cap: 0, tickMs: 1000, released: [1000], now: 1001 },
  ];
  it.each(ROWS)('$name', ({ cap, tickMs, released, now }) => {
    const c = new ReplayClock({ maxGapSec: cap });
    c.addEvent(makeEvent(1000));
    c.addEvent(makeEvent(2800));
    c.play();
    const first = c.tick(1); // releases 1000 (now 1000.001)
    const second = c.tick(tickMs);
    expect([...first, ...second].map((e) => e.payload.original_ts)).toEqual(released);
    expect(c.now).toBeCloseTo(now, 2);
  });

  it('does nothing once every event is released', () => {
    const c = new ReplayClock({ maxGapSec: 2 });
    c.addEvent(makeEvent(1000));
    c.play();
    c.tick(1);
    c.tick(1000);
    expect(c.now).toBeCloseTo(1001.001, 3);
  });
});
