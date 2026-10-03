import { expect, it } from 'vitest';
import { GameWorld } from './world';
import { EPassengerTier } from '@xeom-rush/shared';
it('delivers a multi-stop parcel only once after its final ordered stop', () => {
  const world = new GameWorld({ enhanced: true });
  world.addPlayer('a', 'Courier', 2050, 2050);
  world.getPassengerMap().clear();
  const p = {
    id: 'pass-9',
    x: 2050,
    y: 2050,
    destX: 2050,
    destY: 2200,
    reward: 10000,
    spawnedAt: 0,
    isCarried: false,
    tier: EPassengerTier.REGULAR,
    deadline: 0,
  };
  world.getPassengerMap().set(p.id, p);
  world.getSpatialGrid().insert(p.id, p.x, p.y);
  world.tick(0.05);
  const trip = world.getGameplayState('a')!.trip!;
  expect(trip.stops.length).toBe(3);
  for (let i = 0; i < trip.stops.length; i++) {
    const stop = trip.stops[i],
      player = world.getPlayer('a')!;
    player.x = stop.x;
    player.y = stop.y;
    world.tick(0.05);
    if (i < trip.stops.length - 1) {
      expect(player.score).toBe(0);
      expect(world.getSessionStatsForPlayer('a')!.deliveriesCount).toBe(0);
      expect(world.getGameplayState('a')!.trip!.stopIndex).toBe(i + 1);
    }
  }
  expect(world.getSessionStatsForPlayer('a')!.deliveriesCount).toBe(1);
  expect(world.getPlayer('a')!.passengerId).toBeNull();
  expect(world.getPlayer('a')!.score).toBeGreaterThanOrEqual(10000);
});
