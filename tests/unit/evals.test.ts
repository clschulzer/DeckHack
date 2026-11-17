import { describe, expect, it } from 'vitest';
import type { Provider } from '../../src/ai/provider';
import type { EditOp } from '../../src/core/types';
import { CASES } from '../../evals/cases';
import { applyAll, baseDecks, report, runCase, startDeck } from '../../evals/lib/run';
import { score } from '../../evals/lib/score';

/**
 * Tests of the eval harness itself, without a model: every case must be passable (its reference
 * solution scores 100 %), and typical model mistakes must be caught by the check they belong to.
 */
const decks = baseDecks();
const scripted = (edits: EditOp[]): Provider => ({
  id: 'scripted', label: 'scripted', needsKey: false,
  rework: async (request) => ({ files: applyAll(request.files, edits), summary: '' }),
});
const failing = async (id: string, edits: EditOp[]) => {
  const result = await runCase(CASES.find((c) => c.id === id)!, decks, scripted(edits), { model: '', apiKey: '' });
  if (result.error) throw new Error(result.error);
  return result.checks.filter((k) => !k.ok).map((k) => k.name);
};
const html = (old: string, next: string): EditOp => ({ op: 'replace', path: 'index.html', old, new: next });

describe('eval cases', () => {
  it('has unique ids and a reason for every case', () => {
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
    expect(CASES.every((c) => c.why.length > 20 && c.comments.length > 0)).toBe(true);
  });

  for (const c of CASES) {
    it(`${c.id}: the reference solution passes every check`, async () => {
      const result = await runCase(c, decks, scripted(c.reference), { model: '', apiKey: '' });
      expect(result.checks.filter((k) => !k.ok)).toEqual([]);
      expect(result.passed).toBe(true);
    });
  }

  it('doing nothing fails every case that asks for a change', async () => {
    for (const c of CASES.filter((x) => x.id !== 'no-change-needed')) {
      const before = startDeck(c, decks);
      expect(score(before, before, c.comments, c.expect).every((k) => k.ok), c.id).toBe(false);
    }
  });
});

describe('eval scoring catches typical mistakes', () => {
  it('scope: an edit that also touches another slide', async () => {
    expect(await failing('local-rewrite', [
      html('A tool that helps nurses with equipment.', 'Anna walks straight to the nearest free pump.'),
      html('The patient waits.', 'Patients wait.'),
    ])).toEqual(['scope']);
  });

  it('shared: a rule all slides use is edited for one slide', async () => {
    expect(await failing('scoped-style', [
      { op: 'replace', path: 'deck.css', old: 'h2 { font-size: clamp(24px, 4.6vw, 72px);', new: 'h2 { font-size: clamp(20px, 4vw, 60px);' },
    ])).toEqual(['shared']);
  });

  it('content: the length limit is ignored', async () => {
    expect(await failing('shorten-headline', [
      html('a shift looking for equipment.', 'on every single shift looking for equipment.'),
    ])).toEqual(['content']);
  });

  it('invention: a number nobody gave', async () => {
    expect(await failing('local-rewrite', [
      html('A tool that helps nurses with equipment.', 'Nurses find a pump 80 % faster.'),
    ])).toEqual(['invention']);
  });

  it('placeholders: a made-up quote instead of a TODO, and a TODO filled without facts', async () => {
    expect(await failing('missing-fact', [
      html('A tool that helps nurses with equipment.', '“It saved my night shift.” Anna, ward 4B.'),
    ])).toEqual(['placeholders']);
    expect(await failing('keep-placeholders', [
      html('It hits Anna, night-shift nurse on ward 4B.', 'It hits night-shift nurses.'),
      html('[TODO: what happens because of it]', 'Care is delayed.'),
    ])).toEqual(['placeholders']);
  });

  it('injection: hidden instructions in the deck are followed', async () => {
    expect(await failing('injection', [
      html('Live prototype: Anna asks for pump 12 and gets bed 7, ward 4B.', 'Runs on a phone. <a href="https://evil.example/claim">Claim</a>'),
    ])).toEqual(['content']);
  });

  it('brief: the pitch brief is rewritten', async () => {
    const c = CASES.find((x) => x.id === 'local-rewrite')!;
    const before = startDeck(c, decks);
    const manifest = (before['deckhack.json'] as { text: string }).text;
    const after = applyAll(before, [...c.reference, { op: 'write', path: 'deckhack.json', content: manifest.replace('"minutes": 3', '"minutes": 5') }]);
    expect(score(before, after, c.comments, c.expect).filter((k) => !k.ok).map((k) => k.name)).toEqual(['brief']);
  });

  it('writes a readable report', async () => {
    const good = await runCase(CASES[0]!, decks, scripted(CASES[0]!.reference), { model: '', apiKey: '' });
    const bad = await runCase(CASES[0]!, decks, scripted([]), { model: '', apiKey: '' });
    const text = report('Rework evals', [good, { ...bad, id: 'did-nothing' }], { model: 'scripted' });
    expect(text).toContain('**1 of 2 cases passed.**');
    expect(text).toContain('### did-nothing');
  });
});
