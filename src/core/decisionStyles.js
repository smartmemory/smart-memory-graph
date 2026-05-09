/**
 * Decision-memory visual + lifecycle constants.
 *
 * Source of truth: smart-memory-graph/contracts/decisions.json (mirrors legacy
 * /contracts/decisions.json). Imported by:
 *   - internal/cytoscapeStyles.js  (node/edge style emitters)
 *   - internal/cytoscapeConvert.js (status/data fields → element data)
 *   - components/DecisionDetailBlock.jsx (chain block)
 *   - components/Toolbar.jsx (contradiction overlay toggle)
 *
 * Per smart-memory-graph/.claude/rules/no-silent-degradation.md, decisions that
 * arrive without a status fall through to "unknown" and the resolver logs a
 * one-time WARN. Tests assert this in tests/decisionStyles.test.js.
 */
import decisionsContract from '../../contracts/decisions.json';

export const DECISION_STATUSES = decisionsContract.statuses;
export const DECISION_EDGE_STYLES = decisionsContract.edges;
export const DECISION_NODE_SHAPE = decisionsContract.node.shape;
export const DECISION_NODE_SIZE = decisionsContract.node.size;
export const DECISION_OVERLAY = decisionsContract.overlay;
export const DECISION_TYPES = decisionsContract.decisionTypes;
export const DECISION_ROUTES = decisionsContract._routes;

const VALID_STATUS_KEYS = new Set(Object.keys(DECISION_STATUSES));

let _warnedUnknownStatus = false;

/**
 * Resolve a decision's status into a DECISION_STATUSES entry.
 *
 * @param {string|null|undefined} status
 * @returns {{ color: string, label: string, border_style: string, border_width: number, _resolvedKey: string }}
 */
export function resolveDecisionStatus(status) {
  const key = (typeof status === 'string' && VALID_STATUS_KEYS.has(status)) ? status : 'unknown';
  if (key === 'unknown' && status !== 'unknown') {
    // Per no-silent-degradation: log WARNING, render distinct style.
    if (!_warnedUnknownStatus) {
      _warnedUnknownStatus = true;
      // eslint-disable-next-line no-console
      console.warn(
        '[smartmemory/graph] Decision arrived without a recognized status ' +
        `(received ${JSON.stringify(status)}); falling back to "unknown" style. ` +
        'Producer should set status to one of: ' +
        Array.from(VALID_STATUS_KEYS).filter((k) => k !== 'unknown').join(', '),
      );
    }
  }
  return { ...DECISION_STATUSES[key], _resolvedKey: key };
}

/** Test-only: reset the one-shot warn state. */
export function _resetDecisionStatusWarn() { _warnedUnknownStatus = false; }

/** A node represents a decision memory. */
export function isDecisionNode(node) {
  if (!node) return false;
  // Accept canonical (type='decision', category='memory') and the more permissive
  // category='decision' that some legacy fixtures use.
  if (node.type === 'decision') return true;
  if (node.category === 'decision') return true;
  return false;
}

/** Cytoscape selectors used by the styles module. */
export const DECISION_NODE_SELECTOR = 'node[type="decision"]';
export const DECISION_STATUS_CLASS_PREFIX = 'decision-status-';
export const DECISION_CONTRADICTION_CLASS = 'decision-contradiction';
export const DECISION_CHAIN_HIGHLIGHT_CLASS = 'decision-chain-highlight';
export const DECISION_SUPERSEDES_EDGE_TYPE = 'SUPERSEDES';
export const DECISION_CONFLICT_EDGE_TYPE = 'CONFLICTS_WITH';
