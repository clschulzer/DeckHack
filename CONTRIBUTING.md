# Contributing

Thanks for helping. DeckHack is meant to be owned by the people who use it at hackathons.

## Good first contributions

- **A template.** Add a folder under `templates/`. The format, the markup the start wizard writes and the rules (text files only, no external requests, invented content) are in [templates/README.md](templates/README.md). `npm test` checks every template against them.
- **A slide adapter.** If your deck format is not detected, extend the detection in `src/core/bridge.inframe.js` and add your deck (or a small copy of its structure) to the tests.
- **A provider.** Implement the `Provider` interface in `src/ai/provider.ts`.

## Ground rules

- Keep it static. No feature may require a server run by the project.
- Deck code is untrusted and stays inside the sandboxed preview. Do not add `allow-same-origin` to the preview iframe.
- The deck must keep working without DeckHack. Nothing DeckHack-specific is written into a deck except the optional `deckhack.json`.
- Before a pull request: `npm run typecheck && npm run lint && npm test && npm run build && npm run e2e`.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`), small and focused.
