import { expect, it } from 'vitest';
import { LANDMARKS, districtAt } from './atlas';
import { CITY_MAP, isRoadPoint, roadSegmentClear } from './city-map';
import { findStreetRoute } from './navigation';
it('keeps every authored landmark reachable through the shared district geometry', () => {
  expect(new Set(LANDMARKS.map((l) => l.id)).size).toBe(12);
  for (const target of LANDMARKS) {
    expect(districtAt(target).id).toBe(target.district);
    expect(isRoadPoint(target)).toBe(true);
    const path = findStreetRoute({ x: 2050, y: 2050 }, target);
    expect(path.length).toBeGreaterThan(1);
    for (let i = 1; i < path.length; i++) expect(roadSegmentClear(path[i - 1], path[i])).toBe(true);
  }
  expect(new Set(CITY_MAP.buildings.map((r) => `${r.width}:${r.height}`)).size).toBeGreaterThan(3);
});
