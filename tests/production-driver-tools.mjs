/* global Buffer, process, console, setTimeout, URL, localStorage */
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
const require = createRequire(new URL('../apps/e2e/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const { EMessageType, decodeConfig, decodeSnapshot, decodeDeltaSnapshot } = require(
  new URL('../packages/shared/dist/index.js', import.meta.url).pathname,
);
const output = new URL('../apps/e2e/test-results/production/', import.meta.url);
await mkdir(output, { recursive: true });
const previousReport = process.env.PRODUCTION_JOURNAL_ONLY
  ? JSON.parse(await readFile(new URL('report.json', output), 'utf8'))
  : null;
const report = {
  priorIncident: previousReport
    ? {
        startedAt: previousReport.startedAt,
        failure: previousReport.failure,
        consoleErrors: previousReport.consoleErrors,
      }
    : undefined,
  url: 'https://xeom-rush.vercel.app',
  startedAt: new Date().toISOString(),
  features: previousReport?.features ?? {},
  errors: [],
  consoleErrors: [],
};
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const state = { config: null, snapshot: null, gameplay: null };
let generation = 0;
page.on('pageerror', (e) => report.errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') report.consoleErrors.push(m.text().replace(/\?[^\s]*/g, '?[redacted]'));
});
page.on('response', async (response) => {
  if (response.url().startsWith('https://xeom-rush.zznam.deno.net') && response.status() >= 400) {
    report.httpErrors ??= [];
    report.httpErrors.push({
      path: new URL(response.url()).pathname,
      status: response.status(),
      body: (await response.text().catch(() => '')).slice(0, 300),
    });
  }
});
page.on('requestfailed', (request) => {
  if (request.url().startsWith('https://xeom-rush.zznam.deno.net')) {
    report.requestFailures ??= [];
    report.requestFailures.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText });
  }
});
page.on('websocket', (socket) => {
  if (!socket.url().startsWith('wss://xeom-rush.zznam.deno.net')) return;
  const current = ++generation;
  state.config = state.snapshot = state.gameplay = null;
  socket.on('framereceived', ({ payload }) => {
    if (generation !== current) return;
    if (typeof payload === 'string') {
      if (payload.startsWith('control:')) {
        const message = JSON.parse(payload.slice(8));
        if (message.kind === 'gameplay') state.gameplay = message.data;
      }
    } else {
      const data = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
      const type = new DataView(data).getUint8(0);
      if (type === EMessageType.CONFIG) state.config = decodeConfig(data);
      if (type === EMessageType.SNAPSHOT) state.snapshot = decodeSnapshot(data);
      if (type === EMessageType.DELTA_SNAPSHOT && state.snapshot)
        state.snapshot = decodeDeltaSnapshot(data, state.snapshot);
    }
  });
});
const player = () => state.snapshot?.players.find((p) => p.id === state.config?.myId);
const button = (name) => page.getByRole('button', { name, exact: true });
const settings = () => page.getByRole('dialog', { name: 'Tùy chỉnh điều khiển' });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const passed = (name, evidence) => {
  report.features[name] = { status: 'passed', evidence };
  console.log(`PASS ${name}: ${evidence}`);
};
async function join() {
  await page.locator('#username').fill('ProductionCheck');
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('.hud-summary')).toBeVisible({ timeout: 30000 });
  await expect.poll(() => !!player() && !!state.gameplay, { timeout: 15000 }).toBe(true);
}
async function followUntil(done, timeout = 90000) {
  const start = Date.now();
  let held = new Set();
  let phase = '';
  const reached = new Set();
  try {
    while (!done()) {
      if (Date.now() - start > timeout)
        throw new Error(
          `Live driving timed out: ${JSON.stringify({ position: player() && { x: player().x, y: player().y }, nav: state.gameplay?.navigation, trip: state.gameplay?.trip?.kind })}`,
        );
      const p = player(),
        g = state.gameplay,
        nav = g?.navigation;
      const nextPhase = `${g?.trip?.passenger.id}:${g?.trip?.stopIndex}:${nav?.target.x}:${nav?.target.y}`;
      if (phase !== nextPhase) {
        reached.clear();
        phase = nextPhase;
      }
      const wanted = new Set();
      if (p && nav) {
        for (const point of nav.route.slice(1))
          if (Math.hypot(point.x - p.x, point.y - p.y) < 28) reached.add(`${point.x},${point.y}`);
        const target = nav.route.slice(1).find((point) => !reached.has(`${point.x},${point.y}`)) ?? nav.target;
        if (Math.abs(target.x - p.x) > 14) wanted.add(target.x > p.x ? 'd' : 'a');
        else if (Math.abs(target.y - p.y) > 14) wanted.add(target.y > p.y ? 's' : 'w');
      }
      for (const key of held) if (!wanted.has(key)) await page.keyboard.up(key);
      for (const key of wanted) if (!held.has(key)) await page.keyboard.down(key);
      held = wanted;
      await wait(80);
    }
  } finally {
    for (const key of held) await page.keyboard.up(key);
  }
}
try {
  await page.goto(report.url);
  report.assets = await page.locator('script[src]').evaluateAll((nodes) => nodes.map((n) => n.src));
  await join();
  if (process.env.PRODUCTION_JOURNAL_ONLY) {
    await followUntil(() => state.gameplay?.practiceCompleted || !state.gameplay?.practice, 30000);
    await page.keyboard.down('w');
    await expect.poll(() => state.gameplay?.summary.distance, { timeout: 10000 }).toBeGreaterThan(25);
    await page.keyboard.up('w');
  } else {
    await button('Tùy chỉnh').click();
    await settings().getByLabel('Bộ phím nhanh').selectOption('ijkl');
    await expect(settings().getByLabel('Phím up')).toHaveValue('i');
    await button('Đóng').click();
    const before = player().y;
    await page.keyboard.down('i');
    await expect.poll(() => player().y, { timeout: 8000 }).toBeLessThan(before - 20);
    await page.keyboard.up('i');
    await button('Tùy chỉnh').click();
    await settings().getByLabel('Phím up').press('k');
    await expect(settings().getByRole('alert')).toContainText('Đi xuống');
    await expect(settings().getByLabel('Phím up')).toHaveValue('i');
    await settings().getByLabel('Phím horn').press('b');
    await expect(settings().getByLabel('Phím horn')).toHaveValue('b');
    passed('Conflict-aware remapping', 'Duplicate rejected, valid horn remap applied');
    const downloading = page.waitForEvent('download');
    await button('Xuất cài đặt').click();
    const download = await downloading;
    const backup = JSON.parse(await readFile(await download.path(), 'utf8'));
    await settings().getByLabel('Bộ phím nhanh').selectOption('wasd');
    await page.getByLabel('Tệp cài đặt').setInputFiles({
      name: 'settings.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    });
    await expect(settings().getByRole('status')).toContainText('Đã nhập cài đặt');
    await page
      .getByLabel('Tệp cài đặt')
      .setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('null') });
    await expect(settings().getByRole('alert')).toContainText('không hợp lệ');
    await expect(settings().getByLabel('Phím horn')).toHaveValue('b');
    await page.reload();
    await join();
    await button('Tùy chỉnh').click();
    await expect(settings().getByLabel('Bộ phím nhanh')).toHaveValue('custom');
    await expect(settings().getByLabel('Phím up')).toHaveValue('i');
    await expect(settings().getByLabel('Phím horn')).toHaveValue('b');
    passed('Control presets', 'IJKL moved the live authoritative player and persisted after reload');
    passed(
      'Settings backup/restore',
      'Real download restored, invalid JSON rejected atomically, configuration survived reload',
    );
    await button('Đặt lại cài đặt').click();
    await button('Giữ cài đặt').click();
    await expect(settings().getByLabel('Bộ phím nhanh')).toHaveValue('custom');
    await button('Đặt lại cài đặt').click();
    await button('Khôi phục mặc định').click();
    await expect(settings().getByLabel('Bộ phím nhanh')).toHaveValue('wasd');
    await expect(settings().getByLabel('Phím horn')).toHaveValue('h');
    passed('Reset settings', 'Cancel preserved controls; confirmation restored WASD/H defaults');
    await button('Đóng').click();
    await followUntil(() => state.gameplay?.practiceCompleted || !state.gameplay?.practice, 30000);
    if (state.gameplay?.trip) await followUntil(() => !state.gameplay?.trip);
    await page.getByRole('button', { name: /^Chọn khách/ }).click();
    const picker = page.getByRole('dialog', { name: 'Chọn khách', exact: true });
    await expect(picker.locator('[data-pickup-id]').first()).toBeVisible({ timeout: 15000 });
    const offerIds = (kind = 'all', tier = 'all') => {
      const offers = new Map(state.gameplay.offers.map((offer) => [offer.id, offer]));
      return state.snapshot.passengers
        .filter(
          (p) =>
            !p.isCarried &&
            (!p.deadline || p.deadline > state.gameplay.tick) &&
            offers.has(p.id) &&
            (kind === 'all' || offers.get(p.id).kind === kind) &&
            (tier === 'all' || p.tier === Number(tier)),
        )
        .map((p) => p.id)
        .sort();
    };
    const matchingIds = async (kind, tier) => {
      const actual = await picker
        .locator('[data-pickup-id]')
        .evaluateAll((cards) => cards.map((card) => card.dataset.pickupId).sort());
      return JSON.stringify(actual) === JSON.stringify(offerIds(kind, tier));
    };
    const kinds = { passenger: 'Chở khách', food: 'Giao đồ ăn', parcel: 'Giao kiện hàng' };
    for (const [value, label] of Object.entries(kinds)) {
      await picker.getByLabel('Loại chuyến').selectOption(value);
      await expect.poll(() => matchingIds(value, 'all')).toBe(true);
      await expect
        .poll(async () =>
          (await picker.locator('[data-pickup-id] strong').allTextContents()).every((t) => t.startsWith(label)),
        )
        .toBe(true);
    }
    await picker.getByLabel('Loại chuyến').selectOption('all');
    for (const [value, label] of [
      ['0', 'Thường'],
      ['1', 'Công việc'],
      ['2', 'VIP'],
    ]) {
      await picker.getByLabel('Hạng khách').selectOption(value);
      await expect.poll(() => matchingIds('all', value)).toBe(true);
      await expect
        .poll(async () =>
          (await picker.locator('[data-pickup-id] small').allTextContents()).every((t) => t.startsWith(label)),
        )
        .toBe(true);
    }
    await picker.getByLabel('Loại chuyến').selectOption('food');
    await button('Xóa bộ lọc').click();
    await expect(picker.getByLabel('Loại chuyến')).toHaveValue('all');
    await expect(picker.getByLabel('Hạng khách')).toHaveValue('all');
    passed('Job-kind filter', 'Live offer cards match each chosen job category; combined filters reset correctly');
    passed('Passenger-tier filter', 'Live card tiers match regular/business/VIP filters');
    const numeric = (text) => Number(text.replaceAll('.', '').replaceAll(',', ''));
    await picker.getByLabel('Sắp xếp chuyến').selectOption('fare');
    await expect
      .poll(async () => {
        const fares = (await picker.locator('[data-pickup-id] strong').allTextContents()).map((t) =>
          numeric(t.match(/([\d.]+)đ/)[1]),
        );
        return fares.every((v, i) => !i || fares[i - 1] >= v);
      })
      .toBe(true);
    await picker.getByLabel('Sắp xếp chuyến').selectOption('distance');
    await expect
      .poll(async () => {
        const distances = (await picker.locator('[data-pickup-id] small').allTextContents()).map((t) =>
          Number(t.match(/Cách (\d+)m/)[1]),
        );
        return distances.every((v, i) => !i || distances[i - 1] <= v);
      })
      .toBe(true);
    await picker.getByLabel('Sắp xếp chuyến').selectOption('expiry');
    await expect
      .poll(async () => {
        const times = (await picker.locator('[data-pickup-id] small').allTextContents()).map((t) => {
          const m = t.match(/Chờ (\d+)s/);
          return m ? Number(m[1]) : Infinity;
        });
        return times.every((v, i) => !i || times[i - 1] <= v);
      })
      .toBe(true);
    report.offerCards = await picker.locator('[data-pickup-id]').count();
    await page.screenshot({ path: new URL('dispatch.png', output).pathname });
    passed('Offer sorting', 'Fare descending, distance ascending, and expiry ascending verified from live card values');
    const selected = await picker.locator('[data-pickup-id]').first().getAttribute('data-pickup-id');
    await picker.locator('[data-pickup-id]').first().click();
    await expect.poll(() => state.gameplay?.selectedPickup).toBe(selected);
    await button('Hồ sơ').click();
    await page.getByLabel('Loại mục tiêu').selectOption('distance');
    await page.getByLabel('Đích ca xe').fill('100');
    await button('Lưu mục tiêu').click();
    await expect(page.getByText('Đã lưu mục tiêu.', { exact: true })).toBeVisible();
    await button('Đóng').click();
    await followUntil(() => (state.gameplay?.summary.recentTrips?.length ?? 0) > 0, 120000);
    await expect.poll(() => state.gameplay?.summary.distance).toBeGreaterThanOrEqual(100);
    report.deliveredTrip = state.gameplay.summary.recentTrips[0];
    await button('Hồ sơ').click();
    await expect(page.getByText('✓ Đã đạt mục tiêu!', { exact: true })).toBeVisible();
    await page.screenshot({ path: new URL('goal.png', output).pathname });
    await button('Đóng').click();
    passed('Personal shift goal', '100m goal advanced through real production driving and reached completion');
  }
  await button('Kết thúc').click();
  await expect(page.getByText('Đã lưu vào nhật ký ca xe trên trình duyệt.', { exact: true })).toBeVisible();
  await button('Chơi tiếp ↗').click();
  await page.reload();
  await join();
  await button('Hồ sơ').click();
  if (!process.env.PRODUCTION_JOURNAL_ONLY) await expect(page.getByLabel('Đích ca xe')).toHaveValue('100');
  await expect(page.locator('.shift-history li')).toHaveCount(1);
  await button('Đóng').click();
  await button('Kết thúc').click();
  const results = page.getByRole('dialog', { name: 'Kết quả ca xe' });
  await expect(results).toContainText('So với 1 ca thành phố gần đây');
  await expect(results.locator('.shift-result li')).toHaveCount(4);
  await expect(page.getByText('Đã lưu vào nhật ký ca xe trên trình duyệt.', { exact: true })).toBeVisible();
  report.shifts = await page.evaluate(() => JSON.parse(localStorage.getItem('xeom:shift-history')).shifts);
  expect(report.shifts).toHaveLength(2);
  const [current, previous] = report.shifts;
  for (const metric of ['score', 'deliveries', 'cleanTrips', 'distance']) {
    const index = ['score', 'deliveries', 'cleanTrips', 'distance'].indexOf(metric);
    await expect(results.locator('.shift-result li').nth(index)).toContainText(
      current[metric] > previous[metric] ? 'Kỷ lục mới!' : `Mốc tốt nhất ${previous[metric].toLocaleString('vi-VN')}`,
    );
  }
  await page.screenshot({ path: new URL('results.png', output).pathname });
  passed('Personal-best comparison', 'All four displayed comparisons agree with two real completed shift records');
  await button('Chơi tiếp ↗').click();
  await join();
  await button('Hồ sơ').click();
  await expect(page.locator('.shift-history li')).toHaveCount(2);
  await button('Xóa nhật ký').click();
  await button('Giữ nhật ký').click();
  await expect(page.locator('.shift-history li')).toHaveCount(2);
  await button('Xóa nhật ký').click();
  await button('Xác nhận xóa nhật ký').click();
  await expect(page.locator('.shift-history li')).toHaveCount(0);
  passed(
    'Local shift journal',
    'Two actual ended shifts persisted across reload; cancellation preserved history and confirmed deletion cleared it',
  );
  expect(report.errors).toEqual([]);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = error.stack;
  console.error(error);
  await page.screenshot({ path: new URL('failure.png', output).pathname }).catch(() => {});
  process.exitCode = 1;
} finally {
  report.endedAt = new Date().toISOString();
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
