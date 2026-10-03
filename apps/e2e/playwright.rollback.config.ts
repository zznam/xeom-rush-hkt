import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: 'rollback.test.ts',
  workers: 1,
  use: { baseURL: 'http://localhost:5186', headless: true },
  webServer: [
    {
      command:
        'CONTENT_RELEASE=false ALLOW_GAME_TESTS=true DEPLOY_TARGET=legacy MONGODB_URI=mongodb://127.0.0.1:1/test PORT=3196 BOT_COUNT=0 bun run --filter server start',
      port: 3196,
      cwd: '../..',
      reuseExistingServer: false,
    },
    {
      command: 'VITE_WS_URL=ws://localhost:3196 bun run --filter client dev --port 5186 --strictPort',
      env: { VITE_DEPLOY_TARGET: '' },
      port: 5186,
      cwd: '../..',
      reuseExistingServer: false,
    },
  ],
});
