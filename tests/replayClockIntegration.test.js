/**
 * Phase 3 integration tests: ReplayClock + DAG state derivation + scrub
 * format helpers.
 *
 * Verifies that the pure clock + DAG state machine compose correctly:
 * advancing the clock through a recorded run releases events that, when
 * fed through the DAG state derivation, produce the same UI states a live
 * subscription would have produced — within speed-multiplier tolerances.
 *
 * No timers, no SSE, no React rendering — pure logic composition.
 */

import { describe, it, expect } from 'vitest';
import { ReplayClock } from '../src/core/replayClock.js';
import { deriveStageStatus, UI_STATES } from '../src/core/pipelineDagState.js';
import { fmtSeconds } from '../src/components/ReplayScrubBar.jsx';

function dagEvent(ts, payload) {
  return {
    run_id: 'r',
    scope: 'workspace:test',
    seq: 0,
    ts,
    kind: 'pipeline.dag',
    status: 'ok',
    stage: null,
    payload: { original_ts: ts, ...payload },
  };
}

function stageEvent(ts, stage, status, payload = {}) {
  return {
    run_id: 'r',
    scope: 'workspace:test',
    seq: ts,
    ts,
    kind: 'pipeline.stage',
    status,
    stage,
    payload: { original_ts: ts, ...payload },
  };
}

/** Replay a sequence through clock+DAG and return the final UI-state map. */
function replayThroughDag(events, { speed = 1, totalRealMs = 60_000, tickMs = 50 } = {}) {
  const clock = new ReplayClock();
  for (const e of events) clock.addEvent(e);
  clock.setSpeed(speed);
  clock.play();

  const statusByStage = {};
  let topology = null;

  const apply = (releasedEvents) => {
    for (const ev of releasedEvents) {
      if (ev.kind === 'pipeline.dag') {
        topology = ev.payload;
        continue;
      }
      if (ev.kind === 'pipeline.stage' && ev.stage) {
        const next = deriveStageStatus({
          previous: statusByStage[ev.stage],
          status: ev.status,
          payload: ev.payload,
        });
        statusByStage[ev.stage] = next;
      }
    }
  };

  // Drive ticks until budget exhausted.
  const ticks = Math.ceil(totalRealMs / tickMs);
  for (let i = 0; i < ticks; i++) {
    apply(clock.tick(tickMs));
  }

  return { statusByStage, topology };
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

describe('ReplayClock + DAG state derivation composition', () => {
  it('replay reproduces final UI states for a happy-path run', () => {
    const events = [
      dagEvent(1000, {
        pipeline: 'ingest',
        nodes: [{ id: 'classify' }, { id: 'store' }],
        edges: [{ from: 'classify', to: 'store' }],
      }),
      stageEvent(1001, 'classify', 'started'),
      stageEvent(1002, 'classify', 'ok'),
      stageEvent(1003, 'store', 'started'),
      stageEvent(1004, 'store', 'ok'),
    ];
    const { statusByStage, topology } = replayThroughDag(events);
    expect(topology.pipeline).toBe('ingest');
    expect(statusByStage).toEqual({
      classify: UI_STATES.COMPLETE,
      store: UI_STATES.COMPLETE,
    });
  });

  it('replay at 2× completes a 4s run in ~2s of real time', () => {
    const events = [
      dagEvent(1000, { pipeline: 'ingest', nodes: [{ id: 'a' }], edges: [] }),
      stageEvent(1001, 'a', 'started'),
      stageEvent(1004, 'a', 'ok'),
    ];

    // At 2× speed, 4s of virtual time elapses in 2s of real time. Give exactly
    // that much real budget and verify the final state was reached.
    const { statusByStage } = replayThroughDag(events, {
      speed: 2,
      totalRealMs: 2_000,
    });
    expect(statusByStage.a).toBe(UI_STATES.COMPLETE);
  });

  it('replay at 0.5× requires more real time to finish', () => {
    const events = [
      dagEvent(1000, { pipeline: 'ingest', nodes: [{ id: 'a' }], edges: [] }),
      stageEvent(1001, 'a', 'started'),
      stageEvent(1004, 'a', 'ok'),
    ];

    // At 0.5×, 4s of virtual time takes 8s of real time. With 2.2s of real
    // budget (+1.1s virtual past the start) we should be active but not
    // complete (started event @ +1, completed @ +4 not yet released).
    const { statusByStage } = replayThroughDag(events, {
      speed: 0.5,
      totalRealMs: 2_200,
    });
    expect(statusByStage.a).toBe(UI_STATES.ACTIVE);
  });

  it('seek-backward replays through DAG state cleanly (terminal-sticky preserves correctness)', () => {
    const clock = new ReplayClock();
    clock.addEvent(dagEvent(1000, { pipeline: 'p', nodes: [{ id: 'a' }], edges: [] }));
    clock.addEvent(stageEvent(1001, 'a', 'started'));
    clock.addEvent(stageEvent(1002, 'a', 'ok'));
    clock.play();
    clock.tick(10_000); // way past end → fully released

    // Seek back to before completion. The DAG state is recomputed from
    // scratch (consumer must reset) — verify the released slice is correct.
    const released = clock.seek(1001.5);
    const stageStatuses = released
      .filter((e) => e.kind === 'pipeline.stage')
      .map((e) => e.status);
    expect(stageStatuses).toEqual(['started']);
  });

  it('warn/timed_out renders correctly in replay (multi-hop budget exhaustion)', () => {
    const events = [
      dagEvent(1000, {
        pipeline: 'multi_hop_search',
        nodes: [{ id: 'hop_0' }],
        edges: [],
      }),
      stageEvent(1001, 'hop_0', 'started'),
      stageEvent(1002, 'hop_0', 'warn', { reason: 'timed_out', budget_remaining_ms: 0 }),
    ];
    const { statusByStage } = replayThroughDag(events);
    expect(statusByStage.hop_0).toBe(UI_STATES.TIMED_OUT);
  });
});

// ---------------------------------------------------------------------------
// fmtSeconds (scrub bar helper)
// ---------------------------------------------------------------------------

describe('ReplayScrubBar fmtSeconds', () => {
  it('formats seconds as m:ss', () => {
    expect(fmtSeconds(0)).toBe('0:00');
    expect(fmtSeconds(5)).toBe('0:05');
    expect(fmtSeconds(60)).toBe('1:00');
    expect(fmtSeconds(125)).toBe('2:05');
  });

  it('handles fractional seconds (floors to whole-second display)', () => {
    expect(fmtSeconds(0.5)).toBe('0:00');     // sub-second → 0:00
    expect(fmtSeconds(0.999)).toBe('0:00');   // still sub-second after ms-round
    expect(fmtSeconds(59.4)).toBe('0:59');
    expect(fmtSeconds(59.9999)).toBe('1:00'); // ms-round bumps into next minute
  });

  it('handles invalid input', () => {
    expect(fmtSeconds(null)).toBe('0:00');
    expect(fmtSeconds(undefined)).toBe('0:00');
    expect(fmtSeconds(NaN)).toBe('0:00');
    expect(fmtSeconds(Infinity)).toBe('0:00');
    expect(fmtSeconds(-5)).toBe('0:00');
  });
});
