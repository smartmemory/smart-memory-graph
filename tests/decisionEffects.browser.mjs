// Real Chromium, public GraphExplorer entry, no server or adapter.
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const { chromium } = createRequire(import.meta.url)('playwright-core');
const captures = process.env.DECISION_EFFECTS_SCREENSHOTS;
let browser, context, page, bundle, siteDir, siteUrl;
let errors;
before(async () => {
  bundle = await build({
    entryPoints: [path.join(import.meta.dirname, 'fixtures/decisionEffectsHost.jsx')],
    bundle: true, write: false, outdir: 'out', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
  });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
  // A local document has a storage origin, which the normal (flag-off) explorer uses.
  siteDir = await mkdtemp(path.join(tmpdir(), 'decision-effects-browser-'));
  const entry = path.join(siteDir, 'index.html');
  await writeFile(entry, '<!doctype html><html lang="en"><head><title>Decision effects</title><style>body{margin:24px;background:#f1f4f3}#root{max-width:1500px;margin:auto}</style></head><body><main id="root"></main></body></html>');
  siteUrl = pathToFileURL(entry).href;
  if (captures) await mkdir(captures, { recursive: true });
});
after(async () => {
  try { await browser?.close(); }
  finally { if (siteDir) await rm(siteDir, { recursive: true, force: true }); }
});
beforeEach(async () => {
  errors = [];
  context = await browser.newContext({ viewport: { width: 1540, height: 1000 }, offline: true, reducedMotion: 'reduce' });
  page = await context.newPage();
  page.setDefaultTimeout(3500);
  page.on('pageerror', err => errors.push(err.message));
  await page.route('**/*', route => {
    if (route.request().url() === siteUrl) return route.continue();
    errors.push('Unexpected request: ' + route.request().url());
    return route.abort();
  });
  await page.goto(siteUrl);
  for (const file of bundle.outputFiles) {
    if (file.path.endsWith('.js')) await page.addScriptTag({ content: file.text });
    else if (file.path.endsWith('.css')) await page.addStyleTag({ content: file.text });
  }
});
afterEach(async () => { await context?.close(); assert.deepEqual(errors, []); });

const node = id => page.locator('[data-node="' + id + '"]');
const edge = kind => page.locator('[data-edge="' + kind + '"]');
const button = name => page.getByRole('button', { name, exact: true });
const bar = () => page.getByLabel('Commit bar', { exact: true });
const aside = () => page.getByRole('complementary');
async function show(name) {
  await page.evaluate(n => window.loadCase(n), name);
  await page.locator('.de-view').waitFor();
}
async function shot(name, element = page.locator('.de-view')) {
  if (captures) await element.screenshot({ path: path.join(captures, name + '.png'), animations: 'disabled' });
}
async function date(value) {
  const slider = page.getByRole('slider');
  await slider.focus();
  // Use the native range-input setter and event used by a browser drag.
  await slider.evaluate((el, iso) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(Date.parse(iso + 'T00:00:00Z') / 86400000));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  assert.equal(await slider.getAttribute('aria-valuetext'), value);
}
async function openConflict() { await edge('conflict').getByRole('button').first().click(); }
async function readCommit() { return page.evaluate(() => window.lastCommit); }

test('flag is off by default and opt-in without inputs displays unavailable', async () => {
  await page.evaluate(() => window.loadCase('off'));
  await page.locator('#root > *').first().waitFor({ state: 'attached' });
  assert.equal(await page.getByRole('region', { name: 'Decision effects' }).count(), 0);
  await page.evaluate(() => window.loadCase('missing'));
  await page.getByText('Decision effects unavailable.', { exact: true }).waitFor();
});

test('A · ghost, directed retire arrow, strike and proposed/retiring tags', async () => {
  await show('email');
  assert.match(await node('A').getByRole('button').innerText(), /Draft: Move email to the US vendor to cut cost/);
  assert.match(await node('A').getByRole('button').innerText(), /proposed/);
  assert.equal(await node('A').locator('button').evaluate(el => getComputedStyle(el).borderStyle), 'dashed');
  assert.equal(await edge('replaces').getAttribute('data-source'), 'A');
  assert.equal(await edge('replaces').getAttribute('data-target'), 'vendor');
  assert.ok(await edge('replaces').locator('path').getAttribute('marker-end'));
  assert.match(await node('vendor').getByRole('button').innerText(), /retiring/);
  assert.equal(await node('vendor').locator('strong').evaluate(el => getComputedStyle(el).textDecorationLine), 'line-through');
  await shot('01-ghost');
  await shot('02-retiring-rule', node('vendor'));
});

test('A · exactly three ripple links, with the frozen parents, hop labels and double borders', async () => {
  await show('email');
  const paths = await edge('ripple').evaluateAll(es => es.map(e => [e.dataset.source, e.dataset.target, e.textContent.includes('R2') ? 2 : 1]));
  assert.deepEqual(paths, [['vendor', 'support', 1], ['vendor', 'growth', 1], ['support', 'exports', 2]]);
  for (const [, id, hop] of paths) {
    assert.match(await node(id).getByRole('button').innerText(), new RegExp('R' + hop + ' · needs review'));
    assert.equal(await node(id).locator('button').evaluate(el => getComputedStyle(el).borderStyle), 'double');
  }
  await shot('04-ripple', page.locator('.de-frame'));
});

test('A · open conflict, both texts, reason, guarded save, scoped commit and standing marks', async () => {
  await show('email');
  assert.equal(await edge('conflict').count(), 1);
  assert.equal(await edge('conflict').getAttribute('data-target'), 'eu');
  assert.match(await bar().innerText(), /1 conflict · 1 replaced · 3 to review/);
  assert.equal(await button('Save').isDisabled(), true);
  await shot('06-commit-bar', bar());
  await openConflict();
  assert.match(await aside().innerText(), /Move email to the US vendor to cut cost/);
  assert.match(await aside().innerText(), /Customer data stays in the EU region/);
  assert.match(await aside().innerText(), /store and process customer email addresses outside the EU/);
  assert.equal(await button('Keep both with a scope').isDisabled(), true);
  await page.getByLabel('Scope', { exact: true }).fill('Marketing email only');
  await shot('03-conflict-card', aside());
  await button('Keep both with a scope').click();
  assert.deepEqual(await readCommit(), { focus: 'A', answers: { eu: { choice: 'scoped', scope: 'Marketing email only' } } });
  assert.equal(await edge('settled').getByRole('button').innerText(), 'scoped');
  assert.equal(await node('A').locator('[data-ghost]').count(), 0);
  assert.equal(await node('eu').locator('[data-retired]').count(), 0);
  assert.deepEqual(await page.locator('.de-review-list button').allTextContents(), [
    'R1 · Support may export tickets for analysis', 'R1 · Email templates are owned by the growth team', 'R2 · Ticket exports are anonymised before sharing',
  ]);
});

test('A · replace retires on 24 Nov and Cancel drops the ghost and all preview marks', async () => {
  await show('email');
  await openConflict();
  await button('Replace the old rule').click();
  assert.equal((await readCommit()).answers.eu.choice, 'replace');
  for (const id of ['vendor', 'eu']) assert.match(await node(id).getByRole('button').innerText(), /replaced 24 Nov/);
  assert.equal(await page.locator('.de-review-list li').count(), 3);
  assert.equal(await node('A').locator('[data-ghost]').count(), 0);
  await show('email');
  await openConflict();
  await aside().getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await node('A').count(), 0);
  for (const kind of ['replaces', 'conflict', 'ripple']) assert.equal(await edge(kind).count(), 0);
});

test('multiple conflicts require every choice', async () => {
  await show('multi');
  await openConflict();
  await button('Replace the old rule').click();
  assert.equal(await button('Save').isDisabled(), true);
  assert.equal(await edge('conflict').count(), 1);
  assert.equal(await edge('pending').count(), 1);
  assert.equal(await readCommit(), null);
});

test('B · safe Friday draft depends on Thursday and flags neither of its dependents', async () => {
  await show('friday');
  assert.match(await bar().innerText(), /0 conflicts · 0 replaced · 0 to review/);
  assert.match(await bar().innerText(), /Safe to save/);
  assert.equal(await button('Save').isEnabled(), true);
  assert.equal(await page.locator('[data-source="B"][data-target="release"]').count(), 1);
  assert.equal(await edge('ripple').count(), 0);
  assert.equal(await page.locator('[data-review]').count(), 0);
});

test('C · only the pilot billing decision needs review, plus human-review policy readback', async () => {
  await show('pilots');
  assert.match(await bar().innerText(), /0 conflicts · 1 replaced · 1 to review/);
  assert.equal(await edge('replaces').getAttribute('data-target'), 'pilot');
  assert.equal(await edge('ripple').getAttribute('data-target'), 'billing');
  assert.match(await node('billing').getByRole('button').innerText(), /R1 · needs review/);
  await show('propose');
  await button('Send for review').click();
  assert.match(await node('C').getByRole('button').innerText(), /held/);
  assert.equal(await node('pilot').locator('[data-retired]').count(), 0);
});

test('D · history, exact effective date, show retired and suppression of present-day marks', async () => {
  await show('refunds');
  assert.equal(await node('manager').count(), 0);
  await page.getByRole('checkbox', { name: 'Show retired' }).check();
  assert.match(await node('manager').getByRole('button').innerText(), /replaced 6 May/);
  await page.getByRole('checkbox').uncheck();
  await date('2026-04-14');
  assert.equal(await node('refund').count(), 0);
  assert.equal(await node('manager').count(), 1);
  assert.equal(await node('manager').locator('[data-retired]').count(), 0);
  await date('2026-05-06');
  assert.match(await node('manager').getByRole('button').innerText(), /replaced 6 May/);
  assert.equal(await node('refund').count(), 1);
  await shot('08-rules-in-force');
  await show('email');
  await date('2026-04-14');
  assert.equal(await node('A').count(), 0);
  assert.equal(await edge('conflict').count() + await edge('ripple').count(), 0);
  assert.match(await page.locator('.de-frame-heading').innerText(), /marks are shown for today only/);
  await show('pilots');
  // The host timeline begins in January, even if every rule in this focus is newer.
  await date('2026-04-14');
  assert.equal(await node('pilot').count(), 0);
});

test('E · Why numbers the five nodes, highlights the directed path, dims the rest and clears', async () => {
  await show('standing');
  await node('exports').getByRole('button').click();
  await button('Why?').click();
  for (const [i, id] of ['legal', 'eu', 'vendor', 'support', 'exports'].entries()) {
    assert.equal((await node(id).locator('.de-step').innerText()).trim(), String(i + 1));
  }
  assert.deepEqual(await edge('why').evaluateAll(es => es.map(e => [e.dataset.source, e.dataset.target]).sort()),
    [['eu', 'vendor'], ['legal', 'eu'], ['support', 'exports'], ['vendor', 'support']]);
  assert.equal(await node('growth').getAttribute('data-dimmed'), 'true');
  await shot('09-why-path');
  await button('Clear path').click();
  await node('eu').getByRole('button').click();
  await button('Why?').click();
  assert.equal(await edge('why').count(), 1);
  assert.equal(await edge('why').getAttribute('data-source'), 'legal');
});

test('F · wording is separate, uncompiled check is unknown, computed and stale remain distinct', async () => {
  await show('stale');
  assert.match(await node('eu').getByRole('button').innerText(), /check \?/);
  assert.doesNotMatch(await node('eu').getByRole('button').innerText(), /check ok/);
  await shot('05-unchecked-rule', node('eu'));
  await button('1 possibly related').click();
  assert.match(await aside().innerText(), /Meeting note mentioning EU/);
  assert.equal(await node('mention').count(), 0);
  assert.match(await bar().innerText(), /1 conflict · 1 replaced · 3 to review/);
  await shot('07-possibly-related', aside());
  await page.keyboard.press('Escape');
  assert.equal(await aside().count(), 0);
  assert.match(await page.locator('.de-header').innerText(), /computed now/);
  assert.match(await node('support').getByRole('button').innerText(), /R1 · checking/);
  assert.match(await node('support').getByRole('button').innerText(), /◷ stale/);
  await node('support').getByRole('button').click();
  assert.equal(await aside().locator('time').getAttribute('datetime'), '2026-11-20T03:00:00Z');
  assert.match(await aside().innerText(), /◷ stale · checked/);
  await shot('13-freshness', aside());
});

test('F · 47 decisions render 40 cards, seven hidden and a working overflow stub', async () => {
  await show('crowded');
  assert.equal(await page.locator('[data-node]').count(), 40);
  assert.match(await page.locator('.de-frame-heading').innerText(), /7 more not shown/);
  const stub = button('+7 more at hop 1');
  await stub.scrollIntoViewIfNeeded();
  await shot('14-focus-frame-and-stub');
  await stub.click();
  assert.equal(await aside().getByRole('listitem').count(), 7);
  for (let i = 2; i <= 8; i++) {
    await button('Pilot term ' + (i + 1)).click();
    assert.equal(await page.locator('output').innerText(), 'Refocus requested: term-' + i);
  }
});

test('workspace switch clears choices, open scope input and view settings on an identical snapshot', async () => {
  await show('multi');
  await page.getByRole('checkbox').check();
  await openConflict();
  await button('Replace the old rule').click();
  await openConflict();
  await page.getByLabel('Scope', { exact: true }).fill('First workspace only');
  await page.evaluate(() => window.updateHost('multi', 'second'));
  assert.equal(await aside().count(), 0);
  assert.equal(await page.getByRole('checkbox').isChecked(), false);
  assert.equal(await edge('conflict').count(), 2);
  await edge('conflict').last().getByRole('button').click();
  assert.equal(await page.getByLabel('Scope', { exact: true }).inputValue(), '');
  assert.equal(await button('Keep both with a scope').isDisabled(), true);
  assert.equal(await readCommit(), null);
});

test('unknown policy offers conflict inspection without write actions', async () => {
  await show('unknown-policy');
  assert.equal(await button('Save').count() + await button('Send for review').count(), 0);
  await openConflict();
  assert.match(await aside().innerText(), /Customer data stays in the EU/);
  assert.equal(await button('Replace the old rule').count() + await button('Keep both with a scope').count(), 0);
  assert.equal(await readCommit(), null);
});

test('stored stale conflict has a persistent cue on a computed graph', async () => {
  await show('stale');
  assert.match(await page.locator('.de-header').innerText(), /computed now/);
  assert.match(await edge('conflict').getByRole('button').innerText(), /conflict.*◷ stale/);
});

test('outstanding read becomes unavailable when loading ends without inputs', async () => {
  await page.evaluate(() => window.loadCase('missing'));
  await page.evaluate(() => window.updateHost('missing', 'first', true));
  assert.match(await page.getByRole('status').innerText(), /Loading decision effects/);
  await page.evaluate(() => window.updateHost('missing', 'first', false));
  assert.match(await page.getByRole('status').innerText(), /unavailable/);
});

test('rejected direct save shows a pending link and retries the preserved scope', async () => {
  await show('reject');
  await openConflict();
  await page.getByLabel('Scope', { exact: true }).fill('Billing only');
  await button('Keep both with a scope').click();
  assert.equal(await page.getByRole('alert').innerText(), 'Write rejected');
  assert.equal(await edge('settled').count(), 0);
  await edge('pending').getByRole('button', { name: 'pending: scoped' }).click();
  assert.equal(await page.getByLabel('Scope', { exact: true }).inputValue(), 'Billing only');
  await button('Close detail').click();
  await button('Save').click();
  assert.equal(await edge('settled').getByRole('button').innerText(), 'scoped');
  assert.equal((await readCommit()).answers.eu.scope, 'Billing only');
});
