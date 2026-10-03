import { test, expect } from '@playwright/test';
import { LANDMARKS } from '@xeom-rush/shared';
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
    await a.bringToFront();
    await expect(a.locator('.trip-guide')).toContainText('Dự kiến');
    await a.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await a.keyboard.down('s');
    await expect(a.locator('.trip-toast')).toContainText('Chuyến tốt! +12.500đ', { timeout: 15000 });
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
    await a.getByRole('button', { name: /^Chọn khách/ }).click();
    await expect(a.getByRole('dialog', { name: 'Chọn khách', exact: true })).toBeVisible();
    await request.post(`${endpoint}/test`, { data: { action: 'finish' } });
    await expect(a.getByRole('dialog', { name: 'Chọn khách', exact: true })).toHaveCount(0);
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

for (const adapter of ['ecs-compatible', 'cloudflare']) {
  test(`${adapter}: co-op dispatch, catalog emotes and ordered two-team relay`, async ({ browser, request }) => {
    const base = adapter === 'cloudflare' ? 'http://localhost:3028' : 'http://localhost:3027';
    const guest = (await (await request.post('http://localhost:3027/api/guest', { data: {} })).json()).guest;
    const room = await (await request.post(`${base}/api/rooms`, { data: { guest } })).json();
    const endpoint = `${base}/api/rooms/${room.invite}`;
    const contexts = [],
      pages = [],
      ids: string[] = [],
      errors: string[] = [];
    for (let i = 0; i < 4; i++) {
      const context = await browser.newContext({
          viewport: { width: i === 0 ? 390 : 1280, height: i === 0 ? 844 : 800 },
        }),
        page = await context.newPage();
      contexts.push(context);
      pages.push(page);
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`/?room=${encodeURIComponent(endpoint)}`);
      await page.getByLabel('Biệt danh trong phòng').fill(`Bạn ${i + 1}`);
      await page.getByRole('button', { name: 'Tham gia phòng mời' }).click();
      await expect(page.getByRole('dialog', { name: 'Phòng riêng' })).toBeVisible();
      ids.push((await page.evaluate(() => localStorage.getItem('xeom:guest:localhost:3027')))!.split('.')[0]);
      if (i === 1) {
        await pages[0].getByLabel('Chế độ vòng').selectOption('co-op');
        await pages[0].getByRole('button', { name: 'Bắt đầu vòng', exact: true }).click();
        await expect(page.locator('.room-round-status')).toContainText('40.000');
        await pages[0].getByRole('button', { name: 'Đồng đội và biểu cảm' }).click();
        await pages[0].getByRole('button', { name: 'Chào đồng đội!' }).click();
        await expect(page.locator('.hud-summary')).toContainText('Chào đồng đội!');
        for (const rider of pages) {
          await rider.getByRole('button', { name: 'Đồng đội và biểu cảm' }).click();
          await rider.getByRole('button', { name: 'Nhận chuyến điều phối' }).click();
        }
        const state = await (await request.get(endpoint)).json();
        expect(new Set(Object.values(state.state.teamPlay.assignments)).size).toBe(2);
        await request.post(`${endpoint}/test`, { data: { action: 'finish' } });
        await expect(pages[0].getByText('Kết quả vòng chơi', { exact: true })).toBeVisible();
      }
    }
    await pages[0].getByLabel('Chế độ vòng').selectOption('relay');
    await pages[0].getByRole('button', { name: 'Chơi lại vòng', exact: true }).click();
    await expect(pages[0].getByRole('dialog')).toHaveCount(0);
    const view = async () => (await (await request.get(endpoint)).json()).state;
    const atlas = LANDMARKS;
    for (let leg = 0; leg < 4; leg++) {
      const state = await view(),
        team = state.teamPlay.teams[0],
        target = atlas.find((l) => l.id === team.legs[leg])!;
      const carrierPage = pages[ids.indexOf(team.carrierId)];
      await request.post(`${endpoint}/test`, {
        data: { action: 'position', profileId: team.carrierId, x: target.x - 25, y: target.y },
      });
      await expect
        .poll(async () => (await view()).teamPlay.teams[0].handoffPending || (await view()).teamPlay.teams[0].completed)
        .toBe(true);
      if (leg < 3) {
        await carrierPage.getByRole('button', { name: 'Đồng đội và biểu cảm' }).click();
        await carrierPage.getByRole('button', { name: 'Trao gói tiếp sức' }).click();
        expect((await view()).teamPlay.teams[0].leg).toBe(leg);
        await request.post(`${endpoint}/test`, {
          data: { action: 'position', profileId: team.nextRiderId, x: target.x + 25, y: target.y },
        });
        await carrierPage.getByRole('button', { name: 'Trao gói tiếp sức' }).click();
        await expect.poll(async () => (await view()).teamPlay.teams[0].leg).toBe(leg + 1);
        await carrierPage.getByRole('button', { name: 'Đóng', exact: true }).click();
      }
    }
    expect((await view()).teamPlay.teams[0]).toMatchObject({ completed: true, score: 40000 });
    const profile = await (
      await request.get('http://localhost:3027/api/profile', {
        headers: {
          Authorization: `Bearer ${await pages[0].evaluate(() => localStorage.getItem('xeom:guest:localhost:3027'))}`,
        },
      })
    ).json();
    expect(profile.careerScore).toBe(0);
    await request.post(`${endpoint}/test`, { data: { action: 'finish' } });
    await expect(pages[0].getByRole('dialog', { name: 'Phòng riêng' })).toContainText('Đội 1: 40.000đ');
    expect(errors).toEqual([]);
    for (const context of contexts) await context.close();
  });
}
for (const layout of [
  { name: 'desktop', width: 1440, height: 900, touch: false },
  { name: 'tablet', width: 820, height: 620, touch: false },
  { name: 'breakpoint', width: 769, height: 600, touch: false },
  { name: 'phone', width: 390, height: 844, touch: true },
  { name: 'small phone', width: 320, height: 568, touch: true },
  { name: 'touch landscape', width: 844, height: 390, touch: true },
]) {
  test(`co-op controls and dialogs fit ${layout.name}`, async ({ browser, request }) => {
    const context = await browser.newContext({
      viewport: { width: layout.width, height: layout.height },
      hasTouch: layout.touch,
    });
    const partner = await browser.newContext();
    const page = await context.newPage(),
      other = await partner.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const guest = (await (await request.post('http://localhost:3027/api/guest', { data: {} })).json()).guest;
    const room = await (await request.post('http://localhost:3027/api/rooms', { data: { guest } })).json();
    const endpoint = `http://localhost:3027/api/rooms/${room.invite}`;
    for (const [i, rider] of [page, other].entries()) {
      await rider.goto(`/?room=${encodeURIComponent(endpoint)}`);
      await rider.getByLabel('Biệt danh trong phòng').fill(`Layout${i}`);
      await rider.getByRole('button', { name: 'Tham gia phòng mời' }).click();
      await expect(rider.getByRole('dialog', { name: 'Phòng riêng' })).toBeVisible();
    }
    await expect(page.getByRole('dialog')).toContainText('Layout1');
    await page.getByLabel('Chế độ vòng').selectOption('co-op');
    await page.getByRole('button', { name: 'Bắt đầu vòng', exact: true }).click();
    await page.bringToFront();
    await expect(page.locator('.room-round-status')).toContainText('40.000');
    const selectors = ['.hud-summary', '.hud-minimap', '.game-dock'];
    if (layout.touch) selectors.push('.joystick-mobile', '.honk-btn-mobile');
    const boxes = [];
    for (const selector of selectors) {
      const box = await page.locator(selector).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(layout.width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(layout.height);
      boxes.push({ selector, ...box! });
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i],
          b = boxes[j];
        expect(
          Math.min(a.x + a.width, b.x + b.width) <= Math.max(a.x, b.x) ||
            Math.min(a.y + a.height, b.y + b.height) <= Math.max(a.y, b.y),
          `${a.selector} overlaps ${b.selector}`,
        ).toBe(true);
      }
    for (const button of await page.locator('.game-toolbar button').all()) {
      const box = await button.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(await button.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    if (layout.touch) {
      const stick = await page.getByRole('group', { name: 'Cần điều khiển lái xe' }).boundingBox();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: stick!.x + stick!.width / 2 + 20, y: stick!.y + stick!.height / 2 }],
      });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      await expect
        .poll(() =>
          page
            .getByRole('group', { name: 'Cần điều khiển lái xe' })
            .locator('div')
            .last()
            .evaluate((el) => getComputedStyle(el).transform),
        )
        .toBe('matrix(1, 0, 0, 1, 0, 0)');
    }
    await page.getByRole('button', { name: 'Đồng đội và biểu cảm' }).click();
    for (const button of await page.getByRole('dialog').getByRole('button').all()) {
      const box = await button.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      await expect(button).toBeInViewport();
    }
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(errors).toEqual([]);
    await context.close();
    await partner.close();
  });
}
