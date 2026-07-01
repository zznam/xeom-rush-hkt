export interface Vector2 {
  x: number;
  y: number;
}

export function shortestAngleDelta(from: number, to: number): number {
  let diff = to - from;
  while (diff < -Math.PI) diff += Math.PI * 2;
  while (diff > Math.PI) diff -= Math.PI * 2;
  return diff;
}

export function rotateTowardAngle(current: number, target: number, maxStep: number): number {
  const diff = shortestAngleDelta(current, target);
  if (Math.abs(diff) <= maxStep) {
    return target;
  }
  return current + Math.sign(diff) * maxStep;
}

export function clampVectorMagnitude(vector: Vector2, maxMagnitude: number = 1): Vector2 {
  const magnitude = Math.hypot(vector.x, vector.y);
  if (magnitude <= maxMagnitude || magnitude === 0) {
    return vector;
  }

  return {
    x: (vector.x / magnitude) * maxMagnitude,
    y: (vector.y / magnitude) * maxMagnitude,
  };
}

export function smoothVectorToward(current: Vector2, target: Vector2, dt: number, unitsPerSecond: number): Vector2 {
  const deltaX = target.x - current.x;
  const deltaY = target.y - current.y;
  const distance = Math.hypot(deltaX, deltaY);
  const maxStep = unitsPerSecond * dt;

  if (distance <= maxStep || distance === 0) {
    return target;
  }

  return {
    x: current.x + (deltaX / distance) * maxStep,
    y: current.y + (deltaY / distance) * maxStep,
  };
}
