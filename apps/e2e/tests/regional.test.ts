import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/latency', (route) => route.fulfill({ json: { region: 'test' } }));
});

test('manual region choice matches there and displays the city on mobile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let matchedRegion = '';
  await page.route('**/api/match', async (route) => {
    matchedRegion = route.request().postDataJSON().region;
    await route.fulfill({
      json: {
        room: 'city-01',
        wsUrl: `ws://localhost:3004?session=814ab4e9-a558-465e-8c53-12e849ca14fa&guest=${route.request().postDataJSON().guest}`,
      },
    });
  });
  await page.goto('/');
  await page.locator('#region').selectOption('eu');
  await page.locator('#username').fill('Cô Ba');
  await expect(page.locator('button[type=submit]')).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('regional-lobby.png'), fullPage: true });
  await page.locator('button[type=submit]').click();
  await expect(page.locator('.hud-container')).toBeVisible();
  expect(matchedRegion).toBe('eu');
  await expect(page.getByLabel('Thành phố hiện tại')).toContainText('Ireland · city-01');
  await page.getByRole('button', { name: 'Kết thúc', exact: true }).click();
  await page.getByRole('button', { name: 'Chơi tiếp' }).click();
  await expect(page.locator('#region')).toHaveValue('eu');
});

test('full region gives a useful error without silently moving players', async ({ page }) => {
  const matches: string[] = [];
  await page.route('**/api/match', (route) => {
    matches.push(route.request().postDataJSON().region);
    return route.fulfill({ status: 503, json: { error: 'full' } });
  });
  await page.goto('/');
  await page.locator('#region').selectOption('sg');
  await page.locator('#username').fill('Driver');
  await page.locator('button[type=submit]').click();
  await expect(page.getByRole('alert')).toContainText('Khu vực đang đông');
  expect(matches).toEqual(['sg']);
  await expect(page.locator('button[type=submit]')).toBeEnabled();
});

test('guest credential survives a nickname change and reload', async ({ page }) => {
  let issued = 0;
  await page.route('**/api/guest', (route) => {
    issued++;
    return route.fulfill({ json: { guest: 'same-credential' } });
  });
  const guests: string[] = [];
  await page.route('**/api/match', (route) => {
    guests.push(route.request().postDataJSON().guest);
    return route.fulfill({ status: 503, json: {} });
  });
  await page.goto('/');
  await page.locator('#region').selectOption('sg');
  await page.locator('#username').fill('First name');
  await page.locator('button[type=submit]').click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.reload();
  await page.locator('#region').selectOption('sg');
  await page.locator('#username').fill('Second name');
  await page.locator('button[type=submit]').click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(issued).toBe(1);
  expect(guests).toEqual(['same-credential', 'same-credential']);
});

test('automatic selection explains when every region is unreachable', async ({ page }) => {
  await page.route('**/api/latency', (route) => route.fulfill({ status: 503, json: {} }));
  let matches = 0;
  await page.route('**/api/match', (route) => {
    matches++;
    return route.fulfill({ status: 503, json: {} });
  });
  await page.goto('/');
  await page.locator('#username').fill('OfflineRegion');
  await page.locator('button[type=submit]').click();
  await expect(page.getByRole('alert')).toContainText('Chưa kết nối được khu vực');
  await expect(page.locator('#region')).toBeEnabled();
  await expect(page.locator('button[type=submit]')).toBeEnabled();
  expect(matches).toBe(0);
});

test('matchmaking rejects an unexpected server host without opening a game socket', async ({ page }) => {
  let sockets = 0;
  page.on('websocket', (socket) => {
    // Vite's own hot-reload socket is independent of matchmaking.
    if (new URL(socket.url()).port !== '5175') sockets++;
  });
  await page.route('**/api/match', (route) =>
    route.fulfill({ json: { room: 'wrong-city', wsUrl: 'ws://unexpected.example/room' } }),
  );
  await page.goto('/');
  await page.locator('#region').selectOption('sg');
  await page.locator('#username').fill('SafeRegion');
  await page.locator('button[type=submit]').click();
  await expect(page.getByRole('alert')).toContainText('Địa chỉ thành phố chưa hợp lệ');
  await expect(page.locator('button[type=submit]')).toBeEnabled();
  expect(sockets).toBe(0);
});
