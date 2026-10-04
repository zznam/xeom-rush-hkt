import { describe, expect, it } from 'vitest';
import { defaultCityConfig } from '@xeom-rush/shared';
import { GameWorld } from './world';
import { BotManager } from './bot-ai';
function setup() {
  const world = new GameWorld();
  const bots = new BotManager(world, world.getPhysics());
  return { world, bots };
}
describe('managed bot population', () => {
  it('fills fixed and automatic counts while respecting reconnecting occupants and bounds', () => {
    const { bots } = setup();
    const config = defaultCityConfig().bots;
    bots.configure(config);
    for (let i = 0; i < 5; i++) bots.reconcilePopulation(0);
    expect(bots.getBotCount()).toBe(8);
    config.mode = 'automatic';
    bots.configure(config);
    bots.reconcilePopulation(6);
    expect(bots.getBotCount()).toBe(2);
    bots.reconcilePopulation(8);
    expect(bots.getBotCount()).toBe(0);
    bots.reconcilePopulation(0);
    expect(bots.getBotCount()).toBe(2); // staged spawning
    config.minimum = 3;
    bots.configure(config);
    bots.reconcilePopulation(8);
    expect(bots.getBotCount()).toBe(3);
  });
  it('retires carried bots after delivery and force clear releases passengers', () => {
    const { world, bots } = setup();
    const config = defaultCityConfig().bots;
    config.count = 2;
    bots.configure(config);
    bots.reconcilePopulation(0);
    const bot = world.getPlayers()[0];
    const passenger = [...world.getPassengerMap().values()][0];
    bot.passengerId = passenger.id;
    passenger.isCarried = true;
    config.count = 0;
    bots.configure(config);
    bots.reconcilePopulation(0);
    expect(bots.populationStatus()).toEqual({ current: 1, requested: 0, retiring: 1 });
    bots.clearBots();
    expect(passenger.isCarried).toBe(false);
    expect(bots.getBotCount()).toBe(0);
  });
  it('updates skill mixtures without recreating players or losing their scores', () => {
    const { world, bots } = setup();
    const config = defaultCityConfig().bots;
    config.count = 10;
    bots.configure(config);
    for (let i = 0; i < 5; i++) bots.reconcilePopulation(0);
    const ids = world.getPlayers().map((p) => p.id);
    world.getPlayers()[0].score = 1000;
    config.mix = { easy: 30, normal: 40, hard: 30 };
    bots.configure(config);
    const agents = [
      ...(bots as unknown as { bots: Map<string, { level: string; skill: { decisionMs: number } }> }).bots.values(),
    ];
    expect(agents.filter((b) => b.level === 'easy')).toHaveLength(3);
    expect(agents.filter((b) => b.level === 'hard')).toHaveLength(3);
    expect(world.getPlayers().map((p) => p.id)).toEqual(ids);
    expect(world.getPlayers()[0].score).toBe(1000);
    expect(agents.find((b) => b.level === 'easy')!.skill.decisionMs).toBeGreaterThan(
      agents.find((b) => b.level === 'hard')!.skill.decisionMs,
    );
  });
});

it('seeded turning scenario distinguishes skill while preserving equal physical speed', async () => {
  const { vi } = await import('vitest');
  function drive(level: 'easy' | 'normal' | 'hard') {
    let seed = 42;
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    });
    try {
      const { world, bots } = setup();
      const config = defaultCityConfig().bots;
      config.count = 1;
      config.mix = { easy: 0, normal: 0, hard: 0 };
      config.mix[level] = 100;
      for (const profile of Object.values(config.profiles)) {
        profile.lawfulness = 0;
        profile.aggression = 0.5;
        profile.riskTolerance = 0;
      }
      bots.configure(config);
      bots.reconcilePopulation(0);
      const player = world.getPlayers()[0];
      player.x = 2000;
      player.y = 2000;
      const passenger = [...world.getPassengerMap().values()][0];
      world.getPassengerMap().clear();
      Object.assign(passenger, { x: 2200, y: 2000, destX: 2300, destY: 2000, isCarried: false });
      world.getPassengerMap().set(passenger.id, passenger);
      const agent = (bots as unknown as { bots: Map<string, { currentAngle: number }> }).bots.get(player.id)!;
      agent.currentAngle = -Math.PI / 2;
      let maxStep = 0;
      for (let tick = 0; tick < 8; tick++) {
        const before = { x: player.x, y: player.y };
        bots.tick();
        world.tick(0.05);
        maxStep = Math.max(maxStep, Math.hypot(player.x - before.x, player.y - before.y));
      }
      return { distance: Math.hypot(2200 - player.x, 2000 - player.y), maxStep };
    } finally {
      random.mockRestore();
    }
  }
  const easy = drive('easy'),
    normal = drive('normal'),
    hard = drive('hard');
  expect(hard.distance).toBeLessThan(normal.distance);
  expect(normal.distance).toBeLessThan(easy.distance);
  for (const result of [easy, normal, hard]) expect(result.maxStep).toBeLessThanOrEqual(10.00001);
});
