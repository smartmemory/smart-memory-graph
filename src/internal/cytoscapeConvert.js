/**
 * Conversion layer between canonical GraphNode/GraphEdge and Cytoscape element format.
 * This is the ONE place where format conversion happens — enforced by the internal/ convention.
 */
import { getOriginPrefix } from '../core/graphColors';
import { resolveDecisionStatus, isDecisionNode, DECISION_STATUS_CLASS_PREFIX } from '../core/decisionStyles';

const ONE_DAY_MS = 86_400_000;

/** Returns a temporal age bucket string based on absolute age from now. */
function computeAgeBucket(createdAt) {
  if (!createdAt) return null;
  const ageMs = Date.now() - new Date(createdAt).getTime();
  if (ageMs < ONE_DAY_MS) return 'fresh';
  if (ageMs < 7 * ONE_DAY_MS) return 'recent';
  if (ageMs < 30 * ONE_DAY_MS) return 'aging';
  return 'old';
}

// GraphNode → Cytoscape node element
export function graphNodeToCyElement(node) {
  const isDecision = isDecisionNode(node);
  const decisionStatus = isDecision
    ? resolveDecisionStatus(node.status ?? node.metadata?.status)
    : null;

  const classList = [];
  if (node.grounded) classList.push('grounded');
  if (isDecision) {
    classList.push(`${DECISION_STATUS_CLASS_PREFIX}${decisionStatus._resolvedKey}`);
  }

  return {
    group: 'nodes',
    data: {
      id: node.id,
      label: node.label,
      type: node.type,
      category: node.category || 'entity',
      content: node.content || '',
      confidence: node.confidence,
      created_at: node.created_at,
      age_bucket: computeAgeBucket(node.created_at),
      origin: node.origin || 'unknown',
      origin_prefix: getOriginPrefix(node.origin),
      parentId: node.parentId || null,
      metadata: node.metadata,
      grounded: node.grounded ? true : undefined,
      // Decision fields — undefined for non-decision nodes so cytoscape data
      // selectors don't accidentally match (cytoscape's [attr] selectors
      // treat undefined as absent).
      decision_status: isDecision ? decisionStatus._resolvedKey : undefined,
      decision_type: isDecision ? (node.decision_type ?? node.metadata?.decision_type) : undefined,
      supersedes: isDecision ? (node.supersedes ?? node.metadata?.supersedes) : undefined,
      superseded_by: isDecision ? (node.superseded_by ?? node.metadata?.superseded_by) : undefined,
      contradiction_count: isDecision ? (node.contradiction_count ?? node.metadata?.contradiction_count ?? 0) : undefined,
      reinforcement_count: isDecision ? (node.reinforcement_count ?? node.metadata?.reinforcement_count ?? 0) : undefined,
    },
    classes: classList.length ? classList.join(' ') : undefined,
  };
}

// GraphEdge → Cytoscape edge element
export function graphEdgeToCyElement(edge) {
  const id = edge.id || `${edge.source}->${edge.target}:${edge.label}`;
  return {
    group: 'edges',
    data: {
      id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      type: edge.type || edge.label,
      confidence: edge.confidence,
      metadata: edge.metadata,
    },
  };
}

// Cytoscape node element → GraphNode (for callbacks to consumers)
export function cyElementToGraphNode(el) {
  const d = el.data ? el.data : el;
  return {
    id: d.id,
    label: d.label,
    type: d.type,
    category: d.category,
    content: d.content,
    confidence: d.confidence,
    created_at: d.created_at,
    origin: d.origin,
    metadata: d.metadata,
    // Decision fields — undefined for non-decision nodes.
    status: d.decision_status,
    decision_type: d.decision_type,
    supersedes: d.supersedes,
    superseded_by: d.superseded_by,
    contradiction_count: d.contradiction_count,
    reinforcement_count: d.reinforcement_count,
  };
}

// Cytoscape edge element → GraphEdge (for callbacks to consumers)
export function cyElementToGraphEdge(el) {
  const d = el.data ? el.data : el;
  return {
    id: d.id,
    source: d.source,
    target: d.target,
    label: d.label,
    type: d.type,
    confidence: d.confidence,
    metadata: d.metadata,
  };
}
