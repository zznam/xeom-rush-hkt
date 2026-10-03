import { defineConfig } from '@playwright/test';

const serverPort = Number(process.env.E2E_SERVER_PORT || 3003);
const clientPort = Number(process.env.E2E_CLIENT_PORT || 5174);
export default defineConfig({
  testDir: './tests',
  testIgnore: ['regional.test.ts', 'rooms.test.ts', 'rollback.test.ts'],
  workers: 1,
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: `http://localhost:${clientPort}`,
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
      command: `ALLOW_GAME_TESTS=true DEPLOY_TARGET=legacy MONGODB_URI=mongodb://127.0.0.1:1/test PORT=${serverPort} BOT_COUNT=0 bun run --filter server start`,
      port: serverPort,
      reuseExistingServer: false,
      timeout: 15_000,
      cwd: '../..',
    },
    {
      command: `VITE_WS_URL=ws://localhost:${serverPort} bun run --filter client dev --port ${clientPort}`,
      env: { VITE_DEPLOY_TARGET: '', VITE_REGIONS_JSON: 'stale-aws-setting' },
      port: clientPort,
      reuseExistingServer: false,
      timeout: 15_000,
      cwd: '../..',
    },
  ],
});
