/**
 * ReplayScrubBar — pure UI on top of a useReplayClock instance.
 *
 * VIS-PIPELINE-DAG-1 Phase 3.
 *
 * Renders pause / play, speed selector (0.5× / 1× / 2×), and a seek slider
 * with elapsed/total time labels. All state lives in the clock — this
 * component is purely a controller surface.
 */

import { useCallback, useMemo } from 'react';

const SPEEDS = [0.5, 1, 2];

function fmtSeconds(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '0:00';
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const totalSec = Math.floor(totalMs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * @param {Object} props
 * @param {Object} props.clock - useReplayClock() return value.
 * @param {Object} [props.style]
 */
export default function ReplayScrubBar({ clock, style }) {
  const {
    now,
    paused,
    speed,
    firstTs,
    lastTs,
    durationSec,
    isReady,
    play,
    pause,
    setSpeed,
    seek,
  } = clock || {};

  const elapsedSec = useMemo(() => {
    if (!isReady || firstTs == null || now == null) return 0;
    const raw = Math.max(0, now - firstTs);
    // Clamp to durationSec — if playback ran past the final event, the label
    // would otherwise display elapsed > total. Slider already clamps via
    // value=Math.min(...); now the label matches.
    if (typeof durationSec === 'number' && durationSec > 0) {
      return Math.min(raw, durationSec);
    }
    return raw;
  }, [now, firstTs, isReady, durationSec]);

  const handleSeek = useCallback(
    (e) => {
      if (!isReady || firstTs == null) return;
      const elapsed = Number(e.target.value);
      seek(firstTs + elapsed);
    },
    [seek, firstTs, isReady],
  );

  const togglePlay = useCallback(() => {
    if (paused) play();
    else pause();
  }, [paused, play, pause]);

  if (!clock) return null;

  return (
    <div
      data-testid="replay-scrub-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '6px 10px',
        background: '#1f2937',
        color: '#e5e7eb',
        borderRadius: 6,
        fontSize: 13,
        ...style,
      }}
    >
      <button
        type="button"
        onClick={togglePlay}
        disabled={!isReady}
        aria-label={paused ? 'Play' : 'Pause'}
        style={{
          background: '#374151',
          color: '#e5e7eb',
          border: 'none',
          padding: '4px 10px',
          borderRadius: 4,
          cursor: isReady ? 'pointer' : 'not-allowed',
          minWidth: 60,
        }}
      >
        {paused ? '▶ Play' : '⏸ Pause'}
      </button>

      <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 80 }}>
        {fmtSeconds(elapsedSec)} / {fmtSeconds(durationSec)}
      </span>

      <input
        type="range"
        min={0}
        max={Math.max(0, durationSec)}
        step={0.05}
        value={Math.min(elapsedSec, durationSec)}
        onChange={handleSeek}
        disabled={!isReady || durationSec === 0}
        style={{ flex: 1, minWidth: 100 }}
        aria-label="Seek replay position"
      />

      <span style={{ display: 'flex', gap: 4 }}>
        {SPEEDS.map((s) => (
          <button
            type="button"
            key={s}
            onClick={() => setSpeed(s)}
            style={{
              background: speed === s ? '#0891b2' : '#374151',
              color: '#e5e7eb',
              border: 'none',
              padding: '4px 8px',
              borderRadius: 4,
              cursor: 'pointer',
              fontVariantNumeric: 'tabular-nums',
            }}
            aria-label={`${s}× speed`}
            aria-pressed={speed === s}
          >
            {s}×
          </button>
        ))}
      </span>
    </div>
  );
}

export { fmtSeconds };
