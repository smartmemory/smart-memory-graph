import { useState, useCallback } from 'react';
import { getLastRecording } from '../core/eventStore';

export default function ReplayButton({ onReplay, disabled, className = '', floating = true }) {
  const [hasRecording, setHasRecording] = useState(null); // null = unknown, true/false after check

  const handleClick = useCallback(async () => {
    const recording = await getLastRecording();
    if (!recording) {
      setHasRecording(false);
      setTimeout(() => setHasRecording(null), 2000); // reset after 2s
      return;
    }
    setHasRecording(true);
    onReplay(recording);
  }, [onReplay]);

  return (
    <div className={floating ? 'absolute bottom-2 right-4 z-40' : className}>
      <button
        onClick={handleClick}
        disabled={disabled}
        className="bg-card dark:bg-slate-800 hover:bg-muted dark:hover:bg-slate-700 disabled:opacity-50 text-foreground dark:text-slate-300 px-3 py-1.5 rounded-lg text-xs border border-border dark:border-slate-700 transition-colors flex items-center gap-1.5"
        title="Replay last session"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        {hasRecording === false ? 'No recording' : 'Replay'}
      </button>
    </div>
  );
}
