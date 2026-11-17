import { defineConfig } from 'vitest/config';

/** Live evals (`npm run eval`). Kept out of `npm test` because they call the Claude API. */
export default defineConfig({
  root: new URL('..', import.meta.url).pathname,
  test: { environment: 'jsdom', css: true, include: ['evals/run.test.ts'], testTimeout: 30 * 60 * 1000 },
});
