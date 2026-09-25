// Workspace test fixture: reuse the file-linked SDK's installed jsdom dev dependency.
// No GUI browser process is launched.
import { JSDOM } from '../../../smart-memory-sdk-js/node_modules/jsdom/lib/api.js';
import { vi } from 'vitest';

export function installDom() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://viewer.test', pretendToBeVisual: true });
  for (const name of ['window', 'document', 'navigator', 'sessionStorage', 'localStorage']) {
    vi.stubGlobal(name, dom.window[name]);
  }
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  return () => { dom.window.close(); vi.unstubAllGlobals(); };
}
