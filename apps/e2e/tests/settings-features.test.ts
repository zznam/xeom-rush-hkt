import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function openSettings(page: Page) {
  await page.goto('/');
  await page.locator('#username').fill('ControlRider');
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('.hud-summary')).toBeVisible();
  await page.getByRole('button', { name: 'Tùy chỉnh', exact: true }).click();
  return page.getByRole('dialog', { name: 'Tùy chỉnh điều khiển' });
}

const backup = {
  format: 'xeom-rush-settings',
  version: 1,
  preferences: {
    sound: false,
    reducedMotion: true,
    handedness: 'left',
    joystickSize: 150,
    joystickOffset: 24,
    sensitivity: 1.2,
    textSize: 1.15,
    graphics: 'low',
    bindings: { up: 'i', down: 'k', left: 'j', right: 'l', horn: 'b' },
  },
};

async function upload(page: Page, value: unknown) {
  await page.getByLabel('Tệp cài đặt').setInputFiles({
    name: 'settings.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(value)),
  });
}

test('control presets persist and drive the real player without reconnecting', async ({ page, request }) => {
  let connections = 0;
  page.on('websocket', () => connections++);
  const dialog = await openSettings(page);
  const originalConnections = connections;
  await dialog.getByLabel('Bộ phím nhanh').selectOption('arrows');
  await expect(dialog.getByLabel('Phím up')).toHaveValue('arrowup');
  await dialog.getByLabel('Bộ phím nhanh').selectOption('ijkl');
  await expect(dialog.getByLabel('Phím up')).toHaveValue('i');
  await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
  expect(connections).toBe(originalConnections);
  await expect(page.getByLabel('Hướng dẫn lái xe')).toContainText('IJKL');
  const port = process.env.E2E_SERVER_PORT || '3003';
  const guest = await page.evaluate((key) => localStorage.getItem(key), `xeom:guest:localhost:${port}`);
  const fixture = async (data: Record<string, unknown>) => {
    const response = await request.post(`http://localhost:${port}/api/test/gameplay`, { data: { guest, ...data } });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  await fixture({ action: 'position', x: 2050, y: 2200 });
  await page.keyboard.down('i');
  try {
    await expect.poll(async () => (await fixture({ action: 'state' })).player.y).toBeLessThan(2170);
  } finally {
    await page.keyboard.up('i');
  }
  await page.reload();
  await page.locator('button[type="submit"]').click();
  await page.getByRole('button', { name: 'Tùy chỉnh', exact: true }).click();
  await expect(dialog.getByLabel('Bộ phím nhanh')).toHaveValue('ijkl');
  await expect(dialog.getByLabel('Phím up')).toHaveValue('i');
});

test('conflicting, reserved and modified bindings are rejected with a useful explanation', async ({ page }) => {
  const dialog = await openSettings(page);
  const up = dialog.getByLabel('Phím up');
  await up.press('s');
  await expect(dialog.getByRole('alert')).toContainText('Đi xuống');
  await expect(up).toHaveValue('w');
  await up.press('ArrowDown');
  await expect(dialog.getByRole('alert')).toContainText('hướng tương ứng');
  await expect(up).toHaveValue('w');
  await up.press('Control+q');
  await expect(dialog.getByRole('alert')).toContainText('không kèm Ctrl');
  await expect(up).toHaveValue('w');
  await up.press('Shift');
  await expect(dialog.getByRole('alert')).toContainText('Chọn một chữ');
  await up.press('i');
  await expect(up).toHaveValue('i');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByLabel('Bộ phím nhanh')).toHaveValue('custom');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('settings export, import and reload preserve the complete configuration', async ({ page }) => {
  const dialog = await openSettings(page);
  await upload(page, backup);
  await expect(dialog.getByRole('status')).toContainText('Đã nhập cài đặt');
  await expect(dialog.getByLabel('Tay thuận')).toHaveValue('left');
  await expect(dialog.getByLabel('Phím horn')).toHaveValue('b');
  await expect(dialog.getByRole('button', { name: 'Âm thanh', exact: true })).toHaveAttribute('aria-pressed', 'false');
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Xuất cài đặt', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('xeom-rush-settings.json');
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(exported).toEqual(backup);
  await page.reload();
  await page.locator('button[type="submit"]').click();
  await page.getByRole('button', { name: 'Tùy chỉnh', exact: true }).click();
  await expect(dialog.getByLabel('Kích thước cần', { exact: true })).toHaveValue('150');
  await expect(dialog.getByLabel('Khoảng cách mép', { exact: true })).toHaveValue('24');
  await expect(dialog.getByLabel('Độ nhạy', { exact: true })).toHaveValue('1.2');
  await expect(dialog.getByLabel('Cỡ chữ')).toHaveValue('1.15');
  await expect(dialog.getByLabel('Đồ họa')).toHaveValue('low');
  await expect(dialog.getByLabel('Phím horn')).toHaveValue('b');
});

test('invalid backups cannot partially change live settings', async ({ page }) => {
  const dialog = await openSettings(page);
  await upload(page, backup);
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('xeom:controls')!)))
    .toEqual(backup.preferences);
  const before = await page.evaluate(() => localStorage.getItem('xeom:controls'));
  for (const invalid of [
    null,
    [],
    { ...backup, version: 2 },
    { ...backup, preferences: { ...backup.preferences, sensitivity: 9 } },
    { ...backup, preferences: { ...backup.preferences, sound: 'false' } },
    { ...backup, preferences: { ...backup.preferences, bindings: { ...backup.preferences.bindings, up: 'k' } } },
    {
      ...backup,
      preferences: { ...backup.preferences, bindings: { ...backup.preferences.bindings, horn: 'arrowup' } },
    },
  ]) {
    await upload(page, invalid);
    await expect(dialog.getByRole('alert')).toContainText('Tệp cài đặt không hợp lệ');
    expect(await page.evaluate(() => localStorage.getItem('xeom:controls'))).toBe(before);
    await expect(dialog.getByLabel('Phím up')).toHaveValue('i');
  }
  await page
    .getByLabel('Tệp cài đặt')
    .setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(dialog.getByRole('alert')).toContainText('Tệp cài đặt không hợp lệ');
  await page
    .getByLabel('Tệp cài đặt')
    .setInputFiles({ name: 'large.json', mimeType: 'application/json', buffer: Buffer.alloc(32769, ' ') });
  await expect(dialog.getByRole('alert')).toContainText('Tệp quá lớn');
  expect(await page.evaluate(() => localStorage.getItem('xeom:controls'))).toBe(before);
});

test('reset supports cancellation, respects reduced motion and persists defaults', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const dialog = await openSettings(page);
  await upload(page, backup);
  await dialog.getByRole('button', { name: 'Đặt lại cài đặt', exact: true }).click();
  await dialog.getByRole('button', { name: 'Giữ cài đặt', exact: true }).click();
  await expect(dialog.getByLabel('Phím up')).toHaveValue('i');
  await dialog.getByRole('button', { name: 'Đặt lại cài đặt', exact: true }).click();
  await dialog.getByRole('button', { name: 'Khôi phục mặc định', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Đã khôi phục');
  await expect(dialog.getByLabel('Bộ phím nhanh')).toHaveValue('wasd');
  await expect(dialog.getByLabel('Tay thuận')).toHaveValue('right');
  await expect(dialog.getByRole('button', { name: 'Giảm chuyển động', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(dialog.getByRole('button', { name: 'Âm thanh', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await page.locator('button[type="submit"]').click();
  await page.getByRole('button', { name: 'Tùy chỉnh', exact: true }).click();
  await expect(dialog.getByLabel('Bộ phím nhanh')).toHaveValue('wasd');
  await expect(dialog.getByLabel('Đồ họa')).toHaveValue('auto');
  await expect(dialog.getByLabel('Kích thước cần', { exact: true })).toHaveValue('120');
});

for (const stored of ['null', '[]', '{broken', '{"bindings":{"up":"s"}}']) {
  test(`damaged stored preferences recover safely: ${stored}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript((value) => localStorage.setItem('xeom:controls', value), stored);
    const dialog = await openSettings(page);
    await expect(dialog.getByLabel('Bộ phím nhanh')).toHaveValue('wasd');
    await expect(dialog.getByLabel('Phím up')).toHaveValue('w');
    expect(errors).toEqual([]);
  });
}
