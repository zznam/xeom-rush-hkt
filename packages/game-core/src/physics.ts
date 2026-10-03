import { CITY_MAP, MAP_SIZE, COLLISION_RADIUS, DRIVER_RADIUS, circleIntersectsRectangle } from '@xeom-rush/shared';

export interface Rectangle {
  x: number; // min x
  y: number; // min y
  width: number;
  height: number;
}

export interface CircleObstacle {
  x: number;
  y: number;
  radius: number;
}

export class PhysicsEngine {
  private buildings: Rectangle[] = [];
  private closures: Rectangle[] = [];
  public setClosures(rectangles: Rectangle[]): void {
    this.closures = rectangles;
  }
  private circles: CircleObstacle[] = [];

  constructor() {
    this.generateMapObstacles();
    this.circles = CITY_MAP.features
      .filter((f) => f.kind === 'roundabout')
      .map((f) => ({ x: f.x, y: f.y, radius: f.radius! }));
  }

  public addCircleObstacle(x: number, y: number, radius: number): void {
    if (!this.circles.some((c) => c.x === x && c.y === y && c.radius === radius)) this.circles.push({ x, y, radius });
  }

  /**
   * Checks if a point is inside or too close to any building or roundabout circle.
   */
  public isInsideBuilding(px: number, py: number): boolean {
    const padding = COLLISION_RADIUS;
    for (const rect of [...this.buildings, ...this.closures]) {
      if (
        px >= rect.x - padding &&
        px <= rect.x + rect.width + padding &&
        py >= rect.y - padding &&
        py <= rect.y + rect.height + padding
      ) {
        return true;
      }
    }
    for (const circle of this.circles) {
      if (Math.hypot(px - circle.x, py - circle.y) < circle.radius + padding) return true;
    }
    return false;
  }

  /**
   * Generates a grid of block buildings to simulate alleys and streets.
   */
  private generateMapObstacles(): void {
    this.buildings = CITY_MAP.buildings.map((r) => ({ ...r }));
  }

  public getBuildings(): Rectangle[] {
    return this.buildings;
  }

  /**
   * Returns if a circle (player) collides with a rectangle.
   */
  private checkCircleRectCollision(cx: number, cy: number, radius: number, rect: Rectangle): boolean {
    return circleIntersectsRectangle(cx, cy, radius, rect);
  }

  /**
   * Resolves collision for a moving player. Returns corrected position.
   */
  public resolveMove(
    oldX: number,
    oldY: number,
    newX: number,
    newY: number,
    radius: number = DRIVER_RADIUS,
  ): { x: number; y: number } {
    // 1. Boundary check
    let x = Math.max(radius, Math.min(MAP_SIZE - radius, newX));
    let y = Math.max(radius, Math.min(MAP_SIZE - radius, newY));

    // 2. Obstacle collision check (rectangular buildings)
    for (const rect of [...this.buildings, ...this.closures]) {
      if (this.checkCircleRectCollision(x, y, radius, rect)) {
        if (!this.checkCircleRectCollision(oldX, y, radius, rect)) {
          x = oldX;
        } else if (!this.checkCircleRectCollision(x, oldY, radius, rect)) {
          y = oldY;
        } else {
          return { x: oldX, y: oldY };
        }
      }
    }

    // 3. Obstacle collision check (circular roundabout monuments)
    for (const circle of this.circles) {
      const dx = x - circle.x;
      const dy = y - circle.y;
      const dist = Math.hypot(dx, dy);
      const minDist = radius + circle.radius;
      if (dist < minDist) {
        // Push player out along the normal of the circle
        const fallbackDx = oldX - circle.x;
        const fallbackDy = oldY - circle.y;
        const fallbackDist = Math.hypot(fallbackDx, fallbackDy) || 1;
        const nx = dist > 0 ? dx / dist : fallbackDx / fallbackDist;
        const ny = dist > 0 ? dy / dist : fallbackDy / fallbackDist;
        x = circle.x + nx * minDist;
        y = circle.y + ny * minDist;
      }
    }

    return { x, y };
  }
}
