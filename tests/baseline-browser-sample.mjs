/* global process, console, URL, fetch, crypto, setInterval, clearInterval, localStorage, window, performance, requestAnimationFrame */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
const root = resolve(process.env.BASELINE_ROOT || '/tmp/xeom-release-baseline');
const require = createRequire(resolve(root, 'apps/server/package.json'));
const { WebSocket } = require('ws'),
  { encodeJoin, encodeInput } = require('@xeom-rush/shared');
const { chromium } = createRequire(resolve('apps/e2e/package.json'))('@playwright/test');
const children = [],
  sockets = [],
  browsers = [],
  errors = [];
let bytes = 0,
  running = true,
  timer;
function start(command, args, env) {
  const p = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  p.stdout.on('data', (d) => {
    logs = (logs + d).slice(-4000);
  });
  p.stderr.on('data', (d) => {
    logs = (logs + d).slice(-4000);
  });
  p.on('exit', (code) => {
    if (running && code) errors.push(`${code}: ${logs}`);
  });
  children.push(p);
}
async function ready(url) {
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await pause(100);
  }
  throw new Error(`Not ready ${url}`);
}
try {
  for (const port of [3041, 3044]) {
    start(process.execPath, ['apps/server/dist/index.js'], {
      NODE_ENV: 'development',
      PORT: String(port),
      BOT_COUNT: '8',
      DEPLOY_TARGET: 'legacy',
      MONGODB_URI: 'mongodb://localhost:1/test',
    });
    await ready(`http://localhost:${port}/api/ready`);
  }
  start('bun', ['run', '--filter', 'client', 'dev', '--port', '5188'], {
    VITE_DEPLOY_TARGET: '',
    VITE_WS_URL: 'ws://localhost:3044',
  });
  await ready('http://localhost:5188');
  for (const [port, count] of [
    [3041, 64],
    [3044, 8],
  ])
    for (let i = 0; i < count; i++) {
      const ws = new WebSocket(`ws://localhost:${port}/?session=${crypto.randomUUID()}`);
      ws.on('message', (data) => {
        bytes += data.byteLength || data.length;
      });
      ws.on('error', (e) => errors.push(e.message));
      await once(ws, 'open');
      ws.send(encodeJoin(`Base${i}`));
      sockets.push(ws);
    }
  const pages = [];
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const browser = await chromium.launch({
      args: [
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
      ],
    });
    browsers.push(browser);
    const context = await browser.newContext({ viewport, hasTouch: viewport.width < 500 });
    await context.addInitScript(() => {
      localStorage.setItem('xeom:tutorial', 'done');
      const data = { fps: [], heap: [] };
      window.__baseline = data;
      let last = performance.now(),
        frames = 0;
      const frame = () => {
        frames++;
        const now = performance.now();
        if (now - last >= 1000) {
          data.fps.push((frames * 1000) / (now - last));
          if (performance.memory) data.heap.push(performance.memory.usedJSHeapSize);
          last = now;
          frames = 0;
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    const page = await context.newPage();
    page.on('websocket', (ws) => {
      if (ws.url().includes('session=') && !ws.url().startsWith('ws://localhost:3044'))
        errors.push(`Wrong baseline owner: ${ws.url()}`);
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:5188');
    await page.locator('#username').fill(`Baseline${viewport.width}`);
    await page.locator('button[type="submit"]').click();
    await page.locator('.hud-container').waitFor();
    pages.push({ page, viewport });
  }
  bytes = 0;
  const started = Date.now();
  let seq = 0;
  timer = setInterval(() => {
    for (const ws of sockets) if (ws.readyState === WebSocket.OPEN) ws.send(encodeInput(++seq, 0, 0, 0));
  }, 50);
  await pause(60000);
  const render = [];
  for (const sample of pages) {
    const data = await sample.page.evaluate(() => window.__baseline),
      sorted = [...data.fps].sort((a, b) => a - b);
    render.push({
      viewport: sample.viewport,
      fpsP05: sorted[Math.floor(sorted.length * 0.05)],
      fpsMedian: sorted[Math.floor(sorted.length * 0.5)],
      heapStart: data.heap[0],
      heapEnd: data.heap.at(-1),
      samples: data.fps.length,
    });
  }
  const elapsedMs = Date.now() - started;
  const output = {
    baselineCommit: '2c41af5997de7a8c268492be6b9777a1a6e4b673',
    elapsedMs,
    publicHumans: 74,
    publicBots: 16,
    bytesPerRawPeerSecond: bytes / sockets.length / (elapsedMs / 1000),
    render,
    errors,
  };
  await writeFile(
    process.env.BASELINE_OUTPUT || '/tmp/xeom-baseline-browser.json',
    JSON.stringify(output, null, 2) + '\n',
  );
  assert.deepEqual(errors, []);
  console.log('BASELINE_BROWSER_PASS');
} finally {
  running = false;
  clearInterval(timer);
  for (const ws of sockets) ws.close();
  for (const b of browsers) await b.close();
  for (const p of children.reverse())
    if (p.exitCode === null) {
      p.kill('SIGTERM');
      await Promise.race([once(p, 'exit'), pause(5000).then(() => p.kill('SIGKILL'))]);
    }
}
