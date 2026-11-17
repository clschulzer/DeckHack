import { applyEdit, cloneFiles } from '../core/edits';
import type { Provider, ReworkRequest, ReworkResult } from './provider';

const PATTERN = /(?:replace|ersetze)\s+["“„'‘]([^"”“'’]+)["”“'’]\s+(?:with|by|durch)\s+["“„'‘]([^"”“'’]*)["”“'’]/i;

/**
 * Demo mode: no AI and no network. It understands exactly one kind of comment,
 * replace "old" with "new", and performs it as a plain text replacement.
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
      const m = PATTERN.exec(comment.text);
      if (!m) {
        request.onEvent({ type: 'edit', ok: false, message: `Demo mode only understands: replace "old" with "new". Skipped: ${comment.text.slice(0, 60)}` });
        continue;
      }
      const [, oldText, newText] = m as unknown as [string, string, string];
      const path = Object.keys(files)
        .sort((a, b) => (a === request.entry ? -1 : b === request.entry ? 1 : a.localeCompare(b)))
        .find((p) => { const f = files[p]!; return f.kind === 'text' && f.text.includes(oldText); });
      if (!path) {
        request.onEvent({ type: 'edit', ok: false, message: `"${oldText}" was not found in the deck` });
        continue;
      }
      const file = files[path]!;
      const text = file.kind === 'text' ? file.text : '';
      const at = text.indexOf(oldText);
      // Take enough context to make the match unique, the same rule real edits follow.
      let from = at, to = at + oldText.length;
      while (text.indexOf(text.slice(from, to), text.indexOf(text.slice(from, to)) + 1) >= 0 && (from > 0 || to < text.length)) {
        from = Math.max(0, from - 20);
        to = Math.min(text.length, to + 20);
      }
      const outcome = applyEdit(files, { op: 'replace', path, old: text.slice(from, to), new: text.slice(from, at) + newText + text.slice(at + oldText.length, to) });
      request.onEvent({ type: 'edit', ok: outcome.ok, message: outcome.message });
      if (outcome.ok) done.push(`Slide ${comment.slide || 'deck'}: replaced "${oldText}" with "${newText}" in ${path}.`);
    }
    await new Promise((r) => setTimeout(r, 300));
    return { files, summary: done.length ? done.join(' ') : 'Nothing was changed.' };
  },
};
