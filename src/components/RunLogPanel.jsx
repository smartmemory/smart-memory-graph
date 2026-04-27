/**
 * RunLogPanel — text log of progress events for a run, with optional
 * stage filter. VIS-PIPELINE-DAG-1 Phase 5.
 *
 * Pure presentation: receives the eventsByStage map from usePipelineDag (or
 * a similar source) and renders a scrollable log. When `stageFilter` is set,
 * shows only that stage's events (driven by clicking a node in PipelineDag).
 */

import { useMemo } from 'react';

/**
 * @param {Object} props
 * @param {Object<string, Object[]>} props.eventsByStage  - { [stage]: ProgressEvent[] }
 * @param {string|null} [props.stageFilter]               - Restrict to one stage.
 * @param {() => void} [props.onClearFilter]
 * @param {Object} [props.style]
 */
export default function RunLogPanel({
  eventsByStage = {},
  stageFilter = null,
  onClearFilter,
  style,
}) {
  const rows = useMemo(() => {
    const flat = [];
    const stages = stageFilter ? [stageFilter] : Object.keys(eventsByStage);
    for (const stage of stages) {
      for (const ev of eventsByStage[stage] || []) {
        flat.push({ stage, ev });
      }
    }
    // Sort by seq (or ts as fallback) ascending — matches arrival order.
    flat.sort((a, b) => {
      const sa = typeof a.ev.seq === 'number' ? a.ev.seq : a.ev.ts || 0;
      const sb = typeof b.ev.seq === 'number' ? b.ev.seq : b.ev.ts || 0;
      return sa - sb;
    });
    return flat;
  }, [eventsByStage, stageFilter]);

  return (
    <div
      data-testid="run-log-panel"
      style={{
        background: '#0f172a',
        color: '#e5e7eb',
        borderRadius: 6,
        padding: '6px 10px',
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
        fontSize: 12,
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontWeight: 600 }}>Log</span>
        <span style={{ marginLeft: 8, color: '#94a3b8' }}>
          {stageFilter ? `(${rows.length} events for ${stageFilter})` : `(${rows.length} events)`}
        </span>
        {stageFilter && onClearFilter && (
          <button
            type="button"
            onClick={onClearFilter}
            style={{
              marginLeft: 'auto',
              background: '#374151',
              color: '#e5e7eb',
              border: 'none',
              borderRadius: 4,
              padding: '2px 8px',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            clear filter ×
          </button>
        )}
      </div>
      <div style={{ maxHeight: 200, overflowY: 'auto' }}>
        {rows.length === 0 && (
          <div style={{ color: '#64748b', padding: 4 }}>
            No events {stageFilter ? `for ${stageFilter}` : 'yet'}.
          </div>
        )}
        {rows.map(({ stage, ev }) => (
          <RunLogRow key={`${ev.run_id}:${ev.seq}:${stage}`} stage={stage} ev={ev} />
        ))}
      </div>
    </div>
  );
}

const STATUS_COLOR = {
  started: '#22d3ee',
  progress: '#0891b2',
  ok: '#10b981',
  warn: '#f59e0b',
  error: '#ef4444',
};

function RunLogRow({ stage, ev }) {
  const color = STATUS_COLOR[ev.status] || '#9ca3af';
  const reason = ev.payload?.reason ? ` reason=${ev.payload.reason}` : '';
  const dur = typeof ev.payload?.duration_ms === 'number'
    ? ` ${Math.round(ev.payload.duration_ms)}ms`
    : '';
  // Drip events (entity / relation) get a compact label.
  const drip = ev.payload?.entity?.name
    ? ` entity="${ev.payload.entity.name}"`
    : ev.payload?.relation?.type
      ? ` relation="${ev.payload.relation.type}"`
      : '';
  return (
    <div style={{ padding: '1px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      <span style={{ color: '#64748b' }}>#{ev.seq}</span>{' '}
      <span style={{ color }}>{ev.status}</span>{' '}
      <span style={{ color: '#cbd5e1' }}>{stage}</span>
      <span style={{ color: '#94a3b8' }}>{reason}{dur}{drip}</span>
    </div>
  );
}
