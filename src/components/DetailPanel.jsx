import { useState, useEffect } from 'react';
import { getNodeColor, getOriginBorderColor } from '../core/graphColors';
import { getOriginTier, getTierLabel } from '../core/originTiers';
import { ENTITY_TYPES } from '../core/constants';
import { isDecisionNode } from '../core/decisionStyles';
import { useEntityCorrections } from '../hooks/useEntityCorrections';
import WikipediaOverlay from './WikipediaOverlay';
import DecisionDetailBlock from './DecisionDetailBlock';

const EDGES_PAGE_SIZE = 10;

/**
 * Node detail panel with entity correction capabilities.
 * Entity corrections are powered by the useEntityCorrections hook.
 *
 * @param {Object} props
 * @param {GraphNode} props.node - Selected node data
 * @param {GraphEdge[]} props.edges - Connected edges
 * @param {function} props.onClose - Close the panel
 * @param {function} props.onExpand - Expand neighbors for this node
 * @param {boolean} props.expanding - Whether neighbor expansion is in progress
 * @param {function} props.onNodeUpdate - Callback to update node data (nodeId, updates)
 * @param {GraphAPIAdapter} props.adapter - API adapter for entity corrections
 */
export default function DetailPanel({ node, edges = [], onClose, onExpand, expanding, onNodeUpdate, onDelete, adapter, onDecisionChainHighlight, onSelectId, onHopReplay, hopReplayState }) {
  const [edgesShown, setEdgesShown] = useState(EDGES_PAGE_SIZE);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reset delete-confirm state when node changes
  useEffect(() => {
    setConfirmDelete(false);
    setDeleting(false);
  }, [node?.id]);

  const isEntity = node?.category === 'entity';

  const corrections = useEntityCorrections({
    node,
    adapter,
    onNodeUpdate,
  });

  // Reset edges pagination when node changes
  const nodeId = node?.id;
  useEffect(() => {
    setEdgesShown(EDGES_PAGE_SIZE);
  }, [nodeId]);

  if (!node) return null;

  const color = getNodeColor(node.type, node.category);
  const created = node.created_at ? new Date(node.created_at).toLocaleString() : null;
  const updated = node.updated_at ? new Date(node.updated_at).toLocaleString() : null;
  const paginatedEdges = edges.slice(0, edgesShown);
  const hasMore = edges.length > edgesShown;

  return (
    <div className="w-72 h-full bg-slate-800 border-l border-slate-700 overflow-y-auto shrink-0 flex flex-col shadow-2xl">
      <div className="flex items-center justify-between p-3 border-b border-slate-700">
        <span className="text-sm font-medium text-slate-200">Node Details</span>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-slate-300 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-3 space-y-4 flex-1 overflow-y-auto">
        {/* Header with type badge */}
        <div>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: color }} />

            {/* Type badge — clickable for entities */}
            {isEntity ? (
              <div className="relative">
                <button
                  onClick={() => corrections.setTypeDropdownOpen(!corrections.typeDropdownOpen)}
                  className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize cursor-pointer hover:ring-1 hover:ring-white/20 transition-all ${corrections.typeSaved ? 'ring-2 ring-green-500' : ''}`}
                  style={{ backgroundColor: color + '20', color }}
                  title="Click to change entity type"
                >
                  {node.type}
                  <svg className="w-2.5 h-2.5 inline ml-1 -mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Type dropdown */}
                {corrections.typeDropdownOpen && (
                  <div className="absolute top-full left-0 mt-1 z-50 w-40 bg-slate-900 border border-slate-600 rounded-lg shadow-xl overflow-hidden">
                    <div className="max-h-48 overflow-y-auto">
                      {ENTITY_TYPES.map((t) => (
                        <button
                          key={t}
                          onClick={() => corrections.handleTypeChange(t)}
                          className={`w-full text-left px-3 py-1.5 text-xs capitalize hover:bg-slate-700 transition-colors ${t === node.type ? 'text-blue-400 font-medium' : 'text-slate-300'}`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                    {/* Custom type input */}
                    <div className="border-t border-slate-700 p-2">
                      <input
                        type="text"
                        value={corrections.customType}
                        onChange={(e) => corrections.setCustomType(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && corrections.customType.trim()) corrections.handleTypeChange(corrections.customType.trim().toLowerCase()); }}
                        placeholder="Custom type..."
                        className="w-full text-xs px-2 py-1 bg-slate-800 border border-slate-600 rounded text-slate-300 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <span
                className="text-xs font-medium px-2 py-0.5 rounded-full capitalize"
                style={{ backgroundColor: color + '20', color }}
              >
                {node.type}
              </span>
            )}

            {node.category && node.category !== node.type && (
              <span className="text-xs text-slate-500">({node.category})</span>
            )}
          </div>

          {/* Label — editable for entities */}
          {isEntity && corrections.editingLabel ? (
            <input
              ref={corrections.labelInputRef}
              type="text"
              value={corrections.labelValue}
              onChange={(e) => corrections.setLabelValue(e.target.value)}
              onBlur={corrections.handleLabelSave}
              onKeyDown={(e) => { if (e.key === 'Enter') corrections.handleLabelSave(); if (e.key === 'Escape') corrections.setEditingLabel(false); }}
              className="text-sm font-medium text-slate-100 bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 w-full focus:outline-none focus:border-blue-500"
            />
          ) : (
            <h2
              className={`text-sm font-medium text-slate-100 break-words ${isEntity ? 'cursor-pointer hover:bg-slate-700/50 rounded px-1 -mx-1 transition-colors' : ''} ${corrections.labelSaved ? 'ring-1 ring-green-500 rounded' : ''}`}
              onClick={() => {
                if (isEntity) {
                  corrections.setLabelValue(node.label);
                  corrections.setEditingLabel(true);
                }
              }}
              title={isEntity ? 'Click to rename' : undefined}
            >
              {node.label}
            </h2>
          )}
        </div>

        {/* Grounding status */}
        {!corrections.groundingLoading && corrections.grounding && (
          <div>
            {corrections.grounding.grounded ? (
              <div className="flex items-center gap-1.5 text-xs">
                <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                <span className="text-green-400 font-medium">Grounded</span>
                {corrections.grounding.wikipedia?.url && (
                  <div className="flex items-center gap-1 ml-auto">
                    <a
                      href={corrections.grounding.wikipedia.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 transition-colors"
                      title={corrections.grounding.wikipedia.title || 'Wikipedia'}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                    <button
                      onClick={corrections.handleUnground}
                      className="text-red-400/60 hover:text-red-400 transition-colors"
                      title="Remove grounding"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            ) : isEntity ? (
              <button
                onClick={corrections.handleGround}
                disabled={corrections.wikiLoading}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-purple-600/20 text-purple-400 border border-purple-600/30 rounded hover:bg-purple-600/30 disabled:opacity-40 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Ground
              </button>
            ) : null}
          </div>
        )}

        {/* Wikipedia overlay */}
        {corrections.showWikiOverlay && (
          <WikipediaOverlay
            results={corrections.wikiResults}
            loading={corrections.wikiLoading}
            onAccept={corrections.handleGroundAccept}
            onCancel={() => corrections.setShowWikiOverlay(false)}
          />
        )}

        {/* Expand neighbors button */}
        {onExpand && (
          <button
            onClick={() => onExpand(node.id)}
            disabled={expanding}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium bg-blue-600/20 text-blue-400 border border-blue-600/30 rounded-lg hover:bg-blue-600/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {expanding ? (
              <>
                <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                Expanding...
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
                Expand Neighbors
              </>
            )}
          </button>
        )}

        {/* Multi-hop replay button */}
        {onHopReplay && (
          <button
            onClick={() => onHopReplay(node.id)}
            disabled={hopReplayState === 'playing'}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium bg-cyan-600/20 text-cyan-400 border border-cyan-600/30 rounded-lg hover:bg-cyan-600/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {hopReplayState === 'playing' ? (
              <>
                <div className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                Replaying hops...
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Explore Hops
              </>
            )}
          </button>
        )}

        {/* Content */}
        {node.content && (
          <section>
            <div className="flex items-center gap-1.5 mb-1">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Content</h3>
              {corrections.grounding?.grounded && corrections.grounding.wikipedia?.url && (
                <a
                  href={corrections.grounding.wikipedia.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 transition-colors ml-auto"
                  title={`Wikipedia: ${corrections.grounding.wikipedia.title || ''}`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              )}
            </div>
            <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap break-words max-h-48 overflow-y-auto bg-slate-900/50 rounded p-2">
              {node.content}
            </p>
          </section>
        )}

        {/* Decision-specific block */}
        {isDecisionNode(node) && (
          <DecisionDetailBlock
            node={node}
            adapter={adapter}
            onChainHighlight={onDecisionChainHighlight}
            onSelectId={onSelectId}
          />
        )}

        {/* Connected Edges */}
        {edges.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
              Connections ({edges.length})
            </h3>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {paginatedEdges.map((edge) => {
                const srcId = typeof edge.source === 'string' ? edge.source : edge.source?.toString?.() || edge.source;
                const tgtId = typeof edge.target === 'string' ? edge.target : edge.target?.toString?.() || edge.target;
                const isSource = srcId === node.id;
                const otherId = isSource ? tgtId : srcId;
                const direction = isSource ? '\u2192' : '\u2190';
                return (
                  <div
                    key={edge.id}
                    className="flex items-center gap-1.5 text-xs py-1 px-2 bg-slate-900/50 rounded"
                  >
                    <span className="text-slate-500">{direction}</span>
                    <span className="text-blue-400 font-medium truncate">{edge.label}</span>
                    <span className="text-slate-500 truncate ml-auto" title={otherId}>
                      {edge._otherLabel || (otherId.length > 16 ? otherId.substring(0, 16) + '...' : otherId)}
                    </span>
                  </div>
                );
              })}
              {hasMore && (
                <button
                  onClick={() => setEdgesShown((prev) => prev + EDGES_PAGE_SIZE)}
                  className="w-full text-center text-xs text-blue-400 hover:text-blue-300 py-1 transition-colors"
                >
                  Show more ({edges.length - edgesShown} remaining)
                </button>
              )}
            </div>
          </section>
        )}

        {/* ID */}
        <section>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">ID</h3>
          <p className="text-xs text-slate-500 font-mono break-all select-all">{node.id}</p>
        </section>

        {/* Confidence */}
        {node.confidence != null && (
          <section>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Confidence</h3>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${(node.confidence * 100).toFixed(0)}%`,
                    backgroundColor: node.confidence > 0.7 ? '#10b981' : node.confidence > 0.4 ? '#f59e0b' : '#ef4444',
                  }}
                />
              </div>
              <span className="text-xs text-slate-400">{(node.confidence * 100).toFixed(0)}%</span>
            </div>
          </section>
        )}

        {/* Origin provenance */}
        {node.origin && (
          <section>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Origin</h3>
            <div className="flex items-center gap-2">
              {(() => {
                const borderColor = getOriginBorderColor(node.origin);
                if (node.origin === 'unknown') {
                  return <span className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0 border border-dashed border-red-500" />;
                }
                return borderColor
                  ? <span className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0" style={{ backgroundColor: borderColor }} />
                  : null;
              })()}
              <span className={`text-xs font-mono ${node.origin === 'unknown' ? 'text-red-400' : 'text-slate-300'}`}>
                {node.origin}
              </span>
            </div>
            <div className={`text-[10px] mt-0.5 ${node.origin === 'unknown' ? 'text-red-500/70' : 'text-slate-500'}`}>
              {node.origin === 'unknown'
                ? 'Untagged write path'
                : getTierLabel(getOriginTier(node.origin))}
            </div>
          </section>
        )}

        {/* Timestamps */}
        {(created || updated) && (
          <section>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Timestamps</h3>
            <div className="space-y-1 text-xs text-slate-400">
              {created && <p>Created: {created}</p>}
              {updated && <p>Updated: {updated}</p>}
            </div>
          </section>
        )}

        {/* Metadata */}
        {node.metadata && Object.keys(node.metadata).length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Metadata</h3>
            <div className="bg-slate-900/50 rounded p-2 text-xs text-slate-300 font-mono overflow-x-auto max-h-48 overflow-y-auto">
              <pre>{JSON.stringify(node.metadata, null, 2)}</pre>
            </div>
          </section>
        )}
      </div>

      {/* Footer — destructive actions */}
      {onDelete && (
        <div className="border-t border-slate-700 p-3 bg-slate-800 shrink-0">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-300 flex-1">Delete this node?</span>
              <button
                type="button"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try { await onDelete(node.id); } finally { setDeleting(false); setConfirmDelete(false); }
                }}
                className="px-2 py-1 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded transition-colors disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Confirm'}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirmDelete(false)}
                className="px-2 py-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="w-full px-3 py-1.5 text-xs font-medium text-red-400 hover:text-white hover:bg-red-600/80 border border-red-600/40 hover:border-red-500 rounded transition-colors"
              title="Delete this node from the graph"
            >
              Delete Node
            </button>
          )}
        </div>
      )}
    </div>
  );
}
