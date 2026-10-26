import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { injectIconNames } from './src/lib/icons';

const API_TARGET = process.env.VITE_DEV_API_TARGET ?? 'http://localhost:3000';
const { version: APP_VERSION } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/** Requests only the Material Symbols glyphs listed in src/lib/icons.ts. */
const materialSymbolsSubset: Plugin = { name: 'material-symbols-subset', transformIndexHtml: injectIconNames };

export default defineConfig({
  plugins: [react(), materialSymbolsSubset],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  server: {
    port: 5173,
    host: true,
    // Lets an https tunnel (cloudflared/ngrok) reach the dev server.
    allowedHosts: true,
    proxy: {
      '/api': API_TARGET,
      '/dev': API_TARGET,
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx', 'src/vite-env.d.ts'],
    },
  },
});
