# DeckHack

Static web app to review and rework HTML pitch decks slide by slide: comments per slide, AI edits, version history. No backend. Goal right now: a usable first release for hackathon teams and a base for community contributions.

## Befehle

- Setup: `npm ci`
- Lokal starten wie ein Nutzer: `npm start` (baut, liefert aus, öffnet den Browser) oder `docker compose up` (Port 8080, `DECKHACK_PORT` ändert ihn)
- Container prüfen: `npm run docker:check` (braucht Docker mit Compose, baut, startet und prüft die Auslieferung)
- Dev-Server: `npm run dev`
- Tests (alle): `npm test`
- Einzelner Test: `npx vitest run tests/unit/core.test.ts -t "edits"`
- Typecheck: `npm run typecheck`
- Lint/Format: `npm run lint`
- Build: `npm run build`
- Browser-Durchlauf: `npm run build && npm run e2e` (Playwright, braucht Chromium)
- Vorlagen-Eval: `npm run eval:templates` (jede Vorlage, so wie geliefert und vom Wizard gefüllt, bei 4 Bildschirmgrößen: Tastatur, Überlauf, Kontrast, Animation, offline; Screenshots in `tests/eval/out/`)
- Evals (live, kostet API-Nutzung): `ANTHROPIC_API_KEY=... npm run eval`. Ohne Key wird übersprungen, die Bewertung selbst testet `npm test`.
- Pages-Build: `npm run build:pages` (Landingpage aus `site/` plus Demo-Build der App unter `app/` nach `dist-pages/`)
- Screenshots und GIF: `npm run build && npm run media` (braucht Chromium und ffmpeg), schreibt nach `site/media/`

## Architektur in Kürze

- `src/core/`: Deck-Modell, Edits, Vorschau-Bundler, Bridge im iframe, Versionen (IndexedDB)
- `src/sources/`: Upload, GitHub (laden und committen), Vorlagen, Start-Wizard (`wizard.ts`), Beispiel-Deck mit Dummy-Daten (`example.ts`)
- `src/ai/`: Provider-Schnittstelle, Claude, Demo-Modus, Review-Runde mit Prüfung
- `src/ui/`: React-Oberfläche. Einstieg: `src/main.tsx` -> `ui/App.tsx`
- `evals/`: Fälle (`cases.ts`) und deterministische Bewertung (`lib/score.ts`) für die KI-Überarbeitung
- `site/`: Landingpage für GitHub Pages, `templates/README.md`: Vertrag für Vorlagen, `docs/TESTING.md`: Teststrategie
- `docs/ARCHITECTURE.md`: Entwurf mit Begründungen, Fahrplan (M1 bis M3) und Risiken
- Datenfluss: Quelle -> `DeckFiles` -> `bundleDeck` -> Sandbox-iframe mit Bridge -> `ProbeResult`; Kommentare -> Provider -> `EditOp` -> neue Version

## Konventionen

- Neue Folienerkennung in `src/core/bridge.inframe.js` (`detect`), neuer KI-Anbieter als `Provider` in `src/ai/`.
- Jede Änderung am Deck läuft über `applyEdit` und endet in `addSnapshot`. Nie Versionen überschreiben.

## Stolpersteine

- `src/core/bridge.inframe.js` ist bewusst ES5-artiges JavaScript ohne Imports: Es wird als Text (`?raw`) in die Vorschau injiziert. Der Platzhalter `__PC_CONFIG__` darf nur einmal im File stehen, auch nicht in Kommentaren.
- Die Vorschau hat einen opaken Origin: kein `localStorage`, kein `history.replaceState`. Die Bridge enthält Shims dafür. Neue Browser-APIs, die Decks brauchen, dort ergänzen.
- Der Wizard ersetzt nur den Inhalt von `<main>` der Vorlage. Vorlagen brauchen daher ein `<main>` und Styles für `.slide`, `.eyebrow`/`.tag`, `.lede`, `.points`, `.steps`, `.team`, `.screen`.
- `src/sources/example.ts` ersetzt feste Texte aus dem Wizard-Ergebnis. Ändert sich der Wortlaut in `wizard.ts`, schlägt der Unit-Test „example deck“ fehl: dann die Texte dort nachziehen.
- Die CSP steht als `<meta>` in `index.html` und gilt auch in der Vorschau (srcdoc erbt sie). `connect-src` erlaubt nur Anthropic, GitHub-API und jsDelivr: Decks, die per `fetch` andere Server ansprechen, melden in der Vorschau einen Fehler. Neuer KI-Anbieter oder neue Quelle heißt: Host dort ergänzen.
- Hauptweg für Nutzer ist der lokale Start, gehostet wird nichts. Der Pages-Build (`--mode pages`, `HOSTED_DEMO` in `src/core/settings.ts`) ist nur eine Demo: keine Key-Eingabe, kein Claude, kein GitHub-Commit. Neue Stellen, die einen Key annehmen, müssen `HOSTED_DEMO` beachten. Der Browser-Durchlauf prüft das, wenn `dist-pages/` existiert.
- Vitest liefert CSS-Importe ohne `css: true` als leeren Text. Die Option steht in `vite.config.ts`, `evals/vitest.config.ts` und `tests/eval/vitest.config.ts` und muss bleiben, sonst sind Vorlagen-CSS in Tests leer.
- Kein `@types/node` im Projekt: Node-Module in TypeScript-Dateien nur wie in `evals/run.test.ts` laden, Skripte unter `scripts/` sind `.mjs`.
- Ändert sich die Oberfläche, `npm run media` neu laufen lassen und die Zahlen in `site/index.html` und `docs/TESTING.md` nachziehen.
- `templates/` wird zur Build-Zeit als Text eingebunden, daher nur Textdateien.
- Claude-Aufrufe und GitHub-Commits sind noch nicht gegen die echten Dienste getestet.

## Nicht anfassen

- `sandbox="allow-scripts"` am Vorschau-iframe nicht erweitern (kein `allow-same-origin`): Das schützt den API-Key.
- `connect-src` der CSP in `index.html` nicht auf `*` oder `https:` öffnen.
- Keys nie ohne Opt-in (`remember`) in `localStorage` schreiben. Der Unit-Test „settings“ prüft das.
