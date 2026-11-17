import { defineConfig } from 'vitest/config';

// Browser evals for the templates. Not part of `npm test` because they need Chromium.
export default defineConfig({
  test: {
    environment: 'node',
    css: true, // keep template CSS readable (?raw), see vite.config.ts
    include: ['tests/eval/**/*.eval.ts'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
