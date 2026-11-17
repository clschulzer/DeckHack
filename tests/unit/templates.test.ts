import { describe, expect, it } from 'vitest';
import { findEntry, readManifest } from '../../src/core/bundle';
import { listTemplates } from '../../src/sources/templates';
import { buildDeckFromBrief, EXAMPLE_BRIEF, LENGTHS } from '../../src/sources/wizard';

/** Every folder under templates/ has to keep the contract in templates/README.md. */
describe('templates', () => {
  const templates = listTemplates();

  it('finds the bundled templates', () => {
    expect(templates.map((t) => t.id)).toEqual(expect.arrayContaining(['three-minute-pitch', 'plain-light']));
  });

  for (const t of templates) {
    describe(t.id, () => {
      const manifest = readManifest(t.files) as { name?: string; description?: string; author?: string; entry?: string; slideSelector?: string };
      const entry = findEntry(t.files)!;
      const html = (t.files[entry] as { text: string }).text;

      it('has a complete deckhack.json', () => {
        expect(t.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(manifest.name).toBeTruthy();
        expect(manifest.description).toBeTruthy();
        expect(manifest.author).toBeTruthy();
        expect(manifest.entry && t.files[manifest.entry]).toBeTruthy();
        expect(manifest.slideSelector).toBeTruthy();
      });

      it('keeps its slides in one <main> and finds at least two with its selector', () => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        expect(doc.querySelectorAll('main')).toHaveLength(1);
        const slides = Array.from(doc.querySelectorAll(manifest.slideSelector!));
        expect(slides.length).toBeGreaterThanOrEqual(2);
        expect(slides.every((s) => s.parentElement?.tagName === 'MAIN')).toBe(true);
      });

      it('makes no external requests', () => {
        for (const [path, file] of Object.entries(t.files)) {
          if (file.kind !== 'text') continue;
          const refs = file.text.match(/(?:src|href)\s*=\s*["']?(?:https?:)?\/\/[^"'\s>]+|url\(\s*["']?(?:https?:)?\/\/[^)]+|@import[^;]+/gi) ?? [];
          expect(refs, `${path} references another server`).toEqual([]);
        }
      });

      it('can be filled by the start wizard at every pitch length', () => {
        for (const length of LENGTHS) {
          const { files } = buildDeckFromBrief(t.files, { ...EXAMPLE_BRIEF, minutes: length.minutes });
          const doc = new DOMParser().parseFromString((files[entry] as { text: string }).text, 'text/html');
          expect(doc.querySelectorAll(manifest.slideSelector!)).toHaveLength(length.slides);
        }
      });
    });
  }
});
