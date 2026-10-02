import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/latency', (route) => route.fulfill({ json: { region: 'test' } }));
  await page.route('**/api/guest', (route) => route.fulfill({ json: { guest: 'browser-credential' } }));
});

test('manual region choice matches there and displays the city on mobile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let matchedRegion = '';
  await page.route('**/api/match', async (route) => {
    matchedRegion = route.request().postDataJSON().region;
    await route.fulfill({
      json: { room: 'city-01', wsUrl: 'ws://localhost:3004?session=814ab4e9-a558-465e-8c53-12e849ca14fa' },
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
  await expect(page.getByLabel('Thành phố hiện tại')).toHaveText('Ireland · city-01');
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
