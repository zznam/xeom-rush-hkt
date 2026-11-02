import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { GameplayState, PlayerState } from '@xeom-rush/shared';

const port = process.env.E2E_SERVER_PORT || '3003';
const endpoint = `http://localhost:${port}/api/test/gameplay`;
type FixtureState = { player: PlayerState; gameplay: GameplayState };

async function openDispatch(page: Page, request: APIRequestContext) {
  await page.addInitScript(() => localStorage.setItem('xeom:tutorial', 'done'));
  await page.goto('/');
  await page.locator('#username').fill('DispatchRider');
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('.hud-container')).toBeVisible();
  const guest = await page.evaluate((host) => localStorage.getItem(`xeom:guest:${host}`), `localhost:${port}`);
  const fixture = async (data: Record<string, unknown>): Promise<FixtureState> => {
    const response = await request.post(endpoint, { data: { guest, ...data } });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  // Complete an incidental auto-pickup before preparing the deterministic offer board.
  let seeded: FixtureState | undefined;
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await request.post(endpoint, { data: { guest, action: 'offers' } });
    if (response.ok()) {
      seeded = await response.json();
      break;
    }
    expect(response.status()).toBe(409);
    const trip = (await fixture({ action: 'state' })).gameplay.trip!;
    for (let stop = trip.stopIndex; stop < trip.stops.length; stop++) {
      await fixture({ action: 'position', ...trip.stops[stop] });
      await expect
        .poll(async () => {
          const state = await fixture({ action: 'state' });
          return stop === trip.stops.length - 1
            ? state.gameplay.summary.recentTrips.some((recent) => recent.id === trip.passenger.id)
            : state.gameplay.trip?.stopIndex > stop;
        })
        .toBe(true);
    }
  }
  expect(seeded, 'The deterministic offer board was created').toBeTruthy();
  const ids = Object.fromEntries(seeded!.gameplay.offers.slice(0, 3).map((offer) => [offer.kind, offer.id]));
  expect(Object.keys(ids).sort()).toEqual(['food', 'parcel', 'passenger']);
  await page.getByRole('button', { name: /^Chọn khách/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Chọn khách', exact: true });
  await expect(dialog.locator('[data-pickup-id]')).toHaveCount(3);
  return { dialog, ids, fixture };
}

test('dispatch combines job and tier filters, explains empty results, and clears both filters', async ({
  page,
  request,
}) => {
  const { dialog, ids } = await openDispatch(page, request);
  const cards = dialog.locator('[data-pickup-id]');
  for (const kind of ['food', 'parcel', 'passenger']) {
    await dialog.getByLabel('Loại chuyến').selectOption(kind);
    await expect(cards).toHaveCount(1);
    await expect(cards).toHaveAttribute('data-pickup-id', ids[kind]);
  }
  await dialog.getByLabel('Loại chuyến').selectOption('all');
  await dialog.getByLabel('Hạng khách').selectOption('2');
  await expect(cards).toHaveCount(1);
  await expect(cards).toHaveAttribute('data-pickup-id', ids.parcel);
  await expect(cards).toContainText('VIP');
  await dialog.getByLabel('Loại chuyến').selectOption('food');
  await expect(cards).toHaveCount(0);
  await expect(dialog.getByText('Không có chuyến phù hợp.', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: 'Xóa bộ lọc', exact: true }).click();
  await expect(dialog.getByLabel('Loại chuyến')).toHaveValue('all');
  await expect(dialog.getByLabel('Hạng khách')).toHaveValue('all');
  await expect(cards).toHaveCount(3);
  await page.screenshot({ path: test.info().outputPath('dispatch-desktop.png') });
});

test('dispatch sorts real offers by distance, fare and expiry and sends the selected ride to the server', async ({
  page,
  request,
}) => {
  const { dialog, ids, fixture } = await openDispatch(page, request);
  const order = () =>
    dialog.locator('[data-pickup-id]').evaluateAll((cards) => cards.map((card) => card.getAttribute('data-pickup-id')));
  await expect.poll(order).toEqual([ids.passenger, ids.food, ids.parcel]);
  await dialog.getByLabel('Sắp xếp chuyến').selectOption('fare');
  await expect.poll(order).toEqual([ids.parcel, ids.food, ids.passenger]);
  await dialog.getByLabel('Sắp xếp chuyến').selectOption('expiry');
  // The regular passenger has no expiry and therefore appears after timed offers.
  await expect.poll(order).toEqual([ids.parcel, ids.food, ids.passenger]);
  await dialog.getByLabel('Sắp xếp chuyến').selectOption('distance');
  await expect.poll(order).toEqual([ids.passenger, ids.food, ids.parcel]);
  await dialog.getByLabel('Loại chuyến').selectOption('food');
  await dialog.locator(`[data-pickup-id="${ids.food}"]`).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await fixture({ action: 'state' })).gameplay.selectedPickup).toBe(ids.food);
  await page.getByRole('button', { name: /^Chọn khách/ }).click();
  await expect(dialog.locator(`[data-pickup-id="${ids.food}"]`)).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Tự động đón khách gần', exact: true }).click();
  await expect.poll(async () => (await fixture({ action: 'state' })).gameplay.selectedPickup).toBeNull();
});

test('dispatch controls fit a small mobile viewport and close with Escape', async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const { dialog } = await openDispatch(page, request);
  for (const label of ['Loại chuyến', 'Hạng khách', 'Sắp xếp chuyến']) {
    const control = dialog.getByLabel(label);
    await expect(control).toBeVisible();
    const bounds = await control.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
  }
  await page.screenshot({ path: test.info().outputPath('dispatch-mobile.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Chọn khách/ })).toBeFocused();
  // Settings mounts only when opened; it must restore focus just like the always-mounted picker.
  const settingsTrigger = page.getByRole('button', { name: 'Tùy chỉnh', exact: true });
  await settingsTrigger.click();
  await expect(page.getByRole('dialog', { name: 'Tùy chỉnh điều khiển' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settingsTrigger).toBeFocused();
});
