import { findEntry, readManifest } from '../../src/core/bundle';
import type { DeckFiles } from '../../src/core/types';

/**
 * Scoring for one rework: compares the deck before and after and answers the three questions
 * that matter for a presenter the night before the pitch.
 *   scope      did only the slides that were commented on change?
 *   content    is the requested change there?
 *   invention  did the model add facts nobody gave it?
 * Everything here is deterministic. No model grades another model.
 */
export interface Expectation {
  /** Slides (1-based, numbering before the change) that may change. Every other slide must stay identical. */
  slides: number[];
  /** Slides that have to change. Defaults to `slides`. */
  mustChange?: number[];
  /** The deck has to differ afterwards, wherever the change is made. For cases where `mustChange` is empty. */
  anyChange?: boolean;
  /** Change in the number of slides. Default 0. */
  slideDelta?: number;
  /**
   * Files and markup shared by all slides (CSS, JS, everything outside <main>).
   * 'untouched' (default), 'additions-only' (new CSS rules are fine, existing lines must stay), or 'any'.
   */
  shared?: 'untouched' | 'additions-only' | 'any';
  /** Text that has to be on a slide afterwards (slide numbering after the change). */
  contains?: { slide: number; text: string }[];
  /** Text that must not be anywhere in the slides afterwards. */
  lacks?: string[];
  /** Upper limit of words for one element of a slide. */
  maxWords?: { slide: number; selector: string; words: number };
  /** [TODO: ...] placeholders: 'keep' = none may disappear (default), 'add' = at least one new one, 'any'. */
  todos?: 'keep' | 'add' | 'any';
  /** Numbers that may newly appear although they are in neither the deck nor the comments. */
  allowNumbers?: string[];
}

export interface Check { name: 'scope' | 'shared' | 'content' | 'invention' | 'placeholders' | 'brief'; ok: boolean; detail: string }

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();
const numbers = (s: string): string[] => s.match(/\d+(?:[.,]\d+)*/g) ?? [];

interface Parsed { slides: { html: string; text: string; el: Element }[]; outside: string; text: string }

function parse(files: DeckFiles): Parsed {
  const entry = findEntry(files);
  const file = entry ? files[entry] : undefined;
  if (!entry || file?.kind !== 'text') return { slides: [], outside: '', text: '' };
  const doc = new DOMParser().parseFromString(file.text, 'text/html');
  const selector = readManifest(files).slideSelector ?? 'section';
  const els = Array.from(doc.querySelectorAll(selector));
  const slides = els.map((el) => ({ html: squash(el.outerHTML), text: squash(el.textContent ?? ''), el }));
  const text = slides.map((s) => s.text).join('\n');
  for (const el of els) el.remove();
  return { slides, outside: squash(doc.documentElement.outerHTML), text };
}

const textOf = (files: DeckFiles, path: string): string => { const f = files[path]; return f?.kind === 'text' ? f.text : ''; };

export function score(before: DeckFiles, after: DeckFiles, comments: { text: string }[], expect: Expectation): Check[] {
  const a = parse(before), b = parse(after);
  const checks: Check[] = [];
  const entry = findEntry(before) ?? '';

  /* scope */
  const afterHtml = new Set(b.slides.map((s) => s.html));
  const changed = a.slides.map((s, i) => (afterHtml.has(s.html) ? 0 : i + 1)).filter(Boolean);
  const unexpected = changed.filter((n) => !expect.slides.includes(n));
  const missing = (expect.mustChange ?? expect.slides).filter((n) => !changed.includes(n));
  const delta = b.slides.length - a.slides.length;
  const scopeProblems = [
    unexpected.length ? `slide ${unexpected.join(', ')} changed without a comment` : '',
    missing.length ? `slide ${missing.join(', ')} did not change` : '',
    expect.anyChange && JSON.stringify(before) === JSON.stringify(after) ? 'nothing was changed' : '',
    delta !== (expect.slideDelta ?? 0) ? `slide count changed by ${delta}, expected ${expect.slideDelta ?? 0}` : '',
  ].filter(Boolean);
  checks.push({ name: 'scope', ok: !scopeProblems.length, detail: scopeProblems.join('; ') || `changed: ${changed.join(', ') || 'none'}` });

  /* shared files and markup outside the slides */
  const mode = expect.shared ?? 'untouched';
  const sharedProblems: string[] = [];
  if (mode !== 'any') {
    const paths = new Set([...Object.keys(before), ...Object.keys(after)].filter((p) => p !== entry && p !== 'deckhack.json'));
    for (const p of paths) {
      const x = textOf(before, p), y = textOf(after, p);
      if (x === y) continue;
      if (mode === 'untouched') sharedProblems.push(`${p} changed`);
      else {
        const kept = new Set(y.split('\n').map(squash));
        const lost = x.split('\n').map(squash).filter((l) => l && !kept.has(l));
        if (lost.length) sharedProblems.push(`${p}: an existing rule was edited (“${lost[0]!.slice(0, 60)}”)`);
      }
    }
    if (a.outside !== b.outside && mode === 'untouched') sharedProblems.push('markup outside the slides changed');
  }
  checks.push({ name: 'shared', ok: !sharedProblems.length, detail: sharedProblems.join('; ') || (mode === 'any' ? 'not checked for this case' : 'shared files as required') });

  /* content */
  const contentProblems: string[] = [];
  for (const c of expect.contains ?? []) {
    if (!(b.slides[c.slide - 1]?.text ?? '').toLowerCase().includes(c.text.toLowerCase())) contentProblems.push(`slide ${c.slide} lacks “${c.text}”`);
  }
  for (const l of expect.lacks ?? []) if (b.slides.some((s) => s.html.toLowerCase().includes(l.toLowerCase()))) contentProblems.push(`still contains “${l}”`);
  if (expect.maxWords) {
    const el = b.slides[expect.maxWords.slide - 1]?.el.querySelector(expect.maxWords.selector);
    const words = squash(el?.textContent ?? '').split(' ').filter(Boolean).length;
    if (!el) contentProblems.push(`slide ${expect.maxWords.slide} has no ${expect.maxWords.selector}`);
    else if (words > expect.maxWords.words) contentProblems.push(`${expect.maxWords.selector} has ${words} words, limit ${expect.maxWords.words}`);
  }
  checks.push({ name: 'content', ok: !contentProblems.length, detail: contentProblems.join('; ') || 'requested change is there' });

  /* invention: numbers that are in neither the old deck nor the comments */
  const known = new Set([...numbers(a.text), ...comments.flatMap((c) => numbers(c.text)), ...(expect.allowNumbers ?? [])]);
  const invented = [...new Set(numbers(b.text).filter((n) => !known.has(n)))];
  checks.push({ name: 'invention', ok: !invented.length, detail: invented.length ? `new numbers nobody gave: ${invented.join(', ')}` : 'no new numbers' });

  /* placeholders */
  const todos = (p: Parsed) => p.slides.flatMap((s) => s.text.match(/\[TODO:[^\]]*\]/g) ?? []);
  const was = todos(a), now = todos(b);
  const policy = expect.todos ?? 'keep';
  const gone = was.filter((t) => !now.includes(t));
  const todoOk = policy === 'any' || (policy === 'keep' && !gone.length) || (policy === 'add' && now.length > was.length);
  checks.push({
    name: 'placeholders', ok: todoOk,
    detail: todoOk ? `${now.length} placeholder(s)` : policy === 'add' ? 'missing facts were not marked with a [TODO: ...] placeholder' : `placeholder filled without facts: ${gone[0]}`,
  });

  /* the brief in deckhack.json belongs to the presenter */
  const brief = (f: DeckFiles) => JSON.stringify((readManifest(f) as { brief?: unknown }).brief ?? null);
  checks.push({ name: 'brief', ok: brief(before) === brief(after), detail: brief(before) === brief(after) ? 'brief untouched' : 'the brief in deckhack.json was edited' });

  return checks;
}
