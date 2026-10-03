/* global URL, process, fetch, crypto, console */
import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';
import { setTimeout as pause } from 'node:timers/promises';
const root = resolve(fileURLToPath(new URL('../../..', import.meta.url))),
  require = createRequire(import.meta.url),
  serverRequire = createRequire(resolve(root, 'apps/server/package.json'));
const { Miniflare, Log, LogLevel } = require('miniflare'),
  { WebSocket } = serverRequire('ws'),
  { encodeJoin } = serverRequire('@xeom-rush/shared');
const secret = 'local-test-guest-secret-with-32-characters',
  checkpointSecret = 'local-test-room-career-secret-with-32-characters';
const nodeUrl = 'http://localhost:3027';
const dynamoUrl = process.env.TEST_DYNAMO_URL;
const table = `xeom-room-test-${Date.now()}`;
let dynamo;
if (dynamoUrl) {
  const { DynamoDBClient, CreateTableCommand } = serverRequire('@aws-sdk/client-dynamodb');
  dynamo = new DynamoDBClient({
    endpoint: dynamoUrl,
    region: 'local',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
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
}
let logs = '';
const server = spawn(process.execPath, ['apps/server/dist/index.js'], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: 'development',
    DEPLOY_TARGET: 'legacy',
    PORT: '3027',
    BOT_COUNT: '0',
    MONGODB_URI: 'mongodb://127.0.0.1:1/test',
    ROOM_ADAPTER: 'local',
    ALLOW_ROOM_TESTS: 'true',
    GUEST_SECRET: secret,
    ROOM_CHECKPOINT_SECRET: checkpointSecret,
    ...(dynamoUrl
      ? {
          DEPLOY_TARGET: 'regional-production',
          PRIVATE_ROOMS_ENABLED: 'true',
          GAME_REGION: 'test-region',
          ROOM_ID: 'test-owner',
          DYNAMODB_TABLE: table,
          AWS_REGION: 'local',
          AWS_ENDPOINT_URL: dynamoUrl,
          AWS_ACCESS_KEY_ID: 'local',
          AWS_SECRET_ACCESS_KEY: 'local',
        }
      : {}),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => (logs += d));
server.stderr.on('data', (d) => (logs += d));
async function until(fn, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await fn();
    if (result) return result;
    await pause(25);
  }
  throw new Error('Condition timed out');
}
async function post(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.ok(r.ok, `${r.status} ${url}`);
  return r.json();
}
function control(socket, action, value) {
  socket.ws.send(`control:${JSON.stringify({ version: 1, id: crypto.randomUUID(), action, value })}`);
}
async function open(endpoint, guest) {
  const match = await post(`${endpoint}/join`, { guest }),
    ws = new WebSocket(match.serverUrl),
    messages = [];
  ws.on('error', () => {});
  ws.on('message', (data, binary) => {
    if (!binary && data.toString().startsWith('control:')) messages.push(JSON.parse(data.toString().slice(8)));
  });
  await once(ws, 'open');
  ws.send(encodeJoin('Bạn đường'));
  await until(() => messages.find((m) => m.kind === 'room'));
  return { ws, messages };
}
const latest = (socket, kind) => socket.messages.filter((m) => m.kind === kind).at(-1)?.data;
let mf,
  failing = false,
  checkpointAttempts = 0;
const proxy = createServer(async (req, res) => {
  if (req.url === '/api/room-checkpoint' && req.method === 'POST') {
    checkpointAttempts++;
    if (failing) {
      res.writeHead(503);
      res.end('retry');
      return;
    }
  }
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const response = await fetch(`${nodeUrl}${req.url}`, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
      },
      ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
    });
    res.writeHead(response.status, { 'Content-Type': 'application/json' });
    res.end(await response.text());
  } catch {
    res.writeHead(503);
    res.end();
  }
});
proxy.listen(0, '127.0.0.1');
await once(proxy, 'listening');
const careerProxy = `http://127.0.0.1:${proxy.address().port}`;
try {
  await until(() => {
    if (server.exitCode !== null) throw new Error(logs);
    return logs.includes('Authoritative Server running');
  }, 10000);
  await until(async () => {
    try {
      return (await fetch(`${nodeUrl}/api/ready`)).ok;
    } catch {
      return false;
    }
  }, 10000);
  mf = new Miniflare({
    scriptPath: resolve(root, 'apps/room-service/dist/index.js'),
    modules: true,
    compatibilityDate: '2026-08-01',
    durableObjects: { ROOMS: { className: 'PrivateRoom', useSQLite: true } },
    bindings: {
      GUEST_SECRET: secret,
      ROOM_CHECKPOINT_SECRET: checkpointSecret,
      CAREER_API_URL: careerProxy,
      ALLOWED_ORIGINS: 'http://localhost',
      TEST_MODE: 'true',
    },
    log: new Log(LogLevel.WARN),
  });
  const workerUrl = (await mf.ready).toString().replace(/\/$/, '');
  if (dynamo) {
    const { DynamoDBDocumentClient } = serverRequire('@aws-sdk/lib-dynamodb');
    const { CareerRepository, DynamoCareerBackend } = serverRequire(resolve(root, 'apps/server/dist/career-store.js'));
    const { newCareer, activeObjectives } = serverRequire('@xeom-rush/shared');
    const repo = new CareerRepository(new DynamoCareerBackend(table, DynamoDBDocumentClient.from(dynamo)));
    const id = crypto.randomUUID(),
      objective = activeObjectives()[0];
    const stats = {
      username: 'Cô Ba',
      score: 10000,
      peakStreak: 1,
      deliveriesCount: 1,
      revision: 1,
      summary: newCareer(id).summary,
      progress: { [objective.period]: { [objective.metric]: objective.goal } },
    };
    await Promise.all([0, 1, 2].map((i) => repo.save(id, `dynamo-session-${i}`, stats)));
    await Promise.all([0, 1, 2].map((i) => repo.save(id, `dynamo-session-${i}`, stats)));
    assert.equal((await repo.profile(id)).careerScore, 30000);
    await Promise.all([
      repo.claim(id, `${objective.period}:${objective.id}`),
      repo.claim(id, `${objective.period}:${objective.id}`),
    ]);
    assert.equal((await repo.profile(id)).claimCount, 1);
    await repo.equip(id, 'paint-1');
    assert.equal((await repo.profile(id)).equipped.paint, 'paint-1');
    assert.ok((await repo.leaders()).some((p) => p.id === id));
    console.log('dynamo: concurrent sessions, checkpoint retries, objective claims, cosmetics and ranking PASS');
  }
  for (const [adapter, base] of [
    [dynamoUrl ? 'ecs-dynamo' : 'ecs-compatible', nodeUrl],
    ['cloudflare', workerUrl],
  ]) {
    const guestA = (await post(`${nodeUrl}/api/guest`, {})).guest,
      guestB = (await post(`${nodeUrl}/api/guest`, {})).guest;
    const cap = await fetch(`${base}/api/rooms/capabilities`, { headers: { Authorization: `Bearer ${guestA}` } });
    assert.equal((await cap.json()).available, true);
    const room = await post(`${base}/api/rooms`, { guest: guestA }),
      endpoint = `${room.apiUrl}/api/rooms/${room.invite}`;
    const a = await open(endpoint, guestA),
      b = await open(endpoint, guestB);
    await until(() => latest(a, 'room')?.players.length === 2);
    control(a, 'room-start');
    await until(() => latest(b, 'room')?.status === 'running');
    const round = latest(b, 'room').roundId;
    const profileId = guestA.split('.')[0];
    if (adapter === 'cloudflare') failing = true;
    await post(`${endpoint}/test`, { action: 'job', profileId, kind: 0 });
    await post(`${endpoint}/test`, { action: 'position', profileId, x: 2050, y: 2280 });
    await until(() => latest(a, 'gameplay')?.trip);
    await post(`${endpoint}/test`, { action: 'position', profileId, x: 2050, y: 2380 });
    await until(() => latest(a, 'gameplay')?.summary.baseFares === 10000);
    await post(`${endpoint}/test`, { action: 'checkpoint' });
    const profile = async () =>
      (await fetch(`${nodeUrl}/api/profile`, { headers: { Authorization: `Bearer ${guestA}` } })).json();
    if (adapter === 'cloudflare') {
      assert.equal((await profile()).careerScore, 0);
      assert.ok(checkpointAttempts > 0);
      await post(`${endpoint}/test`, { action: 'restart' });
      const recovered = await open(endpoint, guestA);
      assert.equal(latest(recovered, 'room').status, 'interrupted');
      assert.ok(latest(recovered, 'room').results.find((p) => p.id === profileId).score >= 11000);
      failing = false;
      await post(`${endpoint}/test`, { action: 'checkpoint' });
      const score = (await profile()).careerScore;
      assert.ok(score >= 11000);
      await post(`${endpoint}/test`, { action: 'checkpoint' });
      assert.equal((await profile()).careerScore, score);
      recovered.ws.close();
      b.ws.close();
      a.ws.close();
      console.log('cloudflare: durable checkpoint retry across owner replacement PASS');
      continue;
    }
    const savedScore = (await profile()).careerScore;
    assert.ok(savedScore >= 11000);
    await post(`${endpoint}/test`, { action: 'checkpoint' });
    assert.equal((await profile()).careerScore, savedScore);
    a.ws.close();
    await until(() => latest(b, 'room')?.hostId === guestB.split('.')[0]);
    const resumed = await open(endpoint, guestA);
    assert.equal(latest(resumed, 'room').roundId, round);
    await post(`${endpoint}/test`, { action: 'finish' });
    await until(() => latest(b, 'room')?.status === 'results');
    assert.equal(latest(b, 'room').results.length, 2);
    control(b, 'room-rematch');
    await until(() => latest(b, 'room')?.status === 'running');
    assert.notEqual(latest(b, 'room').roundId, round);
    await post(`${endpoint}/test`, { action: 'restart' });
    await until(async () => {
      const r = await fetch(endpoint);
      return (await r.json()).state.status === 'interrupted';
    });
    const rejoined = await open(endpoint, guestB);
    assert.equal(latest(rejoined, 'room').status, 'interrupted');
    resumed.ws.close();
    b.ws.close();
    rejoined.ws.close();
    console.log(`${adapter}: invite, round, host transfer, reconnect, results, rematch, restart PASS`);
  }
} catch (error) {
  console.error(logs.slice(-2500));
  throw error;
} finally {
  try {
    if (mf) await mf.dispose();
    await new Promise((resolve) => proxy.close(resolve));
  } finally {
    if (server.exitCode === null) {
      server.kill('SIGTERM');
      const exited = once(server, 'exit');
      await Promise.race([exited, pause(5000).then(() => server.kill('SIGKILL'))]);
    }
    if (dynamo) {
      const { DeleteTableCommand } = serverRequire('@aws-sdk/client-dynamodb');
      await dynamo.send(new DeleteTableCommand({ TableName: table }));
      dynamo.destroy();
    }
  }
}
