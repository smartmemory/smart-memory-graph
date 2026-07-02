import { describe, it, expect } from 'vitest';
import { coalesceGraphData, normalizeLabel } from '../coalesce.js';

describe('normalizeLabel', () => {
  it('lowercases, strips leading articles, and collapses whitespace', () => {
    expect(normalizeLabel('The  Acme   Corp')).toBe('acme corp');
    expect(normalizeLabel('An Example')).toBe('example');
    expect(normalizeLabel('a Thing')).toBe('thing');
  });

  it('returns empty string for falsy input', () => {
    expect(normalizeLabel('')).toBe('');
    expect(normalizeLabel(null)).toBe('');
  });
});

describe('coalesceGraphData', () => {
  it('dedupes entity nodes by normalized label and remaps edges', () => {
    const nodes = [
      { id: 'n1', category: 'entity', label: 'Acme Corp' },
      { id: 'n2', category: 'entity', label: 'the Acme Corp' },
      { id: 'm1', category: 'memory', label: 'Some memory' },
    ];
    const edges = [
      { source: 'n2', target: 'm1', type: 'MENTIONED_IN' },
    ];

    const { nodes: dedupedNodes, idRemap } = coalesceGraphData(nodes, edges);

    expect(dedupedNodes).toHaveLength(2); // n2 merged into n1, memory node kept
    expect(idRemap.n2).toBe('n1');
  });

  // Regression test: the merged reciprocal edge's `type` must match its `id`
  // suffix and the docstring's stated intent (merge into RELATED_ENTITY), not
  // stay hardcoded as one of the two input edge types. Edge-type filters/styles
  // (e.g. cytoscapeStyles.js) key off `type === 'RELATED_ENTITY'`.
  it('merges reciprocal CONTAINS_ENTITY + MENTIONED_IN into a RELATED_ENTITY edge with matching type and id', () => {
    const nodes = [
      { id: 'a', category: 'entity', label: 'Alice' },
      { id: 'b', category: 'entity', label: 'Bob' },
    ];
    const edges = [
      { source: 'a', target: 'b', type: 'CONTAINS_ENTITY' },
      { source: 'b', target: 'a', type: 'MENTIONED_IN' },
    ];

    const { edges: mergedEdges } = coalesceGraphData(nodes, edges);

    expect(mergedEdges).toHaveLength(1);
    expect(mergedEdges[0].type).toBe('RELATED_ENTITY');
    expect(mergedEdges[0].id).toMatch(/:RELATED_ENTITY$/);
  });

  // Regression test: a CONTAINS_ENTITY edge with no MENTIONED_IN counterpart
  // between the same node pair is not reciprocal and must keep its real type,
  // not be silently blanked into an unlabeled RELATED_ENTITY edge.
  it('passes through an unpaired reciprocal-type edge with its original type', () => {
    const nodes = [
      { id: 'a', category: 'entity', label: 'Alice' },
      { id: 'b', category: 'entity', label: 'Bob' },
    ];
    const edges = [
      { source: 'a', target: 'b', type: 'CONTAINS_ENTITY' },
    ];

    const { edges: mergedEdges } = coalesceGraphData(nodes, edges);

    expect(mergedEdges).toHaveLength(1);
    expect(mergedEdges[0].type).toBe('CONTAINS_ENTITY');
    expect(mergedEdges[0].id).toBe('a->b:CONTAINS_ENTITY');
  });

  it('dedupes two identical unpaired reciprocal-type edges into one', () => {
    const nodes = [
      { id: 'a', category: 'entity', label: 'Alice' },
      { id: 'b', category: 'entity', label: 'Bob' },
    ];
    const edges = [
      { source: 'a', target: 'b', type: 'CONTAINS_ENTITY' },
      { source: 'a', target: 'b', type: 'CONTAINS_ENTITY' },
    ];

    const { edges: mergedEdges } = coalesceGraphData(nodes, edges);

    expect(mergedEdges).toHaveLength(1);
    expect(mergedEdges[0].type).toBe('CONTAINS_ENTITY');
  });

  it('drops self-loop edges created by merging duplicate nodes', () => {
    const nodes = [
      { id: 'n1', category: 'entity', label: 'Acme' },
      { id: 'n2', category: 'entity', label: 'acme' },
    ];
    const edges = [
      { source: 'n1', target: 'n2', type: 'RELATED_TO' },
    ];

    const { edges: mergedEdges } = coalesceGraphData(nodes, edges);

    expect(mergedEdges).toHaveLength(0);
  });

  it('persists canonicalMap across calls for cross-batch dedup', () => {
    const canonicalMap = {};
    coalesceGraphData(
      [{ id: 'n1', category: 'entity', label: 'Acme' }],
      [],
      canonicalMap
    );
    const { nodes, idRemap } = coalesceGraphData(
      [{ id: 'n2', category: 'entity', label: 'Acme' }],
      [],
      canonicalMap
    );

    expect(nodes).toHaveLength(0);
    expect(idRemap.n2).toBe('n1');
  });
});
