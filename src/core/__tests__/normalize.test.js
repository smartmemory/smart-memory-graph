import { describe, it, expect } from 'vitest';
import { normalizeExtractionResults, normalizeAPIResponse } from '../normalize.js';

describe('normalizeExtractionResults', () => {
  // Studio canonical entity shape (from useGraphElements.js documentation)
  const studioEntity = {
    item_id: 'e1',
    content: 'Marie Curie was a physicist',
    metadata: { name: 'Marie Curie', entity_type: 'person', confidence: 0.95 },
  };

  // Extraction result entity shape (top-level fields)
  const extractionEntity = {
    id: 'e2',
    name: 'Nobel Prize',
    entity_type: 'award',
    confidence: 0.9,
  };

  // Studio canonical relation shape
  const studioRelation = {
    source_id: 'e1',
    target_id: 'e2',
    relation_type: 'RECEIVED',
    confidence: 0.85,
  };

  // Extraction result relation shape (alternative fields)
  const extractionRelation = {
    id: 'rel-1',
    source: 'e1',
    target: 'e2',
    type: 'WORKS_AT',
    confidence: 0.8,
  };

  it('maps Studio canonical entities correctly', () => {
    const { nodes } = normalizeExtractionResults([studioEntity], []);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      id: 'e1',
      type: 'person',          // from metadata.entity_type
      confidence: 0.95,        // from metadata.confidence
      content: 'Marie Curie was a physicist',
    });
  });

  it('maps extraction result entities correctly', () => {
    const { nodes } = normalizeExtractionResults([extractionEntity], []);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      id: 'e2',
      label: 'Nobel Prize',
      type: 'award',           // from top-level entity_type
      confidence: 0.9,
    });
  });

  it('maps Studio canonical relations correctly', () => {
    const { edges } = normalizeExtractionResults([], [studioRelation]);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: 'e1',
      target: 'e2',
      label: 'RECEIVED',       // from relation_type
      type: 'RECEIVED',
      confidence: 0.85,
    });
    // Fallback ID should use resolved fields, not undefined
    expect(edges[0].id).toBe('e1->e2:RECEIVED');
  });

  it('maps extraction result relations correctly', () => {
    const { edges } = normalizeExtractionResults([], [extractionRelation]);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      id: 'rel-1',             // uses provided id
      source: 'e1',
      target: 'e2',
      label: 'WORKS_AT',
      type: 'WORKS_AT',
    });
  });

  it('constructs valid fallback edge IDs (never undefined)', () => {
    const relation = { source_id: 'a', target_id: 'b', relation_type: 'KNOWS' };
    const { edges } = normalizeExtractionResults([], [relation]);
    expect(edges[0].id).toBe('a->b:KNOWS');
    expect(edges[0].id).not.toContain('undefined');
  });

  it('defaults edge type to RELATES_TO when no type field present', () => {
    const relation = { source_id: 'a', target_id: 'b' };
    const { edges } = normalizeExtractionResults([], [relation]);
    expect(edges[0].type).toBe('RELATES_TO');
    expect(edges[0].label).toBe('RELATES_TO');
    expect(edges[0].id).toBe('a->b:RELATES_TO');
  });

  it('defaults entity type to concept when no type field present', () => {
    const entity = { id: 'x', name: 'Unknown' };
    const { nodes } = normalizeExtractionResults([entity], []);
    expect(nodes[0].type).toBe('concept');
  });

  it('handles empty/null inputs gracefully', () => {
    expect(normalizeExtractionResults(null, null)).toEqual({ nodes: [], edges: [] });
    expect(normalizeExtractionResults([], [])).toEqual({ nodes: [], edges: [] });
    expect(normalizeExtractionResults(undefined, undefined)).toEqual({ nodes: [], edges: [] });
  });

  it('preserves metadata passthrough', () => {
    const entity = { id: 'e1', name: 'Test', metadata: { source: 'spacy', custom: true } };
    const { nodes } = normalizeExtractionResults([entity], []);
    expect(nodes[0].metadata).toEqual({ source: 'spacy', custom: true });
  });

  it('uses entity name as label, falls back to content substring', () => {
    const namedEntity = { id: 'e1', name: 'Marie Curie' };
    const contentEntity = { id: 'e2', content: 'A very long piece of text that should be truncated for the label display' };
    const bareEntity = { id: 'e3' };

    const { nodes } = normalizeExtractionResults([namedEntity, contentEntity, bareEntity], []);
    expect(nodes[0].label).toBe('Marie Curie');
    expect(nodes[1].label).toBe('A very long piece of text that should be');
    expect(nodes[2].label).toBe('');
  });
});

describe('normalizeAPIResponse', () => {
  it('handles null input', () => {
    expect(normalizeAPIResponse(null)).toEqual({ nodes: [], edges: [] });
  });

  it('deduplicates nodes by id', () => {
    const data = {
      nodes: [
        { item_id: 'n1', label: 'A', entity_type: 'person' },
        { item_id: 'n1', label: 'A duplicate', entity_type: 'person' },
      ],
      edges: [],
    };
    const { nodes } = normalizeAPIResponse(data);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].label).toBe('A');
  });

  it('skips internal nodes (version_, wikipedia:)', () => {
    const data = {
      nodes: [
        { item_id: 'version_123', label: 'V' },
        { item_id: 'wikipedia:Marie_Curie', label: 'W' },
        { item_id: 'real_node', label: 'Real', entity_type: 'person' },
      ],
      edges: [],
    };
    const { nodes } = normalizeAPIResponse(data);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe('real_node');
  });

  it('skips GROUNDED_IN edges', () => {
    const data = {
      nodes: [{ item_id: 'n1', entity_type: 'person' }],
      edges: [
        { source_id: 'n1', target_id: 'wikipedia:X', edge_type: 'GROUNDED_IN' },
        { source_id: 'n1', target_id: 'n2', edge_type: 'KNOWS' },
      ],
    };
    const { edges } = normalizeAPIResponse(data);
    expect(edges).toHaveLength(1);
    expect(edges[0].type).toBe('KNOWS');
  });
});

// BUG-GRAPH-VIEW-NO-REPLACES-LINK-1: /memory/graph/full now sends each node's lifecycle status, so a replaced decision
// (admitted only as the far end of a readable replaces-link) is drawn as retired, next to its SUPERSEDES edge.
describe('normalizeAPIResponse carries decision status (BUG-GRAPH-VIEW-NO-REPLACES-LINK-1)', () => {
  const fullGraph = {
    nodes: [
      { item_id: 'dec_new', label: 'Deploys on Thursdays', memory_type: 'decision', category: 'memory', status: 'active' },
      { item_id: 'dec_old', label: 'Deploys on Tuesdays', memory_type: 'decision', category: 'memory', status: 'superseded' },
    ],
    edges: [{ source_id: 'dec_new', target_id: 'dec_old', edge_type: 'SUPERSEDES' }],
  };

  it('keeps status on each node and the replaces edge', async () => {
    const { nodes, edges } = normalizeAPIResponse(fullGraph);
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    expect(byId.dec_old.status).toBe('superseded');
    expect(byId.dec_new.status).toBe('active');
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: 'dec_new', target: 'dec_old', type: 'SUPERSEDES' });
  });

  it('draws the replaced decision with the superseded style', async () => {
    const { graphNodeToCyElement } = await import('../../internal/cytoscapeConvert.js');
    const { nodes } = normalizeAPIResponse(fullGraph);
    const old = graphNodeToCyElement(nodes.find((n) => n.id === 'dec_old'));
    expect(old.classes).toContain('decision-status-superseded');
    expect(old.data.decision_status).toBe('superseded');
  });
});
