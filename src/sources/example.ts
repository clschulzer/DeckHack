import { applyEdit, cloneFiles } from '../core/edits';
import { findEntry } from '../core/bundle';
import type { Comment, DeckFiles } from '../core/types';
import { buildDeckFromBrief, EXAMPLE_BRIEF } from './wizard';

/**
 * The example deck: dummy data only, so the review loop can be tried without a deck or a key.
 * It is the wizard's output for the example brief with the remaining placeholders filled in,
 * one round that is already applied (so the version history has something to show) and four
 * open comments that demo mode can answer.
 */
const FILL: [string, string][] = [
  ['[TODO: what happens because of it]', 'Staff walk the ward and ask colleagues.'],
  ['[TODO: what changes for the person who uses it]', 'A tool that helps nurses with equipment.'],
  ['[TODO: screenshot, video or live prototype]', 'Live prototype: Anna asks for pump 12 and gets bed 7, ward 4B.'],
];

export interface ExampleComment { slide: number; text: string; demo: { old: string; new: string }[] }

/** The round that is already applied when the example opens (v1 -> v2). */
export const EXAMPLE_APPLIED: ExampleComment = {
  slide: 2,
  text: 'Third point is about staff. Say what it means for the patient, in three words.',
  demo: [{ old: 'Staff walk the ward and ask colleagues.', new: 'The patient waits.' }],
};

export const EXAMPLE_OPEN: ExampleComment[] = [
  {
    slide: 1,
    text: 'Our ward survey says 52 minutes, not 47. Use the real number.',
    demo: [{ old: '<em>47 minutes</em> a shift', new: '<em>52 minutes</em> a shift' }],
  },
  {
    slide: 3,
    text: 'The line under the headline is vague. Say what changes for the nurse.',
    demo: [{ old: 'A tool that helps nurses with equipment.', new: 'Anna asks her phone and walks straight to the nearest free pump.' }],
  },
  {
    slide: 5,
    text: 'Step 3: what is in the message? The jury will ask.',
    demo: [{ old: 'The nurse gets one push message.', new: 'One push message: device, room and bed.' }],
  },
  {
    slide: 7,
    text: 'Use the project address, not the placeholder.',
    demo: [{ old: 'team@example.org', new: 'hello@pumpfinder.example' }],
  },
];

function edit(files: DeckFiles, entry: string, old: string, next: string): void {
  const outcome = applyEdit(files, { op: 'replace', path: entry, old, new: next });
  if (!outcome.ok) throw new Error(`Example deck is out of date: ${outcome.message}`);
}

/** Files of v1 (as the wizard would create it) and v2 (after the first applied round). */
export function exampleDeck(template: DeckFiles): { name: string; v1: DeckFiles; v2: DeckFiles } {
  const v1 = cloneFiles(buildDeckFromBrief(template, EXAMPLE_BRIEF).files);
  const entry = findEntry(v1)!;
  for (const [old, next] of FILL) edit(v1, entry, old, next);
  const v2 = cloneFiles(v1);
  for (const e of EXAMPLE_APPLIED.demo) edit(v2, entry, e.old, e.new);
  return { name: `${EXAMPLE_BRIEF.project} (example)`, v1, v2 };
}

export function exampleComment(projectId: string, c: ExampleComment, titles: string[], at: number): Comment {
  return { id: crypto.randomUUID(), projectId, slide: c.slide, slideTitle: titles[c.slide - 1], text: c.text, status: 'open', createdAt: at, demo: c.demo };
}
