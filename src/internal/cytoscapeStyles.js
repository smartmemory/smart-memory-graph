import { MEMORY_COLORS, ENTITY_COLORS, SPECIAL_COLORS, ORIGIN_BORDER_COLORS, ANNOTATION_COLORS, ANNOTATION_BORDERS, getNodeColor, desaturateColor } from '../core/graphColors';
import {
  DECISION_STATUSES,
  DECISION_EDGE_STYLES,
  DECISION_NODE_SHAPE,
  DECISION_NODE_SIZE,
  DECISION_OVERLAY,
  DECISION_CONTRADICTION_CLASS,
  DECISION_CHAIN_HIGHLIGHT_CLASS,
  DECISION_SUPERSEDES_EDGE_TYPE,
  DECISION_CONFLICT_EDGE_TYPE,
} from '../core/decisionStyles';

/** Compute degree-based size for entity nodes (12–24px). Memory nodes stay fixed at 28px. */
function entityNodeSize(ele) {
  const deg = ele.degree();
  return Math.min(24, Math.max(12, 12 + deg * 1.5));
}

/**
 * Build cytoscape style array.
 *
 * @param {Object} [theme] - Optional consumer-supplied theme.
 * @param {'dark'|'light'} [theme.mode='dark'] - Light/dark mode for label,
 *   outline, and selection-border defaults. Ignored if `palette.*` overrides
 *   are provided. Default 'dark' preserves web/studio/insights output.
 * @param {Object} [theme.palette] - Explicit color overrides. Any field set
 *   here wins over the mode default and over the per-type semantic palette.
 *   Use this to adopt a host application's theme variables verbatim
 *   (e.g. Obsidian's --graph-node, --graph-line, --graph-text). Memory and
 *   entity node *sizes* are unaffected — only fills and chrome colors are.
 * @param {string} [theme.palette.node] - Single fill for ALL memory/entity/
 *   grounding nodes (collapses the type palette to one color).
 * @param {string} [theme.palette.edge] - Edge line + edge label color.
 * @param {string} [theme.palette.label] - Node label text color.
 * @param {string} [theme.palette.labelOutline] - Node label outline color.
 * @param {string} [theme.palette.selectionBorder] - Selected-element border.
 */
export function getCytoscapeStyles(theme = null) {
  const mode = theme?.mode === 'light' ? 'light' : 'dark';
  const palette = theme?.palette || {};

  // Mode-aware fallbacks (used only when palette.* is not provided).
  const labelColor = palette.label || (mode === 'light' ? '#1e293b' : '#cbd5e1');
  const labelOutline = palette.labelOutline || (mode === 'light' ? '#f8fafc' : '#0f172a');
  const selectionBorder = palette.selectionBorder || (mode === 'light' ? '#0f172a' : '#f8fafc');
  const edgeBaseColor = palette.edge || (mode === 'light' ? '#94a3b8' : '#475569');
  const edgeLabelHover = palette.edge || (mode === 'light' ? '#334155' : '#64748b');
  const defaultNodeFill = palette.node || '#94a3b8';

  // When a flat node color is provided, it replaces the per-type semantic
  // palette. `nodeFillFor()` is the single resolution point.
  const nodeFillFor = (typeColor) => palette.node || typeColor;

  const styles = [
    // Base node style
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        'text-valign': 'bottom',
        'text-halign': 'center',
        'font-size': '10px',
        color: labelColor,
        'text-outline-width': 2,
        'text-outline-color': labelOutline,
        'background-color': defaultNodeFill,
        width: 16,
        height: 16,
        'border-width': (ele) => {
          const prefix = ele.data('origin_prefix');
          if (!prefix || prefix === 'user' || !ORIGIN_BORDER_COLORS[prefix]) return 0;
          return prefix === 'unknown' ? 2.5 : 2;
        },
        'border-color': (ele) => {
          const prefix = ele.data('origin_prefix');
          return ORIGIN_BORDER_COLORS[prefix] || '#94a3b8';
        },
        'border-opacity': (ele) => {
          const prefix = ele.data('origin_prefix');
          return (prefix && prefix !== 'user' && ORIGIN_BORDER_COLORS[prefix]) ? 0.85 : 0;
        },
        'border-style': (ele) => {
          return ele.data('origin_prefix') === 'unknown' ? 'dashed' : 'solid';
        },
        'text-max-width': '100px',
        'text-wrap': 'ellipsis',
      },
    },
    // Selected node
    {
      selector: 'node:selected',
      style: {
        'border-width': 3,
        'border-color': selectionBorder,
        'border-opacity': 1,
        width: 24,
        height: 24,
        'font-size': '12px',
        'font-weight': 'bold',
        'z-index': 999,
      },
    },
    // Highlighted node (search match, path node)
    {
      selector: 'node.highlighted',
      style: {
        'border-width': 3,
        'border-color': '#fbbf24', // amber-400
        width: 22,
        height: 22,
      },
    },
    // Filtered-out node — completely hidden (not ghosted)
    {
      selector: 'node.dimmed',
      style: {
        display: 'none',
      },
    },
    // Neighbor of selected
    {
      selector: 'node.neighbor',
      style: {
        'border-width': 2,
        'border-color': '#60a5fa', // blue-400
        opacity: 1,
      },
    },
    // ── Hover effects ──────────────────────────────────────────────────────
    // Hovered node: soft colored glow ring + subtle scale
    {
      selector: 'node.hovered',
      style: {
        'border-width': 4,
        'border-color': (ele) => ele.style('background-color'),
        'border-opacity': 0.9,
        'overlay-color': (ele) => ele.style('background-color'),
        'overlay-padding': 6,
        'overlay-opacity': 0.15,
        'z-index': 100,
      },
    },
    // Non-neighbor nodes dimmed on hover
    {
      selector: 'node.hover-dimmed',
      style: {
        opacity: 0.25,
      },
    },
    // Non-neighbor edges dimmed on hover
    {
      selector: 'edge.hover-dimmed',
      style: {
        opacity: 0.1,
      },
    },
    // Base edge style
    {
      selector: 'edge',
      style: {
        width: (ele) => {
          const w = ele.data('weight') || ele.data('strength') || 1;
          return Math.min(4, Math.max(0.5, w * 1.5));
        },
        'line-color': edgeBaseColor,
        'target-arrow-shape': 'triangle',
        'target-arrow-color': edgeBaseColor,
        'target-arrow-width': 0.8,
        'curve-style': 'bezier',
        opacity: 0.6,
        label: (ele) => {
          const t = ele.data('type') || ele.data('label') || '';
          return t === 'RELATED_ENTITY' ? '' : t;
        },
        'font-size': '8px',
        color: edgeBaseColor,
        'text-outline-width': 1,
        'text-outline-color': labelOutline,
        'text-rotation': 'autorotate',
      },
    },
    // Selected edge
    {
      selector: 'edge:selected',
      style: {
        width: 2,
        'line-color': selectionBorder,
        opacity: 1,
        color: edgeLabelHover,
      },
    },
    // Highlighted edge (path)
    {
      selector: 'edge.highlighted',
      style: {
        width: 3,
        'line-color': '#fbbf24',
        opacity: 1,
        'z-index': 999,
      },
    },
    // Filtered-out edge — completely hidden
    {
      selector: 'edge.dimmed',
      style: {
        display: 'none',
      },
    },
    // Edge label visible on hover (via class toggle in mouseover handler)
    {
      selector: 'edge.hover-edge-visible',
      style: {
        color: edgeLabelHover,
      },
    },
  ];

  // Add per-type node color styles for memory types (fixed 28px)
  for (const [type, color] of Object.entries(MEMORY_COLORS)) {
    styles.push({
      selector: `node[type="${type}"]`,
      style: { 'background-color': nodeFillFor(color), width: 28, height: 28 },
    });
  }

  // Add per-type node color styles for entity types (degree-based sizing)
  for (const [type, color] of Object.entries(ENTITY_COLORS)) {
    styles.push({
      selector: `node[type="${type}"]`,
      style: {
        'background-color': nodeFillFor(color),
        width: entityNodeSize,
        height: entityNodeSize,
      },
    });
  }

  // ── Decision memory: hexagon + status border ───────────────────────────
  // Distinct shape so decisions are recognisable in the graph hub even
  // before color is parsed. Per contracts/decisions.json + .claude rules
  // (no-silent-degradation): missing status falls through to "unknown"
  // class (logged WARN once at resolve time, not in the style emitter).
  styles.push({
    selector: 'node[type="decision"]',
    style: {
      shape: DECISION_NODE_SHAPE,
      'background-color': nodeFillFor(MEMORY_COLORS.decision),
      width: DECISION_NODE_SIZE,
      height: DECISION_NODE_SIZE,
      'font-weight': 'bold',
    },
  });
  for (const [statusKey, statusDef] of Object.entries(DECISION_STATUSES)) {
    styles.push({
      selector: `node[type="decision"].decision-status-${statusKey}`,
      style: {
        'border-color': statusDef.color,
        'border-style': statusDef.border_style,
        'border-width': statusDef.border_width,
        'border-opacity': 1,
      },
    });
  }
  // Retracted decisions are visually struck through via reduced opacity.
  styles.push({
    selector: 'node[type="decision"].decision-status-retracted',
    style: { opacity: 0.55 },
  });
  // Contradiction overlay — pulsing red ring (toggled by Toolbar).
  styles.push({
    selector: `node.${DECISION_CONTRADICTION_CLASS}`,
    style: {
      'overlay-color': DECISION_OVERLAY.contradiction_pulse_color,
      'overlay-padding': DECISION_OVERLAY.contradiction_pulse_padding,
      'overlay-opacity': DECISION_OVERLAY.contradiction_pulse_opacity,
      'border-color': DECISION_OVERLAY.contradiction_pulse_color,
      'border-width': 3,
      'border-opacity': 1,
      'z-index': 1500,
    },
  });
  // Chain highlight — applied to every node in a supersession lineage when
  // a decision is selected and the chain block expands.
  styles.push({
    selector: `node.${DECISION_CHAIN_HIGHLIGHT_CLASS}`,
    style: {
      'border-color': DECISION_EDGE_STYLES.CHAIN_HIGHLIGHT_COLOR,
      'border-width': 4,
      'border-opacity': 1,
      'z-index': 1200,
    },
  });
  // SUPERSEDES edges — bold amber, directional.
  styles.push({
    selector: `edge[type="${DECISION_SUPERSEDES_EDGE_TYPE}"]`,
    style: {
      'line-color': DECISION_EDGE_STYLES.SUPERSEDES.color,
      'target-arrow-color': DECISION_EDGE_STYLES.SUPERSEDES.color,
      'target-arrow-shape': DECISION_EDGE_STYLES.SUPERSEDES.arrow,
      width: DECISION_EDGE_STYLES.SUPERSEDES.width,
      'line-style': DECISION_EDGE_STYLES.SUPERSEDES.line_style,
      opacity: 0.95,
      'z-index': 50,
    },
  });
  styles.push({
    selector: `edge[type="${DECISION_SUPERSEDES_EDGE_TYPE}"].${DECISION_CHAIN_HIGHLIGHT_CLASS}`,
    style: {
      'line-color': DECISION_EDGE_STYLES.CHAIN_HIGHLIGHT_COLOR,
      'target-arrow-color': DECISION_EDGE_STYLES.CHAIN_HIGHLIGHT_COLOR,
      width: DECISION_EDGE_STYLES.SUPERSEDES.width + 1.5,
      'z-index': 1300,
    },
  });
  // CONFLICTS_WITH edges — dashed red.
  styles.push({
    selector: `edge[type="${DECISION_CONFLICT_EDGE_TYPE}"]`,
    style: {
      'line-color': DECISION_EDGE_STYLES.CONFLICTS_WITH.color,
      'target-arrow-color': DECISION_EDGE_STYLES.CONFLICTS_WITH.color,
      'target-arrow-shape': 'triangle',
      width: DECISION_EDGE_STYLES.CONFLICTS_WITH.width,
      'line-style': DECISION_EDGE_STYLES.CONFLICTS_WITH.line_style,
      opacity: 0.9,
      'z-index': 60,
    },
  });

  // Grounding nodes (fixed 16px)
  styles.push({
    selector: 'node[category="grounding"]',
    style: { 'background-color': nodeFillFor(SPECIAL_COLORS.grounding), width: 16, height: 16 },
  });

  // Grounded nodes — thin border indicates Wikipedia/Wikidata provenance
  // Uses node.grounded class (set on load) AND data(grounded) (set for streaming nodes via onGroundingFlash)
  for (const sel of ['node.grounded', 'node[grounded]']) {
    styles.push({
      selector: sel,
      style: {
        'border-width': 1.5,
        'border-color': '#64748b', // slate-500 — visible on both colored nodes and dark canvas
        'border-opacity': 1,
      },
    });
  }

  // Streaming glow — newly arrived node from live event stream
  styles.push({
    selector: 'node.streaming-new',
    style: {
      'border-width': 4,
      'border-color': '#22d3ee', // cyan-400
      'border-opacity': 1,
      'overlay-color': '#22d3ee',
      'overlay-padding': 6,
      'overlay-opacity': 0.25,
      'z-index': 1000,
    },
  });

  // edge.streaming-new removed — edges use animateEdgePulse() (traveling dash) instead

  // Grounding flash — entity just linked to Wikipedia provenance
  styles.push({
    selector: 'node.grounding-flash',
    style: {
      'border-width': 5,
      'border-color': '#4ade80', // green-400
      'border-opacity': 1,
      'overlay-color': '#4ade80',
      'overlay-padding': 8,
      'overlay-opacity': 0.3,
      'z-index': 1000,
    },
  });

  // LOD cluster parent nodes (compound containers) — subtle halo effect
  styles.push({
    selector: 'node.lod-cluster',
    style: {
      'background-opacity': 0.08,
      'background-color': '#64748b',
      'border-width': 2,
      'border-color': (ele) => ENTITY_COLORS[ele.data('type')] || '#64748b',
      'border-opacity': 0.4,
      shape: 'round-rectangle',
      'text-valign': 'top',
      'text-halign': 'center',
      'font-size': '11px',
      'font-weight': 'bold',
      color: '#94a3b8',
      'padding': '12px',
    },
  });

  // ── Temporal decay desaturation ──────────────────────────────────────────
  // age_bucket is set on node data in cytoscapeConvert.js from created_at timestamp.
  // Nodes blend toward slate-400 as they age. Fresh nodes (< 1 day) are unaffected.
  const decayBuckets = [
    { bucket: 'recent', ratio: 0.15 },  // 1–7 days: very slight
    { bucket: 'aging',  ratio: 0.35 },  // 7–30 days: moderate
    { bucket: 'old',    ratio: 0.55 },  // 30+ days: strongly muted
  ];

  for (const { bucket, ratio } of decayBuckets) {
    styles.push({
      selector: `node[age_bucket="${bucket}"]`,
      style: {
        'background-color': (ele) => {
          // Decay only desaturates hex colors; for non-hex CSS values
          // (rgb()/named/CSS vars) desaturateColor returns the input
          // unchanged, so flat-palette themes simply skip decay tinting.
          const base = palette.node || getNodeColor(ele.data('type'), ele.data('category'));
          return desaturateColor(base, ratio);
        },
      },
    });
  }

  // ── Annotation styles (channel-scoped) ──────────────────────────────
  // Generated from contracts/graph-annotations.json
  // Token format: anno-{channel}-{kind}-{value}

  // Fill channel (background-color for nodes, line-color for edges)
  for (const [kind, values] of Object.entries(ANNOTATION_COLORS)) {
    if (kind === 'search_match') continue;
    for (const [value, color] of Object.entries(values)) {
      if (typeof color !== 'string') continue;
      // Annotations are SIGNALS (search match, contradiction, support).
      // Keep their semantic colors at full saturation even when the base
      // palette is flattened to a host theme — losing them defeats the
      // purpose of overlay channels.
      styles.push({
        selector: `node.anno-fill-${kind}-${value}`,
        style: { 'background-color': color },
      });
      styles.push({
        selector: `edge.anno-fill-${kind}-${value}`,
        style: { 'line-color': color },
      });
    }
  }

  // Border channel (border-color, border-style, border-width)
  for (const [kind, values] of Object.entries(ANNOTATION_BORDERS || {})) {
    for (const [value, border] of Object.entries(values)) {
      styles.push({
        selector: `node.anno-border-${kind}-${value}`,
        style: {
          'border-color': border.color,
          'border-style': border.style,
          'border-width': border.width,
        },
      });
    }
  }

  // Opacity channel (confidence kind only)
  const opacityMap = { high: 1.0, medium: 0.7, low: 0.4, unscored: 0.5 };
  const confidenceColors = ANNOTATION_COLORS.confidence;
  if (confidenceColors) {
    for (const value of Object.keys(confidenceColors)) {
      styles.push({
        selector: `node.anno-opacity-confidence-${value}`,
        style: { opacity: opacityMap[value] || 0.7 },
      });
    }
  }

  // Overlay channel (search_match — channel-locked)
  const searchColors = ANNOTATION_COLORS.search_match || {};
  for (const [value, config] of Object.entries(searchColors)) {
    if (typeof config === 'object' && config.color) {
      styles.push({
        selector: `node.anno-overlay-search_match-${value}`,
        style: {
          'overlay-color': config.color,
          'overlay-opacity': config.opacity || 0,
          'overlay-padding': config.padding || 0,
        },
      });
    }
  }

  return styles;
}
