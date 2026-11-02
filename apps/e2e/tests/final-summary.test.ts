import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
import type { ShiftSummary } from '@xeom-rush/shared';

const port = process.env.E2E_SERVER_PORT || '3003';

// Transport regression: the local server supplies the real handshake, snapshots,
// and gameplay metadata. Only the terminal result/close is injected, because the
// public test fixture does not expose the admin-controlled city reset workflow.
async function joinWithTerminalPacketControl(page: Page) {
  let client: WebSocketRoute;
  let server: WebSocketRoute;
  let latestSummary: ShiftSummary | undefined;
  let ending = false;
  await page.routeWebSocket(
    (url) => url.protocol === 'ws:' && url.port === port,
    (socket) => {
      client = socket;
      server = socket.connectToServer();
      server.onMessage((message) => {
        if (ending) return;
        if (typeof message === 'string' && message.startsWith('control:')) {
          const control = JSON.parse(message.slice(8));
          if (control.kind === 'gameplay') latestSummary = control.data.summary;
        }
        socket.send(message);
      });
    },
  );
  await page.goto('/');
  await page.locator('#username').fill('FinalSummaryRider');
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('.hud-summary')).toBeVisible();
  await expect.poll(() => !!latestSummary).toBe(true);
  return {
    previous: () => latestSummary!,
    end: async (summary: unknown, includeSummary = true) => {
      ending = true;
      client.send(
        `result:${JSON.stringify({ score: 22000, deliveriesCount: 2, mode: 'career', ...(includeSummary ? { summary } : {}) })}`,
      );
      await client.close({ code: 1000, reason: 'City starting a new ride' });
      await server.close({ code: 1000 });
    },
  };
}

test('terminal packet summary overrides stale gameplay metadata in results, goals and saved history', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() =>
    localStorage.setItem('xeom:shift-goal', JSON.stringify({ metric: 'cleanTrips', target: 2 })),
  );
  const transport = await joinWithTerminalPacketControl(page);
  const finalSummary: ShiftSummary = {
    ...transport.previous(),
    distance: 1234,
    cleanTrips: 2,
    baseFares: 20000,
    bonuses: 1500,
    tips: 1000,
    fines: 500,
    fastestTripTicks: 100,
    violations: { redLights: 1, pedestrianHits: 0, driverCollisions: 0 },
  };
  expect(transport.previous().cleanTrips).toBe(0);
  expect(transport.previous().distance).toBe(0);
  await transport.end(finalSummary);
  const results = page.getByRole('dialog', { name: 'Kết quả ca xe' });
  await expect(results).toBeVisible();
  await expect(results.getByText('✓ Đã đạt mục tiêu!', { exact: true })).toBeVisible();
  await expect(results.locator('.shift-breakdown')).toContainText('1234m');
  await expect(results.locator('.shift-breakdown')).toContainText('500đ');
  await expect(results.locator('.shift-breakdown')).toContainText('20.000đ');
  await expect(results.getByText('Đã lưu vào nhật ký ca xe trên trình duyệt.', { exact: true })).toBeVisible();
  const record = await page.evaluate(() => JSON.parse(localStorage.getItem('xeom:shift-history')!).shifts[0]);
  expect(record).toMatchObject({ score: 22000, deliveries: 2, cleanTrips: 2, distance: 1234, fines: 500 });
  expect(errors).toEqual([]);
});

for (const variant of ['older packet without summary', 'malformed optional summary']) {
  test(`terminal ${variant} retains the last valid gameplay summary`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const transport = await joinWithTerminalPacketControl(page);
    const previous = transport.previous();
    await transport.end({ distance: 'invalid' }, variant === 'malformed optional summary');
    const results = page.getByRole('dialog', { name: 'Kết quả ca xe' });
    await expect(results.getByText('Đã lưu vào nhật ký ca xe trên trình duyệt.', { exact: true })).toBeVisible();
    const record = await page.evaluate(() => JSON.parse(localStorage.getItem('xeom:shift-history')!).shifts[0]);
    expect(record).toMatchObject({
      score: 22000,
      deliveries: 2,
      cleanTrips: previous.cleanTrips,
      distance: Math.round(previous.distance),
      fines: previous.fines,
    });
    await expect(results.locator('.shift-breakdown')).toContainText(`${Math.round(previous.distance)}m`);
    expect(errors).toEqual([]);
  });
}
