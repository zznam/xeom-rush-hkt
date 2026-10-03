import { describe, expect, it } from 'vitest';
import { CITY_MAP, createCityMap, roadSegmentClear, isRoadPoint } from './city-map';
import { LANDMARKS } from './atlas';
import { findStreetRoute, StreetNavigator } from './navigation';
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

it('indexes geometry without changing road clearance at building and closure edges', () => {
  const closures = [{ x: 800, y: 1100, width: 100, height: 60 }];
  const reference = (point: { x: number; y: number }, padding: number) =>
    point.x >= padding &&
    point.y >= padding &&
    point.x <= 4000 - padding &&
    point.y <= 4000 - padding &&
    ![...CITY_MAP.buildings, ...closures].some(
      (r) =>
        point.x >= r.x - padding &&
        point.x <= r.x + r.width + padding &&
        point.y >= r.y - padding &&
        point.y <= r.y + r.height + padding,
    ) &&
    !CITY_MAP.features.some(
      (f) => f.kind === 'roundabout' && Math.hypot(point.x - f.x, point.y - f.y) < f.radius! + padding,
    );
  for (let x = 0; x <= 4000; x += 50)
    for (let y = 0; y <= 4000; y += 50) expect(isRoadPoint({ x, y }, 16, closures)).toBe(reference({ x, y }, 16));
  for (const r of CITY_MAP.buildings)
    for (const padding of [0, 15, 16, 44])
      for (const x of [r.x - padding, r.x + r.width + padding])
        for (const y of [r.y - padding, r.y + r.height + padding])
          expect(isRoadPoint({ x, y }, padding, closures)).toBe(reference({ x, y }, padding));
});
it('validates all landmark targets with a reusable closure connectivity graph', () => {
  const navigator = new StreetNavigator([{ x: 800, y: 1100, width: 100, height: 60 }]);
  expect(navigator.reachableTargets({ x: 2050, y: 2050 }, LANDMARKS)).toBe(true);
  expect(navigator.reachableTargets({ x: 2050, y: 2050 }, [{ x: 850, y: 1130 }])).toBe(false);
});
import { advanceStreetRoute } from './navigation';
it('trims forward progress without cutting obstacles and requests replanning after meaningful deviation', () => {
  const target = LANDMARKS.find((l) => l.id === 'ben-thanh')!;
  const path = findStreetRoute({ x: 2050, y: 2050 }, target);
  expect(path.length).toBeLessThan(30);
  const advanced = advanceStreetRoute(path[1], path)!;
  expect(advanced.length).toBeLessThanOrEqual(path.length);
  for (let i = 1; i < advanced.length; i++) expect(roadSegmentClear(advanced[i - 1], advanced[i])).toBe(true);
  expect(advanceStreetRoute({ x: 3650, y: 3650 }, path)).toBeNull();
});
it('keeps cached geometry independent of mutable rider positions', () => {
  const from = { x: 2050, y: 2050 },
    to = { x: 2050, y: 2300 };
  const path = findStreetRoute(from, to);
  from.x = 3650;
  to.y = 3000;
  expect(path[0]).toEqual({ x: 2050, y: 2050 });
  expect(path.at(-1)).toEqual({ x: 2050, y: 2300 });
});
