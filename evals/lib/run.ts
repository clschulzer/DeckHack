import { applyEdit, cloneFiles } from '../../src/core/edits';
import type { Provider } from '../../src/ai/provider';
import type { Comment, DeckFiles, EditOp } from '../../src/core/types';
import { exampleDeck } from '../../src/sources/example';
import { listTemplates } from '../../src/sources/templates';
import { buildDeckFromBrief, EXAMPLE_BRIEF } from '../../src/sources/wizard';
import type { Decks, EvalCase } from '../cases';
import { score, type Check } from './score';

export interface CaseResult { id: string; why: string; checks: Check[]; passed: boolean; error?: string; summary?: string }

export function baseDecks(): Decks {
  const template = listTemplates().find((t) => t.id === 'three-minute-pitch');
  if (!template) throw new Error('The three-minute-pitch template is missing.');
  return { example: exampleDeck(template.files).v2, draft: buildDeckFromBrief(template.files, EXAMPLE_BRIEF).files };
}

export function startDeck(c: EvalCase, decks: Decks): DeckFiles {
  const files = cloneFiles(decks[c.base]);
  for (const [old, next] of c.prepare ?? []) {
    const outcome = applyEdit(files, { op: 'replace', path: 'index.html', old, new: next });
    if (!outcome.ok) throw new Error(`${c.id}: prepare failed: ${outcome.message}`);
  }
  return files;
}

export function applyAll(files: DeckFiles, edits: EditOp[]): DeckFiles {
  const out = cloneFiles(files);
  for (const e of edits) {
    const outcome = applyEdit(out, e);
    if (!outcome.ok) throw new Error(outcome.message);
  }
  return out;
}

const asComments = (c: EvalCase): Comment[] => c.comments.map((x, i) => ({
  id: `${c.id}-${i}`, projectId: 'eval', slide: x.slide, text: x.text, target: x.target, status: 'open', createdAt: i,
}));

/** Runs one case through a provider exactly as the app does, minus the browser preview. */
export async function runCase(c: EvalCase, decks: Decks, provider: Provider, opts: { model: string; apiKey: string }): Promise<CaseResult> {
  const before = startDeck(c, decks);
  try {
    const result = await provider.rework({ files: before, entry: 'index.html', comments: asComments(c), model: opts.model, apiKey: opts.apiKey, onEvent: () => {} });
    const checks = score(before, result.files, c.comments, c.expect);
    return { id: c.id, why: c.why, checks, passed: checks.every((k) => k.ok), summary: result.summary };
  } catch (e) {
    return { id: c.id, why: c.why, checks: [], passed: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function report(title: string, results: CaseResult[], meta: Record<string, string>): string {
  const names = ['scope', 'shared', 'content', 'invention', 'placeholders', 'brief'] as const;
  const passed = results.filter((r) => r.passed).length;
  const lines = [
    `# ${title}`, '',
    ...Object.entries(meta).map(([k, v]) => `- ${k}: ${v}`), '',
    `**${passed} of ${results.length} cases passed.**`, '',
    `| Case | ${names.join(' | ')} | Result |`, `| --- | ${names.map(() => '---').join(' | ')} | --- |`,
    ...results.map((r) => `| ${r.id} | ${names.map((n) => { const k = r.checks.find((x) => x.name === n); return k ? (k.ok ? 'ok' : 'FAIL') : '–'; }).join(' | ')} | ${r.error ? 'error' : r.passed ? 'pass' : 'fail'} |`),
    '',
  ];
  const failures = results.filter((r) => !r.passed);
  if (failures.length) {
    lines.push('## What failed', '');
    for (const r of failures) {
      lines.push(`### ${r.id}`, '', r.why, '');
      if (r.error) lines.push(`- error: ${r.error}`);
      for (const k of r.checks.filter((x) => !x.ok)) lines.push(`- ${k.name}: ${k.detail}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}
