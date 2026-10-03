import { DRIVER_RADIUS, MAP_SIZE } from './constants';
import type { Vector2D } from './types';

export interface Building {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface MapFeature extends Vector2D {
  id: string;
  kind: 'roundabout' | 'light' | 'crosswalk';
  radius?: number;
  direction?: 'horizontal' | 'vertical';
  tickOffset?: number;
}
export const STREET_LINES = [50, 450, 850, 1250, 1650, 2050, 2450, 2850, 3250, 3650];
export class SeededRandom {
  constructor(private state = 42) {}
  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 0xffffffff;
  }
}
export function createCityMap() {
  const buildings: Building[] = [];
  for (let x = 100; x < MAP_SIZE - 100; x += 400)
    for (let y = 100; y < MAP_SIZE - 100; y += 400) {
      if (Math.abs(x - MAP_SIZE / 2) < 400 && Math.abs(y - MAP_SIZE / 2) < 400) continue;
      if (x < 2000 && y < 2000) {
        for (const dx of [0, 190])
          for (const dy of [0, 190]) buildings.push({ x: x + dx, y: y + dy, width: 110, height: 110 });
      } else if (x >= 2000 && y < 2000) buildings.push({ x, y, width: 300, height: 260 });
      else if (x < 2000) {
        buildings.push({ x, y, width: 120, height: 300 }, { x: x + 180, y, width: 120, height: 300 });
      } else buildings.push({ x, y, width: 260, height: 300 });
    }
  const features: MapFeature[] = [];
  const rng = new SeededRandom();
  STREET_LINES.forEach((x, ix) =>
    STREET_LINES.forEach((y, iy) => {
      if (
        (Math.abs(x - MAP_SIZE / 2) < 400 && Math.abs(y - MAP_SIZE / 2) < 400) ||
        x < 150 ||
        y < 150 ||
        x > MAP_SIZE - 150 ||
        y > MAP_SIZE - 150
      )
        return;
      const roll = rng.next();
      if (roll < 0.12) features.push({ id: `roundabout-${ix}-${iy}`, kind: 'roundabout', x, y, radius: 24 });
      else if (roll < 0.42)
        features.push({ id: `tl-${ix}-${iy}`, kind: 'light', x, y, tickOffset: Math.floor(rng.next() * 400) });
      else if (roll < 0.82)
        features.push({
          id: `cw-${ix}-${iy}`,
          kind: 'crosswalk',
          x,
          y,
          direction: rng.next() < 0.5 ? 'horizontal' : 'vertical',
        });
    }),
  );
  return { buildings, features };
}
export const CITY_MAP = createCityMap();
// Static geometry is indexed once; every runtime queries the same authored shapes.
const roadBins = new Map<string, { buildings: Building[]; circles: MapFeature[] }>();
function bin(x: number, y: number) {
  const key = `${x}:${y}`;
  let value = roadBins.get(key);
  if (!value) {
    value = { buildings: [], circles: [] };
    roadBins.set(key, value);
  }
  return value;
}
for (const r of CITY_MAP.buildings)
  for (let x = Math.floor(r.x / 100); x <= Math.floor((r.x + r.width) / 100); x++)
    for (let y = Math.floor(r.y / 100); y <= Math.floor((r.y + r.height) / 100); y++) bin(x, y).buildings.push(r);
for (const c of CITY_MAP.features.filter((f) => f.kind === 'roundabout'))
  for (let x = Math.floor((c.x - c.radius!) / 100); x <= Math.floor((c.x + c.radius!) / 100); x++)
    for (let y = Math.floor((c.y - c.radius!) / 100); y <= Math.floor((c.y + c.radius!) / 100); y++)
      bin(x, y).circles.push(c);
export function isRoadPoint(point: Vector2D, clearance = 16, closures: Building[] = []): boolean {
  if (point.x < clearance || point.y < clearance || point.x > MAP_SIZE - clearance || point.y > MAP_SIZE - clearance)
    return false;
  const blocked = (r: Building) =>
    point.x >= r.x - clearance &&
    point.x <= r.x + r.width + clearance &&
    point.y >= r.y - clearance &&
    point.y <= r.y + r.height + clearance;
  if (closures.some(blocked)) return false;
  for (let x = Math.floor((point.x - clearance) / 100); x <= Math.floor((point.x + clearance) / 100); x++)
    for (let y = Math.floor((point.y - clearance) / 100); y <= Math.floor((point.y + clearance) / 100); y++) {
      const nearby = roadBins.get(`${x}:${y}`);
      if (
        nearby &&
        (nearby.buildings.some(blocked) ||
          nearby.circles.some((c) => Math.hypot(point.x - c.x, point.y - c.y) < c.radius! + clearance))
      )
        return false;
    }
  return true;
}
export function roadSegmentClear(a: Vector2D, b: Vector2D, closures: Building[] = []): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 8));
  for (let i = 0; i <= steps; i++)
    if (!isRoadPoint({ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps }, 16, closures))
      return false;
  return true;
}

/** Exact circular body collision, shared by movement and GPS endpoint recovery. */
export function circleIntersectsRectangle(cx: number, cy: number, radius: number, rect: Building): boolean {
  const dx = cx - Math.max(rect.x, Math.min(cx, rect.x + rect.width));
  const dy = cy - Math.max(rect.y, Math.min(cy, rect.y + rect.height));
  return dx * dx + dy * dy < radius * radius;
}
export function isDrivablePoint(point: Vector2D, closures: Building[] = [], radius = DRIVER_RADIUS): boolean {
  if (point.x < radius || point.y < radius || point.x > MAP_SIZE - radius || point.y > MAP_SIZE - radius) return false;
  const blocked = (rect: Building) => circleIntersectsRectangle(point.x, point.y, radius, rect);
  if (closures.some(blocked)) return false;
  for (let x = Math.floor((point.x - radius) / 100); x <= Math.floor((point.x + radius) / 100); x++)
    for (let y = Math.floor((point.y - radius) / 100); y <= Math.floor((point.y + radius) / 100); y++) {
      const nearby = roadBins.get(`${x}:${y}`);
      if (
        nearby &&
        (nearby.buildings.some(blocked) ||
          nearby.circles.some((c) => Math.hypot(point.x - c.x, point.y - c.y) < c.radius! + radius))
      )
        return false;
    }
  return true;
}
export function drivableSegmentClear(a: Vector2D, b: Vector2D, closures: Building[] = []): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 8));
  for (let i = 0; i <= steps; i++)
    if (!isDrivablePoint({ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps }, closures))
      return false;
  return true;
}
