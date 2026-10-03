/* global process, console, performance */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
const root = process.env.PERFORMANCE_ROOT || process.cwd(),
  require = createRequire(resolve(root, 'apps/server/package.json'));
const { GameWorld } = require(resolve(root, 'apps/server/dist/world.js'));
const { BotManager } = require(resolve(root, 'apps/server/dist/bot-ai.js'));
const shared = require('@xeom-rush/shared');
const originalLog = console.log;
console.log = () => {};
const world = new GameWorld({ enhanced: true }),
  bots = new BotManager(world, world.getPhysics());
const people = Array.from({ length: 64 }, (_, i) => `load-${i}`);
for (const [i, id] of people.entries()) world.addPlayer(id, id, 50 + (i % 8) * 400, 50 + Math.floor(i / 8) * 400);
bots.spawnBots(8);
const samples = [],
  bytes = [];
for (let tick = 0; tick < 7200; tick++) {
  const started = performance.now();
  bots.tick();
  world.tick(0.05);
  let outgoing = 0;
  for (const [i, id] of people.entries()) {
    const s = world.getVisibleSnapshotForPlayer(id);
    outgoing += shared.encodeSnapshot(
      world.getTick(),
      s.players,
      s.passengers,
      s.trafficLights,
      s.pedestrians,
      s.rushHour,
      s.streaks,
    ).byteLength;
    if (world.getGameplayState && tick % 20 === i % 20) outgoing += JSON.stringify(world.getGameplayState(id)).length;
  }
  samples.push(performance.now() - started);
  bytes.push(outgoing);
}
console.log = originalLog;
samples.sort((a, b) => a - b);
const report = {
  ticks: samples.length,
  humans: 64,
  bots: 8,
  p95Ms: samples[Math.floor(samples.length * 0.95)],
  maxMs: samples.at(-1),
  meanMs: samples.reduce((a, b) => a + b, 0) / samples.length,
  fullSnapshotBytesPerPeerSecond: (bytes.reduce((a, b) => a + b, 0) / bytes.length / 64) * 20,
  memory: process.memoryUsage(),
};
if (process.env.PERFORMANCE_OUTPUT)
  await writeFile(process.env.PERFORMANCE_OUTPUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
