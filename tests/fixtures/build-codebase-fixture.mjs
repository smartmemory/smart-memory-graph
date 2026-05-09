#!/usr/bin/env node
/**
 * build-codebase-fixture.mjs
 *
 * Walks the SmartMemory monorepo and builds a graph fixture in the same shape
 * as `smart-memory-graph` consumes (GraphNode[] + GraphEdge[]).
 *
 * Each Python module becomes a node; each `import` / `from X import` edge
 * pointing at another in-repo module becomes an edge. Falls back to
 * filesystem-parent edges if the imports yield too few links.
 *
 * Used by tests/perf.cytoscape.test.js. Re-run with:
 *   node tests/fixtures/build-codebase-fixture.mjs
 *
 * Output:  tests/fixtures/codebase-200k.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../..'); // .../SmartMemory
const OUT_FILE = path.join(__dirname, 'codebase-200k.json');

const SKIP_DIRS = new Set([
  'node_modules', '.venv', 'venv', 'build', 'dist', '__pycache__',
  '.git', 'examples', '.next', 'site', 'coverage', '.pytest_cache',
  '.ruff_cache', '.mypy_cache', '.turbo', '.vite',
  // The monorepo has 10k+ source files — keep the committed fixture
  // bounded to a representative ~1.5k-node slice. Remove to scale up for
  // ad-hoc benchmarking. `tmp` is a scratch dir with 6k+ files.
  'tmp', 'smart-memory-studio', 'smart-memory-web',
  'smart-memory-insights', 'smart-memory-admin',
  'smart-memory-benchmarks', 'smart-memory-test',
  'smartmemory-hub', 'smartmemory-hub-base44',
]);

const SOURCE_EXTS = new Set(['.py', '.js', '.jsx', '.ts', '.tsx']);

function* walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.claude') continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile() && SOURCE_EXTS.has(path.extname(e.name))) yield full;
  }
}

const files = [];
for (const f of walk(REPO_ROOT)) files.push(f);

console.error(`Discovered ${files.length} source files under ${REPO_ROOT}`);

// Build module-id index (relative path) and content map.
const idForPath = new Map();
const pathForModule = new Map();

function moduleIdOf(absPath) {
  const rel = path.relative(REPO_ROOT, absPath).replace(/\\/g, '/');
  return rel;
}

for (const f of files) {
  const id = moduleIdOf(f);
  idForPath.set(f, id);
  // dotted python module name for import resolution
  if (f.endsWith('.py')) {
    const noExt = id.replace(/\.py$/, '');
    const parts = noExt.split('/');
    // try several suffix-suffix module names so we can match `from x.y import z`
    for (let i = 0; i < parts.length; i++) {
      const dotted = parts.slice(i).join('.');
      if (!pathForModule.has(dotted)) pathForModule.set(dotted, id);
    }
  }
}

const PY_IMPORT = /^\s*(?:from\s+([\w.]+)\s+import\s+|import\s+([\w.]+))/gm;
const JS_IMPORT = /^\s*(?:import[^'"]*['"]([^'"]+)['"]|(?:const|let|var)\s+\w+\s*=\s*require\(['"]([^'"]+)['"]\))/gm;

function resolveJsImport(fromAbs, spec) {
  if (!spec.startsWith('.')) return null;
  const baseDir = path.dirname(fromAbs);
  const candidates = [
    spec, `${spec}.js`, `${spec}.jsx`, `${spec}.ts`, `${spec}.tsx`,
    path.join(spec, 'index.js'), path.join(spec, 'index.jsx'),
    path.join(spec, 'index.ts'), path.join(spec, 'index.tsx'),
  ];
  for (const c of candidates) {
    const abs = path.resolve(baseDir, c);
    if (idForPath.has(abs)) return idForPath.get(abs);
  }
  return null;
}

const edges = [];
const nodeMeta = new Map(); // id -> { lines }
const seenEdgeKeys = new Set();

for (const f of files) {
  const id = idForPath.get(f);
  let body;
  try { body = fs.readFileSync(f, 'utf8'); } catch { continue; }
  const lineCount = body.split('\n').length;
  nodeMeta.set(id, { lines: lineCount, size: body.length });

  if (f.endsWith('.py')) {
    let m;
    PY_IMPORT.lastIndex = 0;
    while ((m = PY_IMPORT.exec(body))) {
      const dotted = m[1] || m[2];
      if (!dotted) continue;
      const target = pathForModule.get(dotted);
      if (!target || target === id) continue;
      const key = `${id}->${target}`;
      if (seenEdgeKeys.has(key)) continue;
      seenEdgeKeys.add(key);
      edges.push({ id: `imp:${edges.length}`, source: id, target, type: 'IMPORTS', label: 'imports' });
    }
  } else {
    let m;
    JS_IMPORT.lastIndex = 0;
    while ((m = JS_IMPORT.exec(body))) {
      const spec = m[1] || m[2];
      if (!spec) continue;
      const target = resolveJsImport(f, spec);
      if (!target || target === id) continue;
      const key = `${id}->${target}`;
      if (seenEdgeKeys.has(key)) continue;
      seenEdgeKeys.add(key);
      edges.push({ id: `imp:${edges.length}`, source: id, target, type: 'IMPORTS', label: 'imports' });
    }
  }
}

// Build nodes — emit shape compatible with cytoscapeConvert.graphNodeToCyElement:
// requires { id, label, type, category, content, ... }
const TYPE_FROM_EXT = {
  '.py': 'code', '.js': 'code', '.jsx': 'code', '.ts': 'code', '.tsx': 'code',
};

const nodes = [];
for (const id of idForPath.values()) {
  const meta = nodeMeta.get(id) || { lines: 0, size: 0 };
  const ext = path.extname(id);
  const label = path.basename(id);
  const top = id.split('/')[0]; // top-level repo dir as a coarse "package" tag
  nodes.push({
    id,
    label,
    type: TYPE_FROM_EXT[ext] || 'semantic',
    category: 'memory',
    content: `${id} (${meta.lines} lines)`,
    metadata: { package: top, ext, lines: meta.lines, size: meta.size },
  });
}

// If imports gave us fewer than ~node_count edges, top up with parent-dir
// "PART_OF" edges so the layout has structure to settle around.
const dirIndex = new Map(); // dir -> first file id seen
for (const n of nodes) {
  const dir = path.dirname(n.id);
  if (!dirIndex.has(dir)) dirIndex.set(dir, n.id);
}
for (const n of nodes) {
  const dir = path.dirname(n.id);
  const anchor = dirIndex.get(dir);
  if (anchor && anchor !== n.id) {
    const key = `${n.id}->${anchor}:PART_OF`;
    if (!seenEdgeKeys.has(key)) {
      seenEdgeKeys.add(key);
      edges.push({ id: `dir:${edges.length}`, source: n.id, target: anchor, type: 'PART_OF', label: 'part_of' });
    }
  }
}

const out = { nodes, edges, generated_at: new Date().toISOString(), source: REPO_ROOT };
fs.writeFileSync(OUT_FILE, JSON.stringify(out));
const stat = fs.statSync(OUT_FILE);

console.error(`Wrote ${OUT_FILE}`);
console.error(`  nodes: ${nodes.length}`);
console.error(`  edges: ${edges.length}`);
console.error(`  size:  ${(stat.size / 1024).toFixed(1)} KiB`);
