import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: 'regional.test.ts',
  workers: 1,
  use: { baseURL: 'http://localhost:5175', headless: true },
  webServer: [
    {
      command:
        'DEPLOY_TARGET=legacy MONGODB_URI=mongodb://127.0.0.1:1/test PORT=3004 BOT_COUNT=0 bun run --filter server start',
      port: 3004,
      cwd: '../..',
      reuseExistingServer: false,
    },
    {
      command: 'bun run --filter client dev --port 5175',
      port: 5175,
      cwd: '../..',
      reuseExistingServer: false,
      env: {
        VITE_DEPLOY_TARGET: 'regional-production',
        VITE_REGIONS_JSON: JSON.stringify([
          { id: 'sg', label: 'Singapore', apiUrl: 'http://127.0.0.1:3004' },
          { id: 'eu', label: 'Ireland', apiUrl: 'http://localhost:3004' },
        ]),
      },
    },
  ],
});
