import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { cityKey, defaultCityConfig, type AdminCommand, type CityReport } from '@xeom-rush/shared';
import { ControlWorker, ControlTransport } from './worker';
import { CityRuntime } from './runtime';
import { GameWorld } from '../world';
import { BotManager } from '../bot-ai';
afterEach(() => vi.useRealTimers());
it('retries a lost acknowledgement without applying a command twice and fails closed during outage', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  const config = defaultCityConfig();
  const world = new GameWorld();
  const bots = new BotManager(world, world.getPhysics());
  const kick = vi.fn(async () => {});
  const runtime = new CityRuntime({
    world: () => world,
    bots: () => bots,
    reset: () => {},
    endRides: async () => {},
    kick,
  });
  const transport = new ControlTransport({
    url: 'http://localhost',
    deployment: 'test',
    region: 'local',
    room: 'local',
    persistent: false,
    token: 's'.repeat(32),
  });
  let failAck = true;
  let outage = false;
  const command: AdminCommand = {
    id: randomUUID(),
    runtimeId: randomUUID(),
    city: 'test',
    actor: '1',
    expectedRevision: 0,
    createdAt: 100000,
    expiresAt: 190000,
    status: 'pending',
    action: { type: 'kick', playerId: 'player-1', reason: 'Test' },
  };
  vi.spyOn(transport, 'call').mockImplementation(async (path) => {
    if (outage) throw new Error('Disconnected');
    if (path === 'ack' && failAck) {
      failAck = false;
      throw new Error('Acknowledgement lost');
    }
    if (path === 'poll') return { config: { revision: 0, config }, command, bans: [], observedUntil: 0 };
    return { ok: true };
  });
  const report = (): Omit<CityReport, 'ref'> => ({
    revision: runtime.revision,
    config,
    tick: world.getTick(),
    tickMs: 1,
    humans: 1,
    bots: bots.populationStatus(),
    paused: false,
    admissionsOpen: true,
    lastSeen: Date.now(),
  });
  const worker = new ControlWorker(transport, runtime, report, async () => {});
  // A poll addressed to another runtime must never reach simulation execution.
  await worker.step();
  runtime.beforeTick();
  expect(kick).not.toHaveBeenCalled();
  command.runtimeId = worker.ref.runtimeId;
  command.city = cityKey(worker.ref);
  vi.setSystemTime(102000);
  await worker.step();
  runtime.beforeTick();
  await Promise.resolve();
  expect(kick).toHaveBeenCalledOnce();
  expect(runtime.revision).toBe(1);
  vi.setSystemTime(103000);
  await worker.step(); // failed acknowledgement
  vi.setSystemTime(104000);
  await worker.step(); // successful acknowledgement and duplicate poll
  runtime.beforeTick();
  await Promise.resolve();
  expect(kick).toHaveBeenCalledOnce();
  expect(runtime.revision).toBe(1);
  expect(worker.healthy).toBe(true);
  outage = true;
  vi.setSystemTime(115000);
  await worker.step();
  expect(worker.healthy).toBe(false);
  expect(runtime.config).toEqual(config);
});
