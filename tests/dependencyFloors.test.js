import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * DEPS-VITEST-4-GRAPH-1: vitest has a CRITICAL advisory cleared at 4.1.11 (DEPS-AUDIT-1). The
 * declared range must have a floor at or above it, and the installed copy of vitest and of every
 * @vitest/* package must be at or above it too. One row per package. package-lock.json is
 * untracked in this repo, so the installed node_modules copy is what proves the lock.
 *
 * Override GRAPH_ROOT to point the check at another checkout.
 */
const root = process.env.GRAPH_ROOT || path.resolve(import.meta.dirname, '..');

const FLOOR = '4.1.11';

// `declared` is the package.json section that must carry the range, or null for a transitive
// package that only the install can prove.
const FLOORS = [
  { name: 'vitest', declared: 'devDependencies' },
  { name: '@vitest/expect', declared: null },
  { name: '@vitest/mocker', declared: null },
  { name: '@vitest/pretty-format', declared: null },
  { name: '@vitest/runner', declared: null },
  { name: '@vitest/snapshot', declared: null },
  { name: '@vitest/spy', declared: null },
  { name: '@vitest/utils', declared: null },
];

const parts = (v) => v.replace(/^[^\d]*/, '').split('-')[0].split('.').map(Number);

function atLeast(version, min) {
  const a = parts(version);
  const b = parts(min);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
}

const readJson = (...p) => JSON.parse(fs.readFileSync(path.join(root, ...p), 'utf8'));

describe('audited dependency floors', () => {
  it.each(FLOORS)('$name installs >= ' + FLOOR + ' (CRITICAL advisory)', ({ name, declared }) => {
    if (declared) {
      const range = readJson('package.json')[declared]?.[name];
      expect(range, `${name} missing from ${declared}`).toBeTruthy();
      expect(atLeast(range, FLOOR), `${name} declared as ${range}, floor ${FLOOR}`).toBe(true);
    }
    const installed = readJson('node_modules', name, 'package.json').version;
    expect(atLeast(installed, FLOOR), `${name} installed ${installed}, floor ${FLOOR}`).toBe(true);
  });

  it('every installed @vitest/* package has a row above (a new one must be added)', () => {
    const listed = new Set(FLOORS.map((r) => r.name));
    const installed = fs.readdirSync(path.join(root, 'node_modules', '@vitest')).map((d) => `@vitest/${d}`);
    expect(installed.filter((n) => !listed.has(n))).toEqual([]);
  });

  it('atLeast compares numerically, not lexically', () => {
    expect(atLeast('^4.10.0', '4.1.11')).toBe(true);
    expect(atLeast('3.2.7', '4.1.11')).toBe(false);
    expect(atLeast('^4.1.9', '4.1.11')).toBe(false);
  });
});
