import { describe, expect, it } from 'vitest';
import { CITY_MAP, createCityMap, roadSegmentClear } from './city-map';
import { findStreetRoute } from './navigation';
import { calculateFare, parseGameCommand } from './gameplay';
describe('portable city foundation', () => {
  it('generates identical client and server geometry', () => expect(createCityMap()).toEqual(CITY_MAP));
  it('routes around buildings and roundabout centres', () => {
    for (const [from, to] of [
      [
        { x: 450, y: 50 },
        { x: 450, y: 850 },
      ],
      [
        { x: 2050, y: 2050 },
        { x: 3250, y: 1650 },
      ],
    ]) {
      const path = findStreetRoute(from, to);
      expect(path.length).toBeGreaterThan(1);
      for (let i = 1; i < path.length; i++) expect(roadSegmentClear(path[i - 1], path[i])).toBe(true);
    }
  });
  it('preserves the base fare and bounds environmental stacking', () =>
    expect(calculateFare(10000, 3, 10, true, 500)).toEqual({
      base: 10000,
      combo: 5000,
      environment: 7500,
      clean: 2250,
      tip: 500,
      total: 25250,
    }));
  it('rejects unbounded or malformed control messages', () => {
    expect(parseGameCommand('{')).toBeNull();
    expect(parseGameCommand(JSON.stringify({ version: 1, id: 'x', action: 'select', target: {} }))).toBeNull();
  });
});
