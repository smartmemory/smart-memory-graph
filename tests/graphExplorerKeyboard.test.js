/**
 * GRAPH-KEY-DELETE-1 — graph keyboard shortcuts must not act outside the graph.
 *
 * Mounts the real GraphExplorer (real useCytoscape, real cytoscape) in jsdom with a mocked
 * adapter, then dispatches real KeyboardEvents. Nothing here touches a network or a backend.
 * The failure class: a host-wide key handler that mutates graph state (and deletes memories).
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDom } from './helpers/dom.js';

// Capture the cytoscape instance the explorer creates so a test can select nodes the way a
// tap would. Everything else is the real library (jsdom's missing canvas is stubbed below).
vi.mock('cytoscape', async (importOriginal) => {
  const mod = await importOriginal();
  const real = mod.default;
  const wrapped = (...args) => {
    const cy = real(...args);
    globalThis.__graphKeyCy = cy;
    return cy;
  };
  Object.assign(wrapped, real);
  return { ...mod, default: wrapped };
});

import GraphExplorer from '../src/components/GraphExplorer.jsx';
import { classifyGraphKey, describeDeletion, isEditableTarget, shortcutAppliesTo } from '../src/core/graphKeyboard.js';

// jsdom has no canvas; cytoscape's renderer only needs a 2d context that accepts any call.
function installCanvasStub() {
  const ctx = new Proxy(function () {}, {
    get: (_t, prop) => {
      if (typeof prop === 'symbol') return undefined;
      if (prop === 'canvas') return document.createElement('canvas');
      if (/PixelRatio$/.test(prop)) return 1;
      if (prop === 'measureText') return () => ({ width: 0 });
      return ctx;
    },
    set: () => true,
    apply: () => ctx,
  });
  vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx);
}

const DATA = {
  nodes: [
    { id: 'm1', label: 'Memory one', type: 'semantic', category: 'memory' },
    { id: 'm2', label: 'Memory two', type: 'semantic', category: 'memory' },
    { id: 'e1', label: 'Entity one', type: 'person', category: 'entity' },
  ],
  edges: [],
};

let cleanupDom, host, mount, reactRoot, adapter;

const makeAdapter = (over = {}) => ({
  getFullGraph: vi.fn(async () => ({ nodes: [], edges: [] })),
  deleteNode: vi.fn(async () => {}),
  deleteEntityNode: vi.fn(async () => {}),
  getGroundingStatus: vi.fn(async () => ({ grounded: false })),
  updateEntityNode: vi.fn(async () => {}),
  createOntologyPattern: vi.fn(async () => {}),
  ...over,
});
const cy = () => globalThis.__graphKeyCy;
const selected = () => cy().nodes(':selected').map((n) => n.id()).sort();
const present = () => cy().nodes().map((n) => n.id()).sort();
const rootEl = () => host.querySelector('[data-graph-explorer]');
const q = (sel) => document.querySelector(sel);

async function render(props = {}) {
  await act(async () => {
    reactRoot.render(createElement(GraphExplorer, { adapter, data: DATA, ...props }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}
async function selectIds(ids) {
  await act(async () => { cy().nodes().unselect(); ids.forEach((id) => cy().getElementById(id).select()); });
}
// Dispatches a real keydown the way a keystroke arrives: at the focused element.
// Returns the event so a test can read defaultPrevented.
async function press(target, key, init = {}) {
  if (target !== document.body) await act(async () => { target.focus?.(); });
  const ev = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  await act(async () => { target.dispatchEvent(ev); });
  return ev;
}
const click = (el) => act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
const deleteCalls = () => adapter.deleteNode.mock.calls.length + adapter.deleteEntityNode.mock.calls.length;

beforeEach(async () => {
  cleanupDom = installDom();
  installCanvasStub();
  // React's legacy input-event polyfill probes these on focus in jsdom; they are never used for real.
  window.HTMLElement.prototype.attachEvent = () => {};
  window.HTMLElement.prototype.detachEvent = () => {};
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(() => fn(Date.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  globalThis.__graphKeyCy = null;
  adapter = makeAdapter();
  host = document.createElement('div');
  host.innerHTML = `
    <div id="host-editor" contenteditable="true">note text</div>
    <input id="host-input" /><textarea id="host-textarea"></textarea>
    <button id="host-button">host button</button><div id="host-plain">plain</div>
    <div id="mount"></div>`;
  document.body.appendChild(host);
  mount = host.querySelector('#mount');
  reactRoot = createRoot(mount);
  await render();
  await selectIds(['m1', 'm2', 'e1']);
});
afterEach(async () => {
  await act(async () => reactRoot.unmount());
  vi.restoreAllMocks();
  cleanupDom();
});

describe('keys outside the graph never delete or select', () => {
  // One row per source of the keystroke. Every row has all three nodes selected.
  const OUTSIDE = [
    ['host contenteditable', '#host-editor'],
    ['host input', '#host-input'],
    ['host textarea', '#host-textarea'],
    ['host button', '#host-button'],
    ['host plain element', '#host-plain'],
    ['document body', 'body'],
  ];
  for (const [name, sel] of OUTSIDE) {
    for (const key of ['Delete', 'Backspace']) {
      it(`${key} from ${name}: no confirm, no backend call`, async () => {
        const ev = await press(q(sel), key);
        expect(ev.defaultPrevented).toBe(false);
        expect(q('[data-testid="graph-delete-confirm-dialog"]')).toBeNull();
        expect(deleteCalls()).toBe(0);
        expect(selected()).toEqual(['e1', 'm1', 'm2']);
      });
    }
    for (const init of [{ metaKey: true }, { ctrlKey: true }]) {
      it(`${init.metaKey ? 'Cmd' : 'Ctrl'}+A from ${name}: not prevented, selection unchanged`, async () => {
        await selectIds(['m1']);
        const ev = await press(q(sel), 'a', init);
        expect(ev.defaultPrevented).toBe(false);
        expect(selected()).toEqual(['m1']);
      });
    }
  }
});

// Opens the DetailPanel rename input for the entity and types a new label, the way a user does.
async function startEntityRename() {
  await act(async () => cy().getElementById('e1').emit('tap'));
  const title = [...rootEl().querySelectorAll('h2')].find((x) => x.textContent === 'Entity one');
  await click(title);
  const input = rootEl().querySelector('input[value="Entity one"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => { setter.call(input, 'Renamed entity'); input.dispatchEvent(new window.Event('input', { bubbles: true })); });
  return input;
}
const addInGraph = (tag, attrs = {}) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  rootEl().appendChild(el);
  return el;
};

describe('an editable element owns focus: no graph shortcut acts, inside the explorer or out', () => {
  // GRAPH-KEY-DELETE-1 class: a graph shortcut that acts while an editor has focus. Cmd+K from the
  // DetailPanel rename input used to steal focus; the blur then saved the edit to the backend.
  const KEYS = [['Delete', {}], ['Backspace', {}], ['a', { metaKey: true }], ['a', { ctrlKey: true }], ['k', { metaKey: true }], ['k', { ctrlKey: true }]];
  const SOURCES = [
    ['explorer search input', async () => rootEl().querySelector('input[type="text"]')],
    ['in-graph contenteditable', async () => addInGraph('div', { contenteditable: 'true', tabindex: '0' })],
    ['in-graph textarea', async () => addInGraph('textarea')],
    ['in-graph select', async () => addInGraph('select')],
    ['DetailPanel rename input (edited)', startEntityRename],
  ];
  for (const [name, make] of SOURCES) {
    it(`${name}: every shortcut key is left to the editor`, async () => {
      const el = await make();
      expect(el).not.toBeNull();
      const searchInput = rootEl().querySelector('input[type="text"]');
      for (const [key, init] of KEYS) {
        // Cmd/Ctrl+K inside the search input itself is the one allowed shortcut (it re-focuses itself).
        if (key === 'k' && el === searchInput) continue;
        const ev = await press(el, key, init);
        expect(ev.defaultPrevented, `${key} ${JSON.stringify(init)}`).toBe(false);
        expect(document.activeElement).toBe(el);
        expect(q('[data-testid="graph-delete-confirm-dialog"]')).toBeNull();
        expect(selected()).toEqual(['e1', 'm1', 'm2']);
      }
      expect(deleteCalls()).toBe(0);
      expect(adapter.updateEntityNode).not.toHaveBeenCalled();
      expect(adapter.createOntologyPattern).not.toHaveBeenCalled();
    });
  }
  it('Backspace on a button inside the explorer does not open the confirm', async () => {
    const btn = rootEl().querySelector('button');
    await press(btn, 'Backspace');
    expect(q('[data-testid="graph-delete-confirm-dialog"]')).toBeNull();
    expect(deleteCalls()).toBe(0);
  });
});

describe('keys on the graph surface', () => {
  it('Cmd+A and Ctrl+A select every node and are prevented', async () => {
    for (const init of [{ metaKey: true }, { ctrlKey: true }]) {
      await selectIds([]);
      const ev = await press(rootEl(), 'a', init);
      expect(ev.defaultPrevented).toBe(true);
      expect(selected()).toEqual(['e1', 'm1', 'm2']);
    }
  });
  for (const key of ['Delete', 'Backspace']) {
    it(`${key} asks first, naming the count, and calls nothing yet`, async () => {
      await press(rootEl(), key);
      const dlg = q('[data-testid="graph-delete-confirm-dialog"]');
      expect(dlg.textContent).toContain('Delete 3 items (2 memories, 1 entity) from SmartMemory?');
      expect(deleteCalls()).toBe(0);
      expect(present()).toEqual(['e1', 'm1', 'm2']);
    });
  }
  it('Cancel leaves everything in place with 0 backend calls', async () => {
    await press(rootEl(), 'Backspace');
    await click(q('[data-testid="graph-delete-cancel"]'));
    expect(q('[data-testid="graph-delete-confirm-dialog"]')).toBeNull();
    expect(deleteCalls()).toBe(0);
    expect(present()).toEqual(['e1', 'm1', 'm2']);
  });
  it('Escape cancels the prompt', async () => {
    await press(rootEl(), 'Delete');
    await press(q('[data-testid="graph-delete-cancel"]'), 'Escape');
    expect(q('[data-testid="graph-delete-confirm-dialog"]')).toBeNull();
    expect(deleteCalls()).toBe(0);
  });
  it('Backspace while the prompt is open does not confirm it', async () => {
    await press(rootEl(), 'Backspace');
    await press(q('[data-testid="graph-delete-cancel"]'), 'Backspace');
    expect(deleteCalls()).toBe(0);
  });
  it('Accept deletes each node by its own category and removes them', async () => {
    await press(rootEl(), 'Backspace');
    await click(q('[data-testid="graph-delete-confirm"]'));
    await settle();
    expect(adapter.deleteNode.mock.calls.map((c) => c[0]).sort()).toEqual(['m1', 'm2']);
    expect(adapter.deleteEntityNode.mock.calls.map((c) => c[0])).toEqual(['e1']);
    expect(present()).toEqual([]);
    expect(q('[data-testid="graph-delete-failure"]')).toBeNull();
  });
  it('modified and held Delete/Backspace do nothing', async () => {
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }]) {
      await press(rootEl(), 'Backspace', init);
      expect(q('[data-testid="graph-delete-confirm-dialog"]')).toBeNull();
    }
  });
  it('Delete with nothing selected does not open a prompt', async () => {
    await selectIds([]);
    await press(rootEl(), 'Delete');
    expect(q('[data-testid="graph-delete-confirm-dialog"]')).toBeNull();
  });
  it('a host that hides the selection toolbar has no keyboard delete either', async () => {
    await render({ hideSelectionToolbar: true });
    await selectIds(['m1', 'm2']);
    for (const key of ['Delete', 'Backspace']) {
      await press(rootEl(), key);
      expect(q('[data-testid="graph-delete-confirm-dialog"]')).toBeNull();
    }
    expect(deleteCalls()).toBe(0);
  });
  it('the selection toolbar Delete button goes through the same confirm', async () => {
    const btn = [...rootEl().querySelectorAll('button')].find((b) => b.textContent.trim() === 'Delete');
    await click(btn);
    expect(q('[data-testid="graph-delete-confirm-dialog"]')).not.toBeNull();
    expect(deleteCalls()).toBe(0);
  });
});

describe('a failed backend delete keeps the node and says so', () => {
  it('1 of 3 rejects: that node stays, selected, with a visible failure', async () => {
    adapter.deleteNode.mockImplementation(async (id) => { if (id === 'm2') throw new Error('API 500'); });
    await press(rootEl(), 'Delete');
    await click(q('[data-testid="graph-delete-confirm"]'));
    await settle();
    expect(present()).toEqual(['m2']);
    expect(selected()).toEqual(['m2']);
    expect(q('[data-testid="graph-delete-failure"]').textContent).toContain('Could not delete 1 of 3 items. It is still in the graph.');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('delete failed for m2; node kept in graph'), expect.any(Error));
  });
  it('every delete rejects: nothing leaves the graph', async () => {
    adapter.deleteNode.mockRejectedValue(new Error('API 500'));
    adapter.deleteEntityNode.mockRejectedValue(new Error('API 500'));
    await press(rootEl(), 'Delete');
    await click(q('[data-testid="graph-delete-confirm"]'));
    await settle();
    expect(present()).toEqual(['e1', 'm1', 'm2']);
    expect(q('[data-testid="graph-delete-failure"]').textContent).toContain('Could not delete 3 of 3 items. They are still in the graph.');
  });
  it('an adapter without the delete methods counts as failure, not success', async () => {
    adapter = { getFullGraph: adapter.getFullGraph };
    await render();
    await press(rootEl(), 'Delete');
    await click(q('[data-testid="graph-delete-confirm"]'));
    await settle();
    expect(present()).toEqual(['e1', 'm1', 'm2']);
    expect(q('[data-testid="graph-delete-failure"]')).not.toBeNull();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('delete failed for'), expect.any(TypeError));
  });
  it('a graph with no adapter cannot delete and says so, without prompting', async () => {
    await render({ adapter: null });
    await selectIds(['m1']);
    await press(rootEl(), 'Delete');
    expect(q('[data-testid="graph-delete-confirm-dialog"]')).toBeNull();
    expect(q('[data-testid="graph-delete-failure"]').textContent).toContain('read-only');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('delete requested with no adapter'));
    expect(present()).toContain('m1');
  });
});

describe('search box Cmd/Ctrl+K and Escape are scoped to the explorer and yield to editors', () => {
  const search = () => rootEl().querySelector('input[type="text"]');
  it('from outside the explorer (every host source): not prevented, search not focused', async () => {
    for (const sel of ['#host-editor', '#host-input', '#host-textarea', '#host-button', '#host-plain', 'body']) {
      for (const init of [{ metaKey: true }, { ctrlKey: true }]) {
        const ev = await press(q(sel), 'k', init);
        expect(ev.defaultPrevented, `${sel} ${JSON.stringify(init)}`).toBe(false);
        expect(document.activeElement).not.toBe(search());
      }
    }
  });
  it('from the explorer surface or the search input itself: prevented, search input focused', async () => {
    for (const from of [rootEl(), search()]) {
      for (const init of [{ metaKey: true }, { ctrlKey: true }]) {
        const ev = await press(from, 'k', init);
        expect(ev.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(search());
      }
    }
  });
  it('Escape in the search input leaves it', async () => {
    await press(rootEl(), 'k', { metaKey: true });
    // jsdom only: React's legacy input polyfill (used because jsdom lacks native `input` support) reads its
    // tracked input after our handler blurred it and throws a reported-not-fatal error. Browsers never take that path.
    const mute = (e) => e.preventDefault();
    window.addEventListener('error', mute);
    await press(search(), 'Escape');
    window.removeEventListener('error', mute);
    expect(document.activeElement).not.toBe(search());
  });
});

describe('graphKeyboard pure rules', () => {
  const surface = { nodeType: 1, tagName: 'DIV', getAttribute: () => null };
  const ev = (over) => ({ target: surface, key: 'Backspace', ...over });
  const ROWS = [
    ['Backspace on surface', ev({}), surface, null, 'delete'],
    ['Delete on surface', ev({ key: 'Delete' }), surface, null, 'delete'],
    ['Cmd+A on surface', ev({ key: 'a', metaKey: true }), surface, null, 'select-all'],
    ['Cmd+Shift+A is not select-all', ev({ key: 'A', metaKey: true, shiftKey: true }), surface, null, null],
    ['target is another element', ev({ target: { nodeType: 1, tagName: 'DIV' } }), surface, null, null],
    ['active element is an input', ev({}), surface, { nodeType: 1, tagName: 'INPUT' }, null],
    ['IME composition', ev({ isComposing: true }), surface, null, null],
    ['already handled', ev({ defaultPrevented: true }), surface, null, null],
    ['no surface', ev({}), null, null, null],
  ];
  for (const [name, e, s, active, want] of ROWS) {
    it(`classify: ${name}`, () => expect(classifyGraphKey(e, s, active)).toBe(want));
  }
  it('isEditableTarget covers the editing elements; describeDeletion names what is removed', () => {
    expect(isEditableTarget({ nodeType: 1, tagName: 'SELECT' })).toBe(true);
    expect(isEditableTarget({ nodeType: 1, tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isEditableTarget({ nodeType: 1, tagName: 'DIV', closest: () => ({ getAttribute: () => 'true' }) })).toBe(true);
    expect(isEditableTarget({ nodeType: 1, tagName: 'DIV', closest: () => ({ getAttribute: () => 'false' }) })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(describeDeletion({ memories: 37 })).toBe('Delete 37 memories from SmartMemory?');
    expect(describeDeletion({ memories: 1 })).toBe('Delete 1 memory from SmartMemory?');
    expect(describeDeletion({ entities: 2 })).toBe('Delete 2 entities from SmartMemory?');
  });
  it('shortcutAppliesTo: editors block it unless it is the search input itself', () => {
    const own = { nodeType: 1, tagName: 'INPUT' };
    const div = { nodeType: 1, tagName: 'DIV' };
    const ROWS = [
      ['plain target, nothing active', div, null, true],
      ['own input', own, own, true],
      ['other textarea target', { nodeType: 1, tagName: 'TEXTAREA' }, null, false],
      ['plain target, other input active', div, { nodeType: 1, tagName: 'INPUT' }, false],
      ['plain target, editable host active', div, { nodeType: 1, tagName: 'DIV', isContentEditable: true }, false],
    ];
    for (const [name, target, active, want] of ROWS) {
      expect(shortcutAppliesTo(target, { ownInput: own, activeElement: active }), name).toBe(want);
    }
  });
});
