import type { DeckFiles } from '../core/types';
import { isTextPath } from '../core/paths';

/**
 * Templates are plain deck folders under /templates. They are bundled as text at build time,
 * so a template may only contain text files (HTML, CSS, JS, SVG). Add a folder and it shows up here.
 */
const raw = import.meta.glob('../../templates/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export interface Template {
  id: string;
  name: string;
  description: string;
  author: string;
  files: DeckFiles;
}

export function listTemplates(): Template[] {
  const byId = new Map<string, DeckFiles>();
  for (const [key, text] of Object.entries(raw)) {
    const rel = key.replace(/^.*\/templates\//, '');
    const slash = rel.indexOf('/');
    if (slash < 0) continue;
    const id = rel.slice(0, slash), path = rel.slice(slash + 1);
    if (!isTextPath(path)) continue;
    if (!byId.has(id)) byId.set(id, {});
    byId.get(id)![path] = { kind: 'text', text };
  }
  return [...byId.entries()].map(([id, files]) => {
    let meta: { name?: string; description?: string; author?: string } = {};
    const manifest = files['deckhack.json'];
    try {
      if (manifest?.kind === 'text') meta = JSON.parse(manifest.text) as typeof meta;
    } catch { /* a broken manifest only costs the nice name */ }
    return { id, name: meta.name ?? id, description: meta.description ?? '', author: meta.author ?? '', files };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
