/**
 * Entity deduplication and reciprocal edge merging.
 * Pure function — no React, no Cytoscape format.
 *
 * Extracted from useGraphStream.js:119-231.
 * Key change: operates on GraphNode/GraphEdge instead of Cytoscape elements.
 */

import { RECIPROCAL_PAIRS } from './constants';

/**
 * Normalize an entity label for frontend deduplication.
 * Strips articles, lowercases, collapses whitespace.
 */
export function normalizeLabel(label) {
  if (!label) return '';
  return label
    .toLowerCase()
    .replace(/^(the|a|an)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Coalesce duplicate entity nodes by normalized label, remap edges,
 * and merge reciprocal edge pairs (CONTAINS_ENTITY + MENTIONED_IN → RELATED_ENTITY).
 * Mutates canonicalMap in-place for cross-batch persistence.
 *
 * @param {Array<GraphNode>} nodes
 * @param {Array<GraphEdge>} edges
 * @param {Object} canonicalMap - normalizedLabel -> canonicalNodeId (mutable, persists across calls)
 * @returns {{ nodes: GraphNode[], edges: GraphEdge[], idRemap: Object }}
 */
export function coalesceGraphData(nodes, edges, canonicalMap = {}) {
  const idRemap = {};
  const dedupedNodes = [];

  for (const node of nodes) {
    // Only coalesce entity nodes, not memory nodes
    if (node.category !== 'entity') {
      dedupedNodes.push(node);
      continue;
    }
    const key = normalizeLabel(node.label);
    if (!key) {
      dedupedNodes.push(node);
      continue;
    }
    if (canonicalMap[key] && canonicalMap[key] !== node.id) {
      idRemap[node.id] = canonicalMap[key];
    } else {
      canonicalMap[key] = node.id;
      dedupedNodes.push(node);
    }
  }

  // First pass: remap endpoints and collect edges
  const rawEdges = [];
  for (const edge of edges) {
    const src = idRemap[edge.source] || edge.source;
    const tgt = idRemap[edge.target] || edge.target;
    if (src === tgt) continue; // self-loop from merging
    rawEdges.push({ ...edge, source: src, target: tgt });
  }

  // Second pass: merge reciprocal CONTAINS_ENTITY + MENTIONED_IN into RELATED_ENTITY.
  // Group by unordered node pair so both directions of a true reciprocal pair land
  // in the same group; only merge when a group actually contains both edge types
  // (a lone CONTAINS_ENTITY/MENTIONED_IN with no counterpart is NOT reciprocal and
  // must pass through as its original type, not be blanked into RELATED_ENTITY).
  const reciprocalGroups = new Map(); // pairKey -> edges[]
  const nonReciprocalEdges = [];

  for (const edge of rawEdges) {
    if (RECIPROCAL_PAIRS.has(edge.type)) {
      const pairKey = [edge.source, edge.target].sort().join('||');
      if (!reciprocalGroups.has(pairKey)) reciprocalGroups.set(pairKey, []);
      reciprocalGroups.get(pairKey).push(edge);
    } else {
      nonReciprocalEdges.push(edge);
    }
  }

  const seenEdges = new Set();
  const remappedEdges = [];

  for (const [pairKey, group] of reciprocalGroups) {
    const isPaired = new Set(group.map((e) => e.type)).size > 1;
    if (isPaired) {
      // Emit one RELATED_ENTITY edge per pair, drop duplicates
      const [a, b] = pairKey.split('||');
      const edgeKey = `${a}->${b}:RELATED_ENTITY`;
      if (seenEdges.has(edgeKey)) continue;
      seenEdges.add(edgeKey);
      remappedEdges.push({
        id: edgeKey,
        source: a,
        target: b,
        label: '',
        type: 'RELATED_ENTITY',
      });
    } else {
      // Unpaired reciprocal-type edges pass through as-is
      for (const edge of group) {
        const edgeKey = `${edge.source}->${edge.target}:${edge.type}`;
        if (seenEdges.has(edgeKey)) continue;
        seenEdges.add(edgeKey);
        remappedEdges.push({ ...edge, id: edgeKey });
      }
    }
  }

  // Non-reciprocal edges pass through with dedup
  for (const edge of nonReciprocalEdges) {
    const edgeKey = `${edge.source}->${edge.target}:${edge.type}`;
    if (seenEdges.has(edgeKey)) continue;
    seenEdges.add(edgeKey);
    remappedEdges.push({ ...edge, id: edgeKey });
  }

  return { nodes: dedupedNodes, edges: remappedEdges, idRemap };
}
