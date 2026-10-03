import { isRoadPoint, roadSegmentClear, type Building } from './city-map';
import type { Vector2D } from './types';

const GRID_STEP = 50;
const GRID_WIDTH = 4000 / GRID_STEP;

// A reusable collision-aware graph; expensive edge checks are cached per road revision.
export class StreetNavigator {
  private points = new Map<number, Vector2D>();
  private edges = new Map<string, boolean>();
  constructor(private closures: Building[] = []) {
    for (let ix = 1; ix < GRID_WIDTH; ix++)
      for (let iy = 1; iy < GRID_WIDTH; iy++) {
        const point = { x: ix * GRID_STEP, y: iy * GRID_STEP };
        if (isRoadPoint(point, 16, closures)) this.points.set(ix * GRID_WIDTH + iy, point);
      }
  }
  private components = new Map<number, number>();
  private anchor(p: Vector2D) {
    if (!isRoadPoint(p, 16, this.closures)) return undefined;
    const candidates: [number, Vector2D][] = [];
    for (let x = Math.floor(p.x / GRID_STEP) - 1; x <= Math.floor(p.x / GRID_STEP) + 2; x++)
      for (let y = Math.floor(p.y / GRID_STEP) - 1; y <= Math.floor(p.y / GRID_STEP) + 2; y++) {
        const id = x * GRID_WIDTH + y,
          point = this.points.get(id);
        if (point && Math.abs(point.x - p.x) < 100 && Math.abs(point.y - p.y) < 100) candidates.push([id, point]);
      }
    return candidates
      .sort((a, b) => Math.hypot(a[1].x - p.x, a[1].y - p.y) - Math.hypot(b[1].x - p.x, b[1].y - p.y))
      .find(([, n]) => roadSegmentClear(p, n, this.closures))?.[0];
  }
  private clearEdge(id: number, next: number) {
    const here = this.points.get(id)!,
      there = this.points.get(next);
    if (!there || Math.abs(here.x - there.x) + Math.abs(here.y - there.y) !== GRID_STEP) return false;
    const key = id < next ? `${id}:${next}` : `${next}:${id}`;
    let clear = this.edges.get(key);
    if (clear === undefined) {
      clear = roadSegmentClear(here, there, this.closures);
      this.edges.set(key, clear);
    }
    return clear;
  }
  // Flood once per closure, then validate every required target against the component.
  reachableTargets(from: Vector2D, targets: readonly Vector2D[]) {
    const start = this.anchor(from);
    if (start === undefined) return false;
    if (!this.components.has(start)) {
      const queue = [start];
      this.components.set(start, start);
      for (let i = 0; i < queue.length; i++)
        for (const offset of [-GRID_WIDTH, GRID_WIDTH, -1, 1]) {
          const next = queue[i] + offset;
          if (!this.components.has(next) && this.clearEdge(queue[i], next)) {
            this.components.set(next, start);
            queue.push(next);
          }
        }
    }
    const component = this.components.get(start);
    return targets.every((target) => {
      const end = this.anchor(target);
      return end !== undefined && this.components.get(end) === component;
    });
  }
  route(from: Vector2D, to: Vector2D): Vector2D[] {
    if (!isRoadPoint(from, 16, this.closures) || !isRoadPoint(to, 16, this.closures)) return [];
    if (roadSegmentClear(from, to, this.closures))
      return [
        { x: from.x, y: from.y },
        { x: to.x, y: to.y },
      ];
    const start = this.anchor(from);
    const end = this.anchor(to);
    if (start === undefined || end === undefined) return [];
    const costs = new Map<number, number>([[start, 0]]);
    const parent = new Map<number, number>();
    const heap: { id: number; score: number }[] = [];
    const push = (id: number, score: number) => {
      heap.push({ id, score });
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p].score <= score) break;
        [heap[i], heap[p]] = [heap[p], heap[i]];
        i = p;
      }
    };
    const pop = () => {
      const first = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        while (true) {
          let n = i;
          const l = i * 2 + 1,
            r = l + 1;
          if (l < heap.length && heap[l].score < heap[n].score) n = l;
          if (r < heap.length && heap[r].score < heap[n].score) n = r;
          if (n === i) break;
          [heap[i], heap[n]] = [heap[n], heap[i]];
          i = n;
        }
      }
      return first;
    };
    const visited = new Set<number>();
    push(start, 0);
    while (heap.length) {
      const { id } = pop();
      if (visited.has(id)) continue;
      visited.add(id);
      if (id === end) {
        const path: Vector2D[] = [{ x: to.x, y: to.y }];
        let cur = end;
        while (cur !== start) {
          path.push(this.points.get(cur)!);
          cur = parent.get(cur)!;
        }
        path.push(this.points.get(start)!, { x: from.x, y: from.y });
        const ordered = path.reverse();
        // Keep corners and endpoints; collinear grid nodes do not add guidance.
        return ordered.filter((point, i) => {
          if (i === 0 || i === ordered.length - 1) return true;
          const a = ordered[i - 1],
            b = ordered[i + 1];
          return Math.abs((point.x - a.x) * (b.y - point.y) - (point.y - a.y) * (b.x - point.x)) > 0.001;
        });
      }
      const here = this.points.get(id)!;
      for (const offset of [-GRID_WIDTH, GRID_WIDTH, -1, 1]) {
        const next = id + offset;
        const there = this.points.get(next);
        if (!there || visited.has(next) || Math.abs(here.x - there.x) + Math.abs(here.y - there.y) !== GRID_STEP)
          continue;
        if (!this.clearEdge(id, next)) continue;
        const cost = costs.get(id)! + GRID_STEP;
        if (cost >= (costs.get(next) ?? Infinity)) continue;
        costs.set(next, cost);
        parent.set(next, id);
        push(next, cost + Math.abs(there.x - to.x) + Math.abs(there.y - to.y));
      }
    }
    return [];
  }
}
let defaultNavigator: StreetNavigator | undefined;
export function findStreetRoute(from: Vector2D, to: Vector2D): Vector2D[] {
  defaultNavigator ??= new StreetNavigator();
  return defaultNavigator.route(from, to);
}

// Trim progress along a route. Replan only when the rider meaningfully deviates.
export function advanceStreetRoute(from: Vector2D, route: Vector2D[], closures: Building[] = []): Vector2D[] | null {
  if (route.length < 2) return null;
  let index = -1,
    closest = Infinity;
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i],
      b = route[i + 1],
      dx = b.x - a.x,
      dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((from.x - a.x) * dx + (from.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const distance = Math.hypot(from.x - (a.x + dx * t), from.y - (a.y + dy * t));
    if (distance <= closest + 0.001 && roadSegmentClear(from, b, closures)) {
      closest = distance;
      index = i + 1;
    }
  }
  if (index < 0 || closest > 100) return null;
  if (
    index < route.length - 1 &&
    Math.hypot(from.x - route[index].x, from.y - route[index].y) < 40 &&
    roadSegmentClear(from, route[index + 1], closures)
  )
    index++;
  return [{ x: from.x, y: from.y }, ...route.slice(index)];
}
