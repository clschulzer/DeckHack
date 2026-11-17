// Builds the container with docker compose, starts it and checks that the app is served.
// Usage: npm run docker:check   (needs Docker with the compose plugin)
import { execSync } from 'node:child_process';

const port = process.env.DECKHACK_PORT || '8080';
const base = `http://localhost:${port}/`;
const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
}

async function waitFor(url) {
  for (let i = 0; i < 30; i++) {
    try {
      return await get(url);
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`${url} did not answer within 30 seconds`);
}

let failed = false;
try {
  run('docker compose up --build --detach');
  const html = await waitFor(base);
  if (!html.includes('<div id="root">')) throw new Error('index.html has no app root');
  if (!html.includes('Content-Security-Policy')) throw new Error('index.html lost its CSP');
  const script = /<script[^>]+src="([^"]+)"/.exec(html)?.[1];
  if (!script) throw new Error('index.html references no script');
  const js = await get(new URL(script, base).href);
  if (js.length < 1000) throw new Error('app script is unexpectedly small');
  console.log(`ok: container serves the app at ${base} (${script}, ${js.length} bytes)`);
} catch (err) {
  failed = true;
  console.error(`FAILED: ${err.message}`);
} finally {
  run('docker compose down');
}
process.exit(failed ? 1 : 0);
