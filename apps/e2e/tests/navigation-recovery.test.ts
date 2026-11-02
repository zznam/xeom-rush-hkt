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
  // Set up the carried passenger through a real authoritative pickup tick.
  // Pickup driving is covered in release.test.ts; this case exercises the corner
  // recovery itself, so network latency must not drive past this short setup trip.
  await position(2050, 2850);
  let tripId = '';
  await expect
    .poll(async () => {
      tripId = (await state()).gameplay.trip?.passenger.id ?? '';
      return !!tripId;
    })
    .toBe(true);
  await page.keyboard.down('d');
  await page.keyboard.down('s');
  await expect
    .poll(
      async () => {
        const clippedCorner = !isRoadPoint((await state()).player, 16);
        // The rounded corner is traversed in a few ticks. Stop on that observation
        // instead of letting exponential polling miss it and drive down the next street.
        if (clippedCorner) {
          await page.keyboard.up('d');
          await page.keyboard.up('s');
        }
        return clippedCorner;
      },
      { timeout: 5000, intervals: [25] },
    )
    .toBe(true);
  await page.keyboard.up('d');
  await page.keyboard.up('s');
  await expect.poll(async () => (await state()).gameplay.navigation.route.length).toBeGreaterThan(1);
  await expect.poll(async () => (await state()).gameplay.navigation.distance).toBeGreaterThan(0);
  // Follow the recovered GPS route with real keys. A fixed diagonal key hold can
  // overshoot the destination on a slow browser even when recovery is correct.
  let held = new Set<string>();
  await expect
    .poll(
      async () => {
        const current = await state();
        const finished = current.gameplay.summary.recentTrips.some((r: { id: string }) => r.id === tripId);
        const next =
          current.gameplay.navigation?.route
            .slice(1)
            .find(
              (point: { x: number; y: number }) =>
                Math.hypot(point.x - current.player.x, point.y - current.player.y) > 12,
            ) ?? current.gameplay.navigation?.target;
        const wanted = new Set<string>();
        if (!finished && next) {
          if (next.x - current.player.x > 8) wanted.add('d');
          if (next.x - current.player.x < -8) wanted.add('a');
          if (next.y - current.player.y > 8) wanted.add('s');
          if (next.y - current.player.y < -8) wanted.add('w');
        }
        for (const key of held) if (!wanted.has(key)) await page.keyboard.up(key);
        for (const key of wanted) if (!held.has(key)) await page.keyboard.down(key);
        held = wanted;
        return finished;
      },
      { timeout: 10000, intervals: [50] },
    )
    .toBe(true);
  expect(errors).toEqual([]);
});
