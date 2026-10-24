import { useState } from 'react';

/**
 * Wikipedia disambiguation overlay for grounding entities.
 * Renders inside DetailPanel when user clicks "Ground" on an entity node.
 */
export default function WikipediaOverlay({ results, onAccept, onCancel, loading }) {
  const [selectedIdx, setSelectedIdx] = useState(0);

  if (loading) {
    return (
      <div className="mt-3 p-3 bg-background/80 dark:bg-slate-900/80 border border-input dark:border-slate-600 rounded-lg">
        <div className="flex items-center gap-2 text-xs text-muted-foreground dark:text-slate-400">
          <div className="w-3 h-3 border-2 border-blue-300 dark:border-blue-400 border-t-transparent rounded-full animate-spin" />
          Searching Wikipedia...
        </div>
      </div>
    );
  }

  if (!results || results.length === 0) {
    return (
      <div className="mt-3 p-3 bg-background/80 dark:bg-slate-900/80 border border-input dark:border-slate-600 rounded-lg">
        <p className="text-xs text-muted-foreground dark:text-slate-400">No Wikipedia results found.</p>
        <button
          onClick={onCancel}
          className="mt-2 text-xs text-muted-foreground dark:text-slate-500 hover:text-foreground dark:hover:text-slate-300 transition-colors"
        >
          Close
        </button>
      </div>
    );
  }

  const selected = results[selectedIdx];

  return (
    <div className="mt-3 p-3 bg-background/80 dark:bg-slate-900/80 border border-input dark:border-slate-600 rounded-lg space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-foreground dark:text-slate-300 uppercase tracking-wider">
          Wikipedia Grounding
        </h4>
        <button
          onClick={onCancel}
          className="text-muted-foreground dark:text-slate-500 hover:text-foreground dark:hover:text-slate-300 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Disambiguation list (when multiple results) */}
      {results.length > 1 && (
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => setSelectedIdx(i)}
              className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                i === selectedIdx
                  ? 'bg-blue-600/20 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-600/30'
                  : 'text-muted-foreground dark:text-slate-400 hover:bg-card dark:hover:bg-slate-800'
              }`}
            >
              <span className="font-medium">{r.title}</span>
              {(r.description || r.summary) && (
                <span className="text-muted-foreground dark:text-slate-500 ml-1">
                  — {(r.description || r.summary).substring(0, 60)}{(r.description || r.summary).length > 60 ? '...' : ''}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Selected article details */}
      {selected && (
        <div className="space-y-2">
          <h5 className="text-xs font-medium text-foreground dark:text-slate-200">{selected.title}</h5>
          {selected.summary && (
            <p className="text-xs text-muted-foreground dark:text-slate-400 leading-relaxed max-h-24 overflow-y-auto">
              {selected.summary}
            </p>
          )}
          {selected.categories && selected.categories.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selected.categories.slice(0, 5).map((cat, i) => (
                <span
                  key={i}
                  className="text-[10px] px-1.5 py-0.5 bg-muted dark:bg-slate-700 text-muted-foreground dark:text-slate-400 rounded"
                >
                  {cat}
                </span>
              ))}
            </div>
          )}
          {selected.url && (
            <a
              href={selected.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-blue-700 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Wikipedia
            </a>
          )}

          {/* Suggested type correction */}
          {selected.suggested_type && (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-100 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700/30 rounded text-[10px] text-amber-700 dark:text-amber-400">
              <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Suggests type: <span className="font-medium">{selected.suggested_type}</span>
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onAccept(selected)}
          className="flex-1 px-3 py-1.5 text-xs font-medium bg-green-600/20 text-green-700 dark:text-green-400 border border-green-300 dark:border-green-600/30 rounded hover:bg-green-600/30 transition-colors"
        >
          Accept
        </button>
        <button
          onClick={onCancel}
          className="flex-1 px-3 py-1.5 text-xs font-medium bg-muted dark:bg-slate-700 text-muted-foreground dark:text-slate-400 border border-input dark:border-slate-600 rounded hover:bg-accent dark:hover:bg-slate-600 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
