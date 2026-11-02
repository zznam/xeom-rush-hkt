/* global process, console */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidence = resolve(root, 'apps/e2e/test-results');
await mkdir(evidence, { recursive: true });
const args = process.argv.slice(2);
const skipBuild = args.includes('--skip-build');
const forwarded = args.filter((arg) => arg !== '--skip-build');
const results = [];
let interrupted = false;
let activeChild;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    interrupted = true;
    if (!activeChild) return;
    try {
      // Bun launches Playwright as a child; signal the owned process group so
      // Playwright can close its browser and web-server fixtures as well.
      if (process.platform === 'win32') activeChild.kill(signal);
      else process.kill(-activeChild.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  });
}
const run = async (name, command) => {
  console.log(`\nE2E: ${name}`);
  const start = Date.now();
  const code = await new Promise((resolveRun) => {
    const child = spawn('bun', command, {
      cwd: root,
      detached: process.platform !== 'win32',
      stdio: 'inherit',
      env: { ...process.env, WRANGLER_LOG_PATH: resolve(evidence, 'wrangler') },
    });
    activeChild = child;
    child.once('error', (error) => {
      console.error(error.message);
      resolveRun(1);
    });
    child.once('exit', (code) => resolveRun(code ?? 1));
  });
  results.push({ name, code, durationMs: Date.now() - start });
  await writeFile(resolve(evidence, 'e2e-summary.json'), JSON.stringify({ results }, null, 2) + '\n');
  activeChild = undefined;
  if (interrupted) process.exit(130);
  return code;
};

if (!skipBuild) {
  for (const [name, command] of [
    ['build server', ['run', 'build:server']],
    ['build admin', ['run', 'build:admin']],
    ['build rooms', ['run', '--filter', '@xeom-rush/room-service', 'build']],
  ]) {
    if (await run(name, command)) process.exit(1);
  }
}

// Continue after a failed suite so a single run reports every supported deployment path.
for (const [name, config] of [
  ['public', 'playwright.config.ts'],
  ['regional', 'playwright.regional.config.ts'],
  ['admin', 'playwright.admin.config.ts'],
  ['rooms', 'playwright.rooms.config.ts'],
  ['rollback', 'playwright.rollback.config.ts'],
]) {
  await run(name, ['run', '--filter', 'e2e', 'test', `--config=${config}`, ...forwarded]);
}
console.table(results);
process.exitCode = results.some((result) => result.code !== 0) ? 1 : 0;
