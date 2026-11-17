// Checks the path that `npx github:clschulzer/DeckHack` takes: pack the repository the way npm
// does for a git dependency (prepare builds the app), install the tarball into an empty folder,
// start the `deckhack` command and check that it serves the app.
// Usage: npm run npx:check
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhack-npx-'));
const port = 4191;
let child;
let failed = false;
try {
  const tarball = execSync(`npm pack --silent --pack-destination "${tmp}"`, { cwd: root, encoding: 'utf8' }).trim().split('\n').pop();
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"private":true}');
  execSync(`npm install --silent --omit=dev "${path.join(tmp, tarball)}"`, { cwd: tmp, stdio: 'inherit' });
  const bin = path.join(tmp, 'node_modules', '.bin', process.platform === 'win32' ? 'deckhack.cmd' : 'deckhack');
  child = spawn(bin, ['--port', String(port), '--no-open'], { stdio: 'inherit', shell: process.platform === 'win32' });

  let html = '';
  for (let i = 0; i < 40 && !html; i++) {
    try { html = await (await fetch(`http://localhost:${port}/`)).text(); } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  if (!html.includes('<div id="root">')) throw new Error('the command does not serve the app');
  if (!html.includes('Content-Security-Policy')) throw new Error('index.html lost its CSP');
  const script = /<script[^>]+src="([^"]+)"/.exec(html)?.[1];
  const js = await fetch(new URL(script, `http://localhost:${port}/`));
  if (!js.ok || !(js.headers.get('content-type') ?? '').includes('javascript')) throw new Error('the app script is not served as JavaScript');
  const outside = await fetch(`http://localhost:${port}/..%2Fpackage.json`);
  if (outside.status !== 404) throw new Error('files outside dist/ are reachable');
  console.log(`ok: the packed package starts with the deckhack command and serves the app (${tarball})`);
} catch (err) {
  failed = true;
  console.error(`FAILED: ${err.message}`);
} finally {
  child?.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
