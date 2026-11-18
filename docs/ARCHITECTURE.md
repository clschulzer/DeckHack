# DeckHack: architecture and design

As of 17 Nov 2026. Design document; the reasoning behind the main choices, the roadmap and known risks.

## Summary

DeckHack is a static web app without a backend of its own. It shows an HTML deck slide by slide, collects comments right on the slide, lets an AI work the changes in as targeted file edits and keeps every state as a version. The deck stays a normal folder of HTML, CSS and JS in your GitHub repository and keeps running without DeckHack.

Five decisions carry the design:

| Decision | Chosen | Why |
| --- | --- | --- |
| Operation | Static app in the browser, no server, started locally (`npx github:clschulzer/DeckHack`, `docker compose up` or `npm start`) | Nobody hosts the app for others, so no operator ever sees keys or decks. GitHub Pages only shows the landing page, the app does not run there |
| Deck format | Any HTML folder, slides detected by adapters | The hackathon deck DeckHack was built for creates its scenes in JavaScript, not as `<section>` elements. A fixed format would have excluded exactly the real deck |
| Preview | Sandboxed iframe without access to the app | Deck code from links and from the AI is untrusted and must never be able to read the API key |
| AI change | Edits through tool calls instead of whole files, followed by an automatic check | Fast and cheap with 40 KB scripts, and the app can show which slides really changed |
| Versions | Local snapshots for every step, a GitHub commit on save | Going back costs nothing, the repository stays the source of truth and the backup |

**The goal behind the goal.** A team should get twenty small fixes done in minutes on the last night before the pitch, instead of in one long chat monologue, without breaking another slide along the way. As an activity: click through, note it on the spot, apply once, check, move on. Ambitious target: from comment to a checked new version of a slide in under 60 seconds, and after every AI change the app states, with evidence, "only slide 8 changed". The foundation is checked by an automated browser run against the real hackathon deck.

## Landscape: what already exists

The idea of pinning comments to a slide and applying them in a batch already exists, but only for people with a local developer setup and in a deck format of its own. The gap is a tool that works in the browser, without installing anything into the deck, on any HTML deck that already exists.

| Project | What it is | What is missing for this workflow |
| --- | --- | --- |
| [frontend-slides](https://open-design.ai/blog/frontend-slides/) | Skill for coding agents that generates HTML decks. MIT, around 25,000 stars according to the article | No editor and no viewer. Changes still go through the chat, which is exactly the monologue DeckHack wants to get rid of |
| [open-slide](https://notes.nicolasdeville.com/github/open-slide/) | Slide framework for agents with an inspector, comments pinned to elements and `/apply-comments`. MIT, 7,717 stars at the 2.0 release | Needs a local dev server, Node and a coding agent. Slides are React components, an existing HTML deck cannot simply be opened |
| [oh-my-ppt](https://dev.to/arcsin1/oh-my-ppt-local-first-ai-slide-deck-generator-editor-30ei) | Local AI generator and editor for HTML slides with per-page AI edits and rollback | Runs on your own machine and produces decks in its own format, no connection to git |

Recommendation at the time: build it, but borrow two things. From open-slide, the idea of pinning comments to individual elements rather than only to slides (now built). And treat decks from frontend-slides as a first-class input: its users have exactly this problem and are the obvious first community. Anyone willing to switch to React slides and a local agent is already well served by open-slide today. That is the honest alternative to building.

## System overview

The app consists of three building blocks in the browser and talks to exactly two services, both with your own credentials.

```
Sources                    DeckHack in the browser                       Services (your credentials)

Template     ─┐            ┌─ Preview: sandboxed iframe + bridge
Upload / ZIP ─┼─ files ───▶├─ Review round: comments ─▶ edits ─▶ check ──▶ Claude API
GitHub link  ─┘            └─ Versions: IndexedDB ─────────────────────────▶ GitHub (load, commit)
```

The review round is the centre: it reads the files of the current version, has the AI deliver edits, renders the result in the sandbox and only creates a new version after the check. There is no server that could see decks or keys.

## Deck model and slide detection

A deck is a folder of files, nothing more. DeckHack writes nothing of its own into it, except, on request, a small `deckhack.json` that pins the entry file and the detection.

Internally the app knows three kinds of files: text (HTML, CSS, JS, SVG, JSON), which can be edited; local binary files from an upload; and remote binary files that stay in the GitHub repository and are loaded by URL, pinned to the commit. That way a 5 MB team video never has to pass through browser storage.

The slides are found by an adapter that runs inside the preview:

| Adapter | Detects | Navigation | Example |
| --- | --- | --- | --- |
| `sections` | One element per slide: `section.slide`, `.slide`, reveal.js, `main > section` | Scroll into view, otherwise arrow keys | Templates, decks from frontend-slides |
| `keys` | Decks that build scenes in JavaScript and show a counter like "08 / 17" | Simulated arrow keys until the counter matches | The Aloha Robotics hackathon pitch |
| `single` | None of the above | None, comments apply to the whole deck | Unknown pages |

The `keys` adapter is why the real hackathon deck works: it has no slide elements in its HTML, but a `SCENES` array in `demo.js` with steps per scene. The steps are kept, "step forward" and "step back" are separate buttons.

New formats are added as another adapter. Also planned: a setup step in which the AI reads an unknown deck and proposes the `deckhack.json`.

## Preview and security

Deck code is always treated as untrusted, whether it comes from a link, an upload or the AI. It only ever runs in an iframe with `sandbox="allow-scripts"`.

That has three consequences. The iframe gets its own empty origin and can read neither the app's storage nor the API key. It cannot redirect the app or open windows. And the only connection is `postMessage` with a token that is generated anew on every load.

So that a deck made of several files runs in such a frame, a bundler in the browser turns the folder into a single HTML document: local stylesheets and scripts are inlined, images and videos are pointed to data URLs or repository URLs. The first script inside is a small bridge that only exists in the preview and never ends up in the deck. It does five things:

- Detect slides, jump to them and report the current position
- Freeze animations or let them run ("with and without animation")
- Collect errors from the deck
- Resolve paths the deck only assembles at runtime, such as `assets/${name}.webp`
- Replace browser features that are forbidden in the sandbox (`localStorage`, `history.replaceState`)

The last point was only uncovered by testing with the real hackathon deck: it writes `?s=8` into the address on every slide change and crashed in the sandbox at first.

Known limits: ES modules with local imports are not bundled yet. The default is: key only for the lifetime of the tab. Remembering it permanently is opt-in with a warning, "Remove stored keys" deletes it again. The app recommends a separate key for DeckHack in a workspace with a spend limit. Anyone who hosts DeckHack themselves and turns on "remember keys" should give it its own domain, so no other site shares its storage. As a second layer behind the sandbox, a Content Security Policy only lets the page and the preview connect to `api.anthropic.com`, `api.github.com` and `cdn.jsdelivr.net`.

## AI rework

A review round sends all open comments to the model in one request and gets targeted file edits back, not rewritten files.

1. **Collect.** Comments are attached to a slide or to the whole deck. "Only this slide" and "redo the whole deck" are the same flow with a different scope.
2. **Build the request.** A fixed system prompt, then the deck content with the slide list as a cacheable block, then the comments. Across several rounds on the same version, the deck block is read from the cache.
3. **Edits as tool calls.** Three tools: `replace_in_file` (the old text must occur exactly and exactly once), `write_file`, `delete_file`. Every call is checked: only paths inside the deck, only text files. If an edit fails, the model gets the error message and corrects itself.
4. **Check.** The new version is rendered invisibly, every slide is visited with animations frozen and a fingerprint is built from markup, text, colours, fonts and positions. Comparing it with the previous version yields the list of slides that really changed.
5. **Repair.** If the change causes new errors on load, the model gets exactly one repair attempt with the error texts.
6. **Result.** A new version, plus the message "Changed: slide 8. Every other slide is unchanged" or the warning that a slide without a comment was changed too.

Step 4 is the heart of the tool. In decks like the hackathon one, all slides share one stylesheet and one script, and a well-meant edit to slide 8 easily shifts slide 3. In a chat you only notice that on stage.

The call goes straight from the browser to the Claude API, with the user's key. The default model is Claude Opus 5.5 at medium effort; Sonnet 5.5 can be picked for small text fixes and Fable 5.2 for reworking whole decks. If a safety filter declines a request, the API automatically retries it on a fallback model; that fallback option is switched on. Other providers fit behind the same small interface.

There is also a demo mode without AI and without network that only understands `replace "old" with "new"`. It lets you try the whole flow and test it automatically.

## Versioning and saving

Versions exist in two layers: locally on every step, in the repository on save.

**Locally.** Every AI round and every restore creates a version in the browser's IndexedDB. File contents are stored once per content hash, so a new version only costs the files that changed. Each version carries the check result, the changed slides and the changed files.

**Going back never deletes.** Restoring v2 gives you v5 with the content of v2. Comments that were applied in the skipped versions become open again. "Show before" and "Show after" switch the stage between two versions and keep the current slide.

**In the repository.** "Save" writes the changed text files as one commit through GitHub's Git Data API. The target is a branch of its own, suggested as `deckhack/<deckname>`, created from the source branch when needed. Nothing lands on `main` without a pull request. Decks without a repository are downloaded as a zip.

Deliberately not chosen: full git in the browser. It would need a CORS proxy for cloning, and with that a server after all.

## Templates and community

Contributing should be as easy as a folder in a pull request. There are three clearly separated places for it:

| Contribution | What you deliver | Effort |
| --- | --- | --- |
| Template | A folder under `templates/` with `index.html` and `deckhack.json` (name, description, author). Text files only, no external requests, so it also works on bad venue Wi-Fi | One evening |
| Adapter | Detection for another deck format in the bridge, plus a test deck | A few hours |
| AI provider | An implementation of the `Provider` interface | A few hours |

The "Three-minute pitch" template follows the dramaturgy juries expect: hook, problem, solution, demo, how it works, team, ask. The start wizard fills it from a short form (talk length, jury criteria, storyline, content).

Three levers for the community, in this order:

1. **The original pitch as the showcase.** Fourth place at a hackathon in Erlangen with a deck built this way is the most credible advertising. The Aloha Robotics deck should be loadable as an example.
2. **One click to try it.** The app opens a deck directly from a link such as `?deck=github.com/you/repo`. A badge in other hackathon repositories' READMEs then leads straight into the editor of a locally running DeckHack.
3. **A template gallery with names.** Every template names its team and its hackathon. That gives participants a reason to contribute their deck after the event.

The licence is MIT: anyone may use, change and adapt DeckHack for any purpose, hackathon or not. README, CONTRIBUTING, CI and a GitHub Pages workflow for the landing page are in the repository.

## Design and UI concept

The guiding image is a control room: calm technology around a lit stage. The interface steps back, the deck is the only thing with character.

**Layout.** Three columns below a slim header.

| Area | Content | Why |
| --- | --- | --- |
| Left: slide rail | Number, title, yellow marker with the number of open comments, blue dot for "changed in this version" | You see at a glance where work is left and what the last round touched |
| Centre: stage | Deck at a fixed size of 1280 × 720, scaled to fit. Below it slide forward and back, step forward and back, animations on or off, replay, present | Fixed size means the slide looks in the editor the way it will on the projector |
| Right: review and versions | Comments on the current slide, input field, "Apply round", log, result. Second tab: version list | Your eyes stay on the slide, your hands on the comment |
| Header | Deck name, source, version badge, save, settings | Saving is rare, so it is small |

**Core flow.** Click a slide, type a comment, Enter. Next slide. At the end, "Apply round" once. The result appears as a card with the check message, below it "Show before" and "Undo". No dialog, no page change.

**Colour with meaning.** There are exactly two roles. Cobalt blue stands for everything you can do. Marker yellow stands for notes that are still waiting, like a sticky note on a printout. Green, orange and red are reserved for check results. Surfaces are a cool slate grey instead of black or white, so both dark and light decks sit well in front of them. Light and dark theme follow the system. The logo is the palm from the Aloha Robotics hackathon team.

**Type.** System font for the interface, monospace for everything that is counted: slide numbers, versions, the log. No web fonts, the app loads nothing from third parties.

**Language.** English, because the audience is international. Buttons say what happens ("Apply round", "Restore this version"), errors say what to do.

**Narrow screens.** Below 900 px the stage sits on top, the slides become a horizontal rail, the review follows below. Commenting on a phone works, editing is for the laptop.

**Not built yet, but planned:** thumbnails in the slide rail, a slider for the before/after comparison and a presenter mode with notes and a timer.

## Tech stack and repository layout

TypeScript, React 19 and Vite, shipped as static files. That is the stack most contributors and every coding AI know best.

| Building block | Choice | Note |
| --- | --- | --- |
| Interface | React 19, own CSS with tokens | No UI library |
| AI | `@anthropic-ai/sdk` in the browser | Only loaded on the first AI call |
| ZIP | `fflate` | The only other runtime dependency |
| Storage | IndexedDB directly | Around 150 lines |
| GitHub | REST API via `fetch` | No SDK |
| Tests | Vitest for the core logic, Playwright for the browser run | Both run in CI |

| Folder | Purpose |
| --- | --- |
| `src/core/` | Deck model, edits, bundler, bridge, preview, versions |
| `src/sources/` | Upload, loading from and committing to GitHub, templates, start wizard, example deck |
| `src/ai/` | Provider interface, Claude, demo mode, review round with check |
| `src/ui/` | Start, editor, dialogs, styles |
| `templates/` | Templates as plain folders |
| `tests/` | Unit tests, a browser run, template evals |

The core logic in `src/core/` knows nothing about React. It can later also be used in a GitHub Action that photographs every slide on each commit.

## Status and roadmap

The foundation works: the whole review flow runs in demo mode and is checked automatically, including with the real hackathon deck. Two paths are built but have never run against the real service: the Claude call and the GitHub commit. The key and token for that were missing.

| Checked on 17 Nov 2026 (first state) | Result |
| --- | --- |
| Typecheck, lint, 13 unit tests | Green |
| Browser run with a template: load, detect 7 slides, comment, apply, "only slide 1 changed", restore v1 | 10 of 10 |
| Sandbox: deck code cannot read the app | Confirmed |
| Hackathon deck as zip: 17 scenes detected via the counter, jump to slide 8, no errors, images loaded | Confirmed |
| Hackathon deck: a text change on slide 8 is reported as "only slide 8" | Confirmed |
| Claude API from the browser, loading from and committing to GitHub | Not tested |

**Update, evening of 17 Nov 2026 and 18 Nov 2026.** Added and checked since the first state (71 unit tests, 32 browser checks, 35 with the hackathon deck):

| Building block | State |
| --- | --- |
| Example deck with dummy data, start wizard | Done, tested |
| Key hardening: tab session only, opt-in with warning, Content Security Policy | Done, tested |
| Comment by clicking an element, token estimate before sending, deck by link (`?example`, `?template=`, `?deck=`) | Done, tested (`?deck=` only up to the request, GitHub itself untested) |
| Evals: 12 cases, deterministic scoring, workflow | Scoring tested, no live run |
| Landing page, screenshots and GIF by script, Pages build | Built, live on GitHub Pages |
| Local start with one command (`npx github:clschulzer/DeckHack`, `npm start`, `docker compose up`), Pages only as landing page without the app | Built and tested, container check in CI |
| Template contract `templates/README.md` with automatic checks, five more templates | Done |
| First real round with Claude, commit to GitHub (M1) | Open, needs key and token |
| Thumbnails, before/after slider (M2) | Open. "Show before/after" already switches |
| Hackathon deck as example, adapter tests with real reveal.js and Marp decks, screenshot action, announcement (M3) | Open |

Exactly what is tested and what needs a real key is in `docs/TESTING.md`.

| Milestone | Content | Done when |
| --- | --- | --- |
| M1: First real round | Own repository, landing page on GitHub Pages, run Claude and the GitHub commit with real credentials, fix what that turns up | On the hackathon deck, a comment becomes a checked new version in under 60 seconds, and the commit is on a branch |
| M2: Feels like a slide tool | Thumbnails, comment by clicking an element, before/after slider, fill a template with AI from a short brief, open a deck by link | A stranger manages five fixes without an explanation |
| M3: Community launch | Hackathon deck as example, five templates, adapters for reveal.js and Marp with test decks, screenshot action, announcement | The first pull request from someone outside is merged |

## Risks and open decisions

The biggest risk is not the technology, but that the first real AI run brings surprises the demo mode cannot show.

| Risk | Assessment | Countermeasure |
| --- | --- | --- |
| The Claude call from the browser fails on details | Medium. The path is meant for "your own key in the browser" ([source](https://simonwillison.net/2024/Aug/23/anthropic-dangerous-direct-browser-access)), but untested here | First item in M1 |
| Cost per round for large decks | Low. The hackathon deck has around 100 KB of text, an estimated 30,000 tokens. With Opus 5.5 that is roughly 12 cents of input per round, much less with the cache | Show the estimated tokens before applying |
| The fingerprint reports changes that are not real | Medium for decks with randomness or the time of day on screen. Stable for the hackathon deck | Animations are frozen during the check; make it switchable per deck |
| Private repositories | Images and videos are currently only loaded from public repositories | Fetch binary files from private repositories through the API |
| Key in browser storage | Low with the default setting (tab only) | Own domain for anyone hosting it themselves |
| Decks with ES modules | Local imports are not bundled yet | Add an import map to the bundler |

Decided: name "DeckHack", repository `clschulzer/DeckHack`, licence MIT, interface in English. Whether the name is free as a trademark or domain has not been checked.
