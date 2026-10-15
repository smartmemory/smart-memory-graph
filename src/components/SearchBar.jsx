import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { getNodeColor } from '../core/graphColors';
import { shortcutAppliesTo } from '../core/graphKeyboard';

/**
 * Search bar for graph nodes.
 * Accepts GraphNode[] (not Cytoscape elements) — searches node.label, node.content, node.type, node.id.
 *
 * @param {{ nodes: GraphNode[] }} props.nodes - Array of graph nodes to search
 * @param {function} props.onSearch - Called with array of matching node IDs
 * @param {function} props.onNodeSelect - Called with a single node ID when user picks a result
 */
export default function SearchBar({ nodes, onSearch, onNodeSelect }) {
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  // Search results (debounced)
  const [results, setResults] = useState([]);

  const doSearch = useCallback(
    (q) => {
      if (!q.trim()) {
        setResults([]);
        onSearch([]);
        return;
      }
      const lower = q.toLowerCase();
      const matched = (nodes || [])
        .filter((n) => {
          const label = (n.label || '').toLowerCase();
          const content = (n.content || '').toLowerCase();
          const type = (n.type || '').toLowerCase();
          const id = (n.id || '').toLowerCase();
          return label.includes(lower) || content.includes(lower) || type.includes(lower) || id.includes(lower);
        })
        .slice(0, 20);
      setResults(matched);
      onSearch(matched.map((n) => n.id));
    },
    [nodes, onSearch]
  );

  const handleChange = useCallback(
    (e) => {
      const val = e.target.value;
      setQuery(val);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => doSearch(val), 200);
    },
    [doSearch]
  );

  const handleClear = useCallback(() => {
    setQuery('');
    setResults([]);
    onSearch([]);
    inputRef.current?.focus();
  }, [onSearch]);

  const handleSelect = useCallback(
    (id) => {
      onNodeSelect(id);
      setIsFocused(false);
    },
    [onNodeSelect]
  );

  // Clear debounce timer on unmount
  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  // Keyboard shortcut: Cmd/Ctrl+K to focus search, Escape to leave it.
  // GRAPH-KEY-DELETE-1: inside an explorer the listener sits on that explorer, not on the host
  // window, so a host editor keeps its Cmd/Ctrl+K (Obsidian inserts a link with it). Even inside
  // the explorer it yields to any other editable element: stealing focus from the DetailPanel
  // rename input blurs it, and that blur saves the edit to the backend.
  useEffect(() => {
    const input = inputRef.current;
    const listenOn = input?.closest('[data-graph-explorer]') ?? window;
    const handler = (e) => {
      if (!shortcutAppliesTo(e.target, { ownInput: input, activeElement: input?.ownerDocument.activeElement })) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        input?.focus();
      }
      if (e.key === 'Escape') {
        input?.blur();
        setIsFocused(false);
      }
    };
    listenOn.addEventListener('keydown', handler);
    return () => listenOn.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="w-full">
      {/* Results dropdown (above the search bar) */}
      {isFocused && results.length > 0 && (
        <div className="mb-2 bg-slate-900 border border-slate-600 rounded-lg shadow-xl max-h-60 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => handleSelect(r.id)}
              className="block w-full text-left px-3 py-2 hover:bg-slate-700 transition-colors border-b border-slate-700/50 last:border-b-0"
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: getNodeColor(r.type, r.category) }}
                />
                <span className="text-sm text-slate-200 truncate">{r.label}</span>
                <span className="text-xs text-slate-500 capitalize shrink-0">{r.type}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
          <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)}
          placeholder="Search nodes... (Cmd+K)"
          className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-10 pr-16 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <div className="absolute inset-y-0 right-2 flex items-center gap-1">
          {query && (
            <button onClick={handleClear} className="p-1 text-slate-500 hover:text-slate-300 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          {!query && (
            <kbd className="text-[10px] text-slate-500 bg-slate-700 rounded px-1.5 py-0.5 border border-slate-600">
              {navigator.platform?.includes('Mac') ? 'Cmd' : 'Ctrl'}+K
            </kbd>
          )}
        </div>
      </div>

      {/* Result count */}
      {query && (
        <div className="mt-1 text-xs text-slate-500">
          {results.length} {results.length === 1 ? 'match' : 'matches'}
        </div>
      )}
    </div>
  );
}
