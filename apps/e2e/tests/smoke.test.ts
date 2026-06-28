import { test, expect, request } from '@playwright/test';

const SERVER_URL = 'http://localhost:3002';

test.describe('Xeom Rush Smoke Tests', () => {
  test('1. Server health endpoint responds with ok status', async () => {
    const apiContext = await request.newContext();
    const res = await apiContext.get(`${SERVER_URL}/api/health`);
    expect(res.ok()).toBe(true);

    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.timestamp).toBe('string');
  });

  test('2. Client login screen loads with username input and join button', async ({ page }) => {
    await page.goto('/');

    // Username input must be visible
    const usernameInput = page.locator('#username');
    await expect(usernameInput).toBeVisible({ timeout: 10_000 });

    // The join button must be visible
    const joinBtn = page.locator('button[type="submit"]');
    await expect(joinBtn).toBeVisible({ timeout: 5_000 });
    await expect(joinBtn).toContainText('LÊN XE');
  });

  test('3. Entering username and joining renders the game canvas and HUD', async ({ page }) => {
    await page.goto('/');

    // Fill username
    await page.locator('#username').fill('PlaywrightDriver');

    // Click join
    await page.locator('button[type="submit"]').click();

    // Main game canvas must appear
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });

    // HUD container must appear (react class set on the wrapping div)
    const hud = page.locator('.hud-container');
    await expect(hud).toBeVisible({ timeout: 8_000 });
  });

  test('4. Minimap canvas renders after joining', async ({ page }) => {
    await page.goto('/');

    await page.locator('#username').fill('MinimapTester');
    await page.locator('button[type="submit"]').click();

    // Wait for minimap canvas (id="minimap")
    const minimap = page.locator('canvas#minimap');
    await expect(minimap).toBeVisible({ timeout: 10_000 });

    // Verify minimap has non-zero dimensions
    const box = await minimap.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });
});
