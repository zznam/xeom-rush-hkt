import { describe, expect, it } from 'vitest';
import { ClientPrediction } from '../../../client/src/game/prediction';
import { STANDARD_RULES } from '@xeom-rush/shared';
import { GameWorld } from '../world';

describe('authoritative runtime physics and prediction', () => {
  it('uses the new speed on both sides and clears input recorded under old rules', () => {
    const world = new GameWorld();
    world.addPlayer('driver', 'Test', 2000, 2000);
    const prediction = new ClientPrediction();
    const input = { seq: 1, dx: 1, dy: 0, angle: 0, dt: 0.05 };
    prediction.addInput(input);
    prediction.configure(300, false, 1);
    expect(prediction.reconcile(2000, 2000, 0)).toEqual({ x: 2000, y: 2000 });
    world.setRules({ ...structuredClone(STANDARD_RULES), speed: 300 });
    world.queueInput('driver', input);
    world.tick(0.05);
    const p = world.getPlayer('driver')!;
    const predicted = prediction.predict(2000, 2000, input);
    expect(predicted.x).toBe(p.x);
    expect(p.x).toBe(2015);
    prediction.configure(300, true, 2);
    expect(prediction.predict(p.x, p.y, input)).toEqual({ x: p.x, y: p.y });
  });
  it('changes population and collision rules without replacing a carried passenger', () => {
    const world = new GameWorld();
    world.addPlayer('a', 'A', 2000, 2000);
    world.addPlayer('b', 'B', 2020, 2000);
    const a = world.getPlayer('a')!;
    const b = world.getPlayer('b')!;
    a.score = b.score = 10000;
    const ride = [...world.getPassengerMap().values()][0];
    a.passengerId = ride.id;
    ride.isCarried = true;
    world.setRules({
      ...structuredClone(STANDARD_RULES),
      driverCollisions: false,
      passengerLimit: 0,
      pedestriansPerCrosswalk: 0,
    });
    world.tick(0.05);
    expect(a.score).toBe(10000);
    expect(b.score).toBe(10000);
    expect(world.getPassengerMap().get(ride.id)).toBe(ride);
    expect([...world.getPassengerMap().values()].filter((p) => !p.isCarried)).toHaveLength(0);
    expect(world.getCityFeatures().getPedestrians()).toHaveLength(0);
  });
});
