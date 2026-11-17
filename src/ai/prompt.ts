import type { ReworkRequest } from './provider';

export const SYSTEM_PROMPT = `You edit HTML presentation decks inside DeckHack, a review tool for hackathon pitch decks.

A deck is a folder of plain HTML, CSS and JavaScript. A presenter has clicked through the deck slide by slide and left comments. They are usually short on time and rehearsing soon, so they need exactly the changes they asked for and nothing else. After your edits the tool reloads the deck, walks every slide and reports which slides changed, so unrequested changes to other slides show up as a warning to the presenter.

How to work:
- Make the changes by calling the edit tools. Use replace_in_file for targeted changes: copy the old text exactly from the file and include enough of it to be unique. Use write_file only for a new file or when most of a file changes.
- A comment on one slide should leave every other slide looking and reading the same. When a slide needs a style change, scope it to that slide (its own class, id or selector) instead of changing a rule other slides share.
- Keep the deck's structure, navigation and visual language. Do not add libraries, CDNs or build steps unless a comment asks for one.
- Some decks build their slides in JavaScript instead of one HTML element per slide. Find the slide by its number and title in that code and edit it there.
- Do not invent facts, numbers or names. When a comment needs information you do not have, put a clearly marked placeholder such as [TODO: customer quote] and mention it in your summary.
- A comment on the whole deck applies to every slide it concerns.
- When deckhack.json has a "brief", it states the pitch length, the seconds available per slide, the storyline and the jury criteria. Keep the amount of text on a slide sayable in that time, and do not edit the brief itself.

When you are done, answer with a short summary of what you changed, slide by slide, in the language the comments are written in. Plain sentences, no headings.`;

/** Deck contents. Stable across requests for the same version, so it is sent as a cacheable block. */
export function deckContext(request: ReworkRequest): string {
  const { files, entry, probe } = request;
  const parts: string[] = [];
  const slides = probe
    ? probe.titles.map((t, i) => `  ${i + 1}. ${t || '(no heading found)'}`).join('\n')
    : '  (not detected)';
  parts.push(`<deck entry="${entry}" slide_count="${probe?.count ?? 'unknown'}" slide_detection="${probe?.adapter ?? 'unknown'}">`);
  parts.push(`<slides>\n${slides}\n</slides>`);
  const assets = Object.keys(files).filter((p) => files[p]!.kind !== 'text').sort();
  if (assets.length) parts.push(`<assets note="binary files, referenced by path, not editable">\n${assets.join('\n')}\n</assets>`);
  for (const path of Object.keys(files).sort((a, b) => (a === entry ? -1 : b === entry ? 1 : a.localeCompare(b)))) {
    const file = files[path]!;
    if (file.kind === 'text') parts.push(`<file path="${path}">\n${file.text}\n</file>`);
  }
  parts.push('</deck>');
  return parts.join('\n');
}

export function taskText(request: ReworkRequest): string {
  const lines = request.comments.map((c) =>
    c.slide === 0
      ? `- Whole deck: ${c.text}`
      : `- Slide ${c.slide}${c.slideTitle ? ` ("${c.slideTitle}")` : ''}: ${c.text}`,
  );
  let text = `Apply these review comments to the deck:\n\n${lines.join('\n')}`;
  if (request.repair?.length) {
    text += `\n\nAn earlier attempt at these comments was applied to the files above, and the deck now reports these new errors when it loads. Fix them while keeping the requested changes:\n\n${request.repair.map((e) => `- ${e}`).join('\n')}`;
  }
  return text;
}
