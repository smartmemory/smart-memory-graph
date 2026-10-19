import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { version as viteVersion } from 'vite';

// DIST-LITE-9: the components use the automatic JSX runtime (no `import React`), which
// is what every consuming app's build already assumes. The default transform on vite <= 7
// (esbuild) is the classic one, so a test that renders a component died on `React is not
// defined` — the components were fine, the test transform was not. Vite 8 (what vitest 4
// installs) transforms with oxc and ignores the `esbuild` key, so the same setting is
// spelled `oxc.jsx.runtime` there. Keyed on the installed vite so an older vite still gets it.
const jsxTransform = Number(viteVersion.split('.')[0]) >= 8
  ? { oxc: { jsx: { runtime: 'automatic' } } }
  : { esbuild: { jsx: 'automatic' } };

export default defineConfig({
  resolve: {
    alias: {
      '@contracts': path.resolve(import.meta.dirname, '../contracts'),
    },
  },
  ...jsxTransform,
  test: {
    environment: 'node',
  },
});
