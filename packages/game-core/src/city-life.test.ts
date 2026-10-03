import { expect, it } from 'vitest';
import { GameWorld } from './world';
import { LANDMARKS, roadSegmentClear } from '@xeom-rush/shared';
it('validates closure routing and cancels roadworks that would trap an occupant', () => {
  const world = new GameWorld({ enhanced: true });
  world.getPassengerMap().clear();
  (world as any).tickCount = 4799;
  world.tick(0.05);
  const pending = world.getCityLife().closure;
  expect(pending).not.toBeNull();
  world.addPlayer('blocked', 'Driver', pending!.rect.x + 50, pending!.rect.y + 30);
  world.getPassengerMap().clear();
  (world as any).tickCount = 4999;
  world.tick(0.05);
  expect(world.getCityLife().closure).toBeNull();
});
it('keeps landmarks reachable when a road closure activates', () => {
  const world = new GameWorld({ enhanced: true });
  world.getPassengerMap().clear();
  (world as any).tickCount = 4799;
  world.tick(0.05);
  world.getPassengerMap().clear();
  (world as any).tickCount = 4999;
  world.tick(0.05);
  const state = world.getCityLife();
  expect(state.closure?.active).toBe(true);
  for (const target of LANDMARKS) {
    const path = world.getNavigationRoute({ x: 2050, y: 2050 }, target);
    expect(path.length).toBeGreaterThan(1);
    for (let i = 1; i < path.length; i++)
      expect(roadSegmentClear(path[i - 1], path[i], [state.closure!.rect])).toBe(true);
  }
});
it('validates an active closure before a later-season round and starts fresh waiting jobs', () => {
  const world = new GameWorld({ enhanced: true, initialTick: 5100 });
  const scheduled = world.getCityLife();
  expect(scheduled.closure).toBeNull();
  expect([...world.getPassengerMap().values()].every((p) => p.deadline === 0 || p.deadline > 5100)).toBe(true);
  world.getPassengerMap().clear();
  world.addPlayer('inside', 'Driver', 850, 1130);
  world.tick(0.05);
  expect(world.getCityLife().closure).toBeNull();
});
