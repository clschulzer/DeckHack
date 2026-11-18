# DeckHack

Static web app to review and rework HTML pitch decks slide by slide: comments per slide, AI edits, version history. No backend. Goal right now: a usable first release for hackathon teams and a base for community contributions.

## Commands

- Setup: `npm ci`
- Run locally like a user: `npm start` (builds, serves, opens the browser) or `docker compose up` (port 8080, `DECKHACK_PORT` changes it)
- Start without a clone: `npx github:clschulzer/DeckHack` (no npm account, no publish: npm fetches the repo, `prepare` builds, `bin/deckhack.mjs` serves `dist/` on 127.0.0.1). Check: `npm run npx:check`
- Check the container: `npm run docker:check` (needs Docker with Compose; builds, starts and checks what is served)
- Dev server: `npm run dev`
- Tests (all): `npm test`
- Single test: `npx vitest run tests/unit/core.test.ts -t "edits"`
- Typecheck: `npm run typecheck`
- Lint/format: `npm run lint`
- Build: `npm run build`
- Browser run: `npm run build && npm run e2e` (Playwright, needs Chromium)
- Template eval: `npm run eval:templates` (every template, as shipped and as filled by the wizard, at 4 screen sizes: keyboard, overflow, contrast, animation, offline; screenshots in `tests/eval/out/`)
- Evals (live, costs API usage): `ANTHROPIC_API_KEY=... npm run eval`. Skipped without a key; the scoring itself is tested by `npm test`.
- Pages build: `npm run build:pages` (only the landing page from `site/` into `dist-pages/`, without the app)
- Screenshots and GIF: `npm run build && npm run media` (needs Chromium and ffmpeg), writes to `site/media/`

## Architecture in brief

- `src/core/`: deck model, edits, preview bundler, bridge inside the iframe, versions (IndexedDB)
- `src/sources/`: upload, GitHub (load and commit), templates, start wizard (`wizard.ts`), example deck with dummy data (`example.ts`)
- `src/ai/`: provider interface, Claude, demo mode, review round with check
- `src/ui/`: React interface. Entry: `src/main.tsx` -> `ui/App.tsx`
- `evals/`: cases (`cases.ts`) and deterministic scoring (`lib/score.ts`) for the AI rework
- `site/`: landing page for GitHub Pages (logo in `site/logo.svg`), `templates/README.md`: contract for templates, `docs/TESTING.md`: test strategy
- `docs/ARCHITECTURE.md`: design with reasoning, roadmap (M1 to M3) and risks
- Data flow: source -> `DeckFiles` -> `bundleDeck` -> sandboxed iframe with bridge -> `ProbeResult`; comments -> provider -> `EditOp` -> new version

## Conventions

- Everything on GitHub (README, docs, landing page, code, commits) is in English.
- New slide detection goes in `src/core/bridge.inframe.js` (`detect`), a new AI provider as a `Provider` in `src/ai/`.
- Every change to the deck goes through `applyEdit` and ends in `addSnapshot`. Never overwrite versions.
- The logo is the palm from the Aloha Robotics team: `site/logo.svg`. The app uses the same SVG as a data URI in `src/ui/styles.css` (`.brand-mark`) and as the favicon in `index.html`; change all three together.

## Gotchas

- `src/core/bridge.inframe.js` is deliberately ES5-style JavaScript without imports: it is injected into the preview as text (`?raw`). The placeholder `__PC_CONFIG__` may appear only once in the file, not even in comments.
- The preview has an opaque origin: no `localStorage`, no `history.replaceState`. The bridge contains shims for them. Add further browser APIs that decks need there.
- The wizard only replaces the content of the template's `<main>`. Templates therefore need a `<main>` and styles for `.slide`, `.eyebrow`/`.tag`, `.lede`, `.points`, `.steps`, `.team`, `.screen`.
- `src/sources/example.ts` replaces fixed texts from the wizard output. If the wording in `wizard.ts` changes, the unit test "example deck" fails: then update the texts there.
- The CSP is a `<meta>` in `index.html` and also applies in the preview (srcdoc inherits it). `connect-src` only allows Anthropic, the GitHub API and jsDelivr: decks that `fetch` other servers report an error in the preview. A new AI provider or a new source means adding its host there.
- The main path for users is the local start, nothing is hosted. GitHub Pages only shows the landing page: no app and no demo there, links to `app/` in `site/` are wrong. `scripts/pages.mjs` aborts if `dist-pages/app` exists.
- `prepare` in `package.json` builds the app on every `npm ci` and on installation via `npx github:`. For that, `bin` and `files` (`bin`, `dist`) must stay. The Dockerfile therefore uses `npm ci --ignore-scripts`. Do not publish to npm without asking.
- Without `css: true`, Vitest delivers CSS imports as empty text. The option is set in `vite.config.ts`, `evals/vitest.config.ts` and `tests/eval/vitest.config.ts` and must stay, otherwise template CSS is empty in tests.
- The Pages workflow first checks whether Pages is enabled with source "GitHub Actions" and otherwise skips the deployment instead of turning `main` red. The Evals workflow only runs manually.
- No `@types/node` in the project: load Node modules in TypeScript files only the way `evals/run.test.ts` does; scripts under `scripts/` are `.mjs`.
- If the interface changes, rerun `npm run media` and update the numbers in `site/index.html` and `docs/TESTING.md`.
- `templates/` is included as text at build time, so text files only.
- Claude calls and GitHub commits have not been tested against the real services yet.
- The eval case `german-comment` in `evals/cases.ts` is German on purpose: it checks that a comment in another language is understood.

## Do not touch

- Do not extend `sandbox="allow-scripts"` on the preview iframe (no `allow-same-origin`): it protects the API key.
- Do not open `connect-src` in the CSP in `index.html` to `*` or `https:`.
- Never write keys to `localStorage` without opt-in (`remember`). The unit test "settings" checks this.
