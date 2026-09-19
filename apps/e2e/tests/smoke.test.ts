import { test, expect, request } from '@playwright/test';

const SERVER_URL = 'http://localhost:3003';

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

  test('5. Debug overlay reports delta snapshot packets after joining', async ({ page }) => {
    await page.goto('/');

    await page.locator('#username').fill('DeltaTester');
    await page.locator('button[type="submit"]').click();

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });

    await expect(page.getByText('DELTA')).toBeVisible({ timeout: 10_000 });
  });
});

test('toon lobby loads its generated art and remembers a Vietnamese driver name', async ({ page }) => {
  await page.goto('/');
  const art = page.locator('.hero-art');
  await expect(art).toBeVisible();
  await expect.poll(() => art.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await page.locator('#username').fill('Cô Ba');
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('.hud-container')).toBeVisible();
  await page.getByRole('button', { name: 'Kết thúc', exact: true }).click();
  await expect(page.getByText('Một chuyến thật vui!')).toBeVisible();
  await page.getByRole('button', { name: 'Chơi tiếp' }).click();
  await expect(page.locator('#username')).toHaveValue('Cô Ba');
});

test('sound and motion controls do not reconnect the game', async ({ page }) => {
  let connections = 0;
  page.on('websocket', () => {
    connections++;
  });
  await page.goto('/');
  await page.locator('#username').fill('SettingsDriver');
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('.hud-container')).toBeVisible();
  const before = connections;
  await page.getByRole('button', { name: 'Âm thanh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Âm thanh', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Giảm chuyển động', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Giảm chuyển động', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(connections).toBe(before);
  await page.reload();
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole('button', { name: 'Âm thanh', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('mobile layout keeps the join form and touch controls usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('button[type="submit"]')).toBeInViewport();
  await page.locator('#username').fill('MobileDriver');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole('group', { name: 'Cần điều khiển lái xe' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kết thúc', exact: true })).toBeInViewport();
});
