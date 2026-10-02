/* global process, console, setTimeout, clearTimeout, fetch, URL, AbortSignal */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, request } from 'node:http';
import { connect as tcpConnect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { until, connect, match, post, smoke } from './regional-live.mjs';

const base = 'http://127.0.0.1:3190';
const children = [];
const sockets = new Set();
const players = [];
let logs = '';
const proxy = createServer((req, res) => {
  const port = req.url.startsWith('/rooms/city-01') ? 3191 : req.url.startsWith('/rooms/city-02') ? 3192 : 3193;
  const upstream = request(
    { hostname: '127.0.0.1', port, path: req.url, method: req.method, headers: req.headers },
    (response) => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    },
  );
  upstream.on('error', () => {
    res.writeHead(503);
    res.end();
  });
  req.pipe(upstream);
});
proxy.on('connection', (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});
proxy.on('upgrade', (req, socket, head) => {
  const port = req.url.startsWith('/rooms/city-01') ? 3191 : 3192;
  const upstream = tcpConnect(port, '127.0.0.1', () => {
    upstream.write(
      `${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\r\n')}\r\n\r\n`,
    );
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
  socket.on('close', () => upstream.destroy());
});
function start(file, port, extra) {
  const child = spawn(process.execPath, [`apps/server/dist/${file}.js`], {
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DEPLOY_TARGET: 'regional-production',
      DYNAMODB_TABLE: '',
      GAME_REGION: 'test-region',
      GUEST_SECRET: 'local-test-key-with-at-least-thirty-two-characters',
      MONGODB_URI: 'mongodb://127.0.0.1:1/test',
      PORT: String(port),
      BOT_COUNT: '0',
      ROOM_CAPACITY: '2',
      ...extra,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => {
    logs = (logs + chunk).slice(-15000);
  });
  child.stderr.on('data', (chunk) => {
    logs = (logs + chunk).slice(-15000);
  });
  children.push(child);
}
try {
  await new Promise((resolve) => proxy.listen(3190, '127.0.0.1', resolve));
  start('index', 3191, { ROOM_ID: 'city-01' });
  start('index', 3192, { ROOM_ID: 'city-02' });
  start('matchmaking', 3193, {
    ROOM_IDS: 'city-01,city-02',
    REGIONS_JSON: JSON.stringify([{ id: 'test-region', label: 'Test', apiUrl: base }]),
  });
  for (let attempt = 0; attempt < 80; attempt++) {
    const statuses = await Promise.all(
      [3191, 3192, 3193].map((port) =>
        fetch(`http://127.0.0.1:${port}/api/ready`)
          .then((r) => r.status)
          .catch(() => 0),
      ),
    );
    if (statuses.every((status) => status === 200)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await post(base, '/rooms/city-01/api/rush-hour');
  await new Promise((resolve) => setTimeout(resolve, 600));
  const a = await match(base, 'test-region');
  players.push(connect(a.wsUrl, 'Driver-A'));
  await until(() => players[0].deltas > 0 && players[0].city);
  assert.ok(
    players[0].city.rushHourTicksRemaining > 0 && players[0].city.rushHourTicksRemaining < 1200,
    'Late arrivals must receive the actual remaining rush-hour ticks',
  );
  assert.equal(players[0].city.deliveries, 0);
  const b = await match(base, 'test-region');
  assert.equal(a.room, b.room, 'Same-region players should meet in the same city');
  players.push(connect(b.wsUrl, 'Driver-B'));
  await until(() => players[0].snapshot.players.some((p) => p.id === players[1].id));
  const c = await match(base, 'test-region');
  assert.notEqual(c.room, a.room, 'Full cities should spill into another city in the same region');
  const { guest } = await (await post(base, '/api/guest')).json();
  assert.equal(
    (await post(base, '/api/match', { region: 'another-region', session: randomUUID(), guest })).status,
    400,
  );
  assert.equal(
    (await post(base, '/api/match', { region: 'test-region', session: randomUUID(), guest: 'forged' })).status,
    400,
  );
  assert.equal((await post(base, '/rooms/city-02/api/reservations', { session: randomUUID(), guest })).status, 403);
  // A copied ticket bound to another session cannot join.
  const forged = new URL(c.wsUrl);
  forged.searchParams.set('session', randomUUID());
  const rejected = connect(forged.toString(), 'Intruder');
  players.push(rejected);
  await until(() => rejected.closed);
  assert.equal(rejected.id, '');
  for (const player of players) if (player.ws.readyState === 1) player.ws.send(new Uint8Array([3]));
  // Release the unclaimed overflow seat by letting it expire; reuse the first city for reconnect checks.
  await until(() => players.slice(0, 2).every((p) => p.closed));
  await smoke(base, 'test-region');
  console.log(
    'PASS: real gateway + two authoritative rooms, co-location, peer visibility, overflow, region isolation, forged identity and ticket rejection',
  );
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  for (const player of players) player.ws.terminate();
  for (const socket of sockets) socket.destroy();
  proxy.close();
  await Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null) return resolve();
          const deadline = setTimeout(() => child.kill('SIGKILL'), 5000);
          child.once('exit', () => {
            clearTimeout(deadline);
            resolve();
          });
          child.kill('SIGTERM');
        }),
    ),
  );
}
