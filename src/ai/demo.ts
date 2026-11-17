import { applyEdit, cloneFiles } from '../core/edits';
import type { DeckFiles } from '../core/types';
import type { Provider, ReworkRequest, ReworkResult } from './provider';

const PATTERN = /(?:replace|ersetze)\s+["“„'‘]([^"”“'’]+)["”“'’]\s+(?:with|by|durch)\s+["“„'‘]([^"”“'’]*)["”“'’]/i;

/** Replaces the first occurrence of `oldText` in the deck, entry file first, as one exact edit. */
function replaceInDeck(files: DeckFiles, entry: string, oldText: string, newText: string): { ok: boolean; message: string } {
  const path = Object.keys(files)
    .sort((a, b) => (a === entry ? -1 : b === entry ? 1 : a.localeCompare(b)))
    .find((p) => { const f = files[p]!; return f.kind === 'text' && f.text.includes(oldText); });
  if (!path) return { ok: false, message: `"${oldText}" was not found in the deck` };
  const file = files[path]!;
  const text = file.kind === 'text' ? file.text : '';
  const at = text.indexOf(oldText);
  // Take enough context to make the match unique, the same rule real edits follow.
  let from = at, to = at + oldText.length;
  while (text.indexOf(text.slice(from, to), text.indexOf(text.slice(from, to)) + 1) >= 0 && (from > 0 || to < text.length)) {
    from = Math.max(0, from - 20);
    to = Math.min(text.length, to + 20);
  }
  return applyEdit(files, { op: 'replace', path, old: text.slice(from, to), new: text.slice(from, at) + newText + text.slice(at + oldText.length, to) });
}

/**
 * Demo mode: no AI and no network. It understands exactly one kind of comment,
 * replace "old" with "new", and performs it as a plain text replacement. Comments of the
 * example deck carry a prepared answer (`comment.demo`) that is performed the same way.
 * It exists so the whole review loop can be tried and tested without an API key.
 */
export const demoProvider: Provider = {
  id: 'demo',
  label: 'Demo mode (no AI)',
  needsKey: false,

  async rework(request: ReworkRequest): Promise<ReworkResult> {
    const files = cloneFiles(request.files);
    const done: string[] = [];
    for (const comment of request.comments) {
      const where = comment.slide ? `Slide ${comment.slide}` : 'Whole deck';
      if (comment.demo?.length) {
        const outcomes = comment.demo.map((e) => replaceInDeck(files, request.entry, e.old, e.new));
        for (const o of outcomes) request.onEvent({ type: 'edit', ok: o.ok, message: o.message });
        if (outcomes.some((o) => o.ok)) done.push(`${where}: applied the prepared answer.`);
        continue;
      }
      const m = PATTERN.exec(comment.text);
      if (!m) {
        request.onEvent({ type: 'edit', ok: false, message: `Demo mode only understands: replace "old" with "new". Skipped: ${comment.text.slice(0, 60)}` });
        continue;
      }
      const [, oldText, newText] = m as unknown as [string, string, string];
      const outcome = replaceInDeck(files, request.entry, oldText, newText);
      request.onEvent({ type: 'edit', ok: outcome.ok, message: outcome.message });
      if (outcome.ok) done.push(`${where}: replaced "${oldText}" with "${newText}".`);
    }
    await new Promise((r) => setTimeout(r, 300));
    return { files, summary: done.length ? `${done.join(' ')}${request.comments.some((c) => c.demo?.length) ? ' Demo mode made no AI call.' : ''}` : 'Nothing was changed.' };
  },
};
