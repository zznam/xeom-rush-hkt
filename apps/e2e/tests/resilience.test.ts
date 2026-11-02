import { test, expect, type WebSocketRoute } from '@playwright/test';

const port = process.env.E2E_SERVER_PORT || '3003';
const base = `http://localhost:${port}`;

test('invalid connection addresses stay in the lobby and can be corrected', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let connections = 0;
  page.on('websocket', (socket) => {
    // Vite has its own HMR socket; count only connections to the game service.
    if (new URL(socket.url()).port === port) connections++;
  });
  await page.goto('/');
  await page.locator('#username').fill('RetryDriver');
  await page.locator('.server-settings summary').click();
  for (const invalid of ['not a url', 'https://localhost', 'javascript:alert(1)']) {
    await page.locator('#serverUrl').fill(invalid);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole('alert')).toContainText('Địa chỉ kết nối chưa hợp lệ');
    await expect(page.locator('#username')).toBeVisible();
  }
  expect(connections).toBe(0);
  await page.locator('#serverUrl').fill(`ws://localhost:${port}`);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('.hud-summary')).toBeVisible();
  await expect(page.locator('.connection-cover')).toHaveCount(0);
  expect(connections).toBe(1);
  expect(errors).toEqual([]);
});

test('failed city verification shows an error and a subsequent join recovers', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/capabilities', (route) => route.fulfill({ status: 503, json: {} }));
  await page.goto('/');
  await page.locator('#username').fill('CityRetry');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole('alert')).toContainText('Chưa xác minh được thành phố');
  await expect(page.locator('button[type="submit"]')).toBeEnabled();
  await page.unroute('**/api/capabilities');
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('.hud-summary')).toBeVisible();
  await expect(page.locator('.connection-cover')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('brief socket interruption reconnects the same ride and identity', async ({ page, request }) => {
  let first: WebSocketRoute | undefined;
  const connections: string[] = [];
  await page.routeWebSocket(`ws://localhost:${port}/**`, (socket) => {
    connections.push(socket.url());
    socket.connectToServer();
    first ??= socket;
  });
  await page.addInitScript(() => localStorage.setItem('xeom:tutorial', 'done'));
  await page.goto('/');
  await page.locator('#username').fill('ReconnectRider');
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('.hud-summary')).toBeVisible();
  await expect(page.locator('.connection-cover')).toHaveCount(0);
  const guest = await page.evaluate((key) => localStorage.getItem(key), `xeom:guest:localhost:${port}`);
  const state = async () => {
    const response = await request.post(`${base}/api/test/gameplay`, { data: { guest, action: 'state' } });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  const before = await state();
  expect(first).toBeDefined();
  // Use an application close code: the browser API cannot forward reserved 1012 to the real server.
  await first!.close({ code: 4000, reason: 'Local E2E brief interruption' });
  await expect(page.locator('.connection-cover')).toBeVisible();
  await expect.poll(() => connections.length).toBe(2);
  await expect(page.locator('.connection-cover')).toHaveCount(0);
  const after = await state();
  expect(after.player.id).toBe(before.player.id);
  expect(after.player.score).toBe(before.player.score);
  for (const key of ['session', 'guest']) {
    expect(new URL(connections[1]).searchParams.get(key)).toBe(new URL(connections[0]).searchParams.get(key));
  }
  await page.getByRole('button', { name: 'Kết thúc', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Kết quả ca xe' })).toBeVisible();
});

test('opening a dialog clears held steering and movement resumes only after a fresh key press', async ({
  page,
  request,
}) => {
  await page.addInitScript(() => localStorage.setItem('xeom:tutorial', 'done'));
  await page.goto('/');
  await page.locator('#username').fill('SafeControls');
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('.connection-cover')).toHaveCount(0);
  const guest = await page.evaluate((key) => localStorage.getItem(key), `xeom:guest:localhost:${port}`);
  const fixture = async (data: Record<string, unknown>) => {
    const response = await request.post(`${base}/api/test/gameplay`, { data: { guest, ...data } });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  await fixture({ action: 'position', x: 2050, y: 600 });
  await page
    .locator('canvas')
    .first()
    .click({ position: { x: 500, y: 400 } });
  await page.keyboard.down('s');
  await expect.poll(async () => (await fixture({ action: 'state' })).player.y).toBeGreaterThan(620);
  await page.getByRole('button', { name: 'Tùy chỉnh', exact: true }).click();
  await page.keyboard.up('s');
  await fixture({ action: 'position', x: 2050, y: 600 });
  await page.keyboard.down('s');
  await page.waitForTimeout(300); // Several real server ticks prove held keys cannot steer through a dialog.
  expect((await fixture({ action: 'state' })).player.y).toBe(600);
  await page.keyboard.press('Escape');
  await page.keyboard.up('s');
  await page.keyboard.down('s');
  await expect.poll(async () => (await fixture({ action: 'state' })).player.y).toBeGreaterThan(620);
  await page.keyboard.up('s');
});

for (const failure of ['network', '503']) {
  test(`one transient capability ${failure} failure recovers without another join`, async ({ page }) => {
    let requests = 0;
    await page.route('**/api/capabilities', (route) => {
      requests++;
      // Vite development renders under StrictMode: both mount preparations fail once.
      if (requests > 2) return route.continue();
      return failure === 'network' ? route.abort('failed') : route.fulfill({ status: 503, json: {} });
    });
    await page.goto('/');
    await page.locator('#username').fill('TransientRetry');
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('.hud-summary')).toBeVisible();
    await expect(page.locator('.connection-cover')).toHaveCount(0);
    expect(requests).toBeGreaterThanOrEqual(3);
    expect(requests).toBeLessThanOrEqual(4);
  });
}

test('exhausted network retries show localized recovery guidance', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/capabilities', (route) => {
    requests++;
    return route.abort('failed');
  });
  await page.goto('/');
  await page.locator('#username').fill('OfflineRetry');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole('alert')).toContainText('Kiểm tra kết nối và thử lại');
  await expect(page.getByRole('alert')).not.toContainText('Failed to fetch');
  // Two StrictMode preparations, each bounded to two attempts.
  expect(requests).toBe(4);
});

test('capability authorization failures are not retried', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/capabilities', (route) => {
    requests++;
    return route.fulfill({ status: 401, json: {} });
  });
  await page.goto('/');
  await page.locator('#username').fill('AuthRetry');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole('alert')).toContainText('Chưa xác minh được thành phố');
  // StrictMode mounts twice; neither 401 response causes another attempt.
  expect(requests).toBe(2);
});
