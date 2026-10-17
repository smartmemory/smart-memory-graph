/**
 * Merge a fresh element set into a live Cytoscape instance.
 * Extracted from useCytoscape.mergeElements so it can be tested against a headless cy.
 *
 * @param {Object} cy - Cytoscape instance
 * @param {Array} elements - Cytoscape element definitions (the complete new set)
 * @param {{ afterMerge?: (cy: Object) => void }} [options]
 * @returns {{ isInitial: boolean }}
 */
export function applyGraphMerge(cy, elements, { afterMerge } = {}) {
  const existingIds = new Set(cy.nodes().map((n) => n.id()));
  const isInitial = existingIds.size === 0;

  // Snapshot positions of every existing node before replace.
  const savedPositions = {};
  if (!isInitial) {
    cy.nodes().forEach((n) => {
      savedPositions[n.id()] = { ...n.position() };
    });
  }

  cy.batch(() => {
    cy.elements().remove();
    cy.add(elements);
    // Restore saved positions for nodes that survived the refresh.
    if (!isInitial) {
      cy.nodes().forEach((n) => {
        const pos = savedPositions[n.id()];
        if (pos) n.position(pos);
      });
    }
    afterMerge?.(cy);
  });

  return { isInitial };
}
