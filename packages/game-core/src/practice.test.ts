import { expect, it } from 'vitest';
import { GameWorld } from './world';
import { BotManager } from './bot-ai';
import { roadSegmentClear } from '@xeom-rush/shared';
it('reserves an introductory pickup and suppresses competitive stats through arrival', () => {
  const w = new GameWorld({ enhanced: true });
  w.getPassengerMap().clear();
  w.addPlayer('a', 'New');
  w.addPlayer('b', 'Other', 2050, 2280);
  expect(w.beginPractice('a')).toBe(true);
  const state = w.getGameplayState('a')!;
  expect(state.practice).toBe(true);
  const target = state.navigation!.targetId;
  expect(w.selectPickup('b', target)).toBe(false);
  w.tick(0.05);
  expect(w.getPlayer('b')!.passengerId).not.toBe(target);
  const p = w.getPlayer('a')!;
  p.x = 2050;
  p.y = 2280;
  w.tick(0.05);
  expect(p.passengerId).toBe(target);
  expect(w.getGameplayState('a')!.trip!.stops).toHaveLength(1);
  p.y = 2380;
  w.tick(0.05);
  const stats = w.getSessionStatsForPlayer('a')!;
  expect(p.score).toBe(0);
  expect(stats.deliveriesCount).toBe(0);
  expect(stats.summary.cleanTrips).toBe(0);
  expect(stats.summary.distance).toBe(0);
  expect(stats.progress).toEqual({});
  expect(w.getGameplayState('a')!.practiceCompleted).toBe(true);
  expect(w.beginPractice('a')).toBe(false);
});
it('cleans up the reserved pickup when its owner leaves', () => {
  const w = new GameWorld({ enhanced: true });
  w.addPlayer('a', 'New');
  w.beginPractice('a');
  const id = w.getGameplayState('a')!.navigation!.targetId;
  w.removePlayer('a');
  expect(w.getPassengerMap().has(id)).toBe(false);
});
it('balances to eight total drivers and retires a carrying bot only after delivery', () => {
  const w = new GameWorld({ enhanced: true }),
    bots = new BotManager(w, w.getPhysics());
  for (let i = 0; i < 6; i++) w.addPlayer(`human-${i}`, 'H', 450, 400 + i * 80);
  bots.balancePopulation();
  expect(bots.getBotCount()).toBe(2);
  const id = [...(bots as any).bots.keys()][0],
    p = w.getPlayer(id)!;
  w.getPassengerMap().clear();
  p.x = 2050;
  p.y = 2200;
  w.getPassengerMap().set('pass-0', {
    id: 'pass-0',
    x: p.x,
    y: p.y,
    destX: 2050,
    destY: 2380,
    reward: 1000,
    tier: 0,
    isCarried: true,
    spawnedAt: 0,
    deadline: 0,
  });
  p.passengerId = 'pass-0';
  for (let i = 6; i < 8; i++) w.addPlayer(`human-${i}`, 'H', 450, 400 + i * 80);
  bots.balancePopulation();
  bots.tick();
  expect(bots.getBotCount()).toBe(1);
  expect(w.getPlayer(id)).toBe(p);
  p.y = 2380;
  w.tick(0.05);
  expect(p.passengerId).toBeNull();
  expect(p.score).toBeGreaterThanOrEqual(1000);
  bots.tick();
  expect(bots.getBotCount()).toBe(0);
});
it('routes enhanced bots through shared clearance geometry', () => {
  const w = new GameWorld({ enhanced: true }),
    bots = new BotManager(w, w.getPhysics());
  const id = bots.spawnBots(1)[0];
  const bot = (bots as any).bots.get(id),
    route = (bots as any).calculatePath(bot, 2050, 2200, 2450, 2950);
  expect(route.length).toBeGreaterThan(2);
  expect(route.every((p: any, i: number) => !i || roadSegmentClear(route[i - 1], p))).toBe(true);
});
