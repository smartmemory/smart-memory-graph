// Keep the last successful graph and the controls that selected it together.
// === 1. Imports ===
import { useEffect, useRef, useState } from 'react';

// === 2. Public API ===
export default function useRulesHistory(data, effects, read, warn = defaultWarning) {
  const { focus, today } = effects;
  const [view, setView] = useState({ date: today, retired: false });
  const [pending, setPending] = useState(null);
  const [error, setError] = useState('');
  const cancelRead = useRef(null);
  const history = useHistoryStart(read, focus, today, warn);
  useEffect(() => () => cancelRead.current?.(), []);
  async function select(date, retired, dragging) {
    cancelRead.current?.();
    const selection = { date, retired };
    setError('');
    if (!read) { setView(selection); return; }
    setPending(selection);
    if (dragging) return;
    const controller = new AbortController();
    const { signal } = controller;
    cancelRead.current = () => controller.abort();
    try {
      const snapshot = await read(focus, { as_of: date, show_retired: retired }, { signal });
      if (!signal.aborted) setView({ ...selection, snapshot });
    } catch (reason) {
      if (!signal.aborted) {
        warn(reason);
        setError('Could not load the selected rules. Showing the last successful view.');
      }
    } finally {
      if (!signal.aborted) {
        setPending(null);
        cancelRead.current = null;
      }
    }
  }
  const snapshot = view.snapshot;
  const first = history.first || initialStart(data, effects);
  const loadingRange = Boolean(read && !history.first && !history.error);
  return { view, pending, selection: pending || view, select, first, loadingRange, error: error || history.error,
    data: snapshot?.data || data, effects: snapshot ? { ...snapshot, today } : effects };
}

// === 3. Internal helpers ===
function defaultWarning(reason) {
  console.warn('Could not load decision history', reason);
}

function initialStart(data, effects) {
  if (effects.phase === 'standing') return earliestRule(data, effects.today);
  // Unsaved previews have no server history and retain their local timeline.
  const january = effects.today.slice(0, 4) + '-01-01';
  return data.nodes.reduce((min, node) => node.validFrom < min ? node.validFrom : min, january);
}

function earliestRule(data, today) {
  return data.nodes.reduce((min, node) =>
    node.type === 'decision' && node.validFrom < min ? node.validFrom : min, today);
}

function useHistoryStart(read, focus, today, warn) {
  const [history, setHistory] = useState({});
  useEffect(() => {
    if (!read) return;
    const controller = new AbortController();
    const { signal } = controller;
    const rangeError = { error: 'Could not load the full date range for this decision.' };
    const timer = setTimeout(() => {
      controller.abort();
      setHistory(rangeError);
      warn(new Error('Decision date range timed out'));
    }, 10000);
    read(focus, { as_of: today, show_retired: true }, { signal }).then(snapshot => {
      if (!signal.aborted) setHistory({ first: earliestRule(snapshot.data, today) });
    }).catch(reason => {
      if (!signal.aborted) {
        warn(reason);
        setHistory(rangeError);
      }
    }).finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); };
  }, [focus, read, today, warn]);
  return history;
}
