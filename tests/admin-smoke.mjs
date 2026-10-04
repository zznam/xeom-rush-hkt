/* global process, console, setTimeout, clearTimeout, fetch, URL, structuredClone */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { until, connect, post } from './regional-live.mjs';
const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { roomKey, issueGuest, verifyGuest } = require('./dist/admission.js');
const dir = await mkdtemp(join(tmpdir(), 'xeom-admin-'));
const origin = 'http://127.0.0.1:3200';
const workers = [];
const players = [];
let logs = '';
const secret = 'test-regional-secret-at-least-thirty-two-characters';
function start(file, port, extra = {}) {
  const child = spawn(
    'deno',
    ['run', '--allow-net', '--allow-read', '--allow-write', '--allow-env', '--allow-sys', '--unstable-kv', file],
    {
      env: {
        ...process.env,
        NODE_ENV: 'development',
        ADMIN_HUB_ENABLED: '0',
        PORT: String(port),
        DENO_KV_PATH: join(dir, `${port}.db`),
        GAME_MASTER_ENABLED: '1',
        ADMIN_CONTROL_URL: origin,
        GAME_DEPLOYMENT_ID: 'legacy',
        ADMIN_WORKER_TOKEN: 'test-worker-credential-at-least-32-characters',
        GUEST_IDENTITY_SECRET: secret,
        GUEST_SECRET: secret,
        DEPLOY_TARGET: 'legacy',
        BOT_COUNT: '0',
        ...extra,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout.on('data', (data) => {
    logs = (logs + data).slice(-14000);
  });
  child.stderr.on('data', (data) => {
    logs = (logs + data).slice(-14000);
  });
  workers.push(child);
  return child;
}
async function stop(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}
async function eventually(check, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch {
      /* starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for managed city');
}
async function api(path, method = 'GET', body) {
  const response = await fetch(`${origin}/api/admin/${path}`, {
    method,
    headers: {
      Cookie: 'xeom_admin=test-session',
      Origin: origin,
      'x-csrf-token': 'test-csrf',
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  assert.ok(response.ok, `${path}: ${JSON.stringify(data)}`);
  return data;
}
const detail = (city) => api(`cities/${encodeURIComponent(city.key)}`);
async function command(city, action) {
  const current = await eventually(async () => {
    const d = await detail(city);
    return d.city.revision === d.config.revision && !d.config.pending ? d : null;
  });
  const result = await api(`cities/${encodeURIComponent(city.key)}/commands`, 'POST', {
    id: randomUUID(),
    runtimeId: current.city.ref.runtimeId,
    expectedRevision: current.config.revision,
    action,
  });
  return eventually(async () => {
    const d = await detail(city);
    const c = d.commands.find((c) => c.id === result.id);
    if (c?.status === 'rejected') throw new Error(c.result);
    return c?.status === 'applied' ? d : null;
  }, 45000);
}
async function joinCity(port, guest, name, session = randomUUID(), regional = false) {
  let url = `ws://127.0.0.1:${port}${regional ? '/rooms/city-01' : ''}?session=${session}&managed=1&guest=${encodeURIComponent(guest)}`;
  if (regional) {
    const response = await fetch(`http://127.0.0.1:${port}/api/reservations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-matchmaker-key': roomKey(secret) },
      body: JSON.stringify({ session, guest }),
    });
    assert.equal(response.status, 200);
    url += `&ticket=${(await response.json()).ticket}`;
  }
  const p = connect(url, name);
  players.push(p);
  return { p, url };
}
try {
  const hub = start('tests/admin-hub.ts', 3200, { GAME_MASTER_ENABLED: '0' });
  await eventually(async () => (await fetch(`${origin}/test/ready`)).ok);
  start('apps/server/dist/index.js', 3201);
  start('apps/server/dist/index.js', 3202);
  for (const [port, region] of [
    [3203, 'test-sg'],
    [3204, 'test-hk'],
  ])
    start('apps/server/dist/index.js', port, {
      DEPLOY_TARGET: 'regional-production',
      GAME_DEPLOYMENT_ID: 'aws',
      GAME_REGION: region,
      ROOM_ID: 'city-01',
      GUEST_SECRET: secret,
    });
  await eventually(async () => (await api('cities')).length === 4);
  const cities = await api('cities');
  const legacy = cities.filter((c) => c.ref.deployment === 'legacy');
  const sg = cities.find((c) => c.ref.region === 'test-sg');
  const hk = cities.find((c) => c.ref.region === 'test-hk');
  assert.equal(legacy.length, 2);
  const legacyIdentity = (await (await post('http://127.0.0.1:3201', '/api/guest')).json()).guest;
  const previousCredential = issueGuest(secret);
  assert.equal(
    (await post('http://127.0.0.1:3201', '/api/guest/link', { guest: legacyIdentity, legacy: previousCredential }))
      .status,
    200,
  );
  const linked = await fetch('http://127.0.0.1:3201/api/profile', {
    headers: { Authorization: `Bearer ${legacyIdentity}` },
  });
  assert.equal(linked.status, 200);
  assert.equal((await linked.json()).id, verifyGuest(previousCredential, secret));
  assert.equal(
    (await post('http://127.0.0.1:3201', '/api/guest/link', { guest: legacyIdentity, legacy: 'matching-nickname' }))
      .status,
    403,
  );

  assert.notEqual(legacy[0].key, legacy[1].key);
  const initial = await detail(legacy[0]);
  const config = structuredClone(initial.config.config);
  config.bots.count = 12;
  await command(legacy[0], { type: 'configure', config });
  await eventually(async () => (await detail(legacy[0])).city.bots.current === 12);
  assert.equal((await detail(legacy[1])).config.config.bots.count, 8);
  assert.equal((await detail(sg)).config.revision, 0);
  const guest = (await (await post('http://127.0.0.1:3203', '/api/guest')).json()).guest;
  const a = await joinCity(3203, guest, 'Same-name', undefined, true);
  const b = await joinCity(3204, guest, 'Same-name', undefined, true);
  await until(() => a.p.city && b.p.city);
  await command(sg, { type: 'pause' });
  await until(() => a.p.city.paused);
  const tick = a.p.snapshot.tick;
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(a.p.snapshot.tick, tick);
  assert.equal(b.p.city.paused, false);
  await command(sg, { type: 'resume' });
  await until(() => a.p.snapshot.tick > tick);
  await command(sg, { type: 'close' });
  a.p.ws.terminate();
  await until(() => a.p.closed);
  const reconnected = connect(a.url, 'Same-name');
  players.push(reconnected);
  await until(() => reconnected.city);
  assert.equal(reconnected.id, a.p.id);
  await command(sg, { type: 'open' });
  await api(`bans/aws/${guest.split('.')[2]}`, 'PUT', {
    reason: 'Cross-region smoke ban',
    expiresAt: null,
    version: null,
  });
  await until(() => reconnected.closed && b.p.closed, 15000);
  const rejected = connect(b.url, 'Same-name');
  players.push(rejected);
  await until(() => rejected.closed);
  assert.equal(rejected.id, '');
  const [ban] = await api('bans?deployment=aws');
  await api(`bans/aws/${ban.guestId}`, 'PUT', { ...ban, revoked: true });
  const c = await joinCity(3204, guest, 'Same-name', undefined, true);
  await until(() => c.p.city);
  const sandbox = (await detail(hk)).config.config;
  sandbox.mode = 'sandbox';
  sandbox.rules.speed = 300;
  const change = command(hk, { type: 'configure', config: sandbox });
  await until(() => c.p.city.countdownSeconds > 0);
  assert.ok(c.p.city.countdownSeconds <= 30);
  await change;
  await until(() => c.p.closed);
  const sandboxPlayer = await joinCity(3204, guest, 'Same-name', undefined, true);
  await until(() => sandboxPlayer.p.city?.mode === 'sandbox');
  assert.equal(sandboxPlayer.p.city.speed, 300);
  // Controller loss blocks new admissions, while existing simulation keeps running.
  await stop(hub);
  const oldTick = sandboxPlayer.p.snapshot.tick;
  await until(() => sandboxPlayer.p.snapshot.tick > oldTick + 5);
  const denied = connect(sandboxPlayer.url.replace(/session=[^&]+/, `session=${randomUUID()}`), 'Denied');
  players.push(denied);
  await until(() => denied.closed);
  assert.equal(denied.id, '');
  console.log(
    'PASS: native KV hub, two Deno instances, two regional cities, selected-city bot control, pause, reconnect, cross-region bans/unban, 30-second sandbox transition, controller outage',
  );
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  for (const player of players) player.ws.terminate();
  await Promise.all(workers.map(stop));
  await rm(dir, { recursive: true, force: true });
}
