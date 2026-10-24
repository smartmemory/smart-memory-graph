import { useState, useCallback, useRef, useEffect } from 'react';

// Debounce helper — delays API calls while the user is dragging the slider
function useDebouncedCallback(fn, delay) {
  const timer = useRef(null);
  const cleanup = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  useEffect(() => cleanup, [cleanup]);
  return useCallback((...args) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => fn(...args), delay);
  }, [fn, delay]);
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export default function TimeTravelSlider({ onTimeChange, onClose }) {
  const mountTime = useRef(Date.now());
  const thirtyDaysAgo = mountTime.current - THIRTY_DAYS_MS;

  const [value, setValue] = useState(mountTime.current);
  const [isLive, setIsLive] = useState(true);

  const debouncedChange = useDebouncedCallback((timestamp) => {
    const iso = new Date(timestamp).toISOString();
    onTimeChange(iso);
  }, 500);

  const handleSliderChange = useCallback((e) => {
    const ts = parseInt(e.target.value, 10);
    const currentNow = Date.now();
    const nearLive = ts >= currentNow - 60000;
    setValue(ts);
    setIsLive(nearLive);
    if (nearLive) {
      // Slider dragged back to "now" — restore live view
      onTimeChange(null);
    } else {
      debouncedChange(ts);
    }
  }, [debouncedChange, onTimeChange]);

  const handleLive = useCallback(() => {
    setValue(Date.now());
    setIsLive(true);
    onTimeChange(null); // null = live/current
  }, [onTimeChange]);

  // Format timestamp for display
  const displayDate = new Date(value);
  const formatted = isLive
    ? 'Live (current)'
    : displayDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

  return (
    <div className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-card dark:bg-slate-800 border border-input dark:border-slate-600 rounded-xl shadow-2xl px-5 py-3 z-50 w-96 max-w-[calc(100vw-2rem)]">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-purple-700 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-xs font-medium text-foreground dark:text-slate-300">Time Travel</span>
        </div>
        <div className="flex items-center gap-2">
          {!isLive && (
            <button
              onClick={handleLive}
              className="text-xs text-green-700 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 font-medium transition-colors"
            >
              Back to Live
            </button>
          )}
          <button
            onClick={onClose}
            className="text-muted-foreground dark:text-slate-500 hover:text-foreground dark:hover:text-slate-300 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <input
        type="range"
        min={thirtyDaysAgo}
        max={mountTime.current}
        value={value}
        onChange={handleSliderChange}
        className="w-full h-1.5 bg-muted dark:bg-slate-700 rounded-full appearance-none cursor-pointer
                   [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                   [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-500
                   [&::-webkit-slider-thumb]:hover:bg-purple-400 [&::-webkit-slider-thumb]:transition-colors"
      />

      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[10px] text-muted-foreground dark:text-slate-500">30 days ago</span>
        <span className={`text-xs font-medium ${isLive ? 'text-green-700 dark:text-green-400' : 'text-purple-700 dark:text-purple-400'}`}>
          {formatted}
        </span>
        <span className="text-[10px] text-muted-foreground dark:text-slate-500">Now</span>
      </div>
    </div>
  );
}
