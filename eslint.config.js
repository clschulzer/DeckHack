import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist', 'dist-single', 'dist-pages', 'site', 'node_modules', 'templates', 'tests/e2e/out', 'src/core/bridge.inframe.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  { files: ['tests/e2e/**', 'scripts/**', 'bin/**', 'evals/**'], languageOptions: { globals: { process: 'readonly', console: 'readonly', document: 'readonly', window: 'readonly', URL: 'readonly', fetch: 'readonly', setTimeout: 'readonly', localStorage: 'readonly', sessionStorage: 'readonly', indexedDB: 'readonly' } } },
);
