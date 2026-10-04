import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { defaultCityConfig, type AdminCommand } from '@xeom-rush/shared';
import { GameWorld } from '../world';
import { BotManager } from '../bot-ai';
import { CityRuntime } from './runtime';
function setup(failSave = false) {
  let now = 1000;
  let world = new GameWorld();
  let bots = new BotManager(world, world.getPhysics());
  const endRides = vi.fn(async () => {
    if (failSave) throw new Error('Storage unavailable');
  });
  const reset = vi.fn((config) => {
    world = new GameWorld({ rules: config.rules });
    bots = new BotManager(world, world.getPhysics());
    bots.configure(config.bots);
  });
  const runtime = new CityRuntime(
    { world: () => world, bots: () => bots, reset, endRides, kick: async () => {} },
    () => now,
    30000,
  );
  const command = (action: AdminCommand['action']): AdminCommand => ({
    id: randomUUID(),
    city: 'test',
    runtimeId: randomUUID(),
    expectedRevision: runtime.revision,
    actor: '1',
    createdAt: now,
    expiresAt: now + 90000,
    status: 'pending',
    action,
  });
  return {
    runtime,
    command,
    endRides,
    reset,
    world: () => world,
    bots: () => bots,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
describe('live city operations', () => {
  it('applies configuration only at a simulation boundary', async () => {
    const s = setup();
    const config = defaultCityConfig();
    config.bots.count = 12;
    const pending = s.runtime.enqueue(s.command({ type: 'configure', config }));
    expect(s.runtime.config.bots.count).toBe(8);
    s.runtime.beforeTick();
    await pending;
    expect(s.runtime.config.bots.count).toBe(12);
    expect(s.runtime.revision).toBe(1);
  });
  it('counts down, closes admissions, saves rides before resetting mode', async () => {
    const s = setup();
    const config = defaultCityConfig();
    config.mode = 'sandbox';
    config.rules.speed = 300;
    const pending = s.runtime.enqueue(s.command({ type: 'configure', config }));
    s.runtime.beforeTick();
    expect(s.runtime.admissionsOpen).toBe(false);
    expect(s.runtime.config.mode).toBe('career');
    expect(s.endRides).not.toHaveBeenCalled();
    s.advance(30000);
    s.runtime.beforeTick();
    expect(s.runtime.frozen).toBe(true);
    await pending;
    await Promise.resolve();
    expect(s.endRides).toHaveBeenCalledOnce();
    expect(s.reset).toHaveBeenCalledOnce();
    expect(s.runtime.config.mode).toBe('sandbox');
  });
  it('aborts a transition on checkpoint failure and keeps the world and configuration', async () => {
    const s = setup(true);
    const config = defaultCityConfig();
    config.mode = 'sandbox';
    const pending = s.runtime.enqueue(s.command({ type: 'configure', config }));
    s.runtime.beforeTick();
    s.advance(30000);
    s.runtime.beforeTick();
    await expect(pending).rejects.toThrow('aborted');
    await Promise.resolve();
    expect(s.runtime.config.mode).toBe('career');
    expect(s.reset).not.toHaveBeenCalled();
    expect(s.runtime.revision).toBe(0);
    expect(s.runtime.admissionsOpen).toBe(true);
  });
  it('pause/resume clears stale input and leaves administrative processing running', async () => {
    const s = setup();
    s.world().addPlayer('player-a', 'A');
    s.world().queueInput('player-a', { seq: 1, dx: 1, dy: 0, angle: 0 });
    const pause = s.runtime.enqueue(s.command({ type: 'pause' }));
    s.runtime.beforeTick();
    await pause;
    expect(s.runtime.frozen).toBe(true);
    const resume = s.runtime.enqueue(s.command({ type: 'resume' }));
    s.runtime.beforeTick();
    await resume;
    expect(s.runtime.frozen).toBe(false);
    expect(s.runtime.revision).toBe(2);
  });
  it('rejects stale and expired commands without mutation', async () => {
    const s = setup();
    const cmd = s.command({ type: 'pause' });
    cmd.expectedRevision = 5;
    const pending = s.runtime.enqueue(cmd);
    s.runtime.beforeTick();
    await expect(pending).rejects.toThrow('revision');
    expect(s.runtime.paused).toBe(false);
    const expired = s.runtime.enqueue({ ...s.command({ type: 'pause' }), expiresAt: 0 });
    s.runtime.beforeTick();
    await expect(expired).rejects.toThrow('expired');
  });
});
