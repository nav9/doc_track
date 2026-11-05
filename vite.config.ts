/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves a project site from /<repository>/.
// CI sets BASE_PATH="/doc_track/"; local development stays at "/".
// Read through globalThis so the config needs no Node type definitions.
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  ?.env;
const base = env?.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    svelte(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'DocTrack — Doctor Leave Planner',
        short_name: 'DocTrack',
        description:
          'Offline-first leave planning, duty roster and NMC attendance tracker for doctors.',
        lang: 'en',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#f4f7fb',
        theme_color: '#0b1220',
        categories: ['medical', 'productivity'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,webmanifest}'],
        globIgnores: ['**/dev-dist/**'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024
      },
      devOptions: {
        enabled: false
      }
    })
  ],
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
