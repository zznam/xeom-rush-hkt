import { MAP_SIZE } from '@xeom-rush/shared';

export interface Rectangle {
  x: number; // min x
  y: number; // min y
  width: number;
  height: number;
}

export class PhysicsEngine {
  private buildings: Rectangle[] = [];

  constructor() {
    this.generateMapObstacles();
  }

  /**
   * Generates a grid of block buildings to simulate alleys and streets.
   */
  private generateMapObstacles(): void {
    const blockSize = 300;
    const streetWidth = 100;
    const step = blockSize + streetWidth;

    for (let x = 100; x < MAP_SIZE - 100; x += step) {
      for (let y = 100; y < MAP_SIZE - 100; y += step) {
        // Leave some areas open for "Chợ" (markets) in the middle
        const inCenter = Math.abs(x - MAP_SIZE / 2) < 400 && Math.abs(y - MAP_SIZE / 2) < 400;
        if (inCenter) continue;

        // Otherwise add block
        this.buildings.push({
          x,
          y,
          width: blockSize,
          height: blockSize,
        });
      }
    }
  }

  public getBuildings(): Rectangle[] {
    return this.buildings;
  }

  /**
   * Returns if a circle (player) collides with a rectangle.
   */
  private checkCircleRectCollision(cx: number, cy: number, radius: number, rect: Rectangle): boolean {
    const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.width));
    const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.height));

    const distanceX = cx - closestX;
    const distanceY = cy - closestY;

    const distanceSquared = distanceX * distanceX + distanceY * distanceY;
    return distanceSquared < radius * radius;
  }

  /**
   * Resolves collision for a moving player. Returns corrected position.
   */
  public resolveMove(oldX: number, oldY: number, newX: number, newY: number, radius: number = 15): { x: number; y: number } {
    // 1. Boundary check
    let x = Math.max(radius, Math.min(MAP_SIZE - radius, newX));
    let y = Math.max(radius, Math.min(MAP_SIZE - radius, newY));

    // 2. Obstacle collision check
    for (const rect of this.buildings) {
      if (this.checkCircleRectCollision(x, y, radius, rect)) {
        // Slide along axes
        // Try correcting X axis first
        if (!this.checkCircleRectCollision(oldX, y, radius, rect)) {
          x = oldX;
        } else if (!this.checkCircleRectCollision(x, oldY, radius, rect)) {
          y = oldY;
        } else {
          // If stuck on both, return old position
          return { x: oldX, y: oldY };
        }
      }
    }

    return { x, y };
  }
}
