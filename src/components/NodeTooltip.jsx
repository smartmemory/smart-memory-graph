import { getNodeColor } from '../core/graphColors';

export default function NodeTooltip({ node, position }) {
  if (!node || !position) return null;

  const color = getNodeColor(node.type, node.category);

  return (
    <div
      className="absolute z-50 pointer-events-none bg-card dark:bg-slate-800 border border-input dark:border-slate-600 rounded-lg shadow-xl px-3 py-2 max-w-[240px]"
      style={{ left: position.x + 12, top: position.y - 8 }}
    >
      <div className="flex items-center gap-2 mb-1">
        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="text-xs font-medium text-foreground dark:text-slate-100 truncate">{node.label}</span>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground dark:text-slate-400">
        <span className="capitalize" style={{ color }}>{node.type}</span>
        {node.confidence != null && (
          <>
            <span>&middot;</span>
            <span>{(node.confidence * 100).toFixed(0)}%</span>
          </>
        )}
      </div>
      {node.content && (
        <p className="text-[10px] text-muted-foreground dark:text-slate-500 mt-1 line-clamp-2">{node.content}</p>
      )}
    </div>
  );
}
