import { useEffect, useState } from 'react';
import {
  resolveDecisionStatus,
  isDecisionNode,
  DECISION_TYPES,
} from '../core/decisionStyles';

/**
 * Decision-specific detail-panel block.
 *
 * Rendered by <DetailPanel> when the selected node is a decision memory
 * (type='decision' or category='decision'). Surfaces:
 *   - Status badge (active / superseded / retracted / pending / unknown)
 *   - Decision type (inference / preference / ...)
 *   - Reinforcement / contradiction counts
 *   - Chain block: prev (supersedes) and next (superseded_by) links
 *   - Conflict list (lazy-loaded from adapter.findDecisionConflicts)
 *   - Provenance link (lazy-loaded from adapter.getDecisionProvenance)
 *
 * The chain block also requests the surrounding component to highlight
 * the full lineage on the canvas via `onChainHighlight(ids[])`. Highlight
 * is cleared by passing `null`. The component never mutates Cytoscape
 * directly — that's the canvas owner's job.
 *
 * @param {Object} props
 * @param {GraphNode} props.node - Selected decision node
 * @param {GraphAPIAdapter} [props.adapter] - Optional adapter; required for live conflict / provenance lookup
 * @param {function(string[]|null): void} [props.onChainHighlight] - Apply chain highlight to canvas
 * @param {function(string): void} [props.onSelectId] - Navigate to another node by id
 */
export default function DecisionDetailBlock({ node, adapter, onChainHighlight, onSelectId }) {
  const [conflicts, setConflicts] = useState(null);
  const [conflictError, setConflictError] = useState(null);
  const [conflictLoading, setConflictLoading] = useState(false);
  const [provenance, setProvenance] = useState(null);
  const [provenanceLoading, setProvenanceLoading] = useState(false);

  // Reset on node change
  useEffect(() => {
    setConflicts(null);
    setConflictError(null);
    setProvenance(null);
    if (onChainHighlight) onChainHighlight(null);
    return () => { if (onChainHighlight) onChainHighlight(null); };
  }, [node?.id, onChainHighlight]);

  if (!isDecisionNode(node)) return null;

  const status = resolveDecisionStatus(node.status);
  const supersedes = Array.isArray(node.supersedes)
    ? node.supersedes
    : (node.supersedes ? [node.supersedes] : []);
  const supersededBy = node.superseded_by || null;

  const handleHighlightChain = () => {
    const ids = [node.id, ...supersedes];
    if (supersededBy) ids.push(supersededBy);
    if (onChainHighlight) onChainHighlight(ids);
  };

  const handleClearChain = () => {
    if (onChainHighlight) onChainHighlight(null);
  };

  const handleLoadConflicts = async () => {
    if (!adapter || typeof adapter.findDecisionConflicts !== 'function') {
      setConflictError('Adapter does not expose findDecisionConflicts');
      return;
    }
    setConflictLoading(true);
    setConflictError(null);
    try {
      const result = await adapter.findDecisionConflicts(node.id);
      setConflicts(result?.conflicts || []);
    } catch (err) {
      setConflictError(err?.message || String(err));
    } finally {
      setConflictLoading(false);
    }
  };

  const handleLoadProvenance = async () => {
    if (!adapter || typeof adapter.getDecisionProvenance !== 'function') return;
    setProvenanceLoading(true);
    try {
      const result = await adapter.getDecisionProvenance(node.id);
      setProvenance(result || null);
    } catch (err) {
      // Per no-silent-degradation: surface error in the UI rather than swallowing.
      setProvenance({ _error: err?.message || String(err) });
    } finally {
      setProvenanceLoading(false);
    }
  };

  const isUnknownStatus = status._resolvedKey === 'unknown';

  return (
    <section
      data-testid="decision-detail-block"
      className="space-y-2 border-t border-slate-700 pt-3 mt-1"
    >
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Decision</h3>
        <span
          data-testid="decision-status-badge"
          className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide"
          style={{
            backgroundColor: status.color + '22',
            color: status.color,
            border: `1px ${status.border_style} ${status.color}`,
          }}
        >
          {status.label}
        </span>
        {isUnknownStatus && (
          <span className="text-[10px] text-red-400" title="Decision producer did not set status">
            (untagged)
          </span>
        )}
      </div>

      {node.decision_type && DECISION_TYPES.includes(node.decision_type) && (
        <div className="text-xs text-slate-300">
          <span className="text-slate-500">Type:</span>{' '}
          <span className="capitalize">{node.decision_type}</span>
        </div>
      )}

      {(node.reinforcement_count != null || node.contradiction_count != null) && (
        <div className="flex gap-3 text-xs text-slate-400">
          <span>
            <span className="text-emerald-400">+</span>
            {node.reinforcement_count ?? 0} reinforced
          </span>
          <span>
            <span className="text-red-400">-</span>
            {node.contradiction_count ?? 0} contradicted
          </span>
        </div>
      )}

      {/* Supersession chain block */}
      <div data-testid="decision-chain-block" className="space-y-1">
        {supersedes.length > 0 && (
          <div className="text-xs">
            <span className="text-slate-500">Supersedes:</span>
            <ul className="ml-3 mt-0.5 space-y-0.5">
              {supersedes.map((id) => (
                <li key={id}>
                  <button
                    onClick={() => onSelectId && onSelectId(id)}
                    className="text-amber-400 hover:text-amber-300 underline truncate font-mono text-[11px]"
                    title={id}
                  >
                    {id}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {supersededBy && (
          <div className="text-xs">
            <span className="text-slate-500">Superseded by:</span>{' '}
            <button
              onClick={() => onSelectId && onSelectId(supersededBy)}
              className="text-amber-400 hover:text-amber-300 underline font-mono text-[11px]"
              title={supersededBy}
            >
              {supersededBy}
            </button>
          </div>
        )}
        {(supersedes.length > 0 || supersededBy) && (
          <div className="flex gap-2 mt-1">
            <button
              onClick={handleHighlightChain}
              className="text-[11px] px-2 py-0.5 rounded bg-amber-600/20 text-amber-300 border border-amber-600/40 hover:bg-amber-600/30"
            >
              Highlight chain
            </button>
            <button
              onClick={handleClearChain}
              className="text-[11px] px-2 py-0.5 rounded bg-slate-700/40 text-slate-300 border border-slate-600/40 hover:bg-slate-700/60"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Conflicts */}
      <div className="space-y-1">
        {conflicts == null ? (
          <button
            onClick={handleLoadConflicts}
            disabled={conflictLoading || !adapter}
            className="text-[11px] px-2 py-0.5 rounded bg-red-600/20 text-red-300 border border-red-600/40 hover:bg-red-600/30 disabled:opacity-40"
          >
            {conflictLoading ? 'Checking…' : 'Find conflicts'}
          </button>
        ) : (
          <div data-testid="decision-conflicts">
            <div className="text-xs text-slate-400">
              Conflicts: <span className="text-red-300">{conflicts.length}</span>
            </div>
            {conflicts.length > 0 && (
              <ul className="ml-3 mt-0.5 space-y-0.5">
                {conflicts.slice(0, 10).map((c) => (
                  <li key={c.decision_id || c.id}>
                    <button
                      onClick={() => onSelectId && onSelectId(c.decision_id || c.id)}
                      className="text-red-300 hover:text-red-200 underline truncate font-mono text-[11px]"
                      title={c.decision_id || c.id}
                    >
                      {(c.decision_id || c.id || '').toString().slice(0, 24)}…
                    </button>
                    {c.content && (
                      <span className="ml-1 text-slate-400 text-[11px]">{c.content.slice(0, 60)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {conflictError && (
          <div className="text-[11px] text-red-400">{conflictError}</div>
        )}
      </div>

      {/* Provenance */}
      <div>
        {provenance == null ? (
          <button
            onClick={handleLoadProvenance}
            disabled={provenanceLoading || !adapter}
            className="text-[11px] px-2 py-0.5 rounded bg-blue-600/20 text-blue-300 border border-blue-600/40 hover:bg-blue-600/30 disabled:opacity-40"
          >
            {provenanceLoading ? 'Loading…' : 'Load provenance'}
          </button>
        ) : provenance._error ? (
          <div className="text-[11px] text-red-400">{provenance._error}</div>
        ) : (
          <div data-testid="decision-provenance" className="text-xs text-slate-300 space-y-0.5">
            <div className="text-slate-500">Provenance</div>
            {provenance.evidence?.length > 0 && (
              <div className="text-[11px]">Evidence: {provenance.evidence.length} items</div>
            )}
            {provenance.superseded?.length > 0 && (
              <div className="text-[11px]">Superseded chain: {provenance.superseded.length} prior</div>
            )}
            {provenance.reasoning_trace && (
              <div className="text-[11px]">Has reasoning trace</div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
