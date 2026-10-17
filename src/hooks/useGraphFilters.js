import { useState, useCallback, useMemo } from 'react';

// Type-filter state per family (UI-REFRESH-1). `null` shows every type. `{ hidden }` shows every
// type except the ones the user turned off, so a type that first appears after a toggle (a
// refresh brings the first decision node) is visible. `{ only }` is set by "deselect all" and
// shows only what the user picks afterwards, so a later type stays hidden there.
// The old shape snapshotted "the active types" at the first toggle, which silently hid every
// type that arrived later.
function resolveActiveTypes(state, available) {
  if (state === null) return new Set(available);
  if (state.only) return new Set(state.only);
  return new Set(available.filter((t) => !state.hidden.has(t)));
}

function toggleTypeState(state, type) {
  if (state === null) return { hidden: new Set([type]) };
  const key = state.only ? 'only' : 'hidden';
  const next = new Set(state[key]);
  if (next.has(type)) next.delete(type);
  else next.add(type);
  return { [key]: next };
}

// Legacy explicit-set shape: an iterable of exactly the active types, or null for all.
function fromActiveSet(active) {
  return active == null ? null : { only: new Set(active) };
}

/**
 * Filter state for graph nodes and edges.
 * Refactored: operates on GraphNode[] instead of Cytoscape elements.
 *
 * @param {GraphNode[]} nodes - Array of graph nodes
 * @param {GraphEdge[]} edges - Array of graph edges
 */
export function useGraphFilters(nodes, edges) {
  const [memoryTypeState, setMemoryTypeState] = useState(null);
  const [entityTypeState, setEntityTypeState] = useState(null);
  const [relationTypeState, setRelationTypeState] = useState(null);

  // Streamed types/nodes (not in the initial arrays)
  const [streamedTypes, setStreamedTypes] = useState({ memory: new Set(), entity: new Set(), relation: new Set() });
  const [streamedNodeMap, setStreamedNodeMap] = useState(new Map());
  const [cascadeEdgeFilter, setCascadeEdgeFilter] = useState(() => {
    const stored = localStorage.getItem('graph:cascadeEdgeFilter');
    return stored !== null ? stored === 'true' : false;
  });

  // Register types from streaming elements (accepts GraphNode | GraphEdge)
  const registerStreamedElements = useCallback((els) => {
    if (!els || els.length === 0) return;

    setStreamedTypes((prev) => {
      let changed = false;
      const memory = new Set(prev.memory);
      const entity = new Set(prev.entity);
      const relation = new Set(prev.relation);
      for (const el of els) {
        if ('source' in el) {
          // Edge
          if (!relation.has(el.type)) { relation.add(el.type); changed = true; }
        } else {
          // Node
          if (el.category === 'memory' && !memory.has(el.type)) { memory.add(el.type); changed = true; }
          else if (el.category === 'entity' && !entity.has(el.type)) { entity.add(el.type); changed = true; }
        }
      }
      return changed ? { memory, entity, relation } : prev;
    });

    setStreamedNodeMap((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const el of els) {
        if (!('source' in el) && !next.has(el.id)) {
          next.set(el.id, { type: el.type, category: el.category });
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  // Extract available types from data + streaming
  const availableTypes = useMemo(() => {
    const memoryTypes = new Set(streamedTypes.memory);
    const entityTypes = new Set(streamedTypes.entity);
    const relationTypes = new Set(streamedTypes.relation);

    for (const node of (nodes || [])) {
      if (node.category === 'memory') memoryTypes.add(node.type);
      else if (node.category === 'entity') entityTypes.add(node.type);
    }
    for (const edge of (edges || [])) {
      relationTypes.add(edge.type);
    }

    return {
      memoryTypes: Array.from(memoryTypes).sort(),
      entityTypes: Array.from(entityTypes).sort(),
      relationTypes: Array.from(relationTypes).sort(),
    };
  }, [nodes, edges, streamedTypes]);

  const activeMemorySet = useMemo(
    () => resolveActiveTypes(memoryTypeState, availableTypes.memoryTypes),
    [memoryTypeState, availableTypes.memoryTypes],
  );

  const activeEntitySet = useMemo(
    () => resolveActiveTypes(entityTypeState, availableTypes.entityTypes),
    [entityTypeState, availableTypes.entityTypes],
  );

  const activeEdgeTypes = useMemo(
    () => resolveActiveTypes(relationTypeState, availableTypes.relationTypes),
    [relationTypeState, availableTypes.relationTypes],
  );

  // Compute visible node IDs (includes both API and streamed nodes)
  const visibleNodeIds = useMemo(() => {
    const ids = new Set();

    for (const node of (nodes || [])) {
      if (node.category === 'memory' && activeMemorySet.has(node.type)) {
        ids.add(node.id);
      } else if (node.category === 'entity' && activeEntitySet.has(node.type)) {
        ids.add(node.id);
      }
    }

    for (const [nodeId, { type, category }] of streamedNodeMap) {
      if (category === 'memory' && activeMemorySet.has(type)) {
        ids.add(nodeId);
      } else if (category === 'entity' && activeEntitySet.has(type)) {
        ids.add(nodeId);
      }
    }

    return ids;
  }, [nodes, activeMemorySet, activeEntitySet, streamedNodeMap]);

  const toggleMemoryType = useCallback((type) => setMemoryTypeState((prev) => toggleTypeState(prev, type)), []);
  const toggleEntityType = useCallback((type) => setEntityTypeState((prev) => toggleTypeState(prev, type)), []);
  const toggleRelationType = useCallback((type) => setRelationTypeState((prev) => toggleTypeState(prev, type)), []);

  const selectAllMemoryTypes = useCallback(() => setMemoryTypeState(null), []);
  const deselectAllMemoryTypes = useCallback(() => setMemoryTypeState({ only: new Set() }), []);
  const selectAllEntityTypes = useCallback(() => setEntityTypeState(null), []);
  const deselectAllEntityTypes = useCallback(() => setEntityTypeState({ only: new Set() }), []);
  const selectAllRelationTypes = useCallback(() => setRelationTypeState(null), []);
  const deselectAllRelationTypes = useCallback(() => setRelationTypeState({ only: new Set() }), []);
  // Legacy setter: a Set of active relation types (exactly those), or null for all.
  const setActiveRelationTypes = useCallback((active) => setRelationTypeState(fromActiveSet(active)), []);

  return {
    activeMemoryTypes: activeMemorySet,
    activeEntityTypes: activeEntitySet,
    activeRelationTypes: relationTypeState === null ? null : activeEdgeTypes,
    activeEdgeTypes,
    availableTypes,
    visibleNodeIds,
    toggleMemoryType,
    toggleEntityType,
    toggleRelationType,
    setActiveRelationTypes,
    selectAllMemoryTypes,
    deselectAllMemoryTypes,
    selectAllEntityTypes,
    deselectAllEntityTypes,
    selectAllRelationTypes,
    deselectAllRelationTypes,
    registerStreamedElements,
    cascadeEdgeFilter,
    toggleCascadeEdgeFilter: () =>
      setCascadeEdgeFilter((prev) => {
        const next = !prev;
        localStorage.setItem('graph:cascadeEdgeFilter', String(next));
        return next;
      }),
  };
}
