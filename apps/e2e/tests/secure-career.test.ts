import { test, expect } from '@playwright/test';
test('career ranking preserves HTTPS while the rider uses a secure WebSocket URL', async ({ page, request }) => {
  const port = process.env.E2E_SERVER_PORT || '3003';
  const base = `http://localhost:${port}`;
  const secure = 'https://secure-career.example';
  await page.route(`${secure}/api/capabilities`, (route) => route.fulfill({ json: { managed: false } }));
  await page.route(`${secure}/api/guest`, async (route) =>
    route.fulfill({ json: await (await request.post(`${base}/api/guest`)).json() }),
  );
  await page.route(`${secure}/api/rooms/capabilities`, (route) =>
    route.fulfill({ json: { available: false, modes: [] } }),
  );
  const rankingRequests: string[] = [];
  await page.route('**/api/careers', (route) => {
    rankingRequests.push(route.request().url());
    return route.fulfill({
      json: [{ id: 'ranked-driver', username: 'SecureCareerLeader', careerScore: 10000, totalDeliveries: 1 }],
    });
  });
  // Forward secure browser frames to the actual local authoritative server.
  const upstreams: WebSocket[] = [];
  await page.routeWebSocket('wss://secure-career.example/**', (route) => {
    const upstream = new WebSocket(`ws://localhost:${port}/${new URL(route.url()).search}`);
    upstreams.push(upstream);
    const pending: (string | Buffer)[] = [];
    route.onMessage((message) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(message);
      else pending.push(message);
    });
    upstream.addEventListener('open', () => pending.splice(0).forEach((message) => upstream.send(message)));
    upstream.binaryType = 'arraybuffer';
    upstream.addEventListener('message', (event) =>
      route.send(typeof event.data === 'string' ? event.data : Buffer.from(event.data)),
    );
    upstream.addEventListener('close', () => route.close());
    route.onClose(() => upstream.close());
  });
  try {
    await page.goto('/');
    await page.locator('.server-settings summary').click();
    await page.locator('#serverUrl').fill('wss://secure-career.example');
    await page.locator('#username').fill('SecureCareerRider');
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('.connection-cover')).toHaveCount(0);
    await page.getByRole('button', { name: 'Hồ sơ', exact: true }).click();
    await expect(page.getByText('SecureCareerLeader — 10.000đ · 1 chuyến', { exact: true })).toBeVisible();
    expect(rankingRequests.length).toBeGreaterThan(0);
    expect([...new Set(rankingRequests)]).toEqual([`${secure}/api/careers`]);
    await expect(page.getByText('Chưa tải được bảng nghề nghiệp. Thử lại sau nhé.', { exact: true })).toHaveCount(0);
  } finally {
    upstreams.forEach((socket) => socket.close());
  }
});
