/* global process, console, setTimeout, clearTimeout, fetch, URL */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'xeom-legacy-'));
const port = 3194;
let logs = '';
const server = spawn(
  'deno',
  [
    'run',
    '--allow-net',
    '--allow-read',
    '--allow-write',
    '--allow-env',
    '--allow-sys',
    '--unstable-kv',
    'deploy/deno-entry.ts',
  ],
  {
    env: {
      ...process.env,
      PORT: String(port),
      BOT_COUNT: '0',
      DENO_KV_PATH: join(directory, 'careers.db'),
      // The Deno entrypoint must keep the legacy route despite stale AWS settings.
      DEPLOY_TARGET: 'regional-production',
      GAME_REGION: 'ap-southeast-1',
      ROOM_ID: 'city-01',
      DYNAMODB_TABLE: 'must-not-be-used',
      GUEST_SECRET: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
server.stdout.on('data', (data) => {
  logs = (logs + data).slice(-12000);
});
server.stderr.on('data', (data) => {
  logs = (logs + data).slice(-12000);
});
server.on('error', (error) => {
  logs += error.message;
});
try {
  let health;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
      if (health.status === 'ok') break;
    } catch {
      /* The process has not started listening yet. */
    }
    if (server.exitCode !== null) throw new Error('Deno server exited before becoming ready');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(health?.deploymentTarget, 'legacy');
  assert.equal(health?.database, 'connected');
  assert.equal(health?.region, 'local');
  assert.equal(health?.room, 'local');
  await new Promise((resolve, reject) => {
    const check = spawn(process.execPath, ['tests/websocket-smoke.mjs', `ws://127.0.0.1:${port}`], {
      stdio: 'inherit',
    });
    check.on('error', reject);
    check.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Legacy WebSocket check exited ${code}`))));
  });
  console.log('PASS: default Deno entrypoint, KV persistence, direct WebSocket join and AWS configuration isolation');
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  await new Promise((resolve) => {
    if (!server.pid || server.exitCode !== null) return resolve();
    const deadline = setTimeout(() => server.kill('SIGKILL'), 5000);
    server.once('exit', () => {
      clearTimeout(deadline);
      resolve();
    });
    server.kill('SIGTERM');
  });
  await rm(directory, { recursive: true, force: true });
}
