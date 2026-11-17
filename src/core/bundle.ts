import bridgeSource from './bridge.inframe.js?raw';
import type { DeckFile, DeckFiles } from './types';
import { dirOf, ext, mimeOf, resolveRef } from './paths';

export interface DeckManifest {
  /** Entry HTML file, relative to the deck root. */
  entry?: string;
  adapter?: 'sections' | 'keys';
  slideSelector?: string;
  counterSelector?: string;
  name?: string;
}

export interface BundleOptions {
  token: string;
  frozen?: boolean;
  startAt?: number;
}

const dataUrlCache = new WeakMap<Uint8Array, string>();

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  const cached = dataUrlCache.get(bytes);
  if (cached) return cached;
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const url = `data:${mime};base64,${btoa(bin)}`;
  dataUrlCache.set(bytes, url);
  return url;
}

const textToDataUrl = (text: string, mime: string): string => `data:${mime};charset=utf-8,${encodeURIComponent(text)}`;

function assetUrl(path: string, file: DeckFile): string | null {
  if (file.kind === 'remote') return file.url;
  if (file.kind === 'binary') return bytesToDataUrl(file.bytes, file.mime);
  return ext(path) === 'svg' ? textToDataUrl(file.text, 'image/svg+xml') : null;
}

/** Inlines @import of local files and points url(...) at loadable URLs. */
function processCss(css: string, cssDir: string, files: DeckFiles, depth = 0): string {
  let out = css;
  if (depth < 5) {
    out = out.replace(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?\s*;/g, (all, ref: string) => {
      const path = resolveRef(cssDir, ref);
      const file = path ? files[path] : undefined;
      return file?.kind === 'text' ? processCss(file.text, dirOf(path!), files, depth + 1) : all;
    });
  }
  return out.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (all, _q: string, ref: string) => {
    const path = resolveRef(cssDir, ref);
    const file = path ? files[path] : undefined;
    const url = file && path ? assetUrl(path, file) : null;
    return url ? `url("${url}")` : all;
  });
}

export function readManifest(files: DeckFiles): DeckManifest {
  const file = files['deckhack.json'];
  if (file?.kind !== 'text') return {};
  try {
    const parsed: unknown = JSON.parse(file.text);
    return parsed && typeof parsed === 'object' ? (parsed as DeckManifest) : {};
  } catch {
    return {};
  }
}

/** Picks the HTML file to open: manifest entry, then index.html, then the shallowest HTML file. */
export function findEntry(files: DeckFiles): string | null {
  const manifest = readManifest(files);
  if (manifest.entry && files[manifest.entry]?.kind === 'text') return manifest.entry;
  const html = Object.keys(files).filter((p) => /\.html?$/i.test(p) && files[p]?.kind === 'text');
  if (!html.length) return null;
  const depth = (p: string) => p.split('/').length;
  return html.sort((a, b) => depth(a) - depth(b) || (/(^|\/)index\.html?$/i.test(a) ? -1 : 0) - (/(^|\/)index\.html?$/i.test(b) ? -1 : 0) || a.localeCompare(b))[0]!;
}

/**
 * Builds one self-contained HTML document for the sandboxed preview:
 * local stylesheets and scripts are inlined, assets are mapped to data or remote URLs,
 * and the bridge is injected as the very first script. The deck's own files are not changed.
 */
export function bundleDeck(files: DeckFiles, entry: string, opts: BundleOptions): { html: string; warnings: string[] } {
  const entryFile = files[entry];
  if (entryFile?.kind !== 'text') throw new Error(`Entry file not found: ${entry}`);
  const warnings: string[] = [];
  const entryDir = dirOf(entry);
  const doc = new DOMParser().parseFromString(entryFile.text, 'text/html');

  for (const link of Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'))) {
    const path = resolveRef(entryDir, link.getAttribute('href')!);
    const file = path ? files[path] : undefined;
    if (!path || file?.kind !== 'text') continue;
    const style = doc.createElement('style');
    style.setAttribute('data-pc-src', path);
    const media = link.getAttribute('media');
    if (media) style.setAttribute('media', media);
    style.textContent = processCss(file.text, dirOf(path), files);
    link.replaceWith(style);
  }
  for (const style of Array.from(doc.querySelectorAll('style:not([data-pc-src])'))) {
    style.textContent = processCss(style.textContent ?? '', entryDir, files);
  }
  for (const el of Array.from(doc.querySelectorAll('[style*="url("]'))) {
    el.setAttribute('style', processCss(el.getAttribute('style')!, entryDir, files));
  }
  for (const script of Array.from(doc.querySelectorAll('script[src]'))) {
    const path = resolveRef(entryDir, script.getAttribute('src')!);
    const file = path ? files[path] : undefined;
    if (!path || file?.kind !== 'text') continue;
    if (script.getAttribute('type') === 'module' && /^\s*import\s[^(]*from\s*["']\.{1,2}\//m.test(file.text)) {
      warnings.push(`${path} imports other local modules. Module imports are not bundled yet, so this script may fail in the preview.`);
    }
    script.removeAttribute('src');
    script.setAttribute('data-pc-src', path);
    script.textContent = file.text.replace(/<\/script/gi, '<\\/script');
  }

  const assets: Record<string, string> = {};
  const texts: Record<string, string> = {};
  for (const [path, file] of Object.entries(files)) {
    const url = assetUrl(path, file);
    if (url) assets[path] = url;
    else if (file.kind === 'text' && !/^(html?|css|m?js)$/.test(ext(path)) && file.text.length < 500_000) texts[path] = file.text;
  }

  const config = { token: opts.token, entryDir, assets, texts, frozen: !!opts.frozen, startAt: opts.startAt ?? 1, manifest: readManifest(files) };
  const bridge = doc.createElement('script');
  bridge.setAttribute('data-pc', 'bridge');
  bridge.textContent = bridgeSource.replace('__PC_CONFIG__', () => JSON.stringify(config).replace(/</g, '\\u003c'));
  (doc.head ?? doc.documentElement).prepend(bridge);

  return { html: '<!doctype html>\n' + doc.documentElement.outerHTML, warnings };
}

export { mimeOf };
