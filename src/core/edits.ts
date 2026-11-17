import type { DeckFile, DeckFiles, EditOp } from './types';
import { isTextPath, safeDeckPath } from './paths';

export interface EditOutcome {
  ok: boolean;
  /** Message for the model (and the log) when the edit could not be applied. */
  message: string;
}

/**
 * Applies one edit to `files` in place. Edits are small and exact on purpose:
 * `replace` must match exactly once, so the model cannot silently change a different spot.
 */
export function applyEdit(files: DeckFiles, edit: EditOp): EditOutcome {
  const path = safeDeckPath(edit.path);
  if (!path) return { ok: false, message: `Invalid path: ${String(edit.path)}. Use a relative path inside the deck.` };

  if (edit.op === 'delete') {
    if (!files[path]) return { ok: false, message: `No such file: ${path}` };
    delete files[path];
    return { ok: true, message: `Deleted ${path}` };
  }

  if (!isTextPath(path)) return { ok: false, message: `Only text files can be edited, not ${path}` };

  if (edit.op === 'write') {
    if (typeof edit.content !== 'string') return { ok: false, message: 'content must be a string' };
    files[path] = { kind: 'text', text: edit.content };
    return { ok: true, message: `Wrote ${path} (${edit.content.length} chars)` };
  }

  const file = files[path];
  if (!file) return { ok: false, message: `No such file: ${path}` };
  if (file.kind !== 'text') return { ok: false, message: `${path} is not a text file` };
  if (typeof edit.old !== 'string' || typeof edit.new !== 'string' || !edit.old) {
    return { ok: false, message: 'old and new must be strings, and old must not be empty' };
  }
  const first = file.text.indexOf(edit.old);
  if (first < 0) return { ok: false, message: `old text not found in ${path}. Copy it exactly, including whitespace.` };
  if (file.text.indexOf(edit.old, first + 1) >= 0) {
    return { ok: false, message: `old text occurs more than once in ${path}. Include more surrounding text to make it unique.` };
  }
  files[path] = { kind: 'text', text: file.text.slice(0, first) + edit.new + file.text.slice(first + edit.old.length) };
  return { ok: true, message: `Edited ${path}` };
}

export const cloneFiles = (files: DeckFiles): DeckFiles => ({ ...files });

function sameFile(a: DeckFile, b: DeckFile): boolean {
  if (a.kind === 'text') return b.kind === 'text' && a.text === b.text;
  if (a.kind === 'remote') return b.kind === 'remote' && a.url === b.url;
  if (b.kind !== 'binary' || a.bytes.length !== b.bytes.length) return false;
  return a.bytes === b.bytes || a.bytes.every((byte, i) => byte === b.bytes[i]);
}

/** Paths whose content differs between two file sets. */
export function changedPaths(before: DeckFiles, after: DeckFiles): string[] {
  const out: string[] = [];
  for (const path of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[path], b = after[path];
    if (!a || !b || !sameFile(a, b)) out.push(path);
  }
  return out.sort();
}
