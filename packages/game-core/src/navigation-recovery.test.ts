import { expect, it } from 'vitest';
import { findStreetRoute } from '@xeom-rush/shared';
import { PhysicsEngine } from './physics';
it('physically drives every segment of a GPS recovery route without collision corrections', () => {
  const physics = new PhysicsEngine();
  let current = { x: 2088.370361328125, y: 2889.71240234375 };
  expect(physics.resolveMove(current.x, current.y, current.x, current.y)).toEqual(current);
  const path = findStreetRoute(current, { x: 2450, y: 3250 });
  expect(path.length).toBeGreaterThan(1);
  for (let i = 1; i < path.length; i++) {
    const from = { ...current },
      to = path[i];
    const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 3);
    for (let step = 1; step <= steps; step++) {
      const expected = { x: from.x + ((to.x - from.x) * step) / steps, y: from.y + ((to.y - from.y) * step) / steps };
      current = physics.resolveMove(current.x, current.y, expected.x, expected.y);
      expect(current.x).toBeCloseTo(expected.x, 6);
      expect(current.y).toBeCloseTo(expected.y, 6);
    }
  }
  expect(current).toEqual({ x: 2450, y: 3250 });
});
