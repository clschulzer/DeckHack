import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `--mode single` inlines everything into one HTML file (handy for sharing a preview build).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist' },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/unit/setup.ts'],
    // Without this, Vitest turns every .css file into an empty string, also with ?raw, and the
    // template checks would never see a stylesheet.
    css: { include: [/.+/] },
  },
}));
