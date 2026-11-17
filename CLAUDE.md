# DeckHack

Static web app to review and rework HTML pitch decks slide by slide: comments per slide, AI edits, version history. No backend. Goal right now: a usable first release for hackathon teams and a base for community contributions.

## Befehle

- Setup: `npm ci`
- Dev-Server: `npm run dev`
- Tests (alle): `npm test`
- Einzelner Test: `npx vitest run tests/unit/core.test.ts -t "edits"`
- Typecheck: `npm run typecheck`
- Lint/Format: `npm run lint`
- Build: `npm run build`
- Browser-Durchlauf: `npm run build && npm run e2e` (Playwright, braucht Chromium)

## Architektur in Kürze

- `src/core/`: Deck-Modell, Edits, Vorschau-Bundler, Bridge im iframe, Versionen (IndexedDB)
- `src/sources/`: Upload, GitHub (laden und committen), Vorlagen
- `src/ai/`: Provider-Schnittstelle, Claude, Demo-Modus, Review-Runde mit Prüfung
- `src/ui/`: React-Oberfläche. Einstieg: `src/main.tsx` -> `ui/App.tsx`
- `docs/ARCHITECTURE.md`: Entwurf mit Begründungen, Fahrplan (M1 bis M3) und Risiken
- Datenfluss: Quelle -> `DeckFiles` -> `bundleDeck` -> Sandbox-iframe mit Bridge -> `ProbeResult`; Kommentare -> Provider -> `EditOp` -> neue Version

## Konventionen

- Neue Folienerkennung in `src/core/bridge.inframe.js` (`detect`), neuer KI-Anbieter als `Provider` in `src/ai/`.
- Jede Änderung am Deck läuft über `applyEdit` und endet in `addSnapshot`. Nie Versionen überschreiben.

## Stolpersteine

- `src/core/bridge.inframe.js` ist bewusst ES5-artiges JavaScript ohne Imports: Es wird als Text (`?raw`) in die Vorschau injiziert. Der Platzhalter `__PC_CONFIG__` darf nur einmal im File stehen, auch nicht in Kommentaren.
- Die Vorschau hat einen opaken Origin: kein `localStorage`, kein `history.replaceState`. Die Bridge enthält Shims dafür. Neue Browser-APIs, die Decks brauchen, dort ergänzen.
- `templates/` wird zur Build-Zeit als Text eingebunden, daher nur Textdateien.
- Claude-Aufrufe und GitHub-Commits sind noch nicht gegen die echten Dienste getestet.

## Nicht anfassen

- `sandbox="allow-scripts"` am Vorschau-iframe nicht erweitern (kein `allow-same-origin`): Das schützt den API-Key.
