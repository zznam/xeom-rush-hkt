import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:5173',
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
      command: 'pnpm --filter server dev',
      port: 3002,
      reuseExistingServer: true,
      timeout: 15_000,
      cwd: '../..',
    },
    {
      command: 'pnpm --filter client dev',
      port: 5173,
      reuseExistingServer: true,
      timeout: 15_000,
      cwd: '../..',
    },
  ],
});
