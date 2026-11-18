/* Assembles the GitHub Pages site: only the landing page from site/. The app itself is not hosted,
   people run it locally (see README). Run through `npm run build:pages`. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist-pages');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'site'), out, { recursive: true });
fs.writeFileSync(path.join(out, '.nojekyll'), '');
if (fs.existsSync(path.join(out, 'app'))) throw new Error('The Pages site must not contain the app.');
console.log(`Site ready in ${path.relative(root, out)}/ (landing page only).`);
