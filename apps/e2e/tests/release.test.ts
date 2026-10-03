import { test, expect } from '@playwright/test';
import { activeObjectives } from '@xeom-rush/shared';
test('combined practice, authored jobs, clean fare, objective claim, wardrobe, career reload and results', async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.locator('#username').fill('SaigonCourier');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText('TẬP LÁI RIÊNG CHO BẠN')).toBeVisible();
  await page.keyboard.down('s');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('xeom:tutorial')), { timeout: 7000 }).toBe('done');
  await page.keyboard.up('s');
  const port = process.env.E2E_SERVER_PORT || '3003';
  const base = `http://localhost:${port}`;
  const guest = (await page.evaluate((host) => localStorage.getItem(`xeom:guest:${host}`), `localhost:${port}`))!;
  const fixture = async (data: Record<string, unknown>, allowBusy = false) => {
    const r = await request.post(`${base}/api/test/gameplay`, { data: { guest, ...data } });
    if (allowBusy && r.status() === 409) return null;
    expect(r.ok()).toBe(true);
    return r.json();
  };
  const deliver = async (kind: number, x = 2050, y = 2200) => {
    // Automatic pickup can begin another legitimate trip immediately after arrival.
    // Finish that trip through ordered authoritative ticks before seeding the next authored job.
    let before = await fixture({ action: 'state' });
    let seeded = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      const active = before.gameplay.trip;
      if (active) {
        for (let stop = active.stopIndex; stop < active.stops.length; stop++) {
          await fixture({ action: 'position', ...active.stops[stop] });
          await expect
            .poll(
              async () => {
                const state = await fixture({ action: 'state' });
                return stop === active.stops.length - 1
                  ? state.gameplay.summary.recentTrips?.some((r: { id: string }) => r.id === active.passenger.id)
                  : state.gameplay.trip?.passenger.id !== active.passenger.id || state.gameplay.trip.stopIndex > stop;
              },
              { timeout: 7000 },
            )
            .toBe(true);
        }
        before = await fixture({ action: 'state' });
        continue;
      }
      seeded = !!(await fixture({ action: 'job', kind, x, y }, true));
      if (seeded) break;
      before = await fixture({ action: 'state' });
    }
    expect(seeded, 'The authored job was seeded after any incidental automatic trip').toBe(true);
    await expect(page.locator('.trip-guide')).toContainText('Dự kiến');
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await page.keyboard.down('s');
    await expect
      .poll(async () => (await fixture({ action: 'state' })).gameplay.trip?.kind, { timeout: 7000 })
      .toBe(kind < 6 ? 'passenger' : kind < 8 ? 'food' : 'parcel');
    await page.keyboard.up('s');
    let state = await fixture({ action: 'state' });
    const tripId = state.gameplay.trip.passenger.id;
    const stops = state.gameplay.trip.stops;
    expect(stops.length).toBe(kind === 9 ? 3 : kind === 8 ? 2 : 1);
    await expect(page.locator('.passenger-story')).toBeVisible();
    for (let i = 0; i < stops.length; i++) {
      await fixture({ action: 'position', x: stops[i].x, y: stops[i].y - 55 });
      await page.keyboard.down('s');
      if (i < stops.length - 1) {
        await expect
          .poll(async () => (await fixture({ action: 'state' })).gameplay.trip?.stopIndex, { timeout: 7000 })
          .toBe(i + 1);
        state = await fixture({ action: 'state' });
        // Intermediate stops cannot pay a fare; actual traffic fines can reduce the balance.
        expect(state.player.score + state.gameplay.summary.fines).toBe(
          before.player.score + before.gameplay.summary.fines,
        );
        expect(state.gameplay.summary.baseFares).toBe(before.gameplay.summary.baseFares);
      } else {
        await expect
          .poll(
            async () =>
              (await fixture({ action: 'state' })).gameplay.summary.recentTrips.some(
                (r: { id: string }) => r.id === tripId,
              ),
            { timeout: 7000 },
          )
          .toBe(true);
      }
      await page.keyboard.up('s');
    }
    const after = await fixture({ action: 'state' });
    expect(after.gameplay.summary.baseFares - before.gameplay.summary.baseFares).toBe(10000);
    if (kind < 8)
      expect(after.gameplay.summary.cleanTrips).toBeGreaterThanOrEqual(before.gameplay.summary.cleanTrips + 1);
    expect(after.gameplay.summary.bestFare).toBeGreaterThanOrEqual(11000);
    await expect(page.locator('.trip-toast')).toContainText('Chuyến tốt!');
    return after;
  };
  await deliver(0);
  await deliver(6);
  await deliver(8);
  await deliver(9);
  // Finish whichever daily template is active, using gameplay rather than injected progress.
  const objective = activeObjectives()[0];
  if (objective.metric === 'rain' || objective.metric === 'night')
    await fixture({ action: 'weather', tick: objective.metric === 'rain' ? 7200 : 8400 });
  const position = (
    { market: [1250, 1200], downtown: [2450, 1000], 'old-town': [1250, 2800], riverside: [2450, 3000] } as Record<
      string,
      number[]
    >
  )[objective.metric] || [2050, 2200];
  if (objective.metric === 'distance') {
    await fixture({ action: 'position', x: 2050, y: 600 });
    await page.keyboard.down('s');
    await expect
      .poll(async () => (await fixture({ action: 'state' })).gameplay.summary.distance, { timeout: 30000 })
      .toBeGreaterThanOrEqual(2000);
    await page.keyboard.up('s');
  } else {
    for (let i = 0; i < objective.goal; i++)
      await deliver(objective.metric === 'food' ? 6 : objective.metric === 'parcel' ? 8 : 0, position[0], position[1]);
  }
  const expectedRecentTrips = (await fixture({ action: 'state' })).gameplay.summary.recentTrips.length;
  await page.getByRole('button', { name: 'Hồ sơ', exact: true }).click();
  const item = page.locator('.objective-list li').filter({ hasText: objective.title });
  await expect(item.getByRole('button', { name: 'Nhận quà', exact: true })).toBeEnabled();
  await item.getByRole('button', { name: 'Nhận quà', exact: true }).click();
  await expect(item.getByRole('button', { name: 'Đã nhận', exact: true })).toBeVisible();
  await page.getByLabel(/^Màu xe/).selectOption('paint-1');
  await expect(page.getByLabel(/^Màu xe/)).toHaveValue('paint-1');
  await expect(page.getByRole('region', { name: 'Chuyến xe gần đây' })).toBeVisible();
  await page.getByRole('button', { name: 'Đóng', exact: true }).click();
  await page.getByRole('button', { name: 'Kết thúc', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Kết quả ca xe' })).toContainText('Tiền boa');
  await expect(page.getByRole('dialog', { name: 'Kết quả ca xe' })).toContainText('Chuyến an toàn');
  await page.getByRole('button', { name: 'Chơi tiếp ↗' }).click();
  await page.reload();
  await page.locator('button[type="submit"]').click();
  await page.getByRole('button', { name: 'Hồ sơ', exact: true }).click();
  await expect(page.getByLabel(/^Màu xe/)).toHaveValue('paint-1');
  await expect(page.locator('.objective-list li').filter({ hasText: objective.title })).toContainText('Đã nhận');
  await expect(page.locator('.recent-trip-list li')).toHaveCount(expectedRecentTrips);
  expect(errors).toEqual([]);
});
