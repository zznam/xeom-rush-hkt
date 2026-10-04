/* global process, console, setInterval, clearInterval, URL */
// Local test harness only. This file is never imported by the application or included in its image.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const express = require('express');
const { ControlService, deploymentRecord, hash } = require('./dist/admin/service.js');
const { MemoryControlStore } = require('./dist/admin/store.js');
const { AdminAuth } = require('./dist/admin/auth.js');
const { createAdminRouter } = require('./dist/admin/router.js');
const { CityRuntime } = require('./dist/admin/runtime.js');
const { ControlTransport, ControlWorker } = require('./dist/admin/worker.js');
const { GameWorld } = require('./dist/world.js');
const { BotManager } = require('./dist/bot-ai.js');
const port = Number(process.env.ADMIN_FIXTURE_PORT || 3198);
const origin = `http://localhost:${port}`;
const token = 'local-test-worker-credential-only-123456';
const service = new ControlService(new MemoryControlStore());
await service.bootstrap('1', [deploymentRecord('test', 'Local test', ['local'], token)]);
await service.put('staff/2', { id: '2', login: 'Game Master', role: 'gm' });
await service.put('staff/3', { id: '3', login: 'Moderator', role: 'moderator' });
const app = express();
app.get('/test/login', async (req, res) => {
  const staffId = req.query.role === 'moderator' ? '3' : req.query.role === 'gm' ? '2' : '1';
  const session = randomUUID();
  await service.put(`sessions/${hash(session)}`, { staffId, csrf: 'fixture-csrf', expiresAt: Date.now() + 3600000 });
  res.cookie('xeom_admin', session, { httpOnly: true, sameSite: 'lax', path: '/' });
  res.json({ ok: true });
});
app.use(
  createAdminRouter(
    service,
    new AdminAuth(service, { origin, clientId: 'fixture', clientSecret: 'fixture', secure: false }),
    '1',
  ),
);
let world = new GameWorld();
let bots = new BotManager(world, world.getPhysics());
const guestId = randomUUID();
const addDriver = () => {
  world.addPlayer('player-demo', 'Cô Ba', 2050, 2050);
  world.getPlayer('player-demo').score = 12000;
};
const runtime = new CityRuntime({
  world: () => world,
  bots: () => bots,
  reset(config) {
    world = new GameWorld({ rules: config.rules });
    bots = new BotManager(world, world.getPhysics());
    bots.configure(config.bots);
    addDriver();
  },
  async endRides() {},
  async kick(id) {
    world.removePlayer(id);
  },
});
const worker = new ControlWorker(
  new ControlTransport({ url: origin, deployment: 'test', token, region: 'local', room: 'city-01', persistent: false }),
  runtime,
  (observe) => ({
    revision: runtime.revision,
    config: runtime.config,
    tick: world.getTick(),
    tickMs: 3.2,
    humans: world.getPlayerCount(),
    bots: bots.populationStatus(),
    paused: runtime.frozen,
    admissionsOpen: runtime.admissionsOpen,
    lastSeen: Date.now(),
    players: world.getPlayers().map((p) => ({
      ...p,
      guestId: p.id === 'player-demo' ? guestId : undefined,
      deliveries: 2,
      bot: p.id.startsWith('bot-'),
    })),
    ...(observe
      ? { map: { passengers: [...world.getPassengerMap().values()].map((p) => ({ x: p.x, y: p.y, tier: p.tier })) } }
      : {}),
  }),
  async (bans) => {
    if (bans.some((b) => b.guestId === guestId)) world.removePlayer('player-demo');
  },
);
const tick = setInterval(() => {
  runtime.beforeTick();
  if (!runtime.frozen) {
    bots.reconcilePopulation(world.getPlayerCount());
    bots.tick();
    world.tick(0.05);
  }
}, 50);
const server = app.listen(port, () => {
  worker.start();
  console.log(`Admin fixture: ${origin}/admin/`);
});
process.on('SIGTERM', () => {
  clearInterval(tick);
  worker.stop();
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
