import { expect, it } from 'vitest';
import { createJob, jobTip, PERSONAS } from './jobs';
import { EPassengerTier } from './types';
const passenger = {
  id: 'pass-8',
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
it('authors six different passengers with twelve distinct lines each', () => {
  expect(PERSONAS.length).toBe(6);
  for (const p of PERSONAS) expect(new Set(p.lines).size).toBe(12);
});
it('makes parcel stops deterministic and food/parcel tips optional', () => {
  const parcel = createJob(passenger);
  expect(parcel.kind).toBe('parcel');
  expect(parcel.stops.length).toBe(2);
  parcel.damage = 1;
  expect(jobTip(10000, parcel, 10, false)).toBe(0);
  const food = createJob({ ...passenger, id: 'pass-6' });
  expect(food.kind).toBe('food');
  expect(jobTip(10000, food, 2401, false)).toBe(0);
  expect(food.stops).toEqual([{ x: 2050, y: 2200 }]);
});
