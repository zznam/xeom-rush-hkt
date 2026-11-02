import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const port = process.env.E2E_SERVER_PORT || '3003';

async function join(page: Page) {
  await page.goto('/');
  await page.locator('#username').fill('NotebookDriver');
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('.connection-cover')).toHaveCount(0);
  await expect(page.locator('.hud-summary')).toBeVisible();
}

async function completeTrip(page: Page, request: APIRequestContext) {
  const guest = await page.evaluate((host) => localStorage.getItem(`xeom:guest:${host}`), `localhost:${port}`);
  const fixture = async (data: Record<string, unknown>) => {
    const response = await request.post(`http://localhost:${port}/api/test/gameplay`, { data: { guest, ...data } });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  // Finish an incidental automatic pickup before setting up the authored ride.
  for (let i = 0; i < 8; i++) {
    const state = await fixture({ action: 'state' });
    if (!state.gameplay.trip) break;
    const id = state.gameplay.trip.passenger.id;
    const index = state.gameplay.trip.stopIndex;
    await fixture({ action: 'position', ...state.gameplay.trip.stops[index] });
    await expect
      .poll(async () => {
        const current = (await fixture({ action: 'state' })).gameplay.trip;
        return !current || current.passenger.id !== id || current.stopIndex !== index;
      })
      .toBe(true);
  }
  const job = await fixture({ action: 'job', kind: 0, x: 2050, y: 2200 });
  const id = job.gameplay.selectedPickup;
  await fixture({ action: 'position', x: 2050, y: 2270 });
  await expect.poll(async () => (await fixture({ action: 'state' })).gameplay.trip?.passenger.id).toBe(id);
  const trip = (await fixture({ action: 'state' })).gameplay.trip;
  await fixture({ action: 'position', ...trip.stops[0] });
  await expect
    .poll(async () =>
      (await fixture({ action: 'state' })).gameplay.summary.recentTrips.some((r: { id: string }) => r.id === id),
    )
    .toBe(true);
  await expect(page.locator('.trip-progress')).not.toContainText('0 chuyến');
}

test('shift goals track real deliveries, history survives reload and bests compare the same mode', async ({
  page,
  request,
}) => {
  // This journey spans two sessions, persistence, confirmation flows and browser teardown.
  test.setTimeout(90_000);
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('xeom:tutorial', 'done');
    localStorage.setItem(
      'xeom:shift-history',
      JSON.stringify({
        version: 1,
        shifts: [
          {
            id: 'previous-city',
            endedAt: 1,
            mode: 'career',
            score: 0,
            deliveries: 0,
            cleanTrips: 0,
            distance: 0,
            fines: 0,
          },
          {
            id: 'different-mode',
            endedAt: 2,
            mode: 'sandbox',
            score: 999999,
            deliveries: 999,
            cleanTrips: 999,
            distance: 999999,
            fines: 0,
          },
        ],
      }),
    );
  });
  await join(page);
  await page.getByRole('button', { name: 'Hồ sơ', exact: true }).click();
  const profile = page.getByRole('dialog', { name: 'Hồ sơ tài xế' });
  await profile.getByLabel('Loại mục tiêu').selectOption('deliveries');
  await profile.getByLabel('Đích ca xe').fill('1');
  await profile.getByRole('button', { name: 'Lưu mục tiêu', exact: true }).click();
  await expect(profile.getByText('Đã lưu mục tiêu.', { exact: true })).toBeVisible();
  await profile.getByRole('button', { name: 'Đóng', exact: true }).click();
  await completeTrip(page, request);
  await page.getByRole('button', { name: 'Hồ sơ', exact: true }).click();
  await expect(profile.getByText('✓ Đã đạt mục tiêu!', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('shift-goal.png') });
  await profile.getByRole('button', { name: 'Đóng', exact: true }).click();
  await page.getByRole('button', { name: 'Kết thúc', exact: true }).click();
  const results = page.getByRole('dialog', { name: 'Kết quả ca xe' });
  await expect(results.getByText('So với 1 ca thành phố gần đây', { exact: true })).toBeVisible();
  await expect(results.getByText(/Chuyến hoàn thành:.*Kỷ lục mới!/)).toBeVisible();
  await expect(results.getByText('Đã lưu vào nhật ký ca xe trên trình duyệt.', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('shift-comparison.png') });
  const records = await page.evaluate(() => JSON.parse(localStorage.getItem('xeom:shift-history')!).shifts);
  expect(records).toHaveLength(3);
  expect(records[0].deliveries).toBeGreaterThanOrEqual(1);
  expect(records[0].score).toBeGreaterThan(0);
  await results.getByRole('button', { name: 'Chơi tiếp ↗' }).click();
  await page.reload();
  await join(page);
  await page.getByRole('button', { name: 'Hồ sơ', exact: true }).click();
  await expect(profile.getByLabel('Đích ca xe')).toHaveValue('1');
  await expect(profile.locator('.shift-history li')).toHaveCount(3);
  await expect(profile.getByRole('progressbar', { name: 'Mục tiêu ca xe' })).toHaveAttribute('value', '0');
  await profile.getByRole('button', { name: 'Xóa nhật ký', exact: true }).click();
  await profile.getByRole('button', { name: 'Giữ nhật ký', exact: true }).click();
  await expect(profile.locator('.shift-history li')).toHaveCount(3);
  await profile.getByRole('button', { name: 'Xóa nhật ký', exact: true }).click();
  await profile.getByRole('button', { name: 'Xác nhận xóa nhật ký', exact: true }).click();
  await expect(profile.locator('.shift-history li')).toHaveCount(0);
  await profile.getByRole('button', { name: 'Tắt mục tiêu', exact: true }).click();
  await expect(profile.getByRole('progressbar', { name: 'Mục tiêu ca xe' })).toHaveCount(0);
});

test('corrupt notebook data is ignored and phone results remain scrollable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => {
    localStorage.setItem('xeom:shift-goal', '{"metric":"__proto__","target":1}');
    localStorage.setItem('xeom:shift-history', '{"version":1,"shifts":[null,{"id":"bad","endedAt":1e99}]}');
  });
  await join(page);
  await page.getByRole('button', { name: 'Hồ sơ', exact: true }).click();
  await expect(page.getByText('Chưa có ca đã lưu. Chọn Kết thúc để ghi ca đầu tiên.', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Kết thúc', exact: true }).click();
  const results = page.getByRole('dialog', { name: 'Kết quả ca xe' });
  const box = (await results.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(568);
  await results.getByRole('button', { name: 'Chơi tiếp ↗' }).scrollIntoViewIfNeeded();
  await expect(results.getByRole('button', { name: 'Chơi tiếp ↗' })).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('phone-shift-results.png') });
  await page.keyboard.press('Tab');
  expect(await results.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  expect(errors).toEqual([]);
});

test('notebook reports denied storage without pretending a goal or shift was saved', async ({ page }) => {
  await join(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('xeom:shift-')) throw new DOMException('Storage denied', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: 'Hồ sơ', exact: true }).click();
  await page.getByRole('button', { name: 'Lưu mục tiêu', exact: true }).click();
  await expect(page.getByText(/Trình duyệt không cho lưu mục tiêu/)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Kết thúc', exact: true }).click();
  await expect(
    page.getByText('Chưa lưu được nhật ký. Bộ nhớ trình duyệt không khả dụng.', { exact: true }),
  ).toBeVisible();
});

test('ending a shift keeps only the latest 30 journal entries without duplicate saves', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem(
      'xeom:shift-history',
      JSON.stringify({
        version: 1,
        shifts: Array.from({ length: 30 }, (_, i) => ({
          id: `previous-${i}`,
          endedAt: i + 1,
          mode: 'career',
          score: 0,
          deliveries: 0,
          cleanTrips: 0,
          distance: 0,
          fines: 0,
        })),
      }),
    );
  });
  await join(page);
  await page.getByRole('button', { name: 'Kết thúc', exact: true }).click();
  await expect(page.getByText('Đã lưu vào nhật ký ca xe trên trình duyệt.', { exact: true })).toBeVisible();
  const records = await page.evaluate(() => JSON.parse(localStorage.getItem('xeom:shift-history')!).shifts);
  expect(records).toHaveLength(30);
  expect(new Set(records.map((s: { id: string }) => s.id)).size).toBe(30);
  expect(records.some((s: { id: string }) => s.id === 'previous-0')).toBe(false);
  expect(records[1].id).toBe('previous-29');
});
