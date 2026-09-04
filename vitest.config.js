import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@contracts': path.resolve(__dirname, '../contracts'),
    },
  },
  // DIST-LITE-9: the components use the automatic JSX runtime (no `import React`), which
  // is what every consuming app's build already assumes. esbuild's default here is the
  // classic transform, so a test that renders a component died on `React is not defined`
  // — the components were fine, the test transform was not.
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'node',
  },
});
