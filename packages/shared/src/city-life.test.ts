import { expect, it } from 'vitest';
import { cityAtTick, DEMAND_EVENTS, environmentMultiplier, movementConditions } from './city-life';
it('uses authoritative ticks for twelve-minute days and ninety-second rain', () => {
  expect(cityAtTick(7199).rain).toBe(false);
  expect(cityAtTick(7200).rain).toBe(true);
  expect(cityAtTick(8999).rain).toBe(true);
  expect(cityAtTick(9000).rain).toBe(false);
  expect(cityAtTick(8400).phase).toBe('night');
  expect(cityAtTick(14400).phase).toBe('day');
  expect(movementConditions(true).acceleration).toBeLessThan(movementConditions(false).acceleration);
});
it('announces roadworks before activation and prevents multiplying environmental bonuses', () => {
  expect(cityAtTick(4800).closure?.active).toBe(false);
  expect(cityAtTick(5000).closure?.active).toBe(true);
  expect(cityAtTick(6200).closure).toBeNull();
  expect(environmentMultiplier(cityAtTick(7200), { x: 2450, y: 950 }, true)).toBe(1.5);
  expect(new Set(DEMAND_EVENTS.map((e) => e.id)).size).toBe(6);
});
