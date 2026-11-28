/**
 * The control for a stepped hop view (Explore Hops, Expand Neighbors): "hop N of M", what the
 * step added, Back / Next hop, and one obvious "Show all". Shown whenever the graph is dimmed by
 * either action. Reads the state `useMultiHopReplay` owns; draws nothing of its own on the canvas.
 */
const BTN = 'px-2 py-0.5 text-xs rounded border border-cyan-300 dark:border-cyan-600 hover:bg-cyan-200 dark:hover:bg-cyan-800 disabled:opacity-40 disabled:cursor-not-allowed';

export default function HopStepper({ multiHop }) {
  const { replayState, step, nextHop, prevHop, showAll, HOP_COLORS } = multiHop;
  if (replayState !== 'stepping' || !step) return null;
  const color = HOP_COLORS[step.active % HOP_COLORS.length];
  const added = step.active === 0
    ? (step.total === 0 ? 'start node, no connections' : 'start node')
    : `+${step.added} ${step.added === 1 ? 'node' : 'nodes'}`;
  return (
    <div
      role="group"
      aria-label="Explore hops"
      className="absolute top-16 left-1/2 -translate-x-1/2 bg-cyan-100 dark:bg-cyan-900/90 border border-cyan-300 dark:border-cyan-600 text-cyan-700 dark:text-cyan-200 px-3 py-2 rounded-lg text-sm z-50 flex items-center gap-3"
    >
      <button type="button" onClick={prevHop} disabled={step.active <= 0} className={BTN}>Back</button>
      <span className="flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
        <span role="status" className="text-xs">hop {step.active} of {step.total}</span>
        <span className="text-xs opacity-80">{added}{step.capped ? ' (capped)' : ''}</span>
      </span>
      <button type="button" onClick={nextHop} disabled={step.active >= step.total} className={BTN}>Next hop</button>
      <button type="button" onClick={showAll} className={`${BTN} font-medium`}>Show all</button>
    </div>
  );
}
