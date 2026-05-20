import { getNodeColor } from '../core/graphColors';

export default function FilterPanel({
  filters,
  onClose,
  searchBar,
  originLegendVisible,
  onToggleOriginLegend,
}) {
  const {
    activeMemoryTypes,
    activeEntityTypes,
    activeEdgeTypes,
    availableTypes,
    toggleMemoryType,
    toggleEntityType,
    toggleRelationType,
    selectAllMemoryTypes,
    deselectAllMemoryTypes,
    selectAllEntityTypes,
    deselectAllEntityTypes,
    selectAllRelationTypes,
    deselectAllRelationTypes,
    cascadeEdgeFilter,
    toggleCascadeEdgeFilter,
  } = filters;

  return (
    <div className="w-56 bg-slate-800 border-r border-slate-700 shrink-0 flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-slate-700">
        <span className="text-sm font-medium text-slate-200">Filters</span>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-slate-300 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-3 flex-1 overflow-y-auto space-y-4">
        {searchBar ? (
          <section>
            {searchBar}
          </section>
        ) : null}

        {/* Memory Types */}
        {availableTypes.memoryTypes.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Memory Types <span className="text-slate-500 normal-case font-normal">({availableTypes.memoryTypes.length})</span></h3>
              <div className="flex gap-1">
                <button onClick={selectAllMemoryTypes} className="text-[10px] text-slate-500 hover:text-slate-300">All</button>
                <span className="text-slate-600">|</span>
                <button onClick={deselectAllMemoryTypes} className="text-[10px] text-slate-500 hover:text-slate-300">None</button>
              </div>
            </div>
            <div className="space-y-1">
              {availableTypes.memoryTypes.map((type) => (
                <TypeCheckbox
                  key={type}
                  type={type}
                  color={getNodeColor(type, 'memory')}
                  checked={activeMemoryTypes.has(type)}
                  onChange={() => toggleMemoryType(type)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Entity Types */}
        {availableTypes.entityTypes.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Entity Types <span className="text-slate-500 normal-case font-normal">({availableTypes.entityTypes.length})</span></h3>
              <div className="flex gap-1">
                <button onClick={selectAllEntityTypes} className="text-[10px] text-slate-500 hover:text-slate-300">All</button>
                <span className="text-slate-600">|</span>
                <button onClick={deselectAllEntityTypes} className="text-[10px] text-slate-500 hover:text-slate-300">None</button>
              </div>
            </div>
            <div className="space-y-1">
              {availableTypes.entityTypes.map((type) => (
                <TypeCheckbox
                  key={type}
                  type={type}
                  color={getNodeColor(type, 'entity')}
                  checked={activeEntityTypes.has(type)}
                  onChange={() => toggleEntityType(type)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Relation Types */}
        {availableTypes.relationTypes.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Relations <span className="text-slate-500 normal-case font-normal">({availableTypes.relationTypes.length})</span></h3>
              <div className="flex gap-1">
                <button onClick={selectAllRelationTypes} className="text-[10px] text-slate-500 hover:text-slate-300">All</button>
                <span className="text-slate-600">|</span>
                <button onClick={deselectAllRelationTypes} className="text-[10px] text-slate-500 hover:text-slate-300">None</button>
              </div>
            </div>
            <div className="space-y-1">
              {availableTypes.relationTypes.map((type) => (
                <TypeCheckbox
                  key={type}
                  type={type}
                  color="#64748b"
                  checked={activeEdgeTypes.has(type)}
                  onChange={() => toggleRelationType(type)}
                />
              ))}
            </div>
            <label className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-700/50 py-0.5 px-1 rounded hover:bg-slate-700/50 cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={cascadeEdgeFilter}
                onChange={toggleCascadeEdgeFilter}
                className="sr-only"
              />
              <div
                className={`w-3 h-3 rounded-sm border flex items-center justify-center transition-colors ${
                  cascadeEdgeFilter ? 'border-transparent bg-blue-500' : 'border-slate-500 bg-transparent'
                }`}
              >
                {cascadeEdgeFilter && (
                  <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <span className="text-[10px] text-slate-400">Hide orphaned nodes</span>
            </label>
          </section>
        )}
      </div>

      {onToggleOriginLegend && (
        <div className="border-t border-slate-700 px-3 py-2">
          <label className="flex items-center gap-2 py-0.5 px-1 rounded hover:bg-slate-700/50 cursor-pointer transition-colors">
            <input
              type="checkbox"
              checked={!!originLegendVisible}
              onChange={onToggleOriginLegend}
              className="sr-only"
            />
            <div
              className={`w-3 h-3 rounded-sm border flex items-center justify-center transition-colors ${
                originLegendVisible ? 'border-transparent bg-blue-500' : 'border-slate-500 bg-transparent'
              }`}
            >
              {originLegendVisible && (
                <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            <span className="text-xs text-slate-300">Origin legend</span>
          </label>
        </div>
      )}

      <div className="border-t border-slate-700 p-2 bg-slate-800/95">
        <p className="text-[11px] text-slate-500 text-center select-none">
          Press <span className="text-slate-300">?</span> for shortcuts
        </p>
      </div>
    </div>
  );
}

function TypeCheckbox({ type, color, checked, onChange }) {
  return (
    <label className="flex items-center gap-2 py-0.5 px-1 rounded hover:bg-slate-700/50 cursor-pointer transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      <div
        className={`w-3 h-3 rounded-sm border flex items-center justify-center transition-colors ${
          checked ? 'border-transparent' : 'border-slate-500 bg-transparent'
        }`}
        style={{ backgroundColor: checked ? color : undefined }}
      >
        {checked && (
          <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
      <span className="text-xs text-slate-300 capitalize">{type.replace(/_/g, ' ')}</span>
    </label>
  );
}
