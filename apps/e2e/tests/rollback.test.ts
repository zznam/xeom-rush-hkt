import { test, expect } from '@playwright/test';
test('content rollback advertises its supported modes and quotes the actual passenger payout', async ({
  page,
  request,
}) => {
  let capabilities: Record<string, boolean> | undefined;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string' || !payload.startsWith('control:')) return;
      const message = JSON.parse(payload.slice(8));
      if (message.kind === 'capabilities') capabilities = message.data;
    }),
  );
  await page.goto('/');
  await page.locator('#username').fill('RollbackDriver');
  await page.locator('button[type="submit"]').click();
  await expect.poll(() => capabilities).toMatchObject({ trips: false, practice: false, progression: false });
  const guest = (await page.evaluate(() => localStorage.getItem('xeom:guest:localhost:3196')))!;
  const fixture = async (data: Record<string, unknown>) => {
    const response = await request.post('http://localhost:3196/api/test/gameplay', { data: { guest, ...data } });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  await fixture({ action: 'job', kind: 9, x: 2050, y: 2200 });
  await page.getByRole('button', { name: /^Chọn khách/ }).click();
  await expect(page.locator('.pickup-list')).toContainText('Chở khách · 10.000đ');
  await expect(page.locator('.pickup-list')).toContainText('1 điểm');
  await page.getByRole('button', { name: 'Đóng', exact: true }).click();
  await page.keyboard.down('s');
  await expect.poll(async () => (await fixture({ action: 'state' })).gameplay.trip, { timeout: 7000 }).not.toBeNull();
  await page.keyboard.up('s');
  const trip = (await fixture({ action: 'state' })).gameplay.trip;
  expect(trip).toMatchObject({ kind: 'passenger', fare: { total: 10000, clean: 0, tip: 0 } });
  expect(trip.stops).toHaveLength(1);
  await expect(page.locator('.passenger-story')).toHaveCount(0);
  await expect(page.locator('.trip-timing')).toContainText('Chuyến thường');
  await fixture({ action: 'position', x: trip.stops[0].x, y: trip.stops[0].y - 55 });
  await page.keyboard.down('s');
  await expect.poll(async () => (await fixture({ action: 'state' })).gameplay.trip, { timeout: 7000 }).toBeNull();
  await page.keyboard.up('s');
  const summary = (await fixture({ action: 'state' })).gameplay.summary;
  expect(summary.baseFares).toBe(10000);
  expect(summary.bonuses).toBe(0);
  expect(summary.tips).toBe(0);
  expect(errors).toEqual([]);
});
