import { test, expect } from '@playwright/test';
import { isRoadPoint } from '@xeom-rush/shared';
test('GPS recovers after real steering clips a legal building corner and finishes the trip', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('xeom:tutorial', 'done'));
  await page.goto('/');
  await page.locator('#username').fill('CornerRider');
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('.connection-cover')).toHaveCount(0);
  const port = process.env.E2E_SERVER_PORT || '3003';
  const guest = (await page.evaluate((host) => localStorage.getItem(`xeom:guest:${host}`), `localhost:${port}`))!;
  const endpoint = `http://localhost:${port}/api/test/gameplay`;
  const state = async () => await (await request.post(endpoint, { data: { guest, action: 'state' } })).json();
  const position = async (x: number, y: number) =>
    expect((await request.post(endpoint, { data: { guest, action: 'position', x, y } })).ok()).toBe(true);
  let seeded = false;
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await request.post(endpoint, { data: { guest, action: 'job', kind: 0, x: 2050, y: 2780 } });
    if (response.ok()) {
      seeded = true;
      break;
    }
    expect(response.status()).toBe(409);
    const trip = (await state()).gameplay.trip;
    for (let i = trip.stopIndex; i < trip.stops.length; i++) {
      await position(trip.stops[i].x, trip.stops[i].y);
      await expect
        .poll(async () => {
          const s = await state();
          return i === trip.stops.length - 1
            ? s.gameplay.summary.recentTrips.some((r: { id: string }) => r.id === trip.passenger.id)
            : s.gameplay.trip?.stopIndex > i;
        })
        .toBe(true);
    }
  }
  expect(seeded).toBe(true);
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.down('s');
  await expect.poll(async () => !!(await state()).gameplay.trip).toBe(true);
  await page.keyboard.up('s');
  const tripId = (await state()).gameplay.trip.passenger.id;
  await position(2050, 2850);
  await page.keyboard.down('d');
  await page.keyboard.down('s');
  await expect.poll(async () => !isRoadPoint((await state()).player, 16), { timeout: 5000 }).toBe(true);
  await page.keyboard.up('d');
  await page.keyboard.up('s');
  await expect.poll(async () => (await state()).gameplay.navigation.route.length).toBeGreaterThan(1);
  await expect.poll(async () => (await state()).gameplay.navigation.distance).toBeGreaterThan(0);
  await page.keyboard.down('a');
  await page.keyboard.down('s');
  await expect
    .poll(async () => (await state()).gameplay.summary.recentTrips.some((r: { id: string }) => r.id === tripId))
    .toBe(true);
  await page.keyboard.up('a');
  await page.keyboard.up('s');
  expect(errors).toEqual([]);
});
