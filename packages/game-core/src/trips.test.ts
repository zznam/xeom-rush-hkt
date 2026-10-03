import { describe, expect, it } from 'vitest';
import { GameWorld } from './world';
import { EPassengerTier, roadSegmentClear } from '@xeom-rush/shared';
function fixture() {
  const world = new GameWorld({ enhanced: true });
  world.addPlayer('a', 'Driver', 2050, 2050);
  world.getPassengerMap().clear();
  const passenger = {
    id: 'pass-test',
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
  world.getPassengerMap().set(passenger.id, passenger);
  world.getSpatialGrid().insert(passenger.id, passenger.x, passenger.y);
  return { world, passenger };
}
describe('authoritative trip experience', () => {
  it('pays the same clean fare quoted by the trip card', () => {
    const { world } = fixture();
    world.tick(0.05);
    const quote = world.getGameplayState('a')!.trip!.fare;
    expect(quote.clean).toBe(1000);
    world.getPlayer('a')!.y = 2200;
    world.tick(0.05);
    expect(world.getPlayer('a')!.score).toBe(quote.total);
    expect(world.getGameplayState('a')!.comboTicksRemaining).toBe(600);
  });
  it('removes the clean bonus for a collision on the delivery tick', () => {
    const { world } = fixture();
    world.tick(0.05);
    world.addPlayer('b', 'Other', 2050, 2200);
    world.getPlayer('a')!.y = 2200;
    world.tick(0.05);
    expect(world.getPlayer('a')!.score).toBe(10000);
    expect(world.getGameplayState('a')!.summary.cleanTrips).toBe(0);
    expect(world.getGameplayState('a')!.summary.fines).toBe(0);
  });
  it('restricts pickup to a selected passenger and clears unavailable selections', () => {
    const { world, passenger } = fixture();
    world.getPassengerMap().set('pass-far', { ...passenger, id: 'pass-far', x: 2450, y: 2050 });
    expect(world.selectPickup('a', 'pass-far')).toBe(true);
    world.tick(0.05);
    expect(world.getPlayer('a')!.passengerId).toBeNull();
    world.getPassengerMap().delete('pass-far');
    world.tick(0.05);
    expect(world.getPlayer('a')!.passengerId).toBe(passenger.id);
  });
  it('keeps active-trip destination metadata outside spatial visibility', () => {
    const { world, passenger } = fixture();
    passenger.destX = 3250;
    passenger.destY = 3350;
    world.tick(0.05);
    const state = world.getGameplayState('a')!;
    expect(state.trip!.passenger.destX).toBe(3250);
    expect(state.navigation!.route.length).toBeGreaterThan(1);
    for (let i = 1; i < state.navigation!.route.length; i++)
      expect(roadSegmentClear(state.navigation!.route[i - 1], state.navigation!.route[i])).toBe(true);
  });
});
