// Drive the normal decision panel through the fetch adapter and Chromium's real canvas.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';

const { chromium } = createRequire(import.meta.url)('playwright-core');
const focus = 'schedule';
const previous = 'old';
const decision = id => ({ id, memory_type: 'decision', label: id, status: 'active' });
const graph = { nodes: [focus, previous, 'review', 'conflict', 'unrelated'].map(decision),
  edges: [{ source: focus, target: previous, type: 'SUPERSEDES' }] };
const data = { nodes: [{ id: focus, hop: 0 }, { id: previous, hop: 5, retirement: 'replaced' }, { id: 'away', hop: 1 },
  { id: 'review', hop: 2 }, { id: 'conflict', hop: 1 }],
  edges: [{ id: 'snap-edge', source: focus, target: previous, type: 'supersedes' }] };
const style = 'main,[data-graph-explorer]{height:720px}.cytoscape-container{width:720px;height:460px}.relative{position:relative}';

test('show, replay and clear a selected decision ripple from the keyboard', async t => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  let reads = 0, reply;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<main></main>' });
    if (url.pathname === '/memory/graph/full') return route.fulfill({ json: graph });
    assert.equal(url.pathname, '/memory/decisions/' + focus + '/effects');
    reads++;
    reply = options => route.fulfill(options);
  });
  const respond = async (count, response) => {
    await until(() => reads === count);
    await reply(response);
  };
  await mount(page);
  const group = page.getByRole('group', { name: 'Decision ripple' });
  const show = group.getByRole('button', { name: 'Show ripple' });
  await show.focus();
  await page.keyboard.press('Enter');
  await group.getByRole('button', { name: 'Loading ripple…', disabled: true }).waitFor();
  await until(() => !!reply);
  assert.equal(await group.locator('.sm-ripple-spinner').count(), 1);
  await reply({ json: { focus, data, conflicts: [{ id: 'conflict' }], review: [{ id: 'review', state: 'flagged' }] } });
  await group.getByText('+1 off screen').waitFor();
  await page.locator('.sm-ripple-ring').waitFor();
  await page.waitForFunction(() => window.cy.getElementById('old').hasClass('ripple-replaced'));
  assert.equal(await page.evaluate(() => window.cy.edges('.ripple-replaced').length), 1);
  assert.equal(await page.evaluate(() => window.cy.getElementById('unrelated').style('opacity')), '0.22');
  await checkColors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await group.getByRole('button', { name: 'Replay' }).press('Space');
  await page.waitForFunction(() => !document.querySelector('.sm-ripple-ring') && !window.cy.$('.ripple-flash').length);
  assert.equal(await page.evaluate(() => window.cy.nodes('.ripple-replaced').length), 1);
  await group.getByRole('button', { name: 'Clear' }).press('Enter');
  assert.equal(await page.evaluate(() => window.cy.$('.ripple-muted, .ripple-replaced').length), 0);
  assert.equal(reads, 1);
  await checkRetryAndEmpty(group, respond);
  await checkPendingClear(group, respond, () => reads);
  assert.deepEqual(errors, []);
});

// A host theme switch updates the in-flight or settled highlights in place.
async function checkColors(page) {
  const read = () => page.evaluate(() => ['conflict', 'review'].map(id => window.cy.$id(id).style('border-color')));
  const light = await read();
  assert.notEqual(light[0], light[1]);
  await page.evaluate(() => window.setGraphMode('dark'));
  await page.waitForFunction(before => window.cy.$id('review').style('border-color') !== before, light[1]);
  const dark = await read();
  assert.notEqual(dark[0], light[0]);
  assert.notEqual(dark[0], dark[1]);
}

// Load the real explorer in an intercepted local document with storage and a canvas.
async function mount(page) {
  const { outputFiles } = await build({ entryPoints: [path.join(import.meta.dirname, 'fixtures/rippleHost.jsx')],
    bundle: true, jsx: 'automatic', outdir: 'out', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
  await page.goto('http://ripple.test/');
  await page.addStyleTag({ content: style });
  for (const file of outputFiles) {
    if (file.path.endsWith('.js')) await page.addScriptTag({ content: file.text });
    else await page.addStyleTag({ content: file.text });
  }
  await page.waitForFunction(() => {
    window.cy = document.querySelector('[data-testid="graph-canvas"]')?._cyreg?.cy;
    return window.cy?.getElementById('schedule').length;
  });
  await page.evaluate(() => window.cy.getElementById('schedule').emit('tap'));
}

// Check the recovery path and the exact empty state in the same panel.
async function checkRetryAndEmpty(group, respond) {
  const show = group.getByRole('button', { name: 'Show ripple' });
  await show.click();
  await respond(2, { status: 503, body: 'Unavailable' });
  await group.getByRole('alert').getByText('Could not load this ripple. Try again.').waitFor();
  await show.click();
  await respond(3, { json: { focus, data: { nodes: [{ id: focus, hop: 0 }], edges: [] } } });
  await group.getByText('This decision touches nothing yet').waitFor();
}

// A cleared slow read cannot paint over a subsequent request or start it early.
async function checkPendingClear(group, respond, readCount) {
  const show = group.getByRole('button', { name: 'Show ripple' });
  const clear = group.getByRole('button', { name: 'Clear' });
  await show.click();
  await until(() => readCount() === 4);
  await clear.click();
  await show.click();
  assert.equal(readCount(), 4);
  await respond(4, { json: { focus, data } });
  await respond(5, { json: { focus, data: { nodes: [], edges: [] } } });
  await group.getByText('This decision touches nothing yet').waitFor();
  assert.equal(await group.getByRole('button', { name: 'Replay' }).count(), 0);
}

// Wait for the pending intercepted HTTP read without delaying the component.
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(predicate(), 'expected an effects request');
}
