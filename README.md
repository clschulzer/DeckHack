# DeckHack

**Fix your HTML pitch deck slide by slide.** Open a deck, leave a note on each slide that needs work, apply the whole round at once, and keep every version. Built for the last night of a hackathon.

DeckHack is a static web app. It has no server: decks, versions and keys stay in your browser, AI calls go straight to the provider with your own API key, and saving creates a commit in your own GitHub repository. Your deck stays a plain folder of HTML, CSS and JavaScript that runs without DeckHack.

> Status: early scaffold. The review loop works end to end in demo mode and is covered by tests. The Claude and GitHub-commit paths are implemented but have not been run against the live services yet.

## What it does

- **Try it without anything:** “Try the example deck” opens a deck with dummy data, four comments waiting and a version to go back to. Demo mode answers them with prepared edits, no key needed.
- **Start wizard for templates:** pick the pitch length, the jury criteria and a storyline, type what the pitch is about, choose demo mode or your Claude API key. The wizard lays out the slides and marks missing facts as `[TODO]`.
- **Open a deck three ways:** a bundled template, your own file / folder / .zip, or a GitHub link (repository, folder, or GitHub Pages URL).
- **Any HTML deck.** Slides are detected by adapters: one element per slide (`section`, `.slide`, reveal.js), or decks that build scenes in JavaScript and show a counter such as `08 / 17`. An optional `deckhack.json` can pin the detection.
- **Comment where it is wrong.** Notes are pinned to a slide or to the whole deck and collected into one review round.
- **Apply the round.** The AI edits the deck's files with small, exact replacements. Then DeckHack reloads the deck, walks every slide and tells you which slides changed, so an edit to slide 8 that also moved slide 3 is flagged.
- **Every version is kept.** Compare before and after, undo, or restore any earlier version. Restoring adds a version; nothing is ever overwritten.
- **Play or freeze animations**, step through scripted scenes, present fullscreen.
- **Save** as a commit on a branch of your repository, or as a .zip.

## Run it

```bash
npm ci
npm run dev        # local dev server
npm run build      # static site in dist/, deploy anywhere (GitHub Pages works)
```

## Check it

```bash
npm run typecheck
npm run lint
npm test           # unit tests (Vitest)
npm run build && npm run e2e                      # browser run of the review loop (Playwright)
npm run e2e -- path/to/your-deck.zip              # also load a real deck
```

## How it is built

| Folder | Purpose |
| --- | --- |
| `src/core/` | Deck model, exact-match edits, preview bundler, the in-frame bridge, versions in IndexedDB |
| `src/sources/` | Loading from upload, GitHub and templates; committing to GitHub |
| `src/ai/` | Provider interface, Claude provider (browser, your key), demo provider, the review round |
| `src/ui/` | React interface |
| `templates/` | Starter decks. Each is a plain folder; add one and it appears in the app |

Security model in one paragraph: deck code is untrusted, whether it comes from a link, an upload or the AI. It only ever runs in an iframe with `sandbox="allow-scripts"`, which gives it an opaque origin. It cannot read the app's storage or your API key, cannot navigate the app and cannot open windows. The app and the preview talk through `postMessage` with a per-load token.

The full design, the roadmap and known risks are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (German).

## Contributing

Templates, slide adapters for more deck formats and AI providers are the easiest places to start. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
