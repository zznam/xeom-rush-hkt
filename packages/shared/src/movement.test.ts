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
import { limitMovementInput } from './movement';
it('enforces slower rain acceleration and turning on raw input, but releases controls immediately', () => {
  const previous = { dx: 0, dy: 0, angle: 0 },
    intent = { dx: 1, dy: 0, angle: Math.PI };
  expect(limitMovementInput(previous, intent, 0.05, false)).toEqual({ dx: 0.4, dy: 0, angle: 0.5 });
  expect(limitMovementInput(previous, intent, 0.05, true)).toEqual({ dx: 0.30000000000000004, dy: 0, angle: 0.4 });
  expect(limitMovementInput(intent, previous, 0.01, true)).toEqual({ dx: 0, dy: 0, angle: Math.PI });
  expect(Number.isFinite(limitMovementInput(previous, { ...intent, angle: 1e300 }, 0.05, true).angle)).toBe(true);
});
