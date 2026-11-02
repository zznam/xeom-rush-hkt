import { defineConfig } from '@playwright/test';
import { evidence } from './evidence';
const artifacts = evidence('admin');
export default defineConfig({
  ...artifacts,
  testDir: './tests',
  testMatch: 'admin.test.ts',
  workers: 1,
  timeout: 40000,
  use: { ...artifacts.use, baseURL: 'http://localhost:3198', headless: true },
  webServer: {
    command: 'node tests/admin-fixture.mjs',
    port: 3198,
    cwd: '../..',
    reuseExistingServer: process.env.ADMIN_REUSE_FIXTURE === '1',
  },
});
