const TEXT_EXT = new Set(['html', 'htm', 'css', 'js', 'mjs', 'json', 'svg', 'md', 'txt', 'xml', 'csv', 'webmanifest']);

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  svg: 'image/svg+xml', ico: 'image/x-icon', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', pdf: 'application/pdf',
};

export const ext = (path: string): string => path.slice(path.lastIndexOf('.') + 1).toLowerCase();
export const isTextPath = (path: string): boolean => TEXT_EXT.has(ext(path));
export const mimeOf = (path: string): string => MIME[ext(path)] ?? 'application/octet-stream';
export const dirOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** True for references that point outside the deck folder (http:, data:, #anchor, mailto:, ...). */
export const isExternalRef = (ref: string): boolean => /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref.trim());

/**
 * Resolves `ref` as written in a file inside `baseDir` to a path relative to the deck root.
 * Returns null when the reference is external or escapes the deck root.
 */
export function resolveRef(baseDir: string, ref: string): string | null {
  const clean = ref.trim().split('#')[0]!.split('?')[0]!;
  if (!clean || isExternalRef(ref)) return null;
  const parts = clean.startsWith('/') ? [] : baseDir.split('/').filter(Boolean);
  for (const seg of clean.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

/** Validates a path the AI wants to write. The model's output is untrusted. */
export function safeDeckPath(path: unknown): string | null {
  if (typeof path !== 'string' || !path || path.length > 300) return null;
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0')) return null;
  const resolved = resolveRef('', path);
  return resolved && resolved === path.replace(/^\.\//, '') ? resolved : null;
}
