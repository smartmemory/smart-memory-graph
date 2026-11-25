/**
 * UI-ORIGIN-UNKNOWN-NEUTRAL-1: an unknown origin is shown plainly. No red border, no dash,
 * no red text, no warning sentence; the value "unknown" is still shown.
 */
import { describe, it, expect } from 'vitest';
import cytoscape from 'cytoscape';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { graphNodeToCyElement } from '../src/internal/cytoscapeConvert.js';
import { getCytoscapeStyles } from '../src/internal/cytoscapeStyles.js';
import { getOriginBorderColor, ORIGIN_BORDER_COLORS } from '../src/core/graphColors.js';
import OriginLegend from '../src/components/OriginLegend.jsx';
import DetailPanel from '../src/components/DetailPanel.jsx';

const node = (id, origin) => ({ id, label: id, type: 'semantic', category: 'memory', origin });

describe('unknown origin is neutral', () => {
  it('has no origin colour', () => {
    expect(getOriginBorderColor('unknown')).toBeNull();
    expect(ORIGIN_BORDER_COLORS.unknown).toBeNull();
    expect(getOriginBorderColor('conversation:x')).toBe('#6366f1'); // other origins unchanged
  });

  it('draws an unknown node with no border, like a user node', () => {
    const cy = cytoscape({
      headless: true, styleEnabled: true, style: getCytoscapeStyles(),
      elements: [graphNodeToCyElement(node('u', 'unknown')), graphNodeToCyElement(node('p', 'cli:add')), graphNodeToCyElement(node('c', 'conversation:x'))],
    });
    for (const id of ['u', 'p']) {
      expect(cy.getElementById(id).numericStyle('border-width')).toBe(0);
      expect(cy.getElementById(id).style('border-style')).toBe('solid');
    }
    expect(cy.getElementById('c').numericStyle('border-width')).toBe(2); // tagged origins keep theirs
  });

  it('legend keeps the unknown entry with no red', () => {
    const html = renderToStaticMarkup(React.createElement(OriginLegend, {}));
    expect(html).toContain('unknown');
    expect(html).not.toMatch(/ef4444|dashed|239, 68, 68/i);
  });

  it('detail panel shows "unknown" in the normal colour with no warning', () => {
    const html = renderToStaticMarkup(React.createElement(DetailPanel, { node: { ...node('u', 'unknown'), content: 'x' }, edges: [], onClose() {} }));
    expect(html).toContain('unknown');
    expect(html).not.toMatch(/text-red|border-red|Untagged write path/);
  });
});
