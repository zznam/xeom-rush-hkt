import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testIgnore: 'regional.test.ts',
  workers: 1,
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:5174',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  // Start server + client before running tests
  webServer: [
    {
      command:
        'DEPLOY_TARGET=legacy MONGODB_URI=mongodb://127.0.0.1:1/test PORT=3003 BOT_COUNT=0 bun run --filter server start',
      port: 3003,
      reuseExistingServer: false,
      timeout: 15_000,
      cwd: '../..',
    },
    {
      command: 'VITE_WS_URL=ws://localhost:3003 bun run --filter client dev --port 5174',
      env: { VITE_DEPLOY_TARGET: '', VITE_REGIONS_JSON: 'stale-aws-setting' },
      port: 5174,
      reuseExistingServer: false,
      timeout: 15_000,
      cwd: '../..',
    },
  ],
});
