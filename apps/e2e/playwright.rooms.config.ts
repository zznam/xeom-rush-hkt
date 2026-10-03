import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results/rooms',
  testMatch: 'rooms.test.ts',
  workers: 1,
  timeout: 45000,
  retries: 0,
  use: { baseURL: 'http://localhost:5185', headless: true, browserName: 'chromium' },
  webServer: [
    {
      command: 'node apps/room-service/tests/serve.mjs',
      port: 3027,
      reuseExistingServer: false,
      timeout: 15000,
      cwd: '../..',
    },
    {
      command: 'VITE_WS_URL=ws://localhost:3027 bun run --filter client dev --port 5185',
      env: { VITE_DEPLOY_TARGET: '' },
      port: 5185,
      reuseExistingServer: false,
      cwd: '../..',
    },
  ],
});
