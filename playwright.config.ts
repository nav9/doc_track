import { defineConfig } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4175';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  actionTimeout: 10_000,
  reporter: [['list']],
  use: {
    baseURL,
    viewport: { width: 1280, height: 900 },
    channel: 'chrome',
    trace: 'retain-on-failure'
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command:
          'npm run build && node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4175 --strictPort',
        url: 'http://127.0.0.1:4175',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000
      }
});
