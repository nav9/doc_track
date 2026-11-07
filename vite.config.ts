/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages serves a project site from /<repository>/.
// CI sets BASE_PATH="/doc_track/"; local development stays at "/".
// Read through globalThis so the config needs no Node type definitions.
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  ?.env;
const base = env?.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [svelte(), tailwindcss()],
  build: {
    target: 'es2020',
    cssMinify: true,
    reportCompressedSize: false
  },
  server: {
    host: '127.0.0.1',
    port: 5173
  }
});
