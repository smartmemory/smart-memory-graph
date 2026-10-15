/**
 * GRAPH-KEY-DELETE-1 — keyboard shortcuts that act on graph state must stay inside the graph.
 *
 * The explorer used to listen on `window`, so in a host app (Obsidian's note editor, any
 * rich-text field) Cmd+A then Backspace deleted every visible memory from the backend.
 * Everything here is pure so the rules can be tested without a browser.
 */

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * True when typing into `el` is text editing, so no graph shortcut may act on the key.
 * jsdom does not implement `isContentEditable`, so the attribute is also checked up the tree.
 */
export function isEditableTarget(el) {
  if (!el || el.nodeType !== 1) return false;
  if (EDITABLE_TAGS.has(el.tagName)) return true;
  if (el.isContentEditable) return true;
  const host = typeof el.closest === 'function' ? el.closest('[contenteditable]') : null;
  return !!host && host.getAttribute('contenteditable') !== 'false';
}

/**
 * Decide what a keydown means for the graph. Returns 'delete', 'select-all' or null.
 *
 * `surface` is the element that owns the listener (the focusable explorer root). A shortcut
 * applies only when that element itself has focus: not when focus is on a button, field or
 * editor inside it, and never when the event came from elsewhere in the host.
 */
export function classifyGraphKey(e, surface, activeElement = null) {
  if (!surface || e.target !== surface) return null;
  if (e.defaultPrevented || e.isComposing || e.repeat) return null;
  if (isEditableTarget(e.target) || isEditableTarget(activeElement)) return null;

  const key = typeof e.key === 'string' ? e.key : '';
  if (key === 'Delete' || key === 'Backspace') {
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return null;
    return 'delete';
  }
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && key.toLowerCase() === 'a') {
    return 'select-all';
  }
  return null;
}

/**
 * Wording for the delete confirmation, naming exactly what will be removed.
 * `counts` is { memories, entities } for the nodes about to be deleted.
 */
export function describeDeletion({ memories = 0, entities = 0 }) {
  const total = memories + entities;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  if (entities === 0) return `Delete ${plural(memories, 'memory', 'memories')} from SmartMemory?`;
  if (memories === 0) return `Delete ${plural(entities, 'entity', 'entities')} from SmartMemory?`;
  return `Delete ${total} items (${plural(memories, 'memory', 'memories')}, ${plural(entities, 'entity', 'entities')}) from SmartMemory?`;
}

/**
 * Whether a window-level shortcut (the search box's Cmd/Ctrl+K) may act on `target`.
 * Inside an explorer, only events from within that explorer count. A search box rendered
 * on its own has no explorer to scope to, so it only yields to text editing elsewhere.
 */
export function shortcutAppliesTo(target, { scope, ownInput }) {
  if (scope) return !!target && typeof scope.contains === 'function' && scope.contains(target);
  if (target && target === ownInput) return true;
  return !isEditableTarget(target);
}
