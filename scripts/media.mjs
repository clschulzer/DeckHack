/* Regenerates the screenshots and the demo GIF for the landing page and the README.
   Run after `npm run build`:  npm run media
   Needs Chromium (Playwright) and, for the GIF, ffmpeg on the PATH. Everything shown is the
   example deck with invented data, driven through the real app in demo mode. */
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const require = createRequire(import.meta.url);
async function launch() {
  const candidates = [() => require('playwright'), () => createRequire('/opt/node-tools/')('playwright')];
  let last;
  for (const load of candidates) {
    try { return await load().chromium.launch(); } catch (e) { last = e; }
  }
  throw last;
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const media = path.join(root, 'site', 'media');
fs.mkdirSync(media, { recursive: true });
const PORT = 4181;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(URL_)).ok) break; } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await launch();
const settle = (page, ms = 900) => page.waitForTimeout(ms);
const openExample = async (page) => {
  await page.goto(`${URL_}?example`);
  await page.locator('.film').nth(6).waitFor({ timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('.film-title')[1]?.textContent === 'Problem', null, { timeout: 15000 });
  await settle(page, 1200);
};

/* ---------- screenshots (2x, for sharp images on the page) ---------- */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' });
  const shot = (name) => page.screenshot({ path: path.join(media, name) });

  await openExample(page);
  await shot('example.png');

  await page.getByRole('button', { name: 'Apply round' }).click();
  await page.locator('.result').waitFor({ timeout: 30000 });
  await page.locator('.film').nth(0).click();
  await settle(page, 1200);
  await shot('applied.png');

  await page.getByRole('tab', { name: /Versions/ }).click();
  await settle(page, 400);
  await shot('versions.png');

  await page.goto(URL_);
  await page.evaluate(() => indexedDB.deleteDatabase('deckhack'));
  await page.goto(`${URL_}?template=three-minute-pitch`);
  await page.getByText('5 minutes', { exact: true }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.locator('#crit-impact').check();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByText('Demo first', { exact: true }).click();
  await settle(page, 300);
  await page.locator('.dialog-inner').screenshot({ path: path.join(media, 'wizard.png') });

  await page.goto(URL_);
  await page.getByRole('button', { name: /AI:/ }).click();
  await page.locator('#provider-claude').check();
  await page.locator('#set-remember').check();
  await settle(page, 300);
  await page.locator('.dialog-inner').screenshot({ path: path.join(media, 'settings.png') });
  await page.close();
}

/* ---------- demo GIF: one round on the example deck ---------- */
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhack-gif-'));
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: 'light' });
  const page = await context.newPage();
  const frames = [];
  const frame = async (seconds) => {
    const file = path.join(dir, `f${String(frames.length).padStart(3, '0')}.png`);
    await page.screenshot({ path: file });
    frames.push({ file, seconds });
  };
  const slide = async (n, seconds) => {
    await page.locator('.film').nth(n - 1).click();
    await page.waitForFunction((want) => document.querySelector('.position b')?.textContent === String(want), n);
    await settle(page);
    await frame(seconds);
  };

  await page.goto(URL_);
  await page.evaluate(() => indexedDB.deleteDatabase('deckhack'));
  await page.reload();
  await settle(page, 400);
  await frame(1.6);
  await openExample(page);
  await frame(2.2);
  await slide(3, 2.0);
  await slide(5, 2.0);
  await slide(7, 1.8);
  await page.getByRole('button', { name: 'Apply round' }).click();
  await page.locator('.result').waitFor({ timeout: 30000 });
  await settle(page);
  await page.locator('.result').scrollIntoViewIfNeeded();
  await frame(3.2);
  await slide(1, 2.4);
  await page.getByRole('button', { name: /Show before/ }).click();
  await settle(page, 1200);
  await frame(2.0);
  await page.getByRole('button', { name: /Show after/ }).click();
  await settle(page, 1200);
  await frame(2.0);
  await page.getByRole('tab', { name: /Versions/ }).click();
  await settle(page, 400);
  await frame(3.0);
  await context.close();

  const list = path.join(dir, 'frames.txt');
  const last = frames.at(-1);
  fs.writeFileSync(list, frames.map((f) => `file '${f.file}'\nduration ${f.seconds}`).join('\n') + `\nfile '${last.file}'\n`);
  const out = path.join(media, 'demo.gif');
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
    '-vf', 'fps=10,scale=1280:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
    '-loop', '0', out], { stdio: 'inherit' });
  if (ff.status !== 0) console.log('ffmpeg is missing or failed: the GIF was not written, the screenshots were.');
  fs.rmSync(dir, { recursive: true, force: true });
}

await browser.close();
server.kill();
for (const f of fs.readdirSync(media).sort()) console.log(`${f}  ${(fs.statSync(path.join(media, f)).size / 1024).toFixed(0)} KB`);
process.exit(0);
