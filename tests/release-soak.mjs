/* global process, console, URL, fetch, crypto, setInterval, clearInterval, localStorage, window, performance, requestAnimationFrame */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
const root = resolve('.'),
  require = createRequire(resolve(root, 'apps/server/package.json'));
const { WebSocket } = require('ws');
const {
  encodeJoin,
  encodeInput,
  decodeConfig,
  decodeSnapshot,
  decodeDeltaSnapshot,
  EMessageType,
  roadSegmentClear,
  LANDMARKS,
} = require('@xeom-rush/shared');
const { Miniflare, Log, LogLevel } = createRequire(resolve(root, 'apps/room-service/package.json'))('miniflare');
const { chromium } = createRequire(resolve(root, 'apps/e2e/package.json'))('@playwright/test');
const { DynamoDBClient, CreateTableCommand, DeleteTableCommand } = require('@aws-sdk/client-dynamodb');
const humans = Number(process.env.SOAK_PUBLIC_HUMANS || 64);
const duration = Number(process.env.SOAK_DURATION_MS || 1800000),
  secret = 'local-soak-guest-secret-with-32-characters';
const checkpointSecret = 'local-soak-checkpoint-secret-with-32-characters';
const table = `release-soak-${Date.now()}`,
  directory = await mkdtemp(join(tmpdir(), 'xeom-soak-'));
const dynamo = new DynamoDBClient({
  endpoint: process.env.TEST_DYNAMO_URL || 'http://localhost:8800',
  region: 'local',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});
const children = [],
  browsers = [],
  sockets = [],
  rooms = [],
  errors = [],
  observations = { phases: new Set(), rain: false, closures: new Set(), events: new Set(), jobs: new Set() };
let mf,
  timer,
  maintenance,
  totalBytes = 0,
  deliveries = 0,
  rounds = 0;
const metrics = [],
  browserSamples = [],
  commandTimes = new Map();
async function json(url, body, headers = {}) {
  const r = await fetch(url, {
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    headers: { 'Content-Type': 'application/json', ...headers },
  });
  assert.ok(r.ok, `${r.status}: ${url}`);
  return r.json();
}
async function until(fn, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {}
    await pause(100);
  }
  throw new Error('Startup/join timed out');
}
function child(command, args, env, label) {
  const p = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  p.stdout.on('data', (d) => {
    logs = (logs + d).slice(-4000);
  });
  p.stderr.on('data', (d) => {
    logs = (logs + d).slice(-4000);
  });
  p.on('exit', (code) => {
    if (code && !closing) errors.push(`${label} exited ${code}: ${logs}`);
  });
  children.push(p);
  return p;
}
function command(s, action, target, value) {
  if (s.ws.readyState !== WebSocket.OPEN) return;
  const key = `${s.id}:${action}`,
    now = Date.now();
  if (now - (commandTimes.get(key) || 0) < 1100) return;
  commandTimes.set(key, now);
  s.ws.send(
    `control:${JSON.stringify({ version: 1, id: crypto.randomUUID(), action, ...(target ? { target } : {}), ...(value ? { value } : {}) })}`,
  );
}
async function open(url, name) {
  const ws = new WebSocket(url),
    s = {
      ws,
      id: '',
      seq: 0,
      snapshot: null,
      gameplay: null,
      room: null,
      bytes: 0,
      lastDeliveries: 0,
      routeIndex: 0,
      routeKey: '',
    };
  ws.binaryType = 'arraybuffer';
  ws.on('message', (data, binary) => {
    const bytes = typeof data === 'string' ? data.length : data.byteLength;
    totalBytes += bytes;
    s.bytes += bytes;
    if (binary) {
      const type = new DataView(data).getUint8(0);
      if (type === EMessageType.CONFIG) {
        s.id = decodeConfig(data).myId;
        s.seq = 0;
        s.snapshot = null;
        s.gameplay = null;
      }
      if (type === EMessageType.SNAPSHOT) s.snapshot = decodeSnapshot(data);
      if (type === EMessageType.DELTA_SNAPSHOT && s.snapshot) s.snapshot = decodeDeltaSnapshot(data, s.snapshot);
    } else {
      const text = data.toString();
      if (text.startsWith('control:')) {
        const message = JSON.parse(text.slice(8));
        if (message.kind === 'room') s.room = message.data;
        if (message.kind === 'gameplay' && message.data) {
          s.gameplay = message.data;
          const g = s.gameplay;
          observations.phases.add(g.city.phase);
          observations.rain ||= g.city.rain;
          if (g.city.closure?.active) observations.closures.add(g.city.closure.id);
          if (g.city.event) observations.events.add(g.city.event.id);
          if (g.trip) observations.jobs.add(g.trip.kind);
        }
      }
      if (text.startsWith('city:')) {
        const count = JSON.parse(text.slice(5)).deliveries;
        deliveries += Math.max(0, count - s.lastDeliveries);
        s.lastDeliveries = count;
      }
    }
  });
  ws.on('error', (e) => errors.push(e.message));
  ws.on('close', (code, reason) => {
    if (!closing && code !== 1000) errors.push(`${name} closed ${code}: ${reason}`);
  });
  await once(ws, 'open');
  ws.send(encodeJoin(name));
  await until(() => s.id && s.snapshot);
  sockets.push(s);
  return s;
}
function drive(s) {
  if (!s.snapshot || !s.gameplay || s.ws.readyState !== WebSocket.OPEN || (s.room && s.room.status !== 'running'))
    return;
  const p = s.snapshot.players.find((p) => p.id === s.id),
    g = s.gameplay;
  if (!p) return;
  if (s.room?.mode === 'co-op' && !g.trip && !g.selectedPickup) command(s, 'dispatch-job');
  const nav = g.navigation;
  if (!nav) {
    if (!s.room || s.room.mode === 'competitive') {
      const offers = g.offers.filter((o) => !g.reservations[o.id]);
      if (offers.length) command(s, 'select-pickup', offers[parseInt(s.id.slice(-2), 16) % offers.length || 0].id);
    }
    s.ws.send(encodeInput(++s.seq, 0, 0, 0));
    return;
  }
  // The server already publishes a cleared remaining road route; follow its next corner.
  const target = nav.route[1] || nav.target;
  let dx = target.x - p.x,
    dy = target.y - p.y,
    norm = Math.hypot(dx, dy);
  const relay =
    s.room?.teamPlay?.kind === 'relay'
      ? s.room.teamPlay.teams.find((t) => t.members.includes(s.id.replace('room-', '')))
      : null;
  if (relay?.handoffPending && relay.carrierId === s.id.replace('room-', ''))
    command(s, 'relay-handoff', relay.nextRiderId);
  if (norm < 20) {
    dx = 0;
    dy = 0;
    norm = 1;
  }
  s.ws.send(encodeInput(++s.seq, dx / Math.max(norm, 25), dy / Math.max(norm, 25), Math.atan2(dy, dx)));
}
let closing = false,
  interrupted = false;
process.once('SIGINT', () => {
  interrupted = true;
});
process.once('SIGTERM', () => {
  interrupted = true;
});
try {
  await dynamo.send(
    new CreateTableCommand({
      TableName: table,
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
      AttributeDefinitions: [
        { AttributeName: 'pk', AttributeType: 'S' },
        { AttributeName: 'board', AttributeType: 'S' },
        { AttributeName: 'careerScore', AttributeType: 'N' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'leaderboard',
          KeySchema: [
            { AttributeName: 'board', KeyType: 'HASH' },
            { AttributeName: 'careerScore', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    }),
  );
  const common = {
    NODE_ENV: 'development',
    GUEST_SECRET: secret,
    ROOM_CHECKPOINT_SECRET: checkpointSecret,
    BOT_COUNT: '8',
    ALLOW_ROOM_TESTS: 'true',
    MAX_PRIVATE_ROOMS: '4',
    RELEASE_SHA: table,
  };
  child(
    process.execPath,
    ['apps/server/dist/index.js'],
    {
      ...common,
      PORT: '3037',
      DEPLOY_TARGET: 'regional-production',
      PRIVATE_ROOMS_ENABLED: 'true',
      ROOM_ADAPTER: 'local',
      GAME_REGION: 'soak-region',
      ROOM_ID: 'soak-owner',
      ROOM_CAPACITY: String(humans),
      DYNAMODB_TABLE: table,
      AWS_REGION: 'local',
      AWS_ENDPOINT_URL: process.env.TEST_DYNAMO_URL || 'http://localhost:8800',
      AWS_ACCESS_KEY_ID: 'local',
      AWS_SECRET_ACCESS_KEY: 'local',
    },
    'ECS',
  );
  child(
    'deno',
    [
      'run',
      '--allow-net',
      '--allow-read',
      '--allow-write',
      '--allow-env',
      '--allow-sys',
      '--unstable-kv',
      'apps/server/dist/index.js',
    ],
    { ...common, PORT: '3040', DENO_KV_PATH: join(directory, 'career.db'), DEPLOY_TARGET: 'legacy', ROOM_ADAPTER: '' },
    'Deno',
  );
  for (const port of [3037, 3040]) {
    await until(async () => (await json(`http://localhost:${port}/api/ready`)).ready);
    assert.equal(
      (await json(`http://localhost:${port}/api/health`)).version,
      table,
      "Require this run's server, not an existing listener",
    );
  }
  mf = new Miniflare({
    port: 3038,
    scriptPath: resolve(root, 'apps/room-service/dist/index.js'),
    modules: true,
    compatibilityDate: '2026-08-01',
    durableObjects: { ROOMS: { className: 'PrivateRoom', useSQLite: true } },
    bindings: {
      GUEST_SECRET: secret,
      ROOM_CHECKPOINT_SECRET: checkpointSecret,
      CAREER_API_URL: 'http://localhost:3040',
      ALLOWED_ORIGINS: 'http://localhost:5187',
      TEST_MODE: 'true',
    },
    log: new Log(LogLevel.WARN),
  });
  await mf.ready;
  child(
    'bun',
    ['run', '--filter', 'client', 'dev', '--port', '5187', '--strictPort'],
    { VITE_DEPLOY_TARGET: '', VITE_WS_URL: 'ws://localhost:3040' },
    'Vite',
  );
  await until(async () => (await fetch('http://localhost:5187')).ok);
  for (const [port, count] of [
    [3037, humans],
    [3040, 8],
  ]) {
    for (let i = 0; i < count; i++) {
      const guest = (await json(`http://localhost:${port}/api/guest`, {})).guest,
        session = crypto.randomUUID();
      let url = `ws://localhost:${port}/?guest=${encodeURIComponent(guest)}&session=${session}`;
      if (port === 3037) {
        const reservation = await json(
          `http://localhost:${port}/api/reservations`,
          { guest, session },
          { 'X-Matchmaker-Key': createHmac('sha256', secret).update('matchmaker-rpc').digest('hex') },
        );
        url = `ws://localhost:${port}/rooms/soak-owner?guest=${encodeURIComponent(guest)}&session=${session}&ticket=${reservation.ticket}`;
      }
      await open(url, `Soak${port}-${i}`);
    }
  }
  for (const base of ['http://localhost:3037', 'http://localhost:3038'])
    for (const mode of ['competitive', 'co-op', 'relay']) {
      const guest = (await json('http://localhost:3040/api/guest', {})).guest;
      const room = await json(`${base}/api/rooms`, { guest }),
        endpoint =
          base === 'http://localhost:3037'
            ? `${base}/rooms/soak-owner/private/${room.invite}`
            : `${base}/api/rooms/${room.invite}`;
      // The ECS adapter returns its explicit API owner route; do not use spatial/public routing.
      const api = `${room.apiUrl || base}/api/rooms/${room.invite}`;
      const members = [];
      for (let i = 0; i < 4; i++) {
        const credential = i ? (await json('http://localhost:3040/api/guest', {})).guest : guest;
        const match = await json(`${api}/join`, { guest: credential });
        members.push(await open(match.serverUrl, `Team${mode}-${i}`));
      }
      const host = members[0];
      command(host, 'room-mode', undefined, mode);
      await pause(1200);
      if (mode === 'competitive') command(host, 'room-bots', undefined, 'true');
      await pause(1200);
      command(host, 'room-start');
      await until(() => host.room?.status === 'running');
      rooms.push({ api, host, members, lastRound: host.room.roundId });
      rounds++;
    }
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
      const data = { frames: 0, fps: [], heap: [] };
      window.__soak = data;
      let last = performance.now(),
        frames = 0;
      const frame = () => {
        frames++;
        data.frames++;
        const now = performance.now();
        if (now - last >= 1000) {
          data.fps.push((frames * 1000) / (now - last));
          if (data.fps.length > 1800) data.fps.shift();
          if (performance.memory) data.heap.push(performance.memory.usedJSHeapSize);
          if (data.heap.length > 1800) data.heap.shift();
          last = now;
          frames = 0;
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    const page = await context.newPage();
    page.on('websocket', (ws) => {
      if (!ws.url().includes('session=')) return;
      if (!ws.url().startsWith('ws://localhost:3040')) errors.push(`Wrong browser owner: ${ws.url()}`);
    });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`Browser: ${m.text()}`);
    });
    await page.goto('http://localhost:5187');
    await page.locator('#username').fill(`Render${viewport.width}`);
    await page.locator('button[type="submit"]').click();
    await page.locator('.hud-container').waitFor();
    browserSamples.push({ viewport, page });
  }
  // Exclude connection/JIT setup from steady-state measurements, keeping it in separate samples.
  timer = setInterval(() => {
    for (const s of sockets) drive(s);
  }, 50);
  await pause(30000);
  for (const port of [3037, 3040]) await json(`http://localhost:${port}/api/test/metrics-reset`, {});
  for (const room of rooms) await json(`${room.api}/test`, { action: 'metrics-reset' });
  clearInterval(timer);
  totalBytes = 0;
  for (const s of sockets) s.bytes = 0;
  const started = Date.now();
  console.log(
    `SOAK_STARTED ${new Date(started).toISOString()} duration=${duration} public${humans}+8+2 browsers, 6 team/private rooms`,
  );
  timer = setInterval(() => {
    for (const s of sockets) drive(s);
  }, 50);
  maintenance = setInterval(() => {
    for (const r of rooms) {
      if (['results', 'interrupted'].includes(r.host.room?.status)) command(r.host, 'room-rematch');
      if (r.host.room?.roundId !== r.lastRound) {
        rounds++;
        r.lastRound = r.host.room?.roundId;
      }
    }
  }, 1500);
  while (!interrupted && Date.now() - started < duration) {
    await pause(Math.min(30000, duration - (Date.now() - started)));
    const nodes = await Promise.all([3037, 3040].map((port) => json(`http://localhost:${port}/api/metrics`)));
    const cloud = await Promise.all(
      rooms
        .filter((r) => r.api.includes(':3038'))
        .map(async (r) => (await json(`${r.api}/test`, { action: 'metrics' })).metrics),
    );
    metrics.push({ elapsedMs: Date.now() - started, nodes, cloud });
    console.log(
      `SOAK_PROGRESS ${Math.round((Date.now() - started) / 1000)}s p95=${nodes.map((n) => n.public.p95Ms)} cloud=${cloud.map((c) => c.p95Ms)} deliveries=${deliveries} rounds=${rounds} errors=${errors.length}`,
    );
  }
  assert.ok(!interrupted, 'Soak interrupted before completion');
  const render = [];
  for (const sample of browserSamples) {
    const data = await sample.page.evaluate(() => window.__soak);
    const sorted = [...data.fps].sort((a, b) => a - b);
    render.push({
      viewport: sample.viewport,
      frames: data.frames,
      fpsP05: sorted[Math.floor(sorted.length * 0.05)],
      fpsMedian: sorted[Math.floor(sorted.length * 0.5)],
      heapStart: data.heap[0],
      heapEnd: data.heap.at(-1),
      samples: data.fps.length,
    });
  }
  const elapsedMs = Date.now() - started,
    output = {
      startedAt: new Date(started).toISOString(),
      elapsedMs,
      configuredPublicCapacity: humans,
      publicHumans: humans + 10,
      publicBots: 16,
      roomHumans: 24,
      roomBots: 8,
      adapters: ['ECS+DynamoDB', 'Cloudflare Durable Objects+Deno KV'],
      totalBytes,
      bytesPerPeerSecond: totalBytes / sockets.length / (elapsedMs / 1000),
      deliveries,
      rounds,
      observations: {
        ...observations,
        phases: [...observations.phases],
        closures: [...observations.closures],
        events: [...observations.events],
        jobs: [...observations.jobs],
      },
      render,
      metrics,
      errors,
    };
  const path = process.env.SOAK_OUTPUT || 'docs/validation/release-soak.json';
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify(output, null, 2) + '\n');
  assert.deepEqual(errors, []);
  for (const m of metrics)
    for (const value of [...m.nodes.flatMap((n) => [n.public, ...n.private]), ...m.cloud])
      assert.ok(value.p95Ms < 40, `p95 ${value.p95Ms}ms exceeds 40ms`);
  if (duration >= 1800000) {
    assert.ok(observations.rain);
    assert.ok(observations.phases.has('night'));
    assert.ok(observations.closures.size);
    assert.ok(observations.events.size === 6);
    assert.ok(observations.jobs.size === 3);
    assert.ok(rounds >= 30);
    assert.ok(deliveries > 0);
  }
  console.log(`SOAK_PASS ${path}`);
} finally {
  closing = true;
  clearInterval(timer);
  clearInterval(maintenance);
  for (const s of sockets) s.ws.close();
  for (const b of browsers) await b.close();
  if (mf) await mf.dispose();
  for (const p of children.reverse())
    if (p.exitCode === null) {
      try {
        process.kill(-p.pid, 'SIGTERM');
      } catch {
        p.kill('SIGTERM');
      }
      await Promise.race([
        once(p, 'exit'),
        pause(5000).then(() => {
          try {
            process.kill(-p.pid, 'SIGKILL');
          } catch {}
        }),
      ]);
    }
  await dynamo.send(new DeleteTableCommand({ TableName: table })).catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
