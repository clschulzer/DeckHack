/* Assembles the GitHub Pages site: the landing page from site/ at the root, the app under app/.
   Run through `npm run build:pages`, which builds the app into dist-pages/app first. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist-pages');
if (!fs.existsSync(path.join(out, 'app', 'index.html'))) throw new Error('dist-pages/app is missing. Run `npm run build:pages`.');
fs.cpSync(path.join(root, 'site'), out, { recursive: true });
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`Site ready in ${path.relative(root, out)}/ (landing page at /, app at /app/).`);
