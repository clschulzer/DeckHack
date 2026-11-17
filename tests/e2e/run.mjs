/* End-to-end check of the review loop in a real browser (Chromium via Playwright).
   Run after `npm run build`:  node tests/e2e/run.mjs [path/to/extra-deck.zip]
   Fails (exit 1) when a step does not behave as expected. Screenshots land in tests/e2e/out. */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
/* Use the project's Playwright; fall back to a machine-wide install whose browser is already present. */
async function launch() {
  const candidates = [() => require('playwright'), () => createRequire('/opt/node-tools/')('playwright')];
  let last;
  for (const load of candidates) {
    try { return await load().chromium.launch(); } catch (e) { last = e; }
  }
  throw last;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const out = path.join(here, 'out');
fs.mkdirSync(out, { recursive: true });
const extraDeck = process.argv[2];
const PORT = 4179;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
const stop = () => server.kill();
process.on('exit', stop);

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
};

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('preview server did not start');
}

await waitForServer();
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
const shot = (name) => page.screenshot({ path: path.join(out, name) });

try {
  /* 1. Template -> editor */
  await page.goto(`http://localhost:${PORT}/`);
  await shot('01-start.png');
  await page.getByRole('button', { name: /Three-minute pitch/ }).click();
  await page.locator('.film').nth(6).waitFor({ timeout: 15000 });
  check('template opens with 7 detected slides', (await page.locator('.film').count()) === 7);
  await page.waitForFunction(() => document.querySelectorAll('.film-title')[1]?.textContent === 'Problem', null, { timeout: 15000 }).catch(() => {});
  check('slide titles are read from the deck', (await page.locator('.film-title').nth(1).textContent()) === 'Problem');

  /* 2. Navigate, comment, apply (demo provider: deterministic, no network) */
  await page.locator('.film').nth(2).click();
  await page.waitForFunction(() => document.querySelector('.position b')?.textContent === '3');
  check('clicking a slide moves the preview', true);
  await page.locator('.film').nth(0).click();
  await page.waitForFunction(() => document.querySelector('.position b')?.textContent === '1');
  await page.fill('#comment-text', 'replace "47 minutes" with "52 minutes"');
  await page.getByRole('button', { name: 'Add comment' }).click();
  await page.locator('.pin').first().waitFor();
  await shot('02-comment.png');
  await page.getByRole('button', { name: 'Apply round' }).click();
  await page.locator('.result').waitFor({ timeout: 30000 });
  const resultText = await page.locator('.result').innerText();
  check('a new version v2 is created', /v2 created/.test(resultText), resultText.split('\n')[0]);
  check('the check reports exactly slide 1 as changed', /Changed: slide 1\./.test(resultText) && /Every other slide is unchanged/.test(resultText));
  const frameText = await page.frameLocator('iframe[title="Deck preview"]').locator('h1').innerText();
  check('the preview shows the new text', frameText.includes('52 minutes'), frameText);
  await shot('03-applied.png');

  /* 3. Sandbox: deck code cannot reach the app */
  const isolated = await page.frameLocator('iframe[title="Deck preview"]').locator('body').evaluate(() => {
    try { void window.parent.document.body; return false; } catch { return true; }
  });
  check('deck code cannot read the app (opaque origin)', isolated);
  check('preview iframe is sandboxed to scripts only', (await page.locator('iframe[title="Deck preview"]').getAttribute('sandbox')) === 'allow-scripts');

  /* 4. Versions: go back without losing history */
  await page.getByRole('tab', { name: /Versions/ }).click();
  check('two versions are listed', (await page.locator('.version').count()) === 2);
  await page.locator('.version').nth(1).getByRole('button', { name: 'Restore' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.version').length === 3);
  const restored = await page.frameLocator('iframe[title="Deck preview"]').locator('h1').innerText();
  check('restoring v1 adds v3 and brings the old text back', restored.includes('47 minutes'), restored);
  await shot('04-versions.png');

  /* 5. Optional: a real scripted deck (slides built in JavaScript) */
  if (extraDeck) {
    await page.goto(`http://localhost:${PORT}/`);
    await page.setInputFiles('#upload-files', extraDeck);
    await page.locator('.film').nth(5).waitFor({ timeout: 60000 });
    const n = await page.locator('.film').count();
    check('scripted deck: slides detected through its counter', n >= 10, `${n} slides`);
    await page.locator('.film').nth(7).click();
    await page.waitForFunction(() => document.querySelector('.position b')?.textContent === '8', null, { timeout: 15000 });
    check('scripted deck: jump to slide 8 works', true);
    await page.waitForTimeout(1500);
    await shot('05-scripted-deck.png');
    const errors = await page.locator('.errors').count() ? await page.locator('.errors').getAttribute('title') : '';
    check('scripted deck: loads without errors', !errors, errors ?? '');
    const phrase = process.argv[3];
    if (phrase) {
      await page.fill('#comment-text', `replace "${phrase}" with "${phrase} now"`);
      await page.getByRole('button', { name: 'Add comment' }).click();
      await page.getByRole('button', { name: 'Apply round' }).click();
      await page.locator('.result').waitFor({ timeout: 60000 });
      const text = (await page.locator('.result-check').innerText()).trim();
      check('scripted deck: an edit to slide 8 is reported as slide 8 only', /^Changed: slide 8\. Every other slide is unchanged\.$/.test(text), text);
      await page.waitForTimeout(1200);
      await shot('06-scripted-deck-applied.png');
    }
  }

  check('no errors in the app itself', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  check('run completed', false, e.message.split('\n')[0]);
  await shot('99-failure.png').catch(() => {});
} finally {
  await browser.close();
  stop();
}

const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed. Screenshots: ${out}`);
process.exit(failed ? 1 : 0);
