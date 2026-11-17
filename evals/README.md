# Evals for the AI rework

The app has one job that a model does: turn review comments into edits of a deck. These evals measure whether the result can go on stage. They answer three questions:

| Question | Check | How it is measured |
| --- | --- | --- |
| Did only the commented slides change? | `scope`, `shared` | Every slide that was not commented must be byte-identical afterwards (whitespace aside). Shared CSS and JS must stay untouched, or, for style requests, existing rules must stay and only new ones may be added. |
| Is the requested change there? | `content` | Required text is on the slide, removed text is gone, word limits hold. |
| Was anything made up? | `invention`, `placeholders`, `brief` | No number appears that is in neither the old deck nor the comments. Missing facts become `[TODO: ...]` placeholders. Existing placeholders are not filled without facts. The pitch brief in `deckhack.json` is not edited. |

All checks are deterministic code in [`lib/score.ts`](lib/score.ts). No model grades another model.

## Cases

Twelve cases in [`cases.ts`](cases.ts), each with the reason it exists:

| Case | Protects against |
| --- | --- |
| `local-rewrite` | An edit that spills onto other slides. |
| `shorten-headline` | Ignoring a length limit, or losing the fact that should stay. |
| `number-everywhere` | A whole-deck correction that misses a slide or touches unrelated ones. |
| `missing-fact` | An invented quote where facts are missing. |
| `keep-placeholders` | Filling `[TODO]` placeholders nobody asked about. |
| `delete-point` | Deleting more than was asked. |
| `add-slide` | Breaking existing slides when a slide is inserted. |
| `scoped-style` | Editing a CSS rule all slides share for the sake of one slide. |
| `injection` | Following instructions hidden in the deck's own HTML. |
| `rename` | A rename that misses a slide. |
| `german-comment` | Comments in another language. |
| `no-change-needed` | Editing although the comment asks for nothing. |

Every case carries a `reference`: one correct solution as plain edits.

## Run them

```bash
npm test                              # no key needed: tests the cases and the scoring (see below)
ANTHROPIC_API_KEY=sk-ant-... npm run eval   # live: all cases against the real Claude provider
EVAL_MODEL=claude-sonnet-5-5 EVAL_RUNS=3 EVAL_CASES=injection,add-slide npm run eval
```

The live run uses the same prompt, tools and edit rules as the app (`src/ai/claude.ts`), writes `results/<date>-<model>.md` and `results/latest.md`, and costs roughly the deck text (about 2,000 tokens) plus the edits, once per case and run. The same run is available as the manual GitHub workflow “Evals” when the repository has an `ANTHROPIC_API_KEY` secret.

Without a key the live suite is skipped and says so.

## What `npm test` proves without a model

`tests/unit/evals.test.ts` tests the evals themselves:

- every case is passable: its reference solution passes all six checks,
- doing nothing fails every case that asks for a change,
- seven typical mistakes (edit spills to another slide, shared rule edited, length limit ignored, invented number, invented quote, injected link, brief rewritten) are each caught by exactly the check they belong to.

## Limits

- The checks compare markup, not pixels. Whether a slide still looks right is checked at runtime in the app, which re-renders the deck after every round and compares a fingerprint of every slide (`src/core/preview.ts`). That check needs a browser and is covered by the end-to-end run.
- `invention` only catches numbers. An invented name or claim without digits passes it; `missing-fact` and `injection` cover the two most likely variants.
- The cases use one deck in two states. Decks that build their slides in JavaScript are covered by the end-to-end run, not here.
- Pass rates of a single run vary. Use `EVAL_RUNS=3` or more before comparing models or prompt changes.

## Add a case

Add an entry to `CASES` with `comments`, `expect` and a `reference`. `npm test` tells you whether the reference passes and whether doing nothing fails. If you change the prompt in `src/ai/prompt.ts` or the tools in `src/ai/claude.ts`, run the live evals before and after and put both reports in the pull request.
