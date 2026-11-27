import { useLayoutEffect, useRef, useState } from 'react';
import { playRipple } from '../internal/ripplePlayback';
import './ripple.css';

// An adapter read can outlive its decision panel. Serialize live reads on the same canvas.
const inFlight = new WeakMap();

// A native button supports both pointer and keyboard activation inside the decision detail.
export default function RippleControl({ cy, id, adapter }) {
  const { status, projection, show, clear } = useRipple(cy, id, adapter);
  const busy = status === 'loading';
  const ready = status === 'ready';
  return (
    <div className="sm-ripple-controls" role="group" aria-label="Decision ripple">
      <button type="button" disabled={busy} aria-busy={busy} onClick={show}>
        {busy && <span className="sm-ripple-spinner" aria-hidden="true" />}
        {busy ? 'Loading ripple…' : ready && !projection.empty ? 'Replay' : 'Show ripple'}
      </button>
      {(busy || ready) && <button type="button" onClick={clear}>Clear</button>}
      <span role="status">
        {projection.empty && 'This decision touches nothing yet'}
        {projection.offScreen > 0 && <span className="sm-ripple-chip">+{projection.offScreen} off screen</span>}
      </span>
      {status === 'error' && <span role="alert">Could not load this ripple. Try again.</span>}
    </div>
  );
}

// Cache a successful read for replay, scoped to this panel and canvas.
function useRipple(cy, id, adapter) {
  const [status, setStatus] = useState('idle');
  const [projection, setProjection] = useState({});
  const [run, setRun] = useState(null);
  const request = useRef(null);

  useLayoutEffect(() => {
    clear();
    return () => { request.current = null; };
  }, [cy, id, adapter]);
  useLayoutEffect(() => {
    if (run) return playRipple(cy, run.snapshot, setProjection);
  }, [cy, run]);

  function clear() {
    request.current = null;
    setRun(null);
    setProjection({});
    setStatus('idle');
  }

  async function show() {
    if (request.current) return;
    if (run && !projection.empty) {
      setRun({ snapshot: run.snapshot });
      return;
    }
    const ticket = {};
    request.current = ticket;
    setStatus('loading');
    setProjection({});
    setRun(null);
    try {
      const current = () => request.current === ticket;
      const snapshot = await readSnapshot(cy, adapter, id, current);
      if (!current()) return;
      setRun({ snapshot });
      setStatus('ready');
    } catch {
      if (request.current === ticket) setStatus('error');
    } finally {
      if (request.current === ticket) request.current = null;
    }
  }
  return { status, projection, show, clear };
}

// Wait only for a read someone still wants; a discarded one is dropped, not queued behind.
async function readSnapshot(cy, adapter, id, current) {
  const previous = inFlight.get(cy);
  if (previous?.current()) await previous.pending.catch(() => {});
  if (!current()) return;
  const pending = adapter.getDecisionEffects(id);
  const entry = { pending, current };
  inFlight.set(cy, entry);
  try {
    const snapshot = await pending;
    if (snapshot?.focus !== id || !Array.isArray(snapshot.data?.nodes) || !Array.isArray(snapshot.data?.edges)) {
      throw new Error('Incomplete decision effects');
    }
    return snapshot;
  } finally {
    if (inFlight.get(cy) === entry) inFlight.delete(cy);
  }
}
