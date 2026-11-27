import RippleControl from './RippleControl';
import { useEffect, useRef, useState } from 'react';
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
 * @param {boolean} [props.toolsEnabled=true] - Show "Find conflicts" and "Load provenance" (GraphExplorer passes enableDecisionTools, default off)
 */
export default function DecisionDetailBlock({ node, rippleCanvas, adapter, onChainHighlight, onSelectId, toolsEnabled = true, daemon = false, decisionUnavailable = daemon ? 'Unavailable through this daemon' : null }) {
  const [conflicts, setConflicts] = useState(null);
  const [conflictError, setConflictError] = useState(null);
  const [conflictLoading, setConflictLoading] = useState(false);
  const [provenance, setProvenance] = useState(null);
  const [provenanceLoading, setProvenanceLoading] = useState(false);

  const [chainLoading, setChainLoading] = useState(false);
  const [chainError, setChainError] = useState(null);
  const chainRequest = useRef(0);

  // Reset on node change
  useEffect(() => {
    setConflicts(null);
    setConflictError(null);
    setProvenance(null);
    if (onChainHighlight) onChainHighlight(null);
    return () => {
      chainRequest.current++;
      onChainHighlight?.(null);
    };
  }, [node?.id, onChainHighlight]);

  if (!isDecisionNode(node)) return null;

  const status = resolveDecisionStatus(node.status);
  const supersedes = Array.isArray(node.supersedes)
    ? node.supersedes
    : (node.supersedes ? [node.supersedes] : []);
  const supersededBy = node.superseded_by || null;

  const handleHighlightChain = async () => {
    const request = ++chainRequest.current;
    const ids = new Set([node.id, ...supersedes, supersededBy].filter(Boolean));
    setChainError(null);
    setChainLoading(true);
    try {
      if (!daemon && adapter?.getDecisionCausalChain) {
        const chain = await adapter.getDecisionCausalChain(node.id);
        for (const direction of ['causes', 'effects']) {
          const pending = [...(chain?.[direction] || [])];
          while (pending.length) {
            const entry = pending.pop();
            if (entry.node_id) ids.add(entry.node_id);
            pending.push(...(entry[direction] || []));
          }
        }
      }
      if (request === chainRequest.current) onChainHighlight?.([...ids]);
    } catch {
      if (request === chainRequest.current) setChainError('Could not load the decision chain.');
    } finally {
      if (request === chainRequest.current) setChainLoading(false);
    }
  };

  const handleClearChain = () => {
    chainRequest.current++;
    setChainLoading(false);
    setChainError(null);
    onChainHighlight?.(null);
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

  const statusMissing = node.status == null || node.status === '';

  return (
    <section
      data-testid="decision-detail-block"
      className="space-y-2 border-t border-border dark:border-slate-700 pt-3 mt-1"
    >
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground dark:text-slate-400 uppercase tracking-wider">Decision</h3>
        <span
          data-testid="decision-status-badge"
          className={`text-[10px] px-2 py-0.5 rounded-full ${statusMissing
            ? 'bg-muted text-muted-foreground dark:bg-slate-800 dark:text-slate-400'
            : 'font-bold uppercase tracking-wide'}`}
          style={statusMissing ? undefined : {
            backgroundColor: status.color + '22',
            color: status.color,
            border: `1px ${status.border_style} ${status.color}`,
          }}
        >
          {statusMissing ? 'Status not set' : status.label}
        </span>
      </div>

      {rippleCanvas && adapter?.getDecisionEffects && (
        <RippleControl key={node.id} cy={rippleCanvas} id={node.id} adapter={adapter} />
      )}

      {node.decision_type && DECISION_TYPES.includes(node.decision_type) && (
        <div className="text-xs text-foreground dark:text-slate-300">
          <span className="text-muted-foreground dark:text-slate-500">Type:</span>{' '}
          <span className="capitalize">{node.decision_type}</span>
        </div>
      )}

      {(node.reinforcement_count != null || node.contradiction_count != null) && (
        <div className="flex gap-3 text-xs text-muted-foreground dark:text-slate-400">
          <span>
            <span className="text-emerald-700 dark:text-emerald-400">+</span>
            {node.reinforcement_count ?? 0} reinforced
          </span>
          <span>
            <span className="text-red-700 dark:text-red-400">-</span>
            {node.contradiction_count ?? 0} contradicted
          </span>
        </div>
      )}

      {/* Supersession chain block */}
      <div data-testid="decision-chain-block" className="space-y-1">
        {supersedes.length > 0 && (
          <div className="text-xs">
            <span className="text-muted-foreground dark:text-slate-500">Supersedes:</span>
            <ul className="ml-3 mt-0.5 space-y-0.5">
              {supersedes.map((id) => (
                <li key={id}>
                  <button
                    disabled={!onSelectId}
                    onClick={() => onSelectId?.(id)}
                    className="text-amber-700 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 underline truncate font-mono text-[11px]"
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
            <span className="text-muted-foreground dark:text-slate-500">Superseded by:</span>{' '}
            <button
              disabled={!onSelectId}
                    onClick={() => onSelectId?.(supersededBy)}
              className="text-amber-700 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 underline font-mono text-[11px]"
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
              disabled={!onChainHighlight || chainLoading}
              className="text-[11px] px-2 py-0.5 rounded bg-amber-600/20 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-600/40 hover:bg-amber-600/30"
            >
              {chainLoading ? 'Loading chain…' : 'Highlight chain'}
            </button>
            <button
              onClick={handleClearChain}
              disabled={!onChainHighlight}
              className="text-[11px] px-2 py-0.5 rounded bg-muted/40 dark:bg-slate-700/40 text-foreground dark:text-slate-300 border border-input/40 dark:border-slate-600/40 hover:bg-muted/60 dark:hover:bg-slate-700/60"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {chainError && <p role="alert" className="text-xs">{chainError}</p>}

      {toolsEnabled && (<>
      {/* Conflicts */}
      <div className="space-y-1">
        {conflicts == null ? (
          <button
            onClick={handleLoadConflicts}
            disabled={!!decisionUnavailable || conflictLoading || !adapter?.findDecisionConflicts}
            className="text-[11px] px-2 py-0.5 rounded bg-red-600/20 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-600/40 hover:bg-red-600/30 disabled:opacity-40"
          >
            {decisionUnavailable ? `Find conflicts · ${decisionUnavailable}` : conflictLoading ? 'Checking…' : 'Find conflicts'}
          </button>
        ) : (
          <div data-testid="decision-conflicts">
            <div className="text-xs text-muted-foreground dark:text-slate-400">
              Conflicts: <span className="text-red-700 dark:text-red-300">{conflicts.length}</span>
            </div>
            {conflicts.length > 0 && (
              <ul className="ml-3 mt-0.5 space-y-0.5">
                {conflicts.slice(0, 10).map((c) => (
                  <li key={c.decision_id || c.id}>
                    <button
                      disabled={!onSelectId}
                    onClick={() => onSelectId?.(c.decision_id || c.id)}
                      className="text-red-700 dark:text-red-300 hover:text-red-700 dark:hover:text-red-200 underline truncate font-mono text-[11px]"
                      title={c.decision_id || c.id}
                    >
                      {(c.decision_id || c.id || '').toString().slice(0, 24)}…
                    </button>
                    {c.content && (
                      <span className="ml-1 text-muted-foreground dark:text-slate-400 text-[11px]">{c.content.slice(0, 60)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {conflictError && (
          <div className="text-[11px] text-red-700 dark:text-red-400">{conflictError}</div>
        )}
      </div>

      {/* Provenance */}
      <div>
        {provenance == null ? (
          <button
            onClick={handleLoadProvenance}
            disabled={!!decisionUnavailable || provenanceLoading || !adapter?.getDecisionProvenance}
            className="text-[11px] px-2 py-0.5 rounded bg-blue-600/20 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-600/40 hover:bg-blue-600/30 disabled:opacity-40"
          >
            {decisionUnavailable ? `Load provenance · ${decisionUnavailable}` : provenanceLoading ? 'Loading…' : 'Load provenance'}
          </button>
        ) : provenance._error ? (
          <div className="text-[11px] text-red-700 dark:text-red-400">{provenance._error}</div>
        ) : (
          <div data-testid="decision-provenance" className="text-xs text-foreground dark:text-slate-300 space-y-0.5">
            <div className="text-muted-foreground dark:text-slate-500">Provenance</div>
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
      </>)}
    </section>
  );
}
