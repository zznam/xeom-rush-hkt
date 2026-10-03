/* global URL, process, console */
import { once } from 'node:events';
import { setTimeout as pause } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const require = createRequire(import.meta.url);
const { Miniflare, Log, LogLevel } = require('miniflare');
const secret = 'local-test-guest-secret-with-32-characters';
const checkpointSecret = 'local-test-room-career-secret-with-32-characters';
const child = spawn(process.execPath, ['apps/server/dist/index.js'], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: 'development',
    DEPLOY_TARGET: 'legacy',
    PORT: '3027',
    BOT_COUNT: '0',
    MAX_PRIVATE_ROOMS: '20',
    MONGODB_URI: 'mongodb://127.0.0.1:1/test',
    ROOM_ADAPTER: 'local',
    ALLOW_ROOM_TESTS: 'true',
    GUEST_SECRET: secret,
    ROOM_CHECKPOINT_SECRET: checkpointSecret,
  },
  stdio: 'inherit',
});
const mf = new Miniflare({
  port: 3028,
  scriptPath: resolve(root, 'apps/room-service/dist/index.js'),
  modules: true,
  compatibilityDate: '2026-08-01',
  durableObjects: { ROOMS: { className: 'PrivateRoom', useSQLite: true } },
  bindings: {
    GUEST_SECRET: secret,
    ROOM_CHECKPOINT_SECRET: checkpointSecret,
    CAREER_API_URL: 'http://localhost:3027',
    ALLOWED_ORIGINS: 'http://localhost:5185',
    TEST_MODE: 'true',
  },
  log: new Log(LogLevel.WARN),
});
await mf.ready;
console.log('Room browser fixtures ready');
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await mf.dispose();
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([once(child, 'exit'), pause(5000).then(() => child.kill('SIGKILL'))]);
  }
  process.exit(0);
}
process.on('SIGTERM', close);
process.on('SIGINT', close);
child.on('exit', () => {
  if (!closing) void close();
});
