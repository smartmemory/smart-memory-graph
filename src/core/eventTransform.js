/**
 * Transform raw graph event data into canonical GraphNode/GraphEdge objects.
 * Pure functions — no React, no Cytoscape format.
 *
 * Extracted from useGraphStream.js:80-113.
 * Key change: returns GraphNode/GraphEdge instead of Cytoscape elements.
 */

import { MEMORY_TYPE_SET } from './graphColors';

/**
 * Build a GraphNode from a graph event's data payload.
 * Returns null for events that should be skipped.
 *
 * VIS-PIPELINE-DAG-1 Phase 1b: optional second arg surfaces
 * payload.original_ts on the GraphNode so downstream replay machinery
 * (Phase 3 useReplayClock) can pace by recorded wall-clock instead of
 * arrival order. Backwards-compatible: callers passing only `data` keep
 * the legacy shape.
 */
export function eventToGraphNode(data, payload) {
  if (!data) return null;
  const id = data.memory_id || data.item_id || data.node_id || data.id;
  if (!id) return null;
  // Skip internal nodes (version tracker artifacts, Wikipedia grounding nodes)
  if (id.startsWith('version_') || id.startsWith('wikipedia:')) return null;

  const label = data.label || data.title || data.content?.substring(0, 40) || id.substring(0, 12);
  const isEntity = data.node_category === 'entity' || !!data.entity_type;
  const type = isEntity
    ? (data.entity_type || data.type || 'concept')
    : (data.memory_type || data.type || 'semantic');
  const category = isEntity ? 'entity' : (MEMORY_TYPE_SET.has(type) ? 'memory' : 'entity');

  const node = {
    id,
    label,
    type,
    category,
    content: data.content || '',
    parentId: data.parent_memory_id || null,
  };

  const original_ts = payload?.original_ts;
  if (typeof original_ts === 'number') {
    node.original_ts = original_ts;
  }
  return node;
}

/**
 * Build a GraphEdge from a graph event's data payload.
 * Returns null for events that should be skipped.
 *
 * VIS-PIPELINE-DAG-1 Phase 1b: optional second arg surfaces
 * payload.original_ts on the GraphEdge for the same reason as eventToGraphNode.
 */
export function eventToGraphEdge(data, payload) {
  if (!data) return null;
  const src = data.source_id || data.source;
  const tgt = data.target_id || data.target;
  if (!src || !tgt) return null;

  const edgeType = data.edge_type || data.link_type || 'RELATES_TO';
  // Skip Wikipedia grounding edges
  if (edgeType === 'GROUNDED_IN') return null;
  if (src.startsWith('wikipedia:') || tgt.startsWith('wikipedia:')) return null;

  const edge = {
    id: `${src}->${tgt}:${edgeType}`,
    source: src,
    target: tgt,
    label: edgeType,
    type: edgeType,
  };

  const original_ts = payload?.original_ts;
  if (typeof original_ts === 'number') {
    edge.original_ts = original_ts;
  }
  return edge;
}

/**
 * VIS-PIPELINE-DAG-1 Phase 2: extraction-drip projection.
 *
 * Convert an extracted-entity payload — emitted by `_entity_to_drip_dict`
 * in `smart-memory-core/smartmemory/pipeline/stages/llm_extract.py` with
 * shape `{id, name, type, confidence}` — into the `data` shape expected
 * by eventToGraphNode and the existing graph.node consumer path.
 *
 * Backwards-tolerant: also accepts the legacy `{name, entity_type, ...}`
 * dict shape for tests and out-of-process producers that pre-date v1.4.0.
 *
 * Returns null if the payload is missing required fields.
 */
export function extractionEntityToData(entity) {
  if (!entity || typeof entity !== 'object') return null;
  const name = entity.name;
  if (!name) return null;
  // Prefer producer-supplied id (stable hash); fall back to derived id for
  // legacy payloads.
  const id = entity.id || `entity:${name}`;
  const type = entity.type || entity.entity_type || 'concept';
  return {
    id,
    label: name,
    entity_type: type,
    node_category: 'entity',
    confidence: entity.confidence,
  };
}

/**
 * VIS-PIPELINE-DAG-1 Phase 2: extraction-drip projection.
 *
 * Convert an extracted-relation payload — emitted by `_relation_to_drip_dict`
 * in core with shape `{source_id, target_id, type, raw_predicate, confidence}`
 * — into the `data` shape expected by eventToGraphEdge.
 *
 * Backwards-tolerant: also accepts the legacy `{subject, predicate, object}`
 * shape for tests and pre-v1.4.0 producers.
 *
 * Returns null if the payload is missing required source/target.
 */
export function extractionRelationToData(relation) {
  if (!relation || typeof relation !== 'object') return null;
  const src = relation.source_id || (relation.subject ? `entity:${relation.subject}` : null);
  const tgt = relation.target_id || (relation.object ? `entity:${relation.object}` : null);
  if (!src || !tgt) return null;
  const edgeType = relation.type || relation.relation_type || relation.predicate || 'RELATES_TO';
  return {
    id: `${src}->${tgt}:${edgeType}`,
    source_id: src,
    target_id: tgt,
    edge_type: edgeType,
    raw_predicate: relation.raw_predicate,
    confidence: relation.confidence,
  };
}
