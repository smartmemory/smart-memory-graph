/**
 * Normalization helpers for converting API responses to GraphNode/GraphEdge arrays.
 */

/**
 * Convert /memory/graph/full API response to canonical GraphData.
 * Matches the logic from useGraphData.js:transformFullGraph (lines 9-66).
 */
export function normalizeAPIResponse(apiData) {
  if (!apiData) return { nodes: [], edges: [] };

  const nodes = [];
  const edges = [];
  const seenNodeIds = new Set();
  const seenEdgeIds = new Set();

  // Pre-scan edges to collect grounded node IDs. A node is considered
  // grounded if EITHER:
  //   1. It has an outgoing/incoming GROUNDED_IN edge to a knowledge-base
  //      node (wikipedia: or wikidata: prefix), OR
  //   2. It carries grounding_* properties (set by GroundingEngine when
  //      grounding metadata is applied directly to the source memory item).
  // The two checks are OR'd so we catch every grounded node regardless of
  // whether the wikidata edge was created and whether the metadata write
  // succeeded.
  const groundedIds = new Set();
  const KB_PREFIXES = ['wikipedia:', 'wikidata:'];
  const isKbNode = (nodeId) =>
    typeof nodeId === 'string' && KB_PREFIXES.some((p) => nodeId.startsWith(p));

  for (const edge of (apiData.edges || apiData.links || [])) {
    const edgeType = edge.edge_type || edge.type || '';
    if (edgeType === 'GROUNDED_IN') {
      const src = edge.source_id || edge.source || '';
      const tgt = edge.target_id || edge.target || '';
      // The source side (the user-facing memory item) is what we want to
      // mark as "has grounding"; the target side is the KB node itself.
      if (src && !isKbNode(src)) groundedIds.add(src);
      if (tgt && !isKbNode(tgt)) groundedIds.add(tgt);
    }
  }

  // Process nodes from the API response
  const rawNodes = apiData.nodes || apiData.items || [];
  for (const item of rawNodes) {
    const id = item.item_id || item.id;
    if (!id || seenNodeIds.has(id)) continue;
    // Skip internal nodes (versions + KB nodes from any provider)
    if (id.startsWith('version_') || isKbNode(id)) continue;
    seenNodeIds.add(id);

    // OR-clause #2: a node is also "grounded" if it carries any
    // grounding_* property written by GroundingEngine (the per-item
    // metadata write added in the 2026-04-11 grounding fix). Properties
    // can live at the top level OR inside item.properties depending on
    // how the backend serializes the node.
    const hasGroundingProps = (() => {
      const flat = item || {};
      const nested = item.properties || {};
      const meta = item.metadata || {};
      const sources = [flat, nested, meta];
      for (const src of sources) {
        if (!src || typeof src !== 'object') continue;
        for (const key of Object.keys(src)) {
          if (key.startsWith('grounding_') && src[key] != null && src[key] !== 0 && src[key] !== '') {
            return true;
          }
        }
      }
      return false;
    })();
    if (hasGroundingProps) {
      groundedIds.add(id);
    }

    const isEntity = item.node_category === 'entity' || item.category === 'entity' || !!item.entity_type;
    const type = isEntity
      ? (item.entity_type || item.memory_type || item.type || 'concept')
      : (item.memory_type || item.type || 'semantic');
    const category = isEntity ? 'entity' : 'memory';

    const origin = item.origin || item.properties?.origin || item.metadata?.origin || 'unknown';

    nodes.push({
      id,
      label: item.label || item.name || item.title || item.properties?.name || item.content?.substring(0, 40) || id.substring(0, 12),
      type,
      category,
      content: item.content || '',
      confidence: item.confidence,
      created_at: item.created_at,
      parentId: item.parent_memory_id || null,
      metadata: item.metadata,
      grounded: groundedIds.has(id),
      origin,
      // Decision lifecycle fields (BUG-GRAPH-VIEW-NO-REPLACES-LINK-1): the status draws a replaced decision as retired.
      status: item.status ?? item.properties?.status ?? item.metadata?.status,
      supersedes: item.supersedes ?? item.metadata?.supersedes,
      superseded_by: item.superseded_by ?? item.metadata?.superseded_by,
    });
  }

  // Process edges from the API response
  const rawEdges = apiData.edges || apiData.links || [];
  for (const edge of rawEdges) {
    const source = edge.source_id || edge.source;
    const target = edge.target_id || edge.target;
    if (!source || !target) continue;
    const edgeType = edge.edge_type || edge.type || 'RELATES_TO';
    // Skip grounding edges (they're collapsed into the .grounded flag)
    // and any edge involving a KB node (wikipedia: / wikidata:).
    if (edgeType === 'GROUNDED_IN') continue;
    if (isKbNode(source) || isKbNode(target)) continue;

    const id = edge.edge_id || `${source}->${target}:${edgeType}`;
    if (seenEdgeIds.has(id)) continue;
    seenEdgeIds.add(id);

    edges.push({
      id,
      source,
      target,
      label: edgeType,
      type: edgeType,
      confidence: edge.confidence,
      metadata: edge.metadata,
    });
  }

  return { nodes, edges };
}

/**
 * Convert pipeline extraction output to GraphData (for Studio).
 */
export function normalizeExtractionResults(entities, relations) {
  const nodes = (entities || []).map((e) => ({
    id: e.item_id || e.id || e.name,
    label: e.label || e.name || e.content?.substring(0, 40) || '',
    type: e.entity_type || e.metadata?.entity_type || e.type || 'concept',
    category: 'entity',
    content: e.content || '',
    confidence: e.confidence ?? e.metadata?.confidence,
    metadata: e.metadata,
  }));

  const edges = (relations || []).map((r) => {
    const source = r.source_id || r.source;
    const target = r.target_id || r.target;
    const relType = r.relation_type || r.edge_type || r.type || 'RELATES_TO';
    return {
      id: r.id || `${source}->${target}:${relType}`,
      source,
      target,
      label: relType,
      type: relType,
      confidence: r.confidence,
      metadata: r.metadata,
    };
  });

  return { nodes, edges };
}
