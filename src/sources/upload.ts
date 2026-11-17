import { unzipSync, zipSync, strToU8 } from 'fflate';
import type { DeckFiles } from '../core/types';
import { isTextPath, mimeOf } from '../core/paths';

const decoder = new TextDecoder();
const SKIP = /(^|\/)(\.git|node_modules|\.DS_Store|__MACOSX)(\/|$)/;

function toFile(path: string, bytes: Uint8Array): DeckFiles[string] {
  return isTextPath(path) ? { kind: 'text', text: decoder.decode(bytes) } : { kind: 'binary', bytes, mime: mimeOf(path) };
}

/** Drops a folder prefix shared by every path ("my-deck/index.html" -> "index.html"). */
export function stripCommonRoot(files: DeckFiles): DeckFiles {
  const paths = Object.keys(files);
  if (!paths.length) return files;
  const first = paths[0]!.split('/');
  let depth = first.length - 1;
  for (const p of paths) {
    const parts = p.split('/');
    let i = 0;
    while (i < depth && i < parts.length - 1 && parts[i] === first[i]) i++;
    depth = i;
  }
  if (!depth) return files;
  return Object.fromEntries(paths.map((p) => [p.split('/').slice(depth).join('/'), files[p]!]));
}

export function filesFromZip(zip: Uint8Array): DeckFiles {
  const out: DeckFiles = {};
  for (const [path, bytes] of Object.entries(unzipSync(zip))) {
    if (path.endsWith('/') || SKIP.test(path)) continue;
    out[path] = toFile(path, bytes);
  }
  return stripCommonRoot(out);
}

/** Accepts one .zip, one .html, or the files of a picked folder. */
export async function filesFromUpload(list: File[]): Promise<{ files: DeckFiles; name: string }> {
  if (!list.length) throw new Error('No files selected.');
  const only = list[0]!;
  if (list.length === 1 && /\.zip$/i.test(only.name)) {
    return { files: filesFromZip(new Uint8Array(await only.arrayBuffer())), name: only.name.replace(/\.zip$/i, '') };
  }
  const out: DeckFiles = {};
  for (const file of list) {
    const path = (file.webkitRelativePath || file.name).replace(/^\/+/, '');
    if (SKIP.test(path)) continue;
    out[path] = toFile(path, new Uint8Array(await file.arrayBuffer()));
  }
  const root = only.webkitRelativePath ? only.webkitRelativePath.split('/')[0]! : only.name.replace(/\.html?$/i, '');
  return { files: stripCommonRoot(out), name: root };
}

/** Packs the deck as a .zip. Remote assets are left out and listed in a note. */
export function zipDeck(files: DeckFiles): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  const remote: string[] = [];
  for (const [path, file] of Object.entries(files)) {
    if (file.kind === 'text') entries[path] = strToU8(file.text);
    else if (file.kind === 'binary') entries[path] = file.bytes;
    else remote.push(`${path}  <-  ${file.url}`);
  }
  if (remote.length) entries['REMOTE-ASSETS.txt'] = strToU8(`These files stay in the source repository and are not part of this archive:\n\n${remote.join('\n')}\n`);
  return zipSync(entries);
}
