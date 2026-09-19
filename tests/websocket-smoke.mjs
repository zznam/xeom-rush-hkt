/* global process, console, setTimeout, fetch, URL */
import { createRequire } from 'node:module';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const WebSocket = require('ws');
const {
  encodeJoin,
  encodeInput,
  decodeConfig,
  decodeSnapshot,
  decodeDeltaSnapshot,
  EMessageType,
} = require('@xeom-rush/shared');
const target = process.argv[2] || 'ws://localhost:3004';
const http = target.replace(/^ws/, 'http');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
  const end = Date.now() + 10000;
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out waiting for game state');
    await sleep(40);
  }
}
function connect(token, username) {
  const url = new URL(target);
  url.searchParams.set('session', token);
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  const state = { socket, id: '', snapshot: null, deltas: 0, closed: 0, pong: false };
  socket.on('open', () => socket.send(encodeJoin(username)));
  socket.on('message', (data, binary) => {
    if (!binary) {
      state.pong = data.toString().startsWith('pong:');
      return;
    }
    const type = new DataView(data).getUint8(0);
    if (type === EMessageType.CONFIG) state.id = decodeConfig(data).myId;
    if (type === EMessageType.SNAPSHOT) state.snapshot = decodeSnapshot(data);
    if (type === EMessageType.DELTA_SNAPSHOT && state.snapshot) {
      state.snapshot = decodeDeltaSnapshot(data, state.snapshot);
      state.deltas++;
    }
  });
  socket.on('close', (code) => {
    state.closed = code;
  });
  socket.on('error', () => {});
  return state;
}
const health = await (await fetch(`${http}/api/health`)).json();
assert.equal(health.status, 'ok');
assert.equal(health.database, 'connected');
assert.equal(
  (
    await fetch(`${http}/api/spawn-bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"count":1}',
    })
  ).status,
  404,
);
const token = randomUUID();
const username = `Testé-${token.slice(0, 6)}`;
let first;
let second;
try {
  first = connect(token, username);
  await until(() => first.deltas > 2);
  assert.equal(first.snapshot.players.find((p) => p.id === first.id).username, username);
  first.socket.send(`ping:${Date.now()}`);
  await until(() => first.pong);
  const id = first.id;
  first.socket.terminate();
  await until(() => first.closed > 0);
  second = connect(token, username);
  await until(() => second.deltas > 2);
  assert.equal(second.id, id, 'brief disconnect must resume the same driver');
  second.socket.send(encodeInput(1, NaN, 0, 0));
  await until(() => second.closed > 0);
  assert.equal(second.closed, 1008);
  assert.equal((await (await fetch(`${http}/api/health`)).json()).status, 'ok');
  console.log(
    'PASS: health, blocked admin controls, UTF-8, full/delta snapshots, ping, session resume, malformed input',
  );
} finally {
  first?.socket.terminate();
  second?.socket.terminate();
}
