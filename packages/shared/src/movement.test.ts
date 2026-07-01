import { describe, expect, it } from 'vitest';
import { rotateTowardAngle, smoothVectorToward } from './movement';

describe('movement smoothing helpers', () => {
  it('rotates along the shortest wrapped angle path with a max step', () => {
    const current = Math.PI - 0.05;
    const target = -Math.PI + 0.05;

    const next = rotateTowardAngle(current, target, 0.04);

    expect(next).toBeCloseTo(Math.PI - 0.01, 5);
  });

  it('settles on the target angle when the remaining turn is inside the max step', () => {
    const next = rotateTowardAngle(0.1, 0.15, 0.1);

    expect(next).toBeCloseTo(0.15, 5);
  });

  it('ramps input vectors toward a target at a fixed rate', () => {
    const next = smoothVectorToward({ x: 0, y: 0 }, { x: 1, y: 0 }, 0.05, 8);

    expect(next.x).toBeCloseTo(0.4, 5);
    expect(next.y).toBeCloseTo(0, 5);
  });

  it('does not overshoot when the target vector is nearby', () => {
    const next = smoothVectorToward({ x: 0.9, y: 0 }, { x: 1, y: 0 }, 0.05, 8);

    expect(next.x).toBeCloseTo(1, 5);
    expect(next.y).toBeCloseTo(0, 5);
  });
});
