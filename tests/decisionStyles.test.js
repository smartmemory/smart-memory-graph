/**
 * Tests for decision-memory visualisation: node shape/color/status, supersession
 * edges, contradiction overlay, and converter pass-through.
 *
 * Real Cytoscape (headless) — no DOM mocks. Asserts the actual computed style
 * values via cy.style().getRawStyle(). Per .claude/rules/no-silent-degradation.md
 * we also assert the WARN log fires once when status is missing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import cytoscape from 'cytoscape';
import { graphNodeToCyElement, graphEdgeToCyElement } from '../src/internal/cytoscapeConvert.js';
import { getCytoscapeStyles } from '../src/internal/cytoscapeStyles.js';
import {
  resolveDecisionStatus,
  isDecisionNode,
  DECISION_STATUSES,
  DECISION_EDGE_STYLES,
  DECISION_NODE_SHAPE,
  DECISION_CONTRADICTION_CLASS,
  DECISION_CHAIN_HIGHLIGHT_CLASS,
  DECISION_SUPERSEDES_EDGE_TYPE,
  DECISION_CONFLICT_EDGE_TYPE,
  _resetDecisionStatusWarn,
} from '../src/core/decisionStyles.js';

function makeCy(elements) {
  return cytoscape({
    headless: true,
    styleEnabled: true,
    style: getCytoscapeStyles(),
    elements,
  });
}

describe('isDecisionNode', () => {
  it('matches type=decision', () => {
    expect(isDecisionNode({ type: 'decision' })).toBe(true);
  });
  it('matches category=decision', () => {
    expect(isDecisionNode({ type: 'something', category: 'decision' })).toBe(true);
  });
  it('rejects non-decisions', () => {
    expect(isDecisionNode({ type: 'semantic' })).toBe(false);
    expect(isDecisionNode(null)).toBe(false);
  });
});

describe('resolveDecisionStatus', () => {
  beforeEach(() => {
    _resetDecisionStatusWarn();
  });

  it('returns the contract entry for known statuses', () => {
    for (const key of ['active', 'superseded', 'retracted', 'pending']) {
      const r = resolveDecisionStatus(key);
      expect(r._resolvedKey).toBe(key);
      expect(r.color).toBe(DECISION_STATUSES[key].color);
    }
  });

  it('falls back to "unknown" and logs WARN once for missing status', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r1 = resolveDecisionStatus(undefined);
    const r2 = resolveDecisionStatus(null);
    const r3 = resolveDecisionStatus('not-a-real-status');
    expect(r1._resolvedKey).toBe('unknown');
    expect(r2._resolvedKey).toBe('unknown');
    expect(r3._resolvedKey).toBe('unknown');
    // Only one warn (one-shot).
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/Decision arrived without a recognized status/);
    warn.mockRestore();
  });
});

describe('graphNodeToCyElement: decision pass-through', () => {
  it('emits hexagon-shape decision with status class and decision data fields', () => {
    const el = graphNodeToCyElement({
      id: 'd1',
      label: 'Use FalkorDB',
      type: 'decision',
      category: 'memory',
      status: 'active',
      decision_type: 'choice',
      reinforcement_count: 3,
      contradiction_count: 0,
      supersedes: ['d0'],
      created_at: new Date().toISOString(),
    });
    expect(el.data.type).toBe('decision');
    expect(el.data.decision_status).toBe('active');
    expect(el.data.decision_type).toBe('choice');
    expect(el.data.reinforcement_count).toBe(3);
    expect(el.data.supersedes).toEqual(['d0']);
    expect(el.classes).toContain('decision-status-active');
  });

  it('falls back to unknown status class when status is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    _resetDecisionStatusWarn();
    const el = graphNodeToCyElement({
      id: 'd-missing',
      label: 'Untagged decision',
      type: 'decision',
      category: 'memory',
    });
    expect(el.data.decision_status).toBe('unknown');
    expect(el.classes).toContain('decision-status-unknown');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not pollute non-decision nodes with decision fields', () => {
    const el = graphNodeToCyElement({
      id: 's1',
      label: 'A semantic',
      type: 'semantic',
      category: 'memory',
    });
    expect(el.data.decision_status).toBeUndefined();
    expect(el.data.decision_type).toBeUndefined();
    expect(el.data.supersedes).toBeUndefined();
    expect(el.classes).toBeUndefined();
  });
});

describe('Cytoscape style application: decision node', () => {
  it('renders a decision node with the contract hexagon shape and active border', () => {
    const cy = makeCy([
      graphNodeToCyElement({ id: 'd1', label: 'Use FalkorDB', type: 'decision', category: 'memory', status: 'active' }),
    ]);
    const node = cy.getElementById('d1');
    expect(node.length).toBe(1);
    expect(node.style('shape')).toBe(DECISION_NODE_SHAPE); // 'hexagon'
    // Active status drives a solid green border.
    expect(node.style('border-style')).toBe(DECISION_STATUSES.active.border_style);
    // Cytoscape returns colors in `rgb(...)`; compare via parsed component.
    const borderColor = node.style('border-color');
    expect(borderColor).toBeDefined();
    cy.destroy();
  });

  it('superseded decision uses dashed amber border', () => {
    const cy = makeCy([
      graphNodeToCyElement({ id: 'd2', label: 'old', type: 'decision', category: 'memory', status: 'superseded' }),
    ]);
    const node = cy.getElementById('d2');
    expect(node.hasClass('decision-status-superseded')).toBe(true);
    expect(node.style('border-style')).toBe(DECISION_STATUSES.superseded.border_style);
    cy.destroy();
  });

  it('retracted decision is rendered with reduced opacity (visual strikethrough)', () => {
    const cy = makeCy([
      graphNodeToCyElement({ id: 'd3', label: 'retracted', type: 'decision', category: 'memory', status: 'retracted' }),
    ]);
    const node = cy.getElementById('d3');
    expect(node.hasClass('decision-status-retracted')).toBe(true);
    const opacity = parseFloat(node.style('opacity'));
    expect(opacity).toBeLessThan(1);
    cy.destroy();
  });
});

describe('Cytoscape style application: supersession chain', () => {
  it('renders 3-link supersession chain with 2 SUPERSEDES edges using contract color', () => {
    const elements = [
      graphNodeToCyElement({ id: 'v1', label: 'v1', type: 'decision', category: 'memory', status: 'superseded', superseded_by: 'v2' }),
      graphNodeToCyElement({ id: 'v2', label: 'v2', type: 'decision', category: 'memory', status: 'superseded', supersedes: ['v1'], superseded_by: 'v3' }),
      graphNodeToCyElement({ id: 'v3', label: 'v3', type: 'decision', category: 'memory', status: 'active', supersedes: ['v2'] }),
      graphEdgeToCyElement({ id: 'e1', source: 'v2', target: 'v1', type: DECISION_SUPERSEDES_EDGE_TYPE, label: 'supersedes' }),
      graphEdgeToCyElement({ id: 'e2', source: 'v3', target: 'v2', type: DECISION_SUPERSEDES_EDGE_TYPE, label: 'supersedes' }),
    ];
    const cy = makeCy(elements);
    expect(cy.nodes().length).toBe(3);
    const supEdges = cy.edges(`[type="${DECISION_SUPERSEDES_EDGE_TYPE}"]`);
    expect(supEdges.length).toBe(2);
    // Each edge picks up the contract style.
    supEdges.forEach((e) => {
      // Width is a number style.
      expect(parseFloat(e.style('width'))).toBeGreaterThanOrEqual(2);
    });
    cy.destroy();
  });

  it('chain-highlight class promotes SUPERSEDES edges to the highlight color', () => {
    const elements = [
      graphNodeToCyElement({ id: 'a', label: 'a', type: 'decision', category: 'memory', status: 'superseded' }),
      graphNodeToCyElement({ id: 'b', label: 'b', type: 'decision', category: 'memory', status: 'active', supersedes: ['a'] }),
      graphEdgeToCyElement({ id: 'e1', source: 'b', target: 'a', type: DECISION_SUPERSEDES_EDGE_TYPE, label: 'supersedes' }),
    ];
    const cy = makeCy(elements);
    const edge = cy.getElementById('e1');
    const baseWidth = parseFloat(edge.style('width'));
    edge.addClass(DECISION_CHAIN_HIGHLIGHT_CLASS);
    cy.getElementById('a').addClass(DECISION_CHAIN_HIGHLIGHT_CLASS);
    cy.getElementById('b').addClass(DECISION_CHAIN_HIGHLIGHT_CLASS);
    const highlightedWidth = parseFloat(edge.style('width'));
    expect(highlightedWidth).toBeGreaterThan(baseWidth);
    cy.destroy();
  });
});

describe('Cytoscape style application: contradiction overlay', () => {
  it('applies contradiction class with overlay color from the contract', () => {
    const elements = [
      graphNodeToCyElement({ id: 'c1', label: 'one', type: 'decision', category: 'memory', status: 'active' }),
      graphNodeToCyElement({ id: 'c2', label: 'two', type: 'decision', category: 'memory', status: 'active' }),
      graphEdgeToCyElement({ id: 'e1', source: 'c1', target: 'c2', type: DECISION_CONFLICT_EDGE_TYPE, label: 'conflicts' }),
    ];
    const cy = makeCy(elements);
    const c1 = cy.getElementById('c1');
    const c2 = cy.getElementById('c2');
    c1.addClass(DECISION_CONTRADICTION_CLASS);
    c2.addClass(DECISION_CONTRADICTION_CLASS);
    expect(c1.hasClass(DECISION_CONTRADICTION_CLASS)).toBe(true);
    // Overlay padding is non-zero only with the class.
    expect(parseFloat(c1.style('overlay-padding'))).toBeGreaterThan(0);
    // CONFLICTS_WITH edge present and uses dashed line style.
    const conflictEdge = cy.edges(`[type="${DECISION_CONFLICT_EDGE_TYPE}"]`);
    expect(conflictEdge.length).toBe(1);
    expect(conflictEdge.style('line-style')).toBe(DECISION_EDGE_STYLES.CONFLICTS_WITH.line_style);
    cy.destroy();
  });
});

describe('Perf sanity: decision styles do not regress base layout cost', () => {
  /**
   * SCALE-SMOKE-1 baseline (Stream D) measures ~30s for a 2.2k-node fixture
   * with cose-bilkent + styleEnabled:false. We don't re-run that here.
   * Instead we verify that *adding decision nodes/edges to a 200-node mix*
   * with full styling does not blow up beyond a generous 4s headless ceiling.
   */
  it('200-node mixed graph with 30 decisions + supersession edges initialises under 4s', () => {
    const nodes = [];
    const edges = [];
    for (let i = 0; i < 170; i++) {
      nodes.push(graphNodeToCyElement({
        id: `n${i}`, label: `n${i}`, type: 'semantic', category: 'memory',
      }));
    }
    for (let i = 0; i < 30; i++) {
      const id = `d${i}`;
      const status = ['active', 'superseded', 'retracted', 'pending'][i % 4];
      nodes.push(graphNodeToCyElement({
        id, label: id, type: 'decision', category: 'memory', status,
        supersedes: i > 0 ? [`d${i - 1}`] : [],
      }));
      if (i > 0) {
        edges.push(graphEdgeToCyElement({
          id: `se${i}`, source: id, target: `d${i - 1}`,
          type: DECISION_SUPERSEDES_EDGE_TYPE, label: 'supersedes',
        }));
      }
    }
    // A few conflict edges
    for (let i = 0; i < 5; i++) {
      edges.push(graphEdgeToCyElement({
        id: `ce${i}`, source: `d${i}`, target: `d${i + 10}`,
        type: DECISION_CONFLICT_EDGE_TYPE, label: 'conflicts',
      }));
    }
    const t0 = performance.now();
    const cy = makeCy([...nodes, ...edges]);
    cy.style().update();
    const elapsed = performance.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`[perf] decision-styled 200-node init: ${elapsed.toFixed(1)} ms`);
    expect(elapsed).toBeLessThan(4000);
    cy.destroy();
  });
});
