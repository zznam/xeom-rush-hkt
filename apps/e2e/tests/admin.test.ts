import { test, expect } from '@playwright/test';

test('portal login is private and offers GitHub sign-in', async ({ page }) => {
  await page.goto('/admin/');
  await expect(page.getByRole('link', { name: 'Continue with GitHub' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /good city/ })).toBeVisible();
});
test('owner reviews and applies a bot change through the actual controller and worker', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.request.get('/test/login?role=owner');
  await page.goto('/admin/');
  await expect(page.getByRole('heading', { name: 'city-01', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: /Live city map/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath('admin-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Bots', exact: true }).click();
  await page.getByLabel('Bot count', { exact: true }).fill('12');
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('bots.count: 8 → 12');
  await page.getByRole('button', { name: 'Apply to this city', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.locator('.command-row').first()).toContainText('applied', { timeout: 15000 });
  await expect(page.locator('.stat').filter({ hasText: 'Active bots' })).toContainText('12', { timeout: 15000 });
  expect(errors).toEqual([]);
});
test('mobile moderator can observe and announce but cannot edit rules or staff', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.request.get('/test/login?role=moderator');
  await page.goto('/admin/');
  await expect(page.getByRole('heading', { name: 'city-01', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bots', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Staff', exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('admin-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Players', exact: true }).click();
  await page.getByLabel('City announcement').fill('Chào mừng đến Sài Gòn!');
  await page.getByRole('button', { name: 'Review announcement' }).click();
  await page.getByRole('button', { name: 'Apply to this city' }).click();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.locator('.command-row').first()).toContainText('applied', { timeout: 15000 });
});
test('custom career rules are locked and sandbox mode has an explicit transition review', async ({ page }) => {
  await page.request.get('/test/login?role=gm');
  await page.goto('/admin/');
  await page.getByRole('button', { name: 'Rules', exact: true }).click();
  await expect(page.getByLabel('Vehicle speed', { exact: true })).toBeDisabled();
  await page.getByLabel('Progress mode').selectOption('sandbox');
  await page.getByLabel('Vehicle speed', { exact: true }).fill('300');
  await page.getByRole('button', { name: 'Review changes' }).click();
  await expect(page.getByRole('dialog')).toContainText('30-second countdown');
  await expect(page.getByRole('dialog')).toContainText('rules.speed: 200 → 300');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('owner reviews reusable defaults without changing the live city', async ({ page }) => {
  await page.request.get('/test/login?role=owner');
  await page.goto('/admin/');
  await page.getByRole('button', { name: 'Bots', exact: true }).click();
  await page.getByLabel('Bot count', { exact: true }).fill('6');
  await page.getByLabel('Save draft as a new preset').fill('Quiet mornings');
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Preset saved');
  await page.getByRole('button', { name: 'Deployments', exact: false }).click();
  const select = page.getByLabel('Set defaults from a saved preset');
  await select.selectOption({ label: 'Quiet mornings' });
  await expect(page.getByRole('dialog')).toContainText('Existing cities keep their current settings');
  expect((await (await page.request.get('/api/admin/deployments')).json())[0].defaults.bots.count).toBe(8);
  await page.getByRole('button', { name: 'Apply defaults', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect((await (await page.request.get('/api/admin/deployments')).json())[0].defaults.bots.count).toBe(6);
  expect((await (await page.request.get('/api/admin/cities')).json())[0].config.bots.count).toBe(12);
});
