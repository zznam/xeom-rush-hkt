/* global process, console, setTimeout, clearTimeout, fetch, URL, performance, setInterval, clearInterval */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { connect, post, until } from './regional-live.mjs';
const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { encodeInput, encodeJoin, EMessageType } = require('@xeom-rush/shared');
const { WebSocket } = require('ws');
// One client fully decodes snapshots. The others consume packets independently;
// decoding 64 browsers on the load generator's single JS thread distorts throughput.
function loadClient(url, name) {
  const ws = new WebSocket(url);
  const client = { ws, deltas: 0, closed: false };
  ws.on('open', () => ws.send(encodeJoin(name)));
  ws.on('message', (data, binary) => {
    if (binary && data[0] === EMessageType.DELTA_SNAPSHOT) client.deltas++;
  });
  ws.on('error', () => {});
  ws.on('close', () => {
    client.closed = true;
  });
  return client;
}
const directory = await mkdtemp(join(tmpdir(), 'xeom-capacity-'));
const clients = [];
let logs = '';
let interval;
const child = spawn(
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
  {
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DEPLOY_TARGET: 'legacy',
      GAME_MASTER_ENABLED: '0',
      ADMIN_HUB_ENABLED: '0',
      PORT: '3219',
      ROOM_CAPACITY: '64',
      BOT_COUNT: '0',
      DENO_KV_PATH: join(directory, 'load.db'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
child.stdout.on('data', (data) => {
  logs = (logs + data).slice(-10000);
});
child.stderr.on('data', (data) => {
  logs = (logs + data).slice(-10000);
});
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch('http://127.0.0.1:3219/api/ready')).ok) break;
    } catch {
      /* starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // The same BotManager/physics path used by managed cities; the dev-only endpoint
  // avoids controller polling changing the measured simulation workload.
  for (let i = 0; i < 2; i++)
    assert.equal((await post('http://127.0.0.1:3219', '/api/spawn-bots', { count: 25 })).status, 200);
  for (let i = 0; i < 64; i++)
    clients.push((i === 0 ? connect : loadClient)(`ws://127.0.0.1:3219?session=${randomUUID()}`, `Load-${i}`));
  await until(() => clients.every((c) => c.deltas > 0), 15000);
  const over = connect(`ws://127.0.0.1:3219?session=${randomUUID()}`, 'Over-capacity');
  await until(() => over.closed);
  assert.equal(over.id, '');
  let seq = 0;
  interval = setInterval(() => {
    seq++;
    for (let i = 0; i < clients.length; i++) {
      const angle = i + seq / 40;
      clients[i].ws.send(encodeInput(seq, Math.cos(angle), Math.sin(angle), angle));
    }
  }, 50);
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const start = performance.now();
  const tick = clients[0].snapshot.tick;
  const startingPackets = clients.map((c) => c.deltas);
  await new Promise((resolve) => setTimeout(resolve, Number(process.env.LOAD_SECONDS || 15) * 1000));
  const hz = (clients[0].snapshot.tick - tick) / ((performance.now() - start) / 1000);
  const health = await (await fetch('http://127.0.0.1:3219/api/health')).json();
  console.log(
    JSON.stringify({
      hz,
      tickDurationMs: health.tickDurationMs,
      averageTickMs: health.averageTickMs,
      tickLagMs: health.tickLagMs,
    }),
  );
  assert.equal(health.bots, 50);
  assert.equal(health.players, 64);
  assert.ok(clients.every((c, index) => !c.closed && c.deltas - startingPackets[index] >= 150));
  assert.ok(hz >= 17, `Simulation missed its budget: ${hz.toFixed(2)} Hz`);
  console.log(
    `PASS: 64 active humans + 50 bots, ${hz.toFixed(2)} Hz, all streams connected, 65th human rejected. Local hardware result; repeat on staging task size.`,
  );
} catch (error) {
  console.error(
    logs
      .split('\n')
      .filter((line) => !line.includes('[Player Join]'))
      .join('\n'),
  );
  throw error;
} finally {
  clearInterval(interval);
  for (const client of clients) client.ws.terminate();
  await new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
  await rm(directory, { recursive: true, force: true });
}
