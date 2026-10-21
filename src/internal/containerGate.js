/**
 * True when the cy container has a nonzero width AND height. A layout run against a 0x0
 * container (hidden tab, panel not laid out yet) places and fits nodes against degenerate
 * bounds, and nothing re-runs it when the size settles unless the caller arranges that.
 */
export function containerHasArea(cy) {
  const el = cy && typeof cy.container === 'function' ? cy.container() : null;
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
