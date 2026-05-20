import { useState, useCallback, useEffect, useRef } from 'react';
import { exportPNG, exportSVG } from '../core/export';
import { LAYOUT_OPTIONS } from '../core/constants';

export default function Toolbar({
  layout,
  onLayoutChange,
  onZoomIn,
  onZoomOut,
  onFitToScreen,
  onRefresh,
  onToggleFilters,
  onPathMode,
  pathMode,
  selectionMode,
  onSelectionModeChange,
  stats,
  cy,
  onCopyLink,
  onToggleTimeTravelSlider,
  timeTravelActive,
  autoFit,
  onAutoFitChange,
  isFullscreen,
  onToggleFullscreen,
  rightActions,
  contradictionOverlay = false,
  onToggleContradictionOverlay,
  originLegendVisible = false,
  onToggleOriginLegend,
}) {
  const [exportOpen, setExportOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const toolbarRef = useRef(null);
  const linkTimerRef = useRef(null);

  // Clean up link-copied timer on unmount
  useEffect(() => {
    return () => { if (linkTimerRef.current) clearTimeout(linkTimerRef.current); };
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target)) {
        setExportOpen(false);
        setLayoutOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleExport = useCallback((format) => {
    const cyInstance = cy?.current;
    if (!cyInstance) return;
    if (format === 'png') exportPNG(cyInstance);
    if (format === 'svg') exportSVG(cyInstance);
    setExportOpen(false);
  }, [cy]);

  return (
    <div ref={toolbarRef} className="h-12 bg-slate-800 border-b border-slate-700 flex items-center px-4 gap-2 shrink-0 z-40">
      {/* App title */}
      <div className="flex items-center gap-2 mr-4">
        <div className="w-6 h-6 rounded bg-blue-600 flex items-center justify-center text-xs font-bold text-white">G</div>
        <span className="text-slate-200 font-medium text-sm hidden sm:inline">Graph Viewer</span>
      </div>

      <div className="w-px h-6 bg-slate-700" />

      {/* Filter toggle */}
      <button
        onClick={onToggleFilters}
        className="px-3 py-1.5 text-sm text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors"
        title="Toggle filters"
      >
        Filters
      </button>

      {/* Layout selector */}
      <div className="relative">
        <button
          onClick={() => { setLayoutOpen(!layoutOpen); setExportOpen(false); }}
          className="px-3 py-1.5 text-sm text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors flex items-center gap-1"
        >
          Layout
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        </button>
        {layoutOpen && (
          <div className="absolute top-full left-0 mt-1 bg-slate-700 border border-slate-600 rounded-lg shadow-xl py-1 min-w-[160px] z-50">
            {LAYOUT_OPTIONS.map((l) => (
              <button
                key={l.id}
                onClick={() => { onLayoutChange(l.id); setLayoutOpen(false); }}
                className={`block w-full text-left px-3 py-1.5 text-sm transition-colors ${
                  layout === l.id ? 'text-blue-400 bg-slate-600' : 'text-slate-300 hover:text-white hover:bg-slate-600'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="w-px h-6 bg-slate-700" />

      {/* Zoom controls */}
      <div className="flex items-center gap-1">
        <button onClick={onZoomOut} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors" title="Zoom out">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" /></svg>
        </button>
        <button onClick={onFitToScreen} className="px-2 py-1 text-xs text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors" title="Fit to screen">
          Fit
        </button>
        <button onClick={onZoomIn} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors" title="Zoom in">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
        </button>
        <label className="flex items-center gap-1 ml-1 cursor-pointer" title="Auto-fit graph to viewport on resize">
          <input
            type="checkbox"
            checked={autoFit}
            onChange={(e) => onAutoFitChange?.(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-slate-500 bg-slate-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
          />
          <span className="text-xs text-slate-400 select-none">Auto</span>
        </label>
      </div>

      <div className="w-px h-6 bg-slate-700" />

      {/* Path finder */}
      <button
        onClick={onPathMode}
        className={`px-3 py-1.5 text-sm rounded transition-colors ${
          pathMode ? 'bg-amber-600 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-700'
        }`}
        title="Find shortest path between two nodes"
      >
        Path
      </button>

      {/* Selection mode toggle */}
      <button
        onClick={() => onSelectionModeChange?.(!selectionMode)}
        className={`px-3 py-1.5 text-sm rounded transition-colors ${
          selectionMode ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-700'
        }`}
        title={selectionMode ? 'Selection mode — click nodes to select, drag to box-select. Click again to return to pan.' : 'Switch to selection mode to select and delete nodes'}
      >
        Select
      </button>

      {/* Export */}
      <div className="relative">
        <button
          onClick={() => { setExportOpen(!exportOpen); setLayoutOpen(false); }}
          className="px-3 py-1.5 text-sm text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors flex items-center gap-1"
        >
          Export
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        </button>
        {exportOpen && (
          <div className="absolute top-full left-0 mt-1 bg-slate-700 border border-slate-600 rounded-lg shadow-xl py-1 min-w-[120px] z-50">
            <button onClick={() => handleExport('png')} className="block w-full text-left px-3 py-1.5 text-sm text-slate-300 hover:text-white hover:bg-slate-600 transition-colors">
              PNG (2x)
            </button>
            <button onClick={() => handleExport('svg')} className="block w-full text-left px-3 py-1.5 text-sm text-slate-300 hover:text-white hover:bg-slate-600 transition-colors">
              SVG
            </button>
          </div>
        )}
      </div>

      <div className="w-px h-6 bg-slate-700" />

      {/* Time Travel */}
      <button
        onClick={onToggleTimeTravelSlider}
        className={`px-3 py-1.5 text-sm rounded transition-colors ${
          timeTravelActive ? 'bg-purple-600 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-700'
        }`}
        title="Time travel — view graph at a past point in time"
      >
        <svg className="w-4 h-4 inline -mt-0.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Time
      </button>

      {/* Decision contradiction overlay */}
      {onToggleContradictionOverlay && (
        <button
          onClick={() => onToggleContradictionOverlay(!contradictionOverlay)}
          className={`px-3 py-1.5 text-sm rounded transition-colors ${
            contradictionOverlay ? 'bg-red-600 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-700'
          }`}
          title="Highlight conflicting decisions on the canvas"
          data-testid="toolbar-contradiction-overlay"
        >
          Conflicts
        </button>
      )}

      {/* Origin Legend */}
      {onToggleOriginLegend && (
        <button
          onClick={onToggleOriginLegend}
          className={`px-3 py-1.5 text-sm rounded transition-colors ${
            originLegendVisible ? 'bg-slate-600 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-700'
          }`}
          title="Toggle origin provenance legend"
        >
          Origin
        </button>
      )}

      {/* Copy Link */}
      <button
        onClick={() => {
          if (onCopyLink) {
            onCopyLink();
            setLinkCopied(true);
            if (linkTimerRef.current) clearTimeout(linkTimerRef.current);
            linkTimerRef.current = setTimeout(() => setLinkCopied(false), 2000);
          }
        }}
        className={`px-3 py-1.5 text-sm rounded transition-colors ${
          linkCopied ? 'bg-green-600 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-700'
        }`}
        title="Copy shareable link to clipboard"
      >
        <svg className="w-4 h-4 inline -mt-0.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
        {linkCopied ? 'Copied!' : 'Link'}
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Stats */}
      <div className="flex items-center gap-3 text-xs text-slate-500">
        <span>{stats.nodes} nodes</span>
        <span>{stats.edges} edges</span>
      </div>

      {/* Refresh */}
      <button
        onClick={onRefresh}
        className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
        title="Refresh graph"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
      </button>

      {/* Fullscreen */}
      <button
        onClick={onToggleFullscreen}
        className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
        title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Enter fullscreen'}
      >
        {isFullscreen ? (
          /* compress / exit-fullscreen icon */
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4m0 5H4m0 0l5-5M15 9h5m-5 0V4m0 5l5-5M9 15v5m0-5H4m0 0l5 5M15 15h5m-5 0v5m0-5l5 5" />
          </svg>
        ) : (
          /* expand / enter-fullscreen icon */
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5h-4m4 0v-4m0 4l-5-5" />
          </svg>
        )}
      </button>

      {rightActions ? <div className="flex items-center gap-1">{rightActions}</div> : null}
    </div>
  );
}
