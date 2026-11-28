// Keep the last successful graph and the controls that selected it together.
// === 1. Imports ===
import { useEffect, useRef, useState } from 'react';

// === 2. Public API ===
export default function useRulesHistory(data, effects, read, warn = defaultWarning) {
  const { focus, today } = effects;
  const [view, setView] = useState({ date: today, retired: false });
  const [pending, setPending] = useState(null);
  const [error, setError] = useState('');
  const request = useRef(0);
  const history = useHistoryStart(read, focus, today, warn);
  useEffect(() => () => { request.current++; }, []);
  async function select(date, retired) {
    const version = ++request.current;
    const selection = { date, retired };
    setError('');
    if (!read) { setView(selection); return; }
    setPending(selection);
    try {
      const snapshot = await read(focus, { as_of: date, show_retired: retired });
      if (version === request.current) setView({ ...selection, snapshot });
    } catch (reason) {
      if (version === request.current) {
        warn(reason);
        setError('Could not load the selected rules. Showing the last successful view.');
      }
    } finally {
      if (version === request.current) setPending(null);
    }
  }
  const snapshot = view.snapshot;
  const first = history.first || initialStart(data, effects);
  const loadingRange = Boolean(read && !history.first && !history.error);
  return { view, selection: pending || view, select, first, loadingRange, error: error || history.error,
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
    let active = true;
    read(focus, { as_of: today, show_retired: true }).then(snapshot => {
      if (active) setHistory({ first: earliestRule(snapshot.data, today) });
    }).catch(reason => {
      if (active) {
        warn(reason);
        setHistory({ error: 'Could not load the full date range for this decision.' });
      }
    });
    return () => { active = false; };
  }, [focus, read, today, warn]);
  return history;
}
