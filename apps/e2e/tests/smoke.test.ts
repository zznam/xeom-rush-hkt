import { test, expect, request } from '@playwright/test';

const SERVER_URL = `http://localhost:${process.env.E2E_SERVER_PORT || 3003}`;

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

    // The default build stays legacy even when an AWS directory is present in the environment.
    await expect(page.locator('#region')).toHaveCount(0);

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

    await expect(page.getByText('DELTA', { exact: true })).toBeVisible({ timeout: 10_000 });
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
  await page.getByRole('button', { name: 'Tùy chỉnh', exact: true }).click();
  await page.getByRole('button', { name: 'Âm thanh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Âm thanh', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Giảm chuyển động', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Giảm chuyển động', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(connections).toBe(before);
  await page.getByRole('button', { name: 'Đóng', exact: true }).click();
  await page.reload();
  await page.locator('button[type="submit"]').click();
  await page.getByRole('button', { name: 'Tùy chỉnh', exact: true }).click();
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

for (const layout of [
  { name: 'desktop', width: 1440, height: 900, touch: false },
  { name: 'tablet', width: 820, height: 620, touch: false },
  { name: 'desktop breakpoint', width: 769, height: 600, touch: false },
  { name: 'phone', width: 390, height: 844, touch: true },
  { name: 'small phone', width: 320, height: 568, touch: true },
  { name: 'touch landscape', width: 844, height: 390, touch: true },
]) {
  test.describe(`Game HUD layout: ${layout.name}`, () => {
    test.use({ viewport: { width: layout.width, height: layout.height }, hasTouch: layout.touch });

    test('keeps the HUD and controls visible without overlapping', async ({ page }) => {
      await page.goto('/');
      await page.locator('#username').fill('LayoutDriver');
      await page.locator('button[type="submit"]').click();
      await expect(page.locator('.hud-summary')).toBeVisible();
      await expect(page.locator('.connection-cover')).toHaveCount(0);

      const selectors = ['.hud-summary', '.hud-minimap', '.game-dock', '.game-toolbar'];
      if (layout.touch) {
        selectors.push('.leaderboard-toggle-btn', '.joystick-mobile', '.honk-btn-mobile');
      } else {
        selectors.push('.hud-leaderboard', '.keyboard-hints');
      }
      const boxes = [];
      for (const selector of selectors) {
        const box = await page.locator(selector).boundingBox();
        expect(box, `${selector} is rendered`).not.toBeNull();
        expect(box!.x, `${selector} left edge`).toBeGreaterThanOrEqual(0);
        expect(box!.y, `${selector} top edge`).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width, `${selector} right edge`).toBeLessThanOrEqual(layout.width);
        expect(box!.y + box!.height, `${selector} bottom edge`).toBeLessThanOrEqual(layout.height);
        boxes.push({ selector, ...box! });
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          // Hints and the toolbar share the dock, but must not overlap each other.
          const pair = [a.selector, b.selector];
          if (
            pair.includes('.game-dock') &&
            pair.some((selector) => ['.keyboard-hints', '.game-toolbar'].includes(selector))
          )
            continue;
          const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
          expect(overlapX <= 0 || overlapY <= 0, `${a.selector} overlaps ${b.selector}`).toBe(true);
        }
      }
      for (const button of await page.locator('.game-toolbar button').all()) {
        await expect(button).toBeInViewport();
        const box = await button.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(await button.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      }
      if (layout.touch) {
        const rankingButton = page.getByRole('button', { name: 'Tài xế quanh bạn' });
        await rankingButton.click();
        await expect(rankingButton).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('#nearby-drivers')).toBeInViewport();
        await rankingButton.click();
        await expect(page.locator('#nearby-drivers')).toHaveCount(0);
      }
      await page.screenshot({ path: `test-results/hud-${layout.name.replaceAll(' ', '-')}.png` });
    });
  });
}

test('custom controls save without reconnecting and dialogs retain keyboard focus', async ({ page }) => {
  let connections = 0;
  page.on('websocket', () => connections++);
  await page.setViewportSize({ width: 320, height: 667 });
  await page.goto('/');
  await page.locator('#username').fill('CustomDriver');
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('.hud-summary')).toBeVisible();
  const before = connections;
  await page.getByRole('button', { name: 'Tùy chỉnh', exact: true }).click();
  await page.getByLabel('Tay thuận').selectOption('left');
  await page.getByLabel('Kích thước cần', { exact: true }).fill('160');
  await page.getByLabel('Khoảng cách mép', { exact: true }).fill('40');
  await page.getByLabel('Độ nhạy', { exact: true }).fill('1.4');
  await page.getByLabel('Cỡ chữ').selectOption('1.3');
  await page.getByLabel('Đồ họa').selectOption('low');
  await page.getByLabel('Phím up').focus();
  await page.keyboard.press('i');
  await expect(page.getByLabel('Phím up')).toHaveValue('i');
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(connections).toBe(before);
  const stick = await page.getByRole('group', { name: 'Cần điều khiển lái xe' }).boundingBox();
  const horn = await page.locator('.honk-btn-mobile').boundingBox();
  expect(stick!.width).toBe(160);
  expect(stick!.x).toBeGreaterThan(horn!.x + horn!.width);
  expect(stick!.x + stick!.width).toBeLessThanOrEqual(320);
  await page.reload();
  await page.locator('button[type="submit"]').click();
  await page.getByRole('button', { name: 'Tùy chỉnh', exact: true }).click();
  await expect(page.getByLabel('Tay thuận')).toHaveValue('left');
  await expect(page.getByLabel('Phím up')).toHaveValue('i');
  await expect(page.getByLabel('Đồ họa')).toHaveValue('low');
});
