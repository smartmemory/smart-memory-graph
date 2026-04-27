/**
 * Unit tests for VIS-PIPELINE-DAG-1 Phase 1b pure logic:
 *   - deriveStageStatus: maps PLAT-PROGRESS-1 status enum + payload.reason → UI state
 *   - fillNeverEntered: marks pending DAG nodes as never_entered after run finishes
 *   - buildElements (PipelineDag): pure topology+state → Cytoscape elements
 *   - eventTransform: payload.original_ts is preserved on GraphNode/GraphEdge
 *
 * Invariant-level — no React rendering, no DOM, no Cytoscape instance.
 */

import { describe, it, expect } from 'vitest';
import {
  deriveStageStatus,
  fillNeverEntered,
  UI_STATES,
} from '../src/core/pipelineDagState.js';
import { buildElements } from '../src/components/PipelineDag.jsx';
import {
  eventToGraphNode,
  eventToGraphEdge,
} from '../src/core/eventTransform.js';

// ---------------------------------------------------------------------------
// deriveStageStatus
// ---------------------------------------------------------------------------

describe('deriveStageStatus', () => {
  it('started → active', () => {
    expect(deriveStageStatus({ status: 'started' })).toBe(UI_STATES.ACTIVE);
  });

  it('progress → active', () => {
    expect(deriveStageStatus({ status: 'progress' })).toBe(UI_STATES.ACTIVE);
  });

  it('ok → complete', () => {
    expect(deriveStageStatus({ status: 'ok' })).toBe(UI_STATES.COMPLETE);
  });

  it('warn with reason=timed_out → timed_out', () => {
    expect(
      deriveStageStatus({ status: 'warn', payload: { reason: 'timed_out' } }),
    ).toBe(UI_STATES.TIMED_OUT);
  });

  it('warn with reason=procedure_match → skipped', () => {
    expect(
      deriveStageStatus({ status: 'warn', payload: { reason: 'procedure_match' } }),
    ).toBe(UI_STATES.SKIPPED);
  });

  it('warn with reason=skipped → skipped', () => {
    expect(
      deriveStageStatus({ status: 'warn', payload: { reason: 'skipped' } }),
    ).toBe(UI_STATES.SKIPPED);
  });

  it('warn with no reason → complete (warn-with-no-reason fallback)', () => {
    expect(deriveStageStatus({ status: 'warn', payload: {} })).toBe(UI_STATES.COMPLETE);
  });

  it('warn with payload.timed_out=true → timed_out (boolean fallback per design.md)', () => {
    expect(
      deriveStageStatus({ status: 'warn', payload: { timed_out: true } }),
    ).toBe(UI_STATES.TIMED_OUT);
  });

  it('warn with payload.timed_out=true takes precedence over missing reason', () => {
    expect(
      deriveStageStatus({ status: 'warn', payload: { timed_out: true, foo: 'bar' } }),
    ).toBe(UI_STATES.TIMED_OUT);
  });

  it('error → errored', () => {
    expect(deriveStageStatus({ status: 'error' })).toBe(UI_STATES.ERRORED);
  });

  it('terminal states are sticky — late progress does not clobber complete', () => {
    expect(
      deriveStageStatus({ previous: UI_STATES.COMPLETE, status: 'progress' }),
    ).toBe(UI_STATES.COMPLETE);
  });

  it('terminal errored is sticky', () => {
    expect(
      deriveStageStatus({ previous: UI_STATES.ERRORED, status: 'started' }),
    ).toBe(UI_STATES.ERRORED);
  });

  it('unknown status with previous active stays active', () => {
    expect(
      deriveStageStatus({ previous: UI_STATES.ACTIVE, status: 'weird_status' }),
    ).toBe(UI_STATES.ACTIVE);
  });

  it('unknown status with no previous → pending', () => {
    expect(deriveStageStatus({ status: 'weird_status' })).toBe(UI_STATES.PENDING);
  });
});

// ---------------------------------------------------------------------------
// fillNeverEntered
// ---------------------------------------------------------------------------

describe('fillNeverEntered', () => {
  it('marks unentered nodes as never_entered', () => {
    const dagNodes = [{ id: 'classify' }, { id: 'simplify' }, { id: 'store' }];
    const statusByStage = { classify: UI_STATES.COMPLETE };
    const next = fillNeverEntered(dagNodes, statusByStage);
    expect(next.classify).toBe(UI_STATES.COMPLETE);
    expect(next.simplify).toBe(UI_STATES.NEVER_ENTERED);
    expect(next.store).toBe(UI_STATES.NEVER_ENTERED);
  });

  it('does not clobber existing terminal states', () => {
    const dagNodes = [{ id: 'a' }, { id: 'b' }];
    const statusByStage = { a: UI_STATES.ERRORED, b: UI_STATES.COMPLETE };
    const next = fillNeverEntered(dagNodes, statusByStage);
    expect(next.a).toBe(UI_STATES.ERRORED);
    expect(next.b).toBe(UI_STATES.COMPLETE);
  });

  it('handles empty DAG nodes', () => {
    expect(fillNeverEntered([], { foo: 'bar' })).toEqual({ foo: 'bar' });
  });
});

// ---------------------------------------------------------------------------
// buildElements (PipelineDag → Cytoscape elements)
// ---------------------------------------------------------------------------

describe('buildElements', () => {
  it('returns [] for null topology', () => {
    expect(buildElements(null, {})).toEqual([]);
  });

  it('builds nodes with pending state when no events received', () => {
    const topology = {
      pipeline: 'ingest',
      nodes: [{ id: 'classify', label: 'Classify' }, { id: 'store', label: 'Store' }],
      edges: [{ from: 'classify', to: 'store', kind: 'sequence' }],
    };
    const elements = buildElements(topology, {});
    const nodes = elements.filter((e) => !e.data.source);
    expect(nodes).toHaveLength(2);
    expect(nodes[0].data.id).toBe('classify');
    expect(nodes[0].data.ui_state).toBe(UI_STATES.PENDING);
    expect(nodes[1].data.ui_state).toBe(UI_STATES.PENDING);
  });

  it('reflects per-stage UI states', () => {
    const topology = {
      pipeline: 'ingest',
      nodes: [{ id: 'classify' }, { id: 'store' }],
      edges: [],
    };
    const elements = buildElements(topology, {
      classify: UI_STATES.COMPLETE,
      store: UI_STATES.ACTIVE,
    });
    const byId = Object.fromEntries(elements.map((e) => [e.data.id, e.data]));
    expect(byId.classify.ui_state).toBe(UI_STATES.COMPLETE);
    expect(byId.store.ui_state).toBe(UI_STATES.ACTIVE);
  });

  it('builds edges with stable ids', () => {
    const topology = {
      pipeline: 'ingest',
      nodes: [{ id: 'a' }, { id: 'b' }],
      edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'b' }],
    };
    const elements = buildElements(topology, {});
    const edges = elements.filter((e) => e.data.source);
    expect(edges).toHaveLength(2);
    // Edge ids must be unique even with duplicate endpoints
    const ids = edges.map((e) => e.data.id);
    expect(new Set(ids).size).toBe(2);
    expect(edges[0].data.source).toBe('a');
    expect(edges[0].data.target).toBe('b');
  });
});

// ---------------------------------------------------------------------------
// eventTransform — original_ts preservation (Phase 3 prerequisite)
// ---------------------------------------------------------------------------

describe('eventToGraphNode preserves original_ts', () => {
  const data = { memory_id: 'mem-1', label: 'Hello', memory_type: 'semantic' };

  it('omits original_ts when no payload provided (legacy behavior)', () => {
    const node = eventToGraphNode(data);
    expect(node.original_ts).toBeUndefined();
    expect(node.id).toBe('mem-1');
  });

  it('surfaces payload.original_ts when provided', () => {
    const node = eventToGraphNode(data, { original_ts: 1714125600.123 });
    expect(node.original_ts).toBe(1714125600.123);
  });

  it('ignores non-numeric original_ts', () => {
    const node = eventToGraphNode(data, { original_ts: 'not-a-number' });
    expect(node.original_ts).toBeUndefined();
  });
});

describe('eventToGraphEdge preserves original_ts', () => {
  const data = { source_id: 's1', target_id: 't1', edge_type: 'RELATES_TO' };

  it('omits original_ts when no payload provided', () => {
    const edge = eventToGraphEdge(data);
    expect(edge.original_ts).toBeUndefined();
  });

  it('surfaces payload.original_ts when provided', () => {
    const edge = eventToGraphEdge(data, { original_ts: 1714125600.5 });
    expect(edge.original_ts).toBe(1714125600.5);
  });
});

// ---------------------------------------------------------------------------
// Markrun-complete + never_entered integration via fillNeverEntered
// ---------------------------------------------------------------------------

describe('terminal-run never_entered fill', () => {
  it('only fills nodes that never received any event', () => {
    const dagNodes = [
      { id: 'classify' },
      { id: 'simplify' },
      { id: 'store' },
      { id: 'evolve' },
    ];
    const partial = {
      classify: UI_STATES.COMPLETE,
      simplify: UI_STATES.ACTIVE, // still active when run terminated
      // store, evolve never seen
    };
    const result = fillNeverEntered(dagNodes, partial);
    expect(result).toEqual({
      classify: UI_STATES.COMPLETE,
      simplify: UI_STATES.ACTIVE,
      store: UI_STATES.NEVER_ENTERED,
      evolve: UI_STATES.NEVER_ENTERED,
    });
  });
});
