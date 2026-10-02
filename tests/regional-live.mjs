/* global process, console, setTimeout, clearTimeout, fetch, URL, AbortSignal */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { WebSocket } = require('ws');
const { encodeJoin, decodeConfig, decodeSnapshot, decodeDeltaSnapshot, EMessageType } = require('@xeom-rush/shared');

export async function until(check, ms = 8000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for game state');
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}
export function connect(url, name) {
  const ws = new WebSocket(url);
  const state = { ws, id: '', snapshot: null, deltas: 0, closed: false, city: null };
  ws.binaryType = 'arraybuffer';
  ws.on('open', () => ws.send(encodeJoin(name)));
  ws.on('message', (buffer, binary) => {
    if (!binary) {
      const text = buffer.toString();
      if (text.startsWith('city:')) state.city = JSON.parse(text.slice(5));
      return;
    }
    const type = new DataView(buffer).getUint8(0);
    if (type === EMessageType.CONFIG) state.id = decodeConfig(buffer).myId;
    if (type === EMessageType.SNAPSHOT) state.snapshot = decodeSnapshot(buffer);
    if (type === EMessageType.DELTA_SNAPSHOT && state.snapshot) {
      state.snapshot = decodeDeltaSnapshot(buffer, state.snapshot);
      state.deltas++;
    }
  });
  ws.on('error', () => {});
  ws.on('close', () => {
    state.closed = true;
  });
  return state;
}
export async function post(base, path, data = {}) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(12000),
  });
}
export async function match(base, region) {
  const guestResponse = await post(base, '/api/guest');
  assert.equal(guestResponse.status, 200);
  const { guest } = await guestResponse.json();
  const response = await post(base, '/api/match', { region, session: randomUUID(), guest });
  assert.equal(response.status, 200, `Match failed (${response.status})`);
  const result = await response.json();
  assert.equal(result.region, region);
  assert.equal(new URL(result.wsUrl).host, new URL(base).host);
  return result;
}
export async function smoke(base, region, expectedRelease) {
  assert.equal((await fetch(`${base}/api/ready`)).status, 200);
  if (expectedRelease) {
    const rooms = await (await fetch(`${base}/api/rooms`, { signal: AbortSignal.timeout(5000) })).json();
    assert.ok(rooms.length >= 2);
    for (const room of rooms) {
      const health = await (
        await fetch(`${base}/rooms/${room}/api/health`, { signal: AbortSignal.timeout(5000) })
      ).json();
      assert.equal(health.version, expectedRelease, `Room ${room} has not deployed the expected revision`);
      assert.equal(health.database, 'connected');
      assert.equal(health.region, region);
      assert.equal(health.status, 'ok');
    }
  }
  const assignment = await match(base, region);
  let player;
  let resumed;
  try {
    player = connect(assignment.wsUrl, `Smoke-${randomUUID().slice(0, 6)}`);
    await until(() => player.deltas >= 2);
    const username = player.snapshot.players.find((p) => p.id === player.id).username;
    player.ws.terminate();
    await until(() => player.closed);
    await new Promise((resolve) => setTimeout(resolve, 250));
    resumed = connect(assignment.wsUrl, username);
    await until(() => resumed.deltas >= 2);
    assert.equal(resumed.id, player.id, 'Reconnect must return to the same driver');
    resumed.ws.send(new Uint8Array([EMessageType.LEAVE]));
    await until(() => resumed.closed);
    console.log(`PASS: ${region} readiness, reservation, full/delta stream and reconnect`);
  } finally {
    player?.ws.terminate();
    resumed?.ws.terminate();
  }
}
if (process.env.API_URL) await smoke(process.env.API_URL, process.env.GAME_REGION, process.env.EXPECTED_RELEASE);
