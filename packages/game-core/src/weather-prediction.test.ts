import { expect, it } from 'vitest';
import { GameWorld } from './world';
import { ClientPrediction } from '../../../apps/client/src/game/prediction';
it('matches simulation and prediction through raw acceleration, turns, rain, release and acknowledged replay', () => {
  for (const rain of [false, true]) {
    const world = new GameWorld({ enhanced: true }),
      prediction = new ClientPrediction();
    world.addPlayer('weather', 'Driver', 2050, 2200);
    world.getPassengerMap().clear();
    if (rain) (world as any).tickCount = 7200;
    prediction.setCityLife(world.getCityLife());
    prediction.setTick(rain ? 7200 : 0);
    let point = { x: 2050, y: 2200 };
    for (let seq = 1; seq <= 10; seq++) {
      const input = {
        seq,
        dx: seq < 8 ? 0 : 1,
        dy: seq < 8 ? 1 : 0,
        angle: seq < 8 ? Math.PI / 2 : 0,
        dt: 0.05,
        speed: rain ? 0.95 : 1,
      };
      world.queueInput('weather', input);
      prediction.addInput(input);
      point = prediction.predict(point.x, point.y, input);
      world.tick(0.05);
      const p = world.getPlayer('weather')!;
      expect(point.x).toBeCloseTo(p.x, 6);
      expect(point.y).toBeCloseTo(p.y, 6);
      expect((point as { angle?: number }).angle).toBeCloseTo(p.angle, 6);
      prediction.setMovement(world.getGameplayState('weather')!.movement!);
      expect(prediction.reconcile(p.x, p.y, p.lastProcessedSeq)).toEqual({ x: p.x, y: p.y });
    }
    const p = world.getPlayer('weather')!,
      stop = { seq: 11, dx: 0, dy: 0, angle: 0, dt: 0.05 };
    world.queueInput('weather', stop);
    point = prediction.predict(p.x, p.y, stop);
    world.tick(0.05);
    expect(point.x).toBe(p.x);
    expect(point.y).toBe(p.y);
  }
});
