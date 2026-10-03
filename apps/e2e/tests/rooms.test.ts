import { test, expect } from '@playwright/test';
for (const adapter of ['ecs-compatible', 'cloudflare']) {
  test(`${adapter}: browser invites, delivery, results, rematch, host transfer and recovery`, async ({
    browser,
    request,
  }) => {
    const base = adapter === 'cloudflare' ? 'http://localhost:3028' : 'http://localhost:3027';
    const aContext = await browser.newContext(),
      bContext = await browser.newContext();
    const a = await aContext.newPage(),
      b = await bContext.newPage();
    const errors: string[] = [];
    for (const p of [a, b]) p.on('pageerror', (e) => errors.push(e.message));
    let endpoint: string;
    if (adapter === 'ecs-compatible') {
      await a.goto('/');
      await a.getByRole('button', { name: 'Phòng bạn bè', exact: true }).click();
      await a.getByLabel('Biệt danh trong phòng').fill('Cô Ba');
      await a.getByRole('button', { name: 'Tạo phòng riêng' }).click();
      await expect(a.getByRole('dialog', { name: 'Phòng riêng' })).toBeVisible();
      const link = await a.getByLabel('Liên kết mời').inputValue();
      endpoint = new URL(link).searchParams.get('room')!;
    } else {
      const guest = (await (await request.post('http://localhost:3027/api/guest', { data: {} })).json()).guest;
      const room = await (await request.post(`${base}/api/rooms`, { data: { guest } })).json();
      endpoint = `${base}/api/rooms/${room.invite}`;
      await a.goto(`/?room=${encodeURIComponent(endpoint)}`);
      await a.getByLabel('Biệt danh trong phòng').fill('Cô Ba');
      await a.getByRole('button', { name: 'Tham gia phòng mời' }).click();
      await expect(a.getByRole('dialog', { name: 'Phòng riêng' })).toBeVisible();
    }
    await b.goto(`/?room=${encodeURIComponent(endpoint)}`);
    await b.getByLabel('Biệt danh trong phòng').fill('Chú Tư');
    await b.getByRole('button', { name: 'Tham gia phòng mời' }).click();
    await expect(a.getByRole('dialog').getByText(/Chú Tư/)).toBeVisible();
    await a.getByRole('button', { name: 'Bắt đầu vòng', exact: true }).click();
    await expect(a.getByRole('dialog')).toHaveCount(0);
    await expect(b.getByRole('dialog')).toHaveCount(0);
    const credential = await a.evaluate(() => localStorage.getItem('xeom:guest:localhost:3027'));
    expect(credential).toBeTruthy();
    const profileId = credential!.split('.')[0];
    await request.post(`${endpoint}/test`, { data: { action: 'job', kind: 0, profileId } });
    await request.post(`${endpoint}/test`, { data: { action: 'position', profileId, x: 2050, y: 2200 } });
    await a.keyboard.down('s');
    await expect(a.locator('.trip-toast')).toContainText('Chuyến tốt! +12.500đ', { timeout: 7000 });
    await a.keyboard.up('s');
    await request.post(`${endpoint}/test`, { data: { action: 'checkpoint' } });
    const profile = async () =>
      await (
        await request.get('http://localhost:3027/api/profile', { headers: { Authorization: `Bearer ${credential}` } })
      ).json();
    const saved = await profile();
    expect(saved.careerScore).toBeGreaterThanOrEqual(11000);
    await request.post(`${endpoint}/test`, { data: { action: 'checkpoint' } });
    expect((await profile()).careerScore).toBe(saved.careerScore);
    await request.post(`${endpoint}/test`, { data: { action: 'finish' } });
    await expect(a.getByText('Kết quả vòng chơi', { exact: true })).toBeVisible();
    await expect(a.locator('.room-results')).toContainText('Cô Ba');
    await a.getByRole('button', { name: 'Chơi lại vòng', exact: true }).click();
    await expect(b.getByRole('dialog')).toHaveCount(0);
    await aContext.close();
    await request.post(`${endpoint}/test`, { data: { action: 'finish' } });
    await expect(b.getByRole('button', { name: 'Chơi lại vòng', exact: true })).toBeVisible();
    await b.getByRole('button', { name: 'Chơi lại vòng', exact: true }).click();
    await request.post(`${endpoint}/test`, { data: { action: 'restart' } });
    await b.reload();
    await b.getByRole('button', { name: 'Tham gia phòng mời' }).click();
    await expect(b.getByText('Vòng chơi bị gián đoạn', { exact: true })).toBeVisible();
    expect((await profile()).careerScore).toBe(saved.careerScore);
    await b.getByRole('button', { name: 'Rời phòng', exact: true }).click();
    await b.getByRole('button', { name: 'Đóng', exact: true }).click();
    await b.locator('button[type="submit"]').click();
    await expect(b.locator('.hud-container')).toBeVisible();
    await expect(b.getByRole('dialog', { name: 'Phòng riêng' })).toHaveCount(0);
    expect(errors).toEqual([]);
    await bContext.close();
  });
}
