# Testing and evals

DeckHack promises one thing a presenter has to be able to rely on the night before the pitch: after a round of AI edits, the app says which slides changed, and nothing else changed. The tests are built around that promise.

## What is checked, and where

| Layer | Command | Runs in CI | What it covers |
| --- | --- | --- | --- |
| Types and lint | `npm run typecheck`, `npm run lint` | every pull request | The usual. |
| Unit tests | `npm test` | every pull request | Edits (exact, unique replacements), paths, bundling, versions in IndexedDB, key storage, the demo provider, the start wizard, the example deck, every template against the template rules, and the eval scoring. |
| Browser run | `npm run build && npm run e2e` | every pull request | The whole loop in Chromium: open a template, navigate, comment, apply, “only slide N changed”, restore, sandbox and key handling, example deck, wizard, pointing at an element, links into the app. Optional: a real deck as zip (`npm run e2e -- deck.zip "phrase on slide 8"`). |
| Container | `npm run docker:check` | every pull request | The image builds with `docker compose`, starts, and serves the app with its CSP. |
| npx start | `npm run npx:check` | every pull request | The repository packs like a git dependency, installs elsewhere, and the `deckhack` command serves the app and nothing outside `dist/`. |
| Evals | `ANTHROPIC_API_KEY=… npm run eval` | manual workflow “Evals” | Twelve rework cases against the real model: scope, content, invention. See [evals/README.md](../evals/README.md). |

Numbers on this branch: 71 unit tests, 32 browser checks (35 with an extra deck), plus a container check (`npm run docker:check`), 12 eval cases.

## The three risks and the test that owns each

**1. An edit changes more than it should.**
At runtime the app renders the deck before and after in a sandboxed frame, walks every slide with animations frozen and compares a fingerprint of markup, text, key styles and positions. The browser run asserts the result text (“Changed: slide 1. Every other slide is unchanged.”) for a template, for the example deck with four comments, and for a deck that builds its scenes in JavaScript. The evals measure how often the model itself stays in scope.

**2. The AI makes something up.**
The prompt tells the model to mark missing facts as `[TODO: …]`. The evals check it: no new numbers, no invented quote, placeholders stay placeholders, hidden instructions in a deck are ignored. The wizard never invents: unit tests assert that empty fields become placeholders and that typed text is escaped.

**3. Deck code or a careless default leaks the API key.**
The browser run asserts the sandbox attribute, that deck code cannot read the app, that it sees no key in its own storage, that a request to another server is blocked by the content security policy, that the key is in `sessionStorage` only by default, that switching “remember” on shows the warning, and that “Remove stored keys” clears it. Unit tests assert the storage rules without a browser.

## What is not tested yet

These need credentials that were not available when the tests were written. They are built, but nobody has seen them work against the real service:

| Path | Needs | How to test it |
| --- | --- | --- |
| A round with Claude from the browser | Anthropic API key | Open the example, switch to Claude in Settings, add a plain comment, apply. |
| Live evals | Anthropic API key | `ANTHROPIC_API_KEY=… npm run eval`, commit the report from `evals/results/`. |
| The wizard’s “first draft” comment | Anthropic API key | Run the wizard with a key, apply the waiting comment. |
| Load a deck from GitHub, including `?deck=` | Network access to api.github.com | Paste a public repository link on the start page. |
| Commit to a branch | GitHub token with “Contents: read and write” | Load a deck from your repository, apply a round, Save. |
| Private repositories with images | GitHub token | Known gap: binary files of private repositories are not loaded yet. |
| GitHub Pages deployment | Pages enabled with source “GitHub Actions” | Merge to `main`, open the published address. |

Also not covered: real reveal.js and Marp exports (the detection is written for their markup but no such deck is in the tests), Firefox and Safari (the browser run uses Chromium), and screen readers.

## Before a pull request

```bash
npm run typecheck && npm run lint && npm test && npm run build && npm run e2e
```

If you change the prompt (`src/ai/prompt.ts`) or the tools (`src/ai/claude.ts`), run the live evals before and after and include both reports. If you change what the wizard writes, the “example deck” and “templates” unit tests tell you what else has to follow.

## Screenshots and the demo GIF

`npm run build && npm run media` regenerates everything under `site/media/` by driving the real app in demo mode with the example deck. Run it when the interface changes, so the landing page and the README never show something the app does not do.
