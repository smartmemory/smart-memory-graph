// Workspace test fixture: reuse the jsdom dev dependency installed under the file-linked SDK.
// It is found through the installed node_modules/@smartmemory/sdk-js link, so it resolves from the
// main checkout and from any .worktrees/<name>/ alike (a ../../../smart-memory-sdk-js path only
// resolved from one directory depth). No GUI browser process is launched.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { vi } from 'vitest';

const sdkRoot = fs.realpathSync(path.resolve(import.meta.dirname, '../../node_modules/@smartmemory/sdk-js'));
const { JSDOM } = createRequire(path.join(sdkRoot, 'package.json'))('jsdom');

export function installDom() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://viewer.test', pretendToBeVisual: true });
  for (const name of ['window', 'document', 'navigator', 'sessionStorage', 'localStorage']) {
    vi.stubGlobal(name, dom.window[name]);
  }
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  return () => { dom.window.close(); vi.unstubAllGlobals(); };
}
