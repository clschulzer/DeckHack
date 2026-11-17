import type { DeckFiles } from '../core/types';
import { findEntry, readManifest } from '../core/bundle';

/**
 * The start wizard: a few questions about the pitch (length, jury criteria, storyline, content)
 * become a first deck. Everything here is deterministic and runs without AI. Facts the presenter
 * did not give are left as visible [TODO: ...] placeholders instead of being invented.
 */
export type Beat =
  | 'hook' | 'problem' | 'customer' | 'solution' | 'demo' | 'how'
  | 'different' | 'impact' | 'business' | 'team' | 'next' | 'ask';

export const LENGTHS = [
  { minutes: 1, slides: 4, label: '1 minute', hint: 'Elevator pitch. One idea, one ask.' },
  { minutes: 3, slides: 7, label: '3 minutes', hint: 'The usual hackathon final.' },
  { minutes: 5, slides: 9, label: '5 minutes', hint: 'Room for proof and what makes you different.' },
  { minutes: 10, slides: 12, label: '10 minutes', hint: 'Demo day. The full story with business case.' },
] as const;

export const CRITERIA: { id: string; label: string; hint: string; beat: Beat }[] = [
  { id: 'problem', label: 'Problem relevance', hint: 'Is the problem real and worth solving?', beat: 'problem' },
  { id: 'innovation', label: 'Innovation', hint: 'What is new compared with what exists?', beat: 'different' },
  { id: 'feasibility', label: 'Technical feasibility', hint: 'Does the approach hold up?', beat: 'how' },
  { id: 'demo', label: 'Working demo', hint: 'Does something run today?', beat: 'demo' },
  { id: 'impact', label: 'Impact', hint: 'How much changes, for how many?', beat: 'impact' },
  { id: 'business', label: 'Business viability', hint: 'Who pays, and why?', beat: 'business' },
  { id: 'team', label: 'Team', hint: 'Why are you the ones to build it?', beat: 'team' },
];

export interface Storyline {
  id: string;
  name: string;
  description: string;
  /** All twelve beats in the order they are told. */
  order: Beat[];
  /** The same beats, most important first. Short pitches keep the front of this list. */
  priority: Beat[];
}

export const STORYLINES: Storyline[] = [
  {
    id: 'classic', name: 'Problem first',
    description: 'Open with the pain, then show how you remove it. Safe and clear for any jury.',
    order: ['hook', 'problem', 'customer', 'solution', 'demo', 'how', 'different', 'impact', 'business', 'team', 'next', 'ask'],
    priority: ['hook', 'ask', 'problem', 'solution', 'demo', 'how', 'team', 'impact', 'different', 'business', 'customer', 'next'],
  },
  {
    id: 'demo', name: 'Demo first',
    description: 'Show it working in the first thirty seconds, explain afterwards. Best when the prototype is your strongest card.',
    order: ['hook', 'demo', 'problem', 'solution', 'how', 'impact', 'different', 'customer', 'business', 'team', 'next', 'ask'],
    priority: ['hook', 'ask', 'demo', 'problem', 'how', 'impact', 'team', 'solution', 'different', 'business', 'customer', 'next'],
  },
  {
    id: 'story', name: 'One person’s story',
    description: 'Follow one real user through their day. Best when the jury does not know the field.',
    order: ['hook', 'customer', 'problem', 'solution', 'demo', 'impact', 'how', 'different', 'business', 'team', 'next', 'ask'],
    priority: ['hook', 'ask', 'customer', 'solution', 'demo', 'problem', 'impact', 'team', 'how', 'different', 'business', 'next'],
  },
  {
    id: 'number', name: 'Number first',
    description: 'Lead with the one figure that makes people sit up. Best when you have data you can defend.',
    order: ['hook', 'impact', 'problem', 'solution', 'demo', 'how', 'different', 'business', 'customer', 'team', 'next', 'ask'],
    priority: ['hook', 'ask', 'impact', 'solution', 'demo', 'problem', 'how', 'team', 'business', 'different', 'next', 'customer'],
  },
];

export const BEAT_TITLES: Record<Beat, string> = {
  hook: 'Hook', problem: 'Problem', customer: 'Who it is for', solution: 'Solution', demo: 'Demo', how: 'How it works',
  different: 'What is new', impact: 'Impact', business: 'Business', team: 'Team', next: 'Next steps', ask: 'Ask',
};

export interface Brief {
  minutes: number;
  criteria: string[];
  /** Free text: criteria pasted from the event page. */
  criteriaNotes: string;
  storyline: string;
  project: string;
  team: string;
  event: string;
  persona: string;
  problem: string;
  cause: string;
  number: string;
  solution: string;
  /** One step per line, "Label: text". */
  how: string;
  /** One person per line, "Name, role". */
  members: string;
  ask: string;
  contact: string;
}

export const EMPTY_BRIEF: Brief = {
  minutes: 3, criteria: ['problem', 'demo', 'feasibility'], criteriaNotes: '', storyline: 'classic',
  project: '', team: '', event: '', persona: '', problem: '', cause: '', number: '', solution: '', how: '', members: '', ask: '', contact: '',
};

/** Dummy data, so the wizard and the example deck can be tried without typing. */
export const EXAMPLE_BRIEF: Brief = {
  minutes: 3, criteria: ['problem', 'demo', 'feasibility'], criteriaNotes: '', storyline: 'classic',
  project: 'PumpFinder',
  team: 'Team Aloha',
  event: 'HealthHack 2026 · Challenge 04',
  persona: 'Anna, night-shift nurse on ward 4B',
  problem: 'Nurses lose 47 minutes a shift looking for equipment.',
  cause: 'Nobody knows where the infusion pump is.',
  number: '47 minutes',
  solution: 'Ask the ward. It answers in two seconds.',
  how: 'Sense: Tags report a position every 30 seconds.\nDecide: A planner ranks the nearest free device.\nAct: The nurse gets one push message.',
  members: 'Name One, Clinical lead\nName Two, Engineering\nName Three, Design',
  ask: 'One ward. Four weeks. Let us prove it.',
  contact: 'team@example.org',
};

/**
 * Which beats a pitch of this length tells, in storyline order. Hook, solution and ask
 * always stay, then the slides for ticked jury criteria, then the rest by importance.
 */
export function planBeats(brief: Pick<Brief, 'minutes' | 'criteria' | 'storyline'>): Beat[] {
  const line = STORYLINES.find((s) => s.id === brief.storyline) ?? STORYLINES[0]!;
  const length = LENGTHS.find((l) => l.minutes === brief.minutes) ?? LENGTHS[1];
  const wanted = new Set(CRITERIA.filter((c) => brief.criteria.includes(c.id)).map((c) => c.beat));
  const fixed: Beat[] = ['hook', 'solution', 'ask'];
  const score = (b: Beat) => line.priority.indexOf(b) - (fixed.includes(b) ? 100 : wanted.has(b) ? 50 : 0);
  const keep = new Set([...line.priority].sort((a, b) => score(a) - score(b)).slice(0, length.slides));
  return line.order.filter((b) => keep.has(b));
}

export const secondsPerSlide = (minutes: number, slides: number): number => Math.round((minutes * 60) / slides / 5) * 5;

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const todo = (what: string): string => `[TODO: ${what}]`;
const or = (value: string, what: string): string => esc(value.trim() || todo(what));
const lines = (text: string): string[] => text.split('\n').map((l) => l.trim()).filter(Boolean);

/** Escaped text with the key number highlighted once. */
function withNumber(text: string, number: string): string {
  const n = number.trim();
  const safe = esc(text);
  if (!n) return safe;
  const at = safe.indexOf(esc(n));
  return at < 0 ? safe : `${safe.slice(0, at)}<em>${esc(n)}</em>${safe.slice(at + esc(n).length)}`;
}

function slide(beat: Beat, brief: Brief): string {
  const project = or(brief.project, 'project name');
  const persona = or(brief.persona, 'who has the problem');
  const open = (extra = '') => `  <section class="slide${extra}" data-title="${BEAT_TITLES[beat]}">`;
  const eyebrow = (text: string) => `    <p class="eyebrow tag">${text}</p>`;
  const body: string[] = [];
  switch (beat) {
    case 'hook': {
      const head = {
        classic: withNumber(brief.problem.trim() || todo('the problem in one sentence'), brief.number),
        demo: `${project}: ${or(brief.solution, 'what it does in one sentence')}`,
        story: `Meet ${persona}.`,
        number: brief.number.trim() ? `<em>${esc(brief.number.trim())}</em>.` : esc(todo('the one number that matters')),
      }[brief.storyline] ?? esc(brief.problem);
      const lede = brief.storyline === 'classic' || brief.storyline === 'demo'
        ? `${project} by ${or(brief.team, 'team name')}.`
        : or(brief.problem, 'the problem in one sentence');
      body.push(eyebrow([brief.team, brief.event].map((s) => s.trim()).filter(Boolean).map(esc).join(' · ') || esc(todo('team and event'))));
      body.push(`    <h1>${head}</h1>`, `    <p class="lede">${lede}</p>`);
      break;
    }
    case 'problem':
      body.push(eyebrow('The problem'), `    <h2>${or(brief.cause || brief.problem, 'why the problem exists')}</h2>`, '    <ul class="points">',
        `      <li>${brief.number.trim() ? `<b>${esc(brief.number.trim())}</b> is what it costs today.` : esc(todo('one number you can defend'))}</li>`,
        `      <li>It hits ${persona}.</li>`,
        `      <li>${esc(todo('what happens because of it'))}</li>`, '    </ul>');
      break;
    case 'customer':
      body.push(eyebrow('Who we built it for'), `    <h2>Meet ${persona}.</h2>`, `    <p class="lede">${esc(todo('one moment in their day where the problem hits'))}</p>`);
      break;
    case 'solution':
      body.push(eyebrow('Our solution'), `    <h2>${or(brief.solution, 'what you built in one sentence')}</h2>`,
        `    <p class="lede">${esc(todo('what changes for the person who uses it'))}</p>`);
      break;
    case 'demo':
      body.push(eyebrow('Demo'), `    <h2>Watch ${project} work.</h2>`, '    <div class="screen">', '      <div class="bar"><i></i><i></i><i></i></div>',
        `      <p>${esc(todo('screenshot, video or live prototype'))}</p>`, '    </div>');
      break;
    case 'how': {
      const steps = lines(brief.how);
      body.push(eyebrow('How it works'), `    <h2>${steps.length ? `${steps.length} part${steps.length > 1 ? 's' : ''}, start to finish.` : esc(todo('how it works in one sentence'))}</h2>`, '    <ol class="steps">');
      for (const s of steps.length ? steps : [todo('step one'), todo('step two'), todo('step three')]) {
        const cut = s.indexOf(':');
        body.push(cut > 0 && !s.startsWith('[') ? `      <li><b>${esc(s.slice(0, cut).trim())}</b><span>${esc(s.slice(cut + 1).trim())}</span></li>` : `      <li><span>${esc(s)}</span></li>`);
      }
      body.push('    </ol>');
      break;
    }
    case 'different':
      body.push(eyebrow('Why this is new'), `    <h2>${esc(todo('what people use today, and what only you do'))}</h2>`);
      break;
    case 'impact':
      body.push(eyebrow('Impact'), `    <h2>${brief.number.trim() ? `<em>${esc(brief.number.trim())}</em> today.` : esc(todo('the number today'))} ${esc(todo(`the number with ${brief.project.trim() || 'your solution'}`))}</h2>`,
        `    <p class="lede">${esc(todo('how you measured it'))}</p>`);
      break;
    case 'business':
      body.push(eyebrow('Who pays'), `    <h2>${esc(todo('who pays, how much, and why it is worth it to them'))}</h2>`);
      break;
    case 'team': {
      const people = lines(brief.members);
      body.push(eyebrow('Why us'), `    <h2>${or(brief.team, 'team name')}</h2>`, '    <div class="team">');
      for (const p of people.length ? people : [todo('name, role')]) {
        const cut = p.indexOf(',');
        body.push(cut > 0 && !p.startsWith('[') ? `      <div><b>${esc(p.slice(0, cut).trim())}</b><span>${esc(p.slice(cut + 1).trim())}</span></div>` : `      <div><b>${esc(p)}</b></div>`);
      }
      body.push('    </div>');
      break;
    }
    case 'next':
      body.push(eyebrow('Next steps'), `    <h2>${esc(todo('what you do in the next four weeks'))}</h2>`);
      break;
    case 'ask':
      body.push(eyebrow('What we need'), `    <h2>${or(brief.ask, 'what you ask the jury for')}</h2>`, `    <p class="lede">${or(brief.contact, 'contact')}</p>`);
      break;
  }
  return [open(beat === 'hook' || beat === 'demo' || beat === 'ask' ? ` ${beat}` : ''), ...body, '  </section>'].join('\n');
}

/**
 * Fills a template with slides planned from the brief. The template keeps its own look: only the
 * content of its <main> element is replaced, so any template with a <main> works. The brief is
 * stored in deckhack.json, where later AI rounds can read the pitch length and the jury criteria.
 */
export function buildDeckFromBrief(template: DeckFiles, brief: Brief): { files: DeckFiles; beats: Beat[] } {
  const entry = findEntry(template);
  const file = entry ? template[entry] : undefined;
  if (!entry || file?.kind !== 'text') throw new Error('This template has no HTML file.');
  const start = file.text.search(/<main\b[^>]*>/i);
  const end = file.text.toLowerCase().lastIndexOf('</main>');
  if (start < 0 || end < 0) throw new Error('This template has no <main> element, so the wizard cannot fill it.');
  const openTag = /<main\b[^>]*>/i.exec(file.text)![0];
  const beats = planBeats(brief);
  let html = `${file.text.slice(0, start)}${openTag}\n\n${beats.map((b) => slide(b, brief)).join('\n\n')}\n\n${file.text.slice(end)}`;
  if (brief.project.trim()) html = html.replace(/<title>[^<]*<\/title>/i, `<title>${esc(brief.project.trim())}</title>`);

  const length = LENGTHS.find((l) => l.minutes === brief.minutes) ?? LENGTHS[1];
  const manifest = {
    ...readManifest(template),
    name: brief.project.trim() || 'Pitch deck',
    description: `${length.label} pitch, ${beats.length} slides`,
    author: brief.team.trim(),
    brief: {
      minutes: brief.minutes,
      secondsPerSlide: secondsPerSlide(brief.minutes, beats.length),
      storyline: (STORYLINES.find((s) => s.id === brief.storyline) ?? STORYLINES[0]!).name,
      juryCriteria: CRITERIA.filter((c) => brief.criteria.includes(c.id)).map((c) => c.label),
      juryNotes: brief.criteriaNotes.trim(),
    },
  };
  return {
    files: { ...template, [entry]: { kind: 'text', text: html }, 'deckhack.json': { kind: 'text', text: JSON.stringify(manifest, null, 2) + '\n' } },
    beats,
  };
}

/** The whole-deck comment that asks the AI for a first draft. Only used when a real provider is set up. */
export function firstDraftComment(brief: Brief): string {
  const criteria = CRITERIA.filter((c) => brief.criteria.includes(c.id)).map((c) => c.label.toLowerCase());
  return `First draft: this deck was laid out by the start wizard for a ${brief.minutes}-minute pitch`
    + (criteria.length ? `, judged on ${criteria.join(', ')}` : '')
    + '. Tighten the wording on every slide so it can be said in the time available, and make each jury criterion easy to tick off.'
    + ' Keep every [TODO: ...] placeholder whose facts you do not have.'
    + (brief.criteriaNotes.trim() ? ` Criteria from the organisers: ${brief.criteriaNotes.trim()}` : '');
}
