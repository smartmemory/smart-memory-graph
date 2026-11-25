import { useEffect, useState } from 'react';

export function useDaemonCapabilities(adapter) {
  const [result, setResult] = useState(null);
  const daemon = typeof adapter?.getDaemonCapabilities === 'function';

  useEffect(() => {
    if (!daemon) return;
    let active = true;
    adapter.getDaemonCapabilities().then(
      (capabilities) => { if (active) setResult({ adapter, capabilities }); },
      () => { if (active) setResult({ adapter, error: true }); },
    );
    return () => { active = false; };
  }, [adapter, daemon]);

  return { daemon, ...(result?.adapter === adapter ? result : {}) };
}
