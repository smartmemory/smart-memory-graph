import { useState, useRef, useEffect, useMemo } from 'react';

const CATEGORY_ICONS = {
  node_added: { icon: '\u25CF', color: 'text-green-400' },    // filled circle
  edge_added: { icon: '\u2192', color: 'text-blue-400' },     // right arrow
  node_removed: { icon: '\u25CB', color: 'text-red-400' },    // empty circle
  pipeline_stage: { icon: '\u25D0', color: 'text-yellow-400' }, // half circle
  search_highlight: { icon: '\uD83D\uDD0D', color: 'text-purple-400' }, // magnifying glass
  ingest_started: { icon: '\u2295', color: 'text-slate-400' }, // circled plus
  graph_cleared: { icon: '\u2716', color: 'text-red-400' },   // heavy X
};

const STATUS_COLORS = {
  connected: 'bg-green-500',
  connecting: 'bg-yellow-500 animate-pulse',
  disconnected: 'bg-red-500',
  reconnecting: 'bg-yellow-500',
};

// Row heights: 1 row = 40px, 2 rows = 72px, 3 rows = 104px
const ROW_HEIGHTS = [40, 72, 104];
const MAX_ROWS = 3;

function formatTime(timestamp) {
  if (!timestamp) return '';
  try {
    const d = new Date(timestamp);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch {
    return '';
  }
}

export default function OperationsBar({
  status,
  operations,
  opsPerSecond,
  isPaused,
  onPause,
  onResume,
  onOperationClick,
  dripInterval,
  onDripIntervalChange,
  replayControl,
}) {
  const tickerRef = useRef(null);
  const [expandedRows, setExpandedRows] = useState(1); // 1-3 rows

  // Track seen event IDs so new arrivals get an entrance animation
  const seenIdsRef = useRef(new Set());
  const newIds = useMemo(() => {
    const fresh = new Set();
    for (const op of operations) {
      if (!seenIdsRef.current.has(op.id)) {
        fresh.add(op.id);
        seenIdsRef.current.add(op.id);
      }
    }
    // Trim seen set to match buffer size (prevent unbounded growth)
    if (seenIdsRef.current.size > 200) {
      const ids = [...seenIdsRef.current];
      seenIdsRef.current = new Set(ids.slice(ids.length - 150));
    }
    return fresh;
  }, [operations]);

  // Auto-scroll ticker to the left (newest entries appear on the left)
  useEffect(() => {
    if (tickerRef.current && !isPaused && expandedRows === 1) {
      tickerRef.current.scrollLeft = 0;
    }
  }, [operations.length, isPaused, expandedRows]);

  const toggleExpand = () => {
    setExpandedRows((prev) => prev >= MAX_ROWS ? 1 : prev + 1);
  };

  const height = ROW_HEIGHTS[expandedRows - 1];
  const isExpanded = expandedRows > 1;

  return (
    <div
      className="bg-slate-800 border-t border-slate-700 flex px-3 gap-3 shrink-0 text-xs transition-all duration-200"
      style={{ height }}
    >
      {/* Left column: status + controls (vertically centered) */}
      <div className="flex flex-col justify-center gap-1 shrink-0 py-1">
        {/* Status indicator */}
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[status] || STATUS_COLORS.disconnected}`} />
          <span className="text-slate-400 tabular-nums w-16">
            {status === 'connected' ? `${opsPerSecond} ops/s` : status}
          </span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={isPaused ? onResume : onPause}
            className="text-slate-400 hover:text-slate-200 transition-colors px-1 py-0.5 rounded hover:bg-slate-700"
            title={isPaused ? 'Resume live feed' : 'Pause live feed'}
          >
            {isPaused ? '\u25B6' : '\u23F8'}
          </button>
          <button
            onClick={toggleExpand}
            className="text-slate-400 hover:text-slate-200 transition-colors px-1 py-0.5 rounded hover:bg-slate-700"
            title={isExpanded ? `Showing ${expandedRows} rows (click to ${expandedRows >= MAX_ROWS ? 'collapse' : 'expand'})` : 'Expand event bar'}
          >
            {expandedRows >= MAX_ROWS ? '\u25BC' : '\u25B2'}
          </button>
        </div>
      </div>

      {/* Speed control */}
      {dripInterval != null && (
        <div className="flex flex-col justify-center gap-0.5 shrink-0 py-1">
          <span className="text-slate-500 text-[10px] leading-none">Speed</span>
          <div className="flex items-center gap-1">
            <input
              type="range"
              min={100}
              max={1000}
              step={50}
              value={dripInterval}
              onChange={(e) => onDripIntervalChange?.(Number(e.target.value))}
              className="w-16 h-1 accent-cyan-500 cursor-pointer"
              title={`${dripInterval}ms per element`}
            />
            <span className="text-slate-400 tabular-nums w-10 text-[10px]">{dripInterval}ms</span>
          </div>
        </div>
      )}

      {/* Divider */}
      <div className="w-px bg-slate-700 shrink-0 my-1" />

      {/* Event items — single-row horizontal scroll OR multi-row wrap */}
      <div
        ref={tickerRef}
        className={
          isExpanded
            ? 'flex-1 overflow-y-auto overflow-x-hidden flex flex-wrap content-start gap-1 py-1 scrollbar-hide'
            : 'flex-1 overflow-x-auto whitespace-nowrap scrollbar-hide flex items-center gap-3'
        }
      >
        {operations.length === 0 && status === 'connected' && (
          <span className="text-slate-500 italic">Waiting for events...</span>
        )}
        {operations.length === 0 && status !== 'connected' && (
          <span className="text-slate-500 italic">
            {status === 'connecting' ? 'Connecting...' : 'Not connected to event stream'}
          </span>
        )}
        {operations.map((op) => {
          const config = CATEGORY_ICONS[op.category] || CATEGORY_ICONS.ingest_started;
          const isNew = newIds.has(op.id);
          return (
            <button
              key={op.id}
              onClick={() => onOperationClick?.(op)}
              className={`flex items-center gap-1.5 hover:bg-slate-700/50 rounded px-1.5 py-0.5 transition-colors cursor-pointer ${
                isExpanded ? '' : 'shrink-0'
              } ${isNew ? 'animate-fade-in' : ''}`}
              title={`${op.label}\n${formatTime(op.timestamp)}\nTrace: ${op.traceId || 'none'}`}
            >
              <span className={config.color}>{config.icon}</span>
              <span className={`text-slate-300 truncate ${isExpanded ? 'max-w-36' : 'max-w-48'}`}>{op.label}</span>
              <span className="text-slate-500">{formatTime(op.timestamp)}</span>
            </button>
          );
        })}
      </div>

      {replayControl ? (
        <>
          <div className="w-px bg-slate-700 shrink-0 my-1" />
          <div className="flex items-center shrink-0 py-1">
            {replayControl}
          </div>
        </>
      ) : null}
    </div>
  );
}
