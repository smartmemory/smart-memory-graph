/**
 * Unit tests for VIS-PIPELINE-DAG-1 Phase 2 extraction-drip projection helpers.
 *
 * Pure functions — no rendering, no Redis. Verify that LLMSingleExtractor's
 * native entity/relation shapes are correctly projected into the data shape
 * eventToGraphNode/eventToGraphEdge expect.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  extractionEntityToData,
  extractionRelationToData,
  eventToGraphNode,
  eventToGraphEdge,
} from '../src/core/eventTransform.js';
import { classifyProgressEvent } from '../src/hooks/useGraphStream.js';

// ---------------------------------------------------------------------------
// extractionEntityToData
// ---------------------------------------------------------------------------

describe('extractionEntityToData', () => {
  it('projects extractor entity into graph.node data shape', () => {
    const data = extractionEntityToData({
      name: 'Django',
      entity_type: 'framework',
      confidence: 0.95,
    });
    expect(data).toEqual({
      id: 'entity:Django',
      label: 'Django',
      entity_type: 'framework',
      node_category: 'entity',
      confidence: 0.95,
    });
  });

  it('defaults entity_type to "concept" when missing', () => {
    const data = extractionEntityToData({ name: 'X' });
    expect(data.entity_type).toBe('concept');
  });

  it('returns null for malformed entity (no name)', () => {
    expect(extractionEntityToData(null)).toBeNull();
    expect(extractionEntityToData({})).toBeNull();
    expect(extractionEntityToData({ entity_type: 'thing' })).toBeNull();
  });

  it('round-trips through eventToGraphNode as a graph entity', () => {
    const data = extractionEntityToData({ name: 'Python', entity_type: 'language' });
    const node = eventToGraphNode(data);
    expect(node.id).toBe('entity:Python');
    expect(node.label).toBe('Python');
    expect(node.category).toBe('entity');
    expect(node.type).toBe('language');
  });

  it('preserves original_ts when provided via eventToGraphNode payload arg', () => {
    const data = extractionEntityToData({ name: 'X', entity_type: 'concept' });
    const node = eventToGraphNode(data, { original_ts: 1714125600.5 });
    expect(node.original_ts).toBe(1714125600.5);
  });
});

// ---------------------------------------------------------------------------
// extractionRelationToData
// ---------------------------------------------------------------------------

describe('extractionRelationToData', () => {
  it('projects extractor relation into graph.edge data shape', () => {
    const data = extractionRelationToData({
      subject: 'Django',
      predicate: 'framework_for',
      object: 'Python',
    });
    expect(data).toEqual({
      id: 'entity:Django->entity:Python:framework_for',
      source_id: 'entity:Django',
      target_id: 'entity:Python',
      edge_type: 'framework_for',
      confidence: undefined,
    });
  });

  it('defaults edge_type to RELATES_TO when predicate missing', () => {
    const data = extractionRelationToData({ subject: 'A', object: 'B' });
    expect(data.edge_type).toBe('RELATES_TO');
  });

  it('returns null for malformed relations', () => {
    expect(extractionRelationToData(null)).toBeNull();
    expect(extractionRelationToData({})).toBeNull();
    expect(extractionRelationToData({ subject: 'A' })).toBeNull();
    expect(extractionRelationToData({ object: 'B' })).toBeNull();
  });

  it('round-trips through eventToGraphEdge', () => {
    const data = extractionRelationToData({
      subject: 'Django',
      predicate: 'uses',
      object: 'Python',
    });
    const edge = eventToGraphEdge(data);
    expect(edge.source).toBe('entity:Django');
    expect(edge.target).toBe('entity:Python');
    expect(edge.type).toBe('uses');
  });

  it('eventToGraphEdge preserves original_ts on drip relations', () => {
    const data = extractionRelationToData({
      subject: 'A',
      predicate: 'r',
      object: 'B',
    });
    const edge = eventToGraphEdge(data, { original_ts: 1714125700.25 });
    expect(edge.original_ts).toBe(1714125700.25);
  });
});

// ---------------------------------------------------------------------------
// Codex Round 1 MUST FIX: canonical drip shape (matches what core actually emits)
// ---------------------------------------------------------------------------

describe('canonical drip payloads from core (post Round 1 fix)', () => {
  it('extractionEntityToData accepts canonical {id, name, type, confidence}', () => {
    const data = extractionEntityToData({
      id: 'abc123def456',
      name: 'Django',
      type: 'framework',
      confidence: 0.95,
    });
    // Must use producer-supplied id (stable hash), not derived `entity:Django`
    expect(data.id).toBe('abc123def456');
    expect(data.label).toBe('Django');
    expect(data.entity_type).toBe('framework');
    expect(data.node_category).toBe('entity');
  });

  it('extractionRelationToData accepts canonical {source_id, target_id, type}', () => {
    const data = extractionRelationToData({
      source_id: 'abc123def456',
      target_id: '789xyz012345',
      type: 'framework_for',
      raw_predicate: 'is the framework for',
    });
    expect(data.source_id).toBe('abc123def456');
    expect(data.target_id).toBe('789xyz012345');
    expect(data.edge_type).toBe('framework_for');
    expect(data.raw_predicate).toBe('is the framework for');
    expect(data.id).toBe('abc123def456->789xyz012345:framework_for');
  });

  it('extractionRelationToData accepts {source_id, target_id, relation_type} (alt canonical key)', () => {
    const data = extractionRelationToData({
      source_id: 'a',
      target_id: 'b',
      relation_type: 'uses',
    });
    expect(data.edge_type).toBe('uses');
  });
});

// ---------------------------------------------------------------------------
// Codex Round 2 SHOULD ADJUST: direct classifyProgressEvent drip-branch coverage
// ---------------------------------------------------------------------------

function _baseDripEvent(payload, { runId = 'run-1', seq = 5, ts = 1700000000.0 } = {}) {
  return {
    run_id: runId,
    scope: 'workspace:test',
    seq,
    ts,
    kind: 'pipeline.stage',
    status: 'progress',
    stage: 'llm_extract',
    payload,
  };
}

describe('classifyProgressEvent: extraction-drip routing', () => {
  it('routes pipeline.stage with payload.entity → node_added', () => {
    const ev = _baseDripEvent({
      original_ts: 1700000000.0,
      entity: { id: 'abc123', name: 'Django', type: 'framework', confidence: 0.9 },
    });
    const classified = classifyProgressEvent(ev);
    expect(classified).not.toBeNull();
    expect(classified.category).toBe('node_added');
    expect(classified.nodeId).toBe('abc123');
    expect(classified.label).toMatch(/Django/);
    expect(classified.meta.operation).toBe('add_node');
    expect(classified.meta.data.id).toBe('abc123');
    expect(classified.meta.data.entity_type).toBe('framework');
    expect(classified.meta.data.node_category).toBe('entity');
  });

  it('routes pipeline.stage with payload.relation → edge_added', () => {
    const ev = _baseDripEvent({
      original_ts: 1700000000.0,
      relation: {
        source_id: 'abc123',
        target_id: '789xyz',
        type: 'framework_for',
        raw_predicate: 'is the framework for',
      },
    });
    const classified = classifyProgressEvent(ev);
    expect(classified).not.toBeNull();
    expect(classified.category).toBe('edge_added');
    expect(classified.nodeId).toBe('abc123');
    expect(classified.edgeId).toBe('abc123->789xyz:framework_for');
    expect(classified.meta.operation).toBe('add_edge');
    expect(classified.meta.data.edge_type).toBe('framework_for');
    expect(classified.meta.data.source_id).toBe('abc123');
    expect(classified.meta.data.target_id).toBe('789xyz');
  });

  it('warns and falls through to pipeline_stage when entity payload is unprojectable', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const ev = _baseDripEvent({
        original_ts: 1700000000.0,
        entity: { type: 'concept' /* missing name */ },
      });
      const classified = classifyProgressEvent(ev);
      // Falls through to generic pipeline_stage
      expect(classified.category).toBe('pipeline_stage');
      // Warning was surfaced (no silent degradation)
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('warns and falls through when relation payload is unprojectable', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const ev = _baseDripEvent({
        original_ts: 1700000000.0,
        relation: { type: 'uses' /* no source_id/target_id */ },
      });
      const classified = classifyProgressEvent(ev);
      expect(classified.category).toBe('pipeline_stage');
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('non-llm_extract pipeline.stage events still route as pipeline_stage', () => {
    const ev = {
      run_id: 'r',
      scope: 'workspace:test',
      seq: 1,
      ts: 1700000000.0,
      kind: 'pipeline.stage',
      status: 'started',
      stage: 'classify',
      payload: { original_ts: 1700000000.0 },
    };
    const classified = classifyProgressEvent(ev);
    expect(classified.category).toBe('pipeline_stage');
  });
});
