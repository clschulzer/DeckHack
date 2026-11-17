import { describe, expect, it } from 'vitest';
import { demoProvider } from '../../src/ai/demo';
import { findEntry } from '../../src/core/bundle';
import type { Comment, DeckFiles } from '../../src/core/types';
import { EXAMPLE_OPEN, exampleComment, exampleDeck } from '../../src/sources/example';
import { buildDeckFromBrief, EMPTY_BRIEF, EXAMPLE_BRIEF, LENGTHS, planBeats, STORYLINES } from '../../src/sources/wizard';

const template: DeckFiles = {
  'index.html': { kind: 'text', text: '<!doctype html><html><head><title>T</title></head><body><main class="deck">\n<section class="slide">old</section>\n</main><footer>keep</footer></body></html>' },
  'deckhack.json': { kind: 'text', text: '{"entry":"index.html","slideSelector":"section.slide"}' },
};
const html = (files: DeckFiles): string => { const f = files[findEntry(files)!]!; return f.kind === 'text' ? f.text : ''; };
const slides = (text: string): number => (text.match(/<section class="slide/g) ?? []).length;

describe('wizard', () => {
  it('plans as many slides as the length allows, hook first and ask last, for every storyline', () => {
    for (const line of STORYLINES) for (const length of LENGTHS) {
      const beats = planBeats({ minutes: length.minutes, criteria: [], storyline: line.id });
      expect(beats).toHaveLength(length.slides);
      expect(beats[0]).toBe('hook');
      expect(beats.at(-1)).toBe('ask');
    }
  });

  it('gives a ticked jury criterion its slide even in a short pitch', () => {
    expect(planBeats({ minutes: 1, criteria: [], storyline: 'classic' })).not.toContain('business');
    expect(planBeats({ minutes: 1, criteria: ['business'], storyline: 'classic' })).toContain('business');
  });

  it('fills only <main>, keeps the rest of the template and stores the brief in the manifest', () => {
    const { files, beats } = buildDeckFromBrief(template, EXAMPLE_BRIEF);
    const text = html(files);
    expect(slides(text)).toBe(beats.length);
    expect(text).toContain('<footer>keep</footer>');
    expect(text).not.toContain('>old<');
    expect(text).toContain('<title>PumpFinder</title>');
    expect(text).toContain('Nurses lose <em>47 minutes</em> a shift');
    const manifest = JSON.parse((files['deckhack.json'] as { text: string }).text) as { slideSelector: string; brief: { minutes: number; juryCriteria: string[] } };
    expect(manifest.slideSelector).toBe('section.slide');
    expect(manifest.brief).toMatchObject({ minutes: 3, juryCriteria: ['Problem relevance', 'Technical feasibility', 'Working demo'] });
  });

  it('marks missing facts as TODO and escapes what the user typed', () => {
    const text = html(buildDeckFromBrief(template, { ...EMPTY_BRIEF, project: '<b>X</b> & co' }).files);
    expect(text).toContain('[TODO: the problem in one sentence]');
    expect(text).toContain('&lt;b&gt;X&lt;/b&gt; &amp; co');
    expect(text).not.toContain('<b>X</b>');
  });
});

describe('example deck', () => {
  it('has a first round applied and prepared answers that demo mode can perform', async () => {
    const deck = exampleDeck(template);
    expect(html(deck.v1)).not.toContain('The patient waits.');
    expect(html(deck.v2)).toContain('The patient waits.');
    expect(html(deck.v2)).not.toContain('[TODO');

    const comments: Comment[] = EXAMPLE_OPEN.map((c, i) => exampleComment('p', c, [], i));
    const events: boolean[] = [];
    const result = await demoProvider.rework({
      files: deck.v2, entry: 'index.html', comments, model: '', apiKey: '',
      onEvent: (e) => { if (e.type === 'edit') events.push(e.ok); },
    });
    expect(events).toEqual([true, true, true, true]);
    const after = html(result.files);
    expect(after).toContain('<em>52 minutes</em> a shift');
    expect(after).toContain('hello@pumpfinder.example');
    expect(result.summary).toContain('Demo mode made no AI call.');
  });
});
