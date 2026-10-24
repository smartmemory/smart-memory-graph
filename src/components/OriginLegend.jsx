import React from 'react';
import { ORIGIN_BORDER_COLORS } from '../core/graphColors';
import { getOriginTier, getTierLabel } from '../core/originTiers';

export default function OriginLegend({ visible = true }) {
  if (!visible) return null;
  const entries = Object.entries(ORIGIN_BORDER_COLORS);
  return (
    <div className="absolute bottom-3 left-3 bg-background/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-lg px-3 py-2 text-[10px] z-50 border border-border/50 dark:border-slate-700/50 max-w-[180px]">
      <div className="text-muted-foreground dark:text-slate-400 uppercase tracking-wider mb-1.5 font-medium">Origin</div>
      {entries.map(([prefix, color]) => (
        <div key={prefix} className="flex items-center gap-2 py-0.5">
          {color ? (
            <span
              className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0"
              style={{
                backgroundColor: color,
                border: prefix === 'unknown' ? '1px dashed #ef4444' : 'none',
              }}
            />
          ) : (
            <span className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0 border border-input dark:border-slate-600" />
          )}
          <span className="text-foreground dark:text-slate-300">{prefix}</span>
          <span className="text-muted-foreground dark:text-slate-600 ml-auto">{getTierLabel(getOriginTier(prefix))}</span>
        </div>
      ))}
    </div>
  );
}
