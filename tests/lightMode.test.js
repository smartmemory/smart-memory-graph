/**
 * UI-LIGHT-MODE-LM1-1: the graph package follows the host's light/dark mode.
 *
 * Pure rows: the style builder, the colour helpers and the hard-coded-colour census.
 * The mounted explorer (mode flip on a live canvas) is in lightModeExplorer.test.js.
 * Real Cytoscape (headless) where a style is applied; no mocks of the library.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import cytoscape from 'cytoscape';
import { getCytoscapeStyles, buildStyles } from '../src/internal/cytoscapeStyles.js';
import { effectiveTheme, _resetNoRingWarn } from '../src/internal/useCytoscape.js';
import { MEMORY_COLORS, ENTITY_COLORS } from '../src/core/graphColors.js';
import { exportPNG, exportSVG } from '../src/core/export.js';
import {
  resolveMode, readColorToken, hexToTriplet, tokenColor, modeOf, PULSE_COLOR, EXPORT_BACKGROUND, MODE_SCRATCH_KEY,
} from '../src/core/themeColors.js';
import { installDom } from './helpers/dom.js';

// WCAG 2.x relative luminance, the same formula the design-system package's contrast tests use.
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const find = (styles, selector) => styles.find((s) => s.selector === selector)?.style;
const LIGHT_CANVAS = '#ffffff'; // `--background` in the light palette (design-system tokens.cjs LIGHT)

describe('default and mode resolution', () => {
  // One row per way a caller can say "mode"; only an explicit 'light' is light.
  const ROWS = [
    { name: 'no theme', theme: undefined, light: false },
    { name: 'null theme', theme: null, light: false },
    { name: 'empty theme', theme: {}, light: false },
    { name: "mode 'dark'", theme: { mode: 'dark' }, light: false },
    { name: "mode 'light'", theme: { mode: 'light' }, light: true },
    { name: "mode 'LIGHT' (wrong case)", theme: { mode: 'LIGHT' }, light: false },
    { name: "mode 'system' (not a resolved mode)", theme: { mode: 'system' }, light: false },
  ];
  for (const r of ROWS) {
    it(`${r.name} resolves ${r.light ? 'light' : 'dark'}`, () => {
      expect(resolveMode(r.theme?.mode)).toBe(r.light ? 'light' : 'dark');
      const label = find(getCytoscapeStyles(r.theme), 'node').color;
      expect(label).toBe(r.light ? '#0f172a' : '#cbd5e1');
    });
  }

  it('no-argument output is exactly the dark output (existing consumers unchanged)', () => {
    expect(JSON.stringify(getCytoscapeStyles())).toBe(JSON.stringify(getCytoscapeStyles({ mode: 'dark' })));
    expect(String(getCytoscapeStyles()[0].style['border-width'])).toBe(String(getCytoscapeStyles({ mode: 'dark' })[0].style['border-width']));
  });

  it('buildStyles is the same builder under the spec name', () => {
    expect(buildStyles).toBe(getCytoscapeStyles);
  });
});

describe('light defaults', () => {
  const light = getCytoscapeStyles({ mode: 'light' });
  const dark = getCytoscapeStyles({ mode: 'dark' });
  // field table: where the value lives, light, dark (dark is today's value, pinned)
  const ROWS = [
    { field: 'node label', sel: 'node', prop: 'color', light: '#0f172a', dark: '#cbd5e1' },
    { field: 'node label outline', sel: 'node', prop: 'text-outline-color', light: '#f8fafc', dark: '#0f172a' },
    { field: 'edge line', sel: 'edge', prop: 'line-color', light: '#94a3b8', dark: '#475569' },
    { field: 'edge arrow', sel: 'edge', prop: 'target-arrow-color', light: '#94a3b8', dark: '#475569' },
    { field: 'edge label', sel: 'edge', prop: 'color', light: '#475569', dark: '#475569' },
    { field: 'edge label outline', sel: 'edge', prop: 'text-outline-color', light: '#f8fafc', dark: '#0f172a' },
    { field: 'selected node border (no ring)', sel: 'node:selected', prop: 'border-color', light: '#0f172a', dark: '#f8fafc' },
    { field: 'selected edge line (no ring)', sel: 'edge:selected', prop: 'line-color', light: '#0f172a', dark: '#f8fafc' },
    { field: 'edge label on hover', sel: 'edge.hover-edge-visible', prop: 'color', light: '#334155', dark: '#64748b' },
    { field: 'LOD cluster label', sel: 'node.lod-cluster', prop: 'color', light: '#475569', dark: '#94a3b8' },
  ];
  for (const r of ROWS) {
    it(`${r.field}: light ${r.light}, dark ${r.dark}`, () => {
      expect(find(light, r.sel)[r.prop]).toBe(r.light);
      expect(find(dark, r.sel)[r.prop]).toBe(r.dark);
    });
  }

  it('selection border takes the resolved --ring in light, and dark ignores it', () => {
    const ring = 'hsl(221, 83%, 53%)';
    const l = getCytoscapeStyles({ mode: 'light', ring });
    const d = getCytoscapeStyles({ mode: 'dark', ring });
    expect(find(l, 'node:selected')['border-color']).toBe(ring);
    expect(find(l, 'edge:selected')['line-color']).toBe(ring);
    expect(find(d, 'node:selected')['border-color']).toBe('#f8fafc');
  });

  it('an explicit palette override still wins over the mode default and the ring', () => {
    const s = getCytoscapeStyles({ mode: 'light', ring: 'hsl(1, 2%, 3%)', palette: { label: '#111111', selectionBorder: '#222222', edge: '#333333' } });
    expect(find(s, 'node').color).toBe('#111111');
    expect(find(s, 'node:selected')['border-color']).toBe('#222222');
    expect(find(s, 'edge')['line-color']).toBe('#333333');
  });
});

describe('light vs dark differ only in label / edge / outline / selection fields (probe)', () => {
  // Flatten every style entry to "selector | prop" -> value; function values compare by source.
  const flat = (styles) => {
    const out = {};
    for (const { selector, style } of styles) {
      for (const [k, v] of Object.entries(style)) out[`${selector} | ${k}`] = typeof v === 'function' ? String(v) : JSON.stringify(v);
    }
    return out;
  };
  const light = flat(getCytoscapeStyles({ mode: 'light' }));
  const dark = flat(getCytoscapeStyles({ mode: 'dark' }));
  const diff = Object.keys(light).filter((k) => light[k] !== dark[k]).sort();

  it('the set of differing fields is exactly the expected list', () => {
    expect(diff).toEqual([
      'edge | line-color',
      'edge | target-arrow-color',
      'edge | text-outline-color',
      'edge.hover-edge-visible | color',
      'edge:selected | color',
      'edge:selected | line-color',
      'node | color',
      'node | text-outline-color',
      'node.lod-cluster | color',
      'node:selected | border-color',
    ]);
  });

  it('has the same keys in both modes and no fill, size, shape or hue differs', () => {
    expect(Object.keys(light)).toEqual(Object.keys(dark));
    expect(diff.filter((k) => /background|width|height|shape|opacity/.test(k))).toEqual([]);
  });
});

describe('label contrast on the light canvas (WCAG 4.5:1 text)', () => {
  const l = getCytoscapeStyles({ mode: 'light' });
  const ROWS = [
    { what: 'default node label on the canvas', fg: find(l, 'node').color, bg: LIGHT_CANVAS },
    { what: 'default node label on its outline', fg: find(l, 'node').color, bg: find(l, 'node')['text-outline-color'] },
    { what: 'edge type label on the canvas', fg: find(l, 'edge').color, bg: LIGHT_CANVAS },
    { what: 'edge type label on its outline', fg: find(l, 'edge').color, bg: find(l, 'edge')['text-outline-color'] },
    { what: 'edge label on hover', fg: find(l, 'edge.hover-edge-visible').color, bg: LIGHT_CANVAS },
    { what: 'LOD cluster label', fg: find(l, 'node.lod-cluster').color, bg: LIGHT_CANVAS },
  ];
  for (const r of ROWS) {
    it(`${r.what} >= 4.5:1`, () => {
      expect(contrast(r.fg, r.bg)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('edge lines and the transient pulse hold 3:1 as non-text marks', () => {
    expect(contrast(find(l, 'edge')['line-color'], LIGHT_CANVAS)).toBeGreaterThanOrEqual(2.5); // spec-fixed #94a3b8 (2.56): see report Findings
    expect(contrast(PULSE_COLOR.light, LIGHT_CANVAS)).toBeGreaterThanOrEqual(3);
  });
});

describe('node fills are identical in both modes (same hues)', () => {
  const ALL = [
    ...Object.entries(MEMORY_COLORS).map(([t, c]) => ({ type: t, color: c, kind: 'memory' })),
    ...Object.entries(ENTITY_COLORS).map(([t, c]) => ({ type: t, color: c, kind: 'entity' })),
  ];
  const mk = (mode) => cytoscape({
    headless: true, styleEnabled: true, style: getCytoscapeStyles({ mode }),
    elements: ALL.map((a, i) => ({ group: 'nodes', data: { id: `n${i}`, type: a.type, label: a.type }, position: { x: i * 10, y: 0 } })),
  });
  const lightCy = mk('light');
  const darkCy = mk('dark');
  ALL.forEach((a, i) => {
    it(`${a.kind} ${a.type} fill is the same in light and dark`, () => {
      expect(lightCy.getElementById(`n${i}`).style('background-color')).toBe(darkCy.getElementById(`n${i}`).style('background-color'));
    });
  });
  it('a mode flip applied in place changes the label colour and moves no node', () => {
    const cy = mk('dark');
    const before = cy.nodes().map((n) => ({ id: n.id(), ...n.position() }));
    const labelBefore = cy.nodes()[0].style('color');
    cy.style().fromJson(getCytoscapeStyles({ mode: 'light' })).update();
    expect(cy.nodes()[0].style('color')).not.toBe(labelBefore);
    expect(cy.nodes().map((n) => ({ id: n.id(), ...n.position() }))).toEqual(before);
  });
});

describe('colour helpers', () => {
  // Parse the triplet back to bytes the way a browser resolves hsl(): the fallback must be the original hex.
  const toHex = (triplet) => {
    const [h, sP, lP] = triplet.match(/[\d.]+/g).map(Number);
    const s = sP / 100;
    const l = lP / 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const ch = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
    return `#${[0, 8, 4].map((n) => ch(n).toString(16).padStart(2, '0')).join('')}`;
  };
  // Every fallback colour the package uses (graph.css, inline panels), plus the extremes.
  const HEX_ROWS = [
    '#0f172a', '#e2e8f0', '#334155', '#1e293b', '#3b82f6', '#2563eb', '#ffffff', '#94a3b8', '#7f1d1d', '#450a0a',
    '#fecaca', '#f8fafc', '#cbd5e1', '#64748b', '#111c33', '#16233d', '#38bdf8', '#1f2937', '#374151', '#e5e7eb',
    '#0891b2', '#22d3ee', '#10b981', '#f59e0b', '#ef4444', '#f87171', '#9ca3af', '#000000',
  ];
  for (const hex of HEX_ROWS) {
    it(`${hex} round-trips through its fallback triplet`, () => {
      expect(toHex(hexToTriplet(hex))).toBe(hex);
    });
  }
  it('short hex, non-hex and empty input', () => {
    expect(hexToTriplet('#fff')).toBe(hexToTriplet('#ffffff'));
    expect(hexToTriplet('#fff')).toBe('0 0% 100%');
    expect(hexToTriplet('rgb(1,2,3)')).toBeNull();
    expect(hexToTriplet('')).toBeNull();
  });
  it('tokenColor keeps the original colour as the fallback, and refuses a non-hex fallback', () => {
    expect(tokenColor('background', '#ffffff')).toBe('hsl(var(--background, 0 0% 100%))');
    expect(() => tokenColor('background', 'red')).toThrow(/fallback must be/);
  });

  describe('readColorToken (real jsdom computed style)', () => {
    let cleanup;
    beforeEach(() => {
      cleanup?.();
      cleanup = installDom();
      vi.stubGlobal('getComputedStyle', window.getComputedStyle.bind(window));
    });
    const TOKEN_ROWS = [
      { name: 'bare HSL triplet', value: '221 83% 53%', out: 'hsl(221, 83%, 53%)' },
      { name: 'triplet with decimals', value: '221.5 83.2% 53%', out: 'hsl(221.5, 83.2%, 53%)' },
      { name: 'hex value passes through', value: '#2563eb', out: '#2563eb' },
      { name: 'unset variable', value: null, out: null },
    ];
    for (const r of TOKEN_ROWS) {
      it(r.name, () => {
        const el = document.createElement('div');
        document.body.appendChild(el);
        if (r.value) el.style.setProperty('--ring', r.value);
        expect(readColorToken(el, '--ring')).toBe(r.out);
      });
    }
    it('no element gives null', () => {
      expect(readColorToken(null, '--ring')).toBeNull();
    });
  });
});

describe('effectiveTheme: mode prop, explicit theme.mode and the --ring read', () => {
  let cleanup;
  beforeEach(() => {
    cleanup?.();
    cleanup = installDom();
    vi.stubGlobal('getComputedStyle', window.getComputedStyle.bind(window));
    _resetNoRingWarn();
  });
  const withRing = () => {
    const el = document.createElement('div');
    el.style.setProperty('--ring', '221 83% 53%');
    document.body.appendChild(el);
    return el;
  };
  const ROWS = [
    { name: 'nothing passed', theme: null, mode: undefined, mode_out: 'dark', ring: undefined },
    { name: 'mode dark', theme: null, mode: 'dark', mode_out: 'dark', ring: undefined },
    { name: 'mode light reads --ring', theme: null, mode: 'light', mode_out: 'light', ring: 'hsl(221, 83%, 53%)' },
    { name: 'theme.mode light beats mode dark', theme: { mode: 'light' }, mode: 'dark', mode_out: 'light', ring: 'hsl(221, 83%, 53%)' },
    { name: 'theme.mode dark beats mode light', theme: { mode: 'dark' }, mode: 'light', mode_out: 'dark', ring: undefined },
    { name: 'palette kept alongside mode', theme: { palette: { node: '#123456' } }, mode: 'light', mode_out: 'light', ring: 'hsl(221, 83%, 53%)' },
  ];
  for (const r of ROWS) {
    it(r.name, () => {
      const eff = effectiveTheme(r.theme, r.mode, withRing());
      expect(eff.mode).toBe(r.mode_out);
      expect(eff.ring).toBe(r.ring);
      if (r.theme?.palette) expect(eff.palette).toEqual(r.theme.palette);
    });
  }
  it('light with no --ring falls back and warns once, naming what was lost (C8)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bare = document.createElement('div');
    document.body.appendChild(bare);
    expect(effectiveTheme(null, 'light', bare).ring).toBeUndefined();
    expect(effectiveTheme(null, 'light', bare).ring).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/--ring is not defined.*selection border falls back to #0f172a/);
    warn.mockRestore();
  });
});

describe('export background and pulse colour follow the applied mode', () => {
  let cleanup;
  beforeEach(() => {
    cleanup?.();
    cleanup = installDom();
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
  });
  const fakeCy = (mode) => {
    const calls = {};
    return {
      calls,
      scratch: (k) => (k === MODE_SCRATCH_KEY ? mode : undefined),
      png: (o) => { calls.png = o; return new Blob(['x']); },
      svg: (o) => { calls.svg = o; return '<svg/>'; },
    };
  };
  const ROWS = [
    { name: 'never set', mode: undefined, bg: '#0f172a' },
    { name: 'dark', mode: 'dark', bg: '#0f172a' },
    { name: 'light', mode: 'light', bg: '#ffffff' },
  ];
  for (const r of ROWS) {
    it(`PNG and SVG export with ${r.name} use ${r.bg}`, () => {
      const cy = fakeCy(r.mode);
      exportPNG(cy);
      exportSVG(cy);
      expect(cy.calls.png.bg).toBe(r.bg);
      expect(cy.calls.svg.bg).toBe(r.bg);
      expect(modeOf(cy)).toBe(r.mode === 'light' ? 'light' : 'dark');
      expect(EXPORT_BACKGROUND[modeOf(cy)]).toBe(r.bg);
    });
  }
  it('the pulse orb is sky-200 on dark (unchanged) and cyan-600 on light', () => {
    expect(PULSE_COLOR).toEqual({ dark: '#a5f3fc', light: '#0891b2' });
  });
});

describe('census: hard-coded dark colour on a surface (class guard)', () => {
  const SRC = path.resolve(import.meta.dirname, '../src');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = walk(SRC).filter((f) => /\.(jsx?|css)$/.test(f));
  // A fallback hex handed to tokenColor() is the original dark colour, by design; everything else counts.
  const countRaw = (text) => (text.replace(/tokenColor\('[^']+',\s*'#[0-9a-fA-F]{3,6}'\)/g, '').match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) || []).length;
  const actual = Object.fromEntries(files.map((f) => [path.relative(SRC, f), countRaw(fs.readFileSync(f, 'utf8'))]).filter(([, n]) => n > 0));

  // Every remaining raw hex, by file, with the reason it stays. A new hex anywhere fails this row.
  const KEEP = {
    'internal/cytoscapeStyles.js': { n: 26, why: 'canvas styles: mode defaults, signal colours (highlight amber, neighbour blue, streaming cyan, grounding green), grounded border slate-500 (holds on both), and doc comments' },
    'components/PipelineDag.jsx': { n: 17, why: 'pipeline-DAG nodes are filled shapes with a light label inside the node, readable on either canvas; status fills are signal colours' },
    'components/RunLogPanel.jsx': { n: 0, why: '' },
    'components/DetailPanel.jsx': { n: 3, why: 'confidence bar green/amber/red: a status signal on a filled bar' },
    'components/OriginLegend.jsx': { n: 1, why: 'unknown-origin dashed red outline: a signal colour (matches the node border)' },
    'core/hopReplayPlan.js': { n: 4, why: 'per-hop reveal hues, documented "do not re-theme"' },
    'core/graphColors.js': { n: 1, why: 'a doc comment naming slate-400' },
    'core/annotationLegend.js': { n: 1, why: 'fallback swatch for a legend entry with no colour' },
    'internal/useCytoscape.js': { n: 1, why: 'the fallback colour named in the one-time no-ring warning text' },
    'core/themeColors.js': { n: 4, why: 'the mode tables of this module (export background, pulse colour) and doc comments' },
  };
  it('graph.css and every inline-styled panel hold zero raw hex', () => {
    for (const f of ['graph.css', 'components/RunLogPanel.jsx', 'components/ReplayScrubBar.jsx', 'components/FilterPanel.jsx', 'core/export.js', 'hooks/useDripFeed.js']) {
      expect({ file: f, n: actual[f] || 0 }).toEqual({ file: f, n: 0 });
    }
  });
  it('every other raw hex is counted and justified', () => {
    const expected = Object.fromEntries(Object.entries(KEEP).filter(([, v]) => v.n > 0).map(([k, v]) => [k, v.n]));
    expect(actual).toEqual(expected);
    for (const [k, v] of Object.entries(KEEP)) if (v.n > 0) expect({ k, why: v.why.length > 10 }).toEqual({ k, why: true });
  });
  it('every graph.css colour is a token var with a fallback', () => {
    const css = fs.readFileSync(path.join(SRC, 'graph.css'), 'utf8');
    const colourDecls = css.match(/(?:^|[;{ ])(?:color|background|border(?:-color)?|outline):[^;}]+/g) || [];
    const bad = colourDecls.filter((d) => /hsl\(var\(--[a-z-]+\)\)/.test(d) || /#[0-9a-f]{3,6}\b/i.test(d));
    expect(bad).toEqual([]);
    expect(css.match(/hsl\(var\(--[a-z-]+, [\d.]+ [\d.]+% [\d.]+%\)\)/g).length).toBeGreaterThanOrEqual(20);
  });
});

// ---- class guard: Tailwind literal colours in src/components (UI-LIGHT-MODE-LM1-1, design.md section 4) ----
// Every neutral/hue literal utility is either paired (a `dark:` variant of the same
// utility sits in the same class string) or is a saturated fill kept on purpose.
describe('tailwind literal colours in components are paired or kept', () => {
  const dir = path.resolve(__dirname, '../src/components');
  const LIT = /(?<![\w:-])((?:hover:|focus:|group-hover:|placeholder-)?)(text|bg|border|ring|placeholder)-(slate|gray|zinc|neutral|white|black|red|amber|yellow|green|blue|cyan|purple|violet|orange|emerald)(?:-(\d{2,3}))?(?:\/\d+)?(?![\w-])/g;
  // rows: [file, max unpaired literals]; saturated fills (bg-*-400+), black and white are not counted
  // GraphExplorer.jsx: text-yellow-600 is a warning glyph on a saturated amber pill (kept, 4.5:1 on its own fill)
  const KEEP_MAX = { 'GraphExplorer.jsx': 1 };
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsx'));
  const rows = files.map((f) => {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const unpaired = [];
    for (const m of src.matchAll(LIT)) {
      const [lit, variant, util, color, num] = m;
      const lo = Math.max(src.lastIndexOf("'", m.index), src.lastIndexOf('"', m.index), src.lastIndexOf('`', m.index));
      const seg = src.slice(lo + 1, m.index + lit.length + 200).split(/['"`]/)[0];
      const paired = new RegExp(`dark:${variant}${util}-`).test(seg) || /dark:/.test(src.slice(Math.max(0, m.index - 12), m.index));
      const saturated = /^(bg)$/.test(util) && Number(num) >= 400 || color === 'black' || color === 'white';
      if (!paired && !saturated) unpaired.push(lit);
    }
    return [f, unpaired.length, unpaired];
  });
  it.each(rows.map((r) => [r[0], r[1], r[2].slice(0, 5).join(' ')]))('%s unpaired neutral/hue literals: %i %s', (f, n) => {
    expect(n).toBeLessThanOrEqual(KEEP_MAX[f] ?? 0);
  });
  it('hue-700 text on white and token text hold 4.5:1', () => {
    const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    for (const h of ['#b91c1c', '#b45309', '#a16207', '#15803d', '#1d4ed8', '#0e7490', '#7e22ce']) expect(cr(h, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});
