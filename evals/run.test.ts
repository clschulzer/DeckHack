import { describe, expect, it } from 'vitest';
import { claudeProvider } from '../src/ai/claude';
import { CASES } from './cases';
import { baseDecks, report, runCase, type CaseResult } from './lib/run';

/**
 * Live evals: every case goes through the real Claude provider, with the same prompt, tools and
 * edit rules as the app. Needs ANTHROPIC_API_KEY and costs money (roughly the deck text once per
 * case and run). Without a key the suite is skipped; `npm test` covers the scoring itself.
 *
 *   ANTHROPIC_API_KEY=... npm run eval
 *   EVAL_MODEL=claude-sonnet-5-5 EVAL_RUNS=3 EVAL_CASES=injection,add-slide npm run eval
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const apiKey = env.ANTHROPIC_API_KEY ?? '';
const model = env.EVAL_MODEL ?? 'claude-opus-5-5';
const runs = Math.max(1, Number(env.EVAL_RUNS ?? 1));
const only = (env.EVAL_CASES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const cases = CASES.filter((c) => !only.length || only.includes(c.id));

describe.skipIf(!apiKey)(`rework evals with ${model}`, () => {
  it('runs every case and writes the report', async () => {
    const decks = baseDecks();
    const results: CaseResult[] = [];
    for (let run = 1; run <= runs; run++) {
      for (const c of cases) {
        const r = await runCase(c, decks, claudeProvider, { model, apiKey });
        results.push(runs > 1 ? { ...r, id: `${r.id} #${run}` } : r);
        console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${c.id}${r.error ? `  (${r.error})` : r.checks.filter((k) => !k.ok).map((k) => `  ${k.name}: ${k.detail}`).join('')}`);
      }
    }
    const date = new Date().toISOString().slice(0, 10);
    const text = report('Rework evals', results, { model, date, 'runs per case': String(runs), cases: String(cases.length) });
    // Node's file system, loaded this way so the app's browser-only type setup stays as it is.
    const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as { mkdirSync(p: URL, o: object): void; writeFileSync(p: URL, d: string): void };
    const dir = new URL('./results/', import.meta.url);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(new URL(`${date}-${model}.md`, dir), text);
    fs.writeFileSync(new URL('latest.md', dir), text);
    console.log(`\n${results.filter((r) => r.passed).length} of ${results.length} passed. Report: evals/results/latest.md`);
    // The run itself succeeds when it completes; the pass rate is the result, read from the report.
    expect(results.length).toBe(cases.length * runs);
  }, 30 * 60 * 1000);
});
