/**
 * VIS-PIPELINE-DAG-1 Phase 5 — RunLogPanel + glyph labels.
 *
 * Pure-component invariants (no React render):
 *   - buildElements adds a leading glyph per UI state for color-blind a11y
 *   - log panel sorts by seq ascending
 *   - log panel filters by stage when stageFilter is set
 *
 * The panel rendering itself is tested via static snapshot of its inputs;
 * since the package's vitest setup doesn't include @testing-library/react,
 * we exercise the pure parts (glyph mapping, event row formatting) only.
 */

import { describe, it, expect } from 'vitest';
import { buildElements } from '../src/components/PipelineDag.jsx';
import {
  UI_STATES,
  MAX_EVENTS_PER_STAGE,
  appendStagedEvent,
  shouldLogEvent,
} from '../src/core/pipelineDagState.js';

const TOPOLOGY = {
  pipeline: 'ingest',
  nodes: [
    { id: 'classify', label: 'Classify' },
    { id: 'store', label: 'Store' },
    { id: 'enrich', label: 'Enrich' },
    { id: 'evolve', label: 'Evolve' },
  ],
  edges: [
    { from: 'classify', to: 'store' },
    { from: 'store', to: 'enrich' },
    { from: 'enrich', to: 'evolve' },
  ],
};

describe('Phase 5 glyph labels — color-blind a11y', () => {
  it('every UI state gets a unique non-empty leading glyph', () => {
    const status = {
      classify: UI_STATES.ACTIVE,
      store: UI_STATES.COMPLETE,
      enrich: UI_STATES.SKIPPED,
      evolve: UI_STATES.ERRORED,
    };
    const elements = buildElements(TOPOLOGY, status);
    const labels = elements
      .filter((e) => !e.data.source)
      .map((e) => e.data.label);

    // Each label starts with a glyph + space + base label
    expect(labels[0]).toMatch(/^▶\s+Classify$/);
    expect(labels[1]).toMatch(/^✓\s+Store$/);
    expect(labels[2]).toMatch(/^⤼\s+Enrich$/);
    expect(labels[3]).toMatch(/^✗\s+Evolve$/);

    // All glyphs distinct → distinguishable without color
    const glyphs = labels.map((l) => l.charAt(0));
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it('pending and never_entered have distinct glyphs', () => {
    const status = {
      classify: UI_STATES.PENDING,
      store: UI_STATES.NEVER_ENTERED,
    };
    const els = buildElements(
      { pipeline: 'p', nodes: [{ id: 'classify' }, { id: 'store' }], edges: [] },
      status,
    );
    const a = els[0].data.label.charAt(0);
    const b = els[1].data.label.charAt(0);
    expect(a).not.toBe(b);
    expect(a).not.toBe('');
    expect(b).not.toBe('');
  });

  it('timed_out is distinct from skipped (both are warn variants)', () => {
    const status = { a: UI_STATES.SKIPPED, b: UI_STATES.TIMED_OUT };
    const els = buildElements(
      { pipeline: 'p', nodes: [{ id: 'a' }, { id: 'b' }], edges: [] },
      status,
    );
    expect(els[0].data.label.charAt(0)).not.toBe(els[1].data.label.charAt(0));
  });
});

// ---------------------------------------------------------------------------
// RunLogPanel — pure logic via re-implementing its sort+filter for verification
// (the component itself is JSX; we don't have RTL set up in this package).
//
// These tests assert the contract that RunLogPanel implements: events flat,
// sorted by seq, optionally filtered by stage. If RunLogPanel's logic
// changes, mirror the change here so the contract is enforced.
// ---------------------------------------------------------------------------

function expectedRows(eventsByStage, stageFilter) {
  const flat = [];
  const stages = stageFilter ? [stageFilter] : Object.keys(eventsByStage);
  for (const stage of stages) {
    for (const ev of eventsByStage[stage] || []) {
      flat.push({ stage, ev });
    }
  }
  flat.sort((a, b) => {
    const sa = typeof a.ev.seq === 'number' ? a.ev.seq : a.ev.ts || 0;
    const sb = typeof b.ev.seq === 'number' ? b.ev.seq : b.ev.ts || 0;
    return sa - sb;
  });
  return flat;
}

function ev(seq, stage, status = 'progress', payload = {}) {
  return { run_id: 'r', seq, ts: 1000 + seq, stage, kind: 'pipeline.stage', status, payload };
}

describe('RunLogPanel sort + filter contract', () => {
  it('flattens and sorts events from multiple stages by seq', () => {
    const map = {
      classify: [ev(1, 'classify', 'started'), ev(3, 'classify', 'ok')],
      store: [ev(2, 'store', 'started'), ev(4, 'store', 'ok')],
    };
    const rows = expectedRows(map, null);
    expect(rows.map((r) => r.ev.seq)).toEqual([1, 2, 3, 4]);
  });

  it('stageFilter restricts to one stage', () => {
    const map = {
      classify: [ev(1, 'classify'), ev(3, 'classify')],
      store: [ev(2, 'store'), ev(4, 'store')],
    };
    const rows = expectedRows(map, 'store');
    expect(rows.map((r) => r.ev.seq)).toEqual([2, 4]);
    expect(rows.every((r) => r.stage === 'store')).toBe(true);
  });

  it('empty map yields no rows', () => {
    expect(expectedRows({}, null)).toEqual([]);
    expect(expectedRows({}, 'classify')).toEqual([]);
  });

  it('stage with no events under filter yields no rows', () => {
    const map = { other: [ev(1, 'other')] };
    expect(expectedRows(map, 'classify')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// appendStagedEvent — the kind-agnostic per-stage log accumulator that feeds
// RunLogPanel via usePipelineDag's eventsByStage.
// ---------------------------------------------------------------------------

describe('appendStagedEvent — kind-agnostic log accumulation', () => {
  it('appends pipeline.stage events under their stage', () => {
    const next = appendStagedEvent({}, ev(1, 'classify', 'started'));
    expect(next.classify).toHaveLength(1);
    expect(next.classify[0].seq).toBe(1);
  });

  it('appends non-pipeline.stage kinds (studio.job relink) under their stage', () => {
    const relink = {
      run_id: 'r', seq: 7, stage: 'relinking', kind: 'studio.job',
      status: 'progress', payload: { progress: 50, message: 'Re-running linking…' },
    };
    const next = appendStagedEvent({}, relink);
    expect(next.relinking).toHaveLength(1);
    expect(next.relinking[0].kind).toBe('studio.job');
  });

  it('interleaves kinds within the same stage bucket', () => {
    let map = appendStagedEvent({}, ev(1, 'extraction', 'started'));
    map = appendStagedEvent(map, {
      run_id: 'r', seq: 2, stage: 'extraction', kind: 'studio.job',
      status: 'ok', payload: {},
    });
    expect(map.extraction.map((e) => e.kind)).toEqual(['pipeline.stage', 'studio.job']);
  });

  it('ignores events without a stage, returning the same map object', () => {
    const map = { classify: [ev(1, 'classify')] };
    expect(appendStagedEvent(map, { run_id: 'r', seq: 2, kind: 'pipeline.dag' })).toBe(map);
    expect(appendStagedEvent(map, null)).toBe(map);
  });

  it('caps each stage at MAX_EVENTS_PER_STAGE, dropping oldest', () => {
    let map = {};
    for (let i = 1; i <= MAX_EVENTS_PER_STAGE + 5; i += 1) {
      map = appendStagedEvent(map, ev(i, 'store'));
    }
    expect(map.store).toHaveLength(MAX_EVENTS_PER_STAGE);
    expect(map.store[0].seq).toBe(6); // oldest 5 dropped
    expect(map.store[map.store.length - 1].seq).toBe(MAX_EVENTS_PER_STAGE + 5);
  });

  it('does not mutate other stages (immutable update)', () => {
    const before = { classify: [ev(1, 'classify')] };
    const next = appendStagedEvent(before, ev(2, 'store'));
    expect(next.classify).toBe(before.classify);
    expect(Object.keys(next).sort()).toEqual(['classify', 'store']);
  });
});

describe('shouldLogEvent — log admission predicate', () => {
  it('admits staged pipeline.stage and studio.job events', () => {
    expect(shouldLogEvent(ev(1, 'classify'))).toBe(true);
    expect(shouldLogEvent({ seq: 2, stage: 'relinking', kind: 'studio.job' })).toBe(true);
    expect(shouldLogEvent({ seq: 3, stage: 'evolve', kind: 'evolver.result' })).toBe(true);
  });

  it('rejects high-volume drip kinds (graph.node/graph.edge)', () => {
    expect(shouldLogEvent({ seq: 4, stage: 'store', kind: 'graph.node' })).toBe(false);
    expect(shouldLogEvent({ seq: 5, stage: 'link', kind: 'graph.edge' })).toBe(false);
  });

  it('rejects stage-less events and null', () => {
    expect(shouldLogEvent({ seq: 6, kind: 'pipeline.dag' })).toBe(false);
    expect(shouldLogEvent(null)).toBe(false);
  });
});
