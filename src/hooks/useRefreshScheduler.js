import { useEffect, useRef } from 'react';
import { createRefreshScheduler } from '../core/refreshScheduler';

/**
 * A view's refresh scheduler (src/core/refreshScheduler.js, UI-REFRESH-FU-2), stable for the life of
 * the component. `run` may change on every render; the scheduler always calls the latest one.
 * Stopped on unmount (no run, no visibility listener left behind), started again on remount.
 *
 * @param {(reasons: string[]) => *} run
 */
export function useRefreshScheduler(run) {
  const runRef = useRef(run);
  runRef.current = run;
  const schedulerRef = useRef(null);
  if (schedulerRef.current === null) {
    schedulerRef.current = createRefreshScheduler((reasons) => runRef.current(reasons));
  }
  useEffect(() => {
    const scheduler = schedulerRef.current;
    scheduler.start();
    return () => scheduler.stop();
  }, []);
  return schedulerRef.current;
}
