import { MOTORBIKE_SPEED, MAP_SIZE } from '@xeom-rush/shared';

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PendingInput {
  seq: number;
  dx: number;
  dy: number;
  angle: number;
  dt: number;
}

class SeededRng {
  private s: number;
  constructor(seed: number) {
    this.s = seed;
  }
  public next(): number {
    this.s = (this.s * 1664525 + 1013904223) % 4294967296;
    return this.s / 4294967296;
  }
}

const STREET_LINES = [50, 450, 850, 1250, 1650, 2050, 2450, 2850, 3250, 3650];
const ROUNDABOUT_CHANCE = 0.25;
const ROUNDABOUT_RADIUS = 34;

export interface CircleObstacle {
  x: number;
  y: number;
  radius: number;
}

export class ClientPrediction {
  private buildings: Rectangle[] = [];
  private circles: CircleObstacle[] = [];
  private pendingInputs: PendingInput[] = [];

  constructor() {
    this.generateMapObstacles();
  }

  private generateMapObstacles(): void {
    const blockSize = 300;
    const streetWidth = 100;
    const step = blockSize + streetWidth;

    for (let x = 100; x < MAP_SIZE - 100; x += step) {
      for (let y = 100; y < MAP_SIZE - 100; y += step) {
        const inCenter = Math.abs(x - MAP_SIZE / 2) < 400 && Math.abs(y - MAP_SIZE / 2) < 400;
        if (inCenter) continue;

        this.buildings.push({
          x,
          y,
          width: blockSize,
          height: blockSize,
        });
      }
    }

    const rng = new SeededRng(42);
    for (let xi = 0; xi < STREET_LINES.length; xi++) {
      for (let yi = 0; yi < STREET_LINES.length; yi++) {
        const cx = STREET_LINES[xi];
        const cy = STREET_LINES[yi];
        const inCenter = Math.abs(cx - MAP_SIZE / 2) < 400 && Math.abs(cy - MAP_SIZE / 2) < 400;
        const nearEdge = cx < 150 || cy < 150 || cx > MAP_SIZE - 150 || cy > MAP_SIZE - 150;
        if (inCenter || nearEdge) continue;

        const roll = rng.next();
        if (roll < ROUNDABOUT_CHANCE) {
          this.circles.push({ x: cx, y: cy, radius: ROUNDABOUT_RADIUS });
        }
      }
    }
  }

  public getBuildings(): Rectangle[] {
    return this.buildings;
  }

  private checkCircleRectCollision(cx: number, cy: number, radius: number, rect: Rectangle): boolean {
    const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.width));
    const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.height));

    const distanceX = cx - closestX;
    const distanceY = cy - closestY;

    const distanceSquared = distanceX * distanceX + distanceY * distanceY;
    return distanceSquared < radius * radius;
  }

  public resolveMove(
    oldX: number,
    oldY: number,
    newX: number,
    newY: number,
    radius: number = 15,
  ): { x: number; y: number } {
    let x = Math.max(radius, Math.min(MAP_SIZE - radius, newX));
    let y = Math.max(radius, Math.min(MAP_SIZE - radius, newY));

    for (const rect of this.buildings) {
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

    for (const circle of this.circles) {
      const dx = x - circle.x;
      const dy = y - circle.y;
      const dist = Math.hypot(dx, dy);
      const minDist = radius + circle.radius;
      if (dist < minDist) {
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

  /**
   * Adds input to local buffer for reconciliation.
   */
  public addInput(input: PendingInput): void {
    this.pendingInputs.push(input);
  }

  /**
   * Integrates inputs locally and predicts current player position.
   */
  public predict(currentX: number, currentY: number, input: PendingInput): { x: number; y: number } {
    if (input.dx === 0 && input.dy === 0) {
      return { x: currentX, y: currentY };
    }

    const mag = Math.sqrt(input.dx * input.dx + input.dy * input.dy);
    const throttle = Math.min(1, mag);
    const ndx = input.dx / mag;
    const ndy = input.dy / mag;

    const deltaX = ndx * MOTORBIKE_SPEED * throttle * input.dt;
    const deltaY = ndy * MOTORBIKE_SPEED * throttle * input.dt;

    return this.resolveMove(currentX, currentY, currentX + deltaX, currentY + deltaY);
  }

  /**
   * Reconciles the local position when a new server snapshot is received.
   */
  public reconcile(serverX: number, serverY: number, lastProcessedSeq: number): { x: number; y: number } {
    // 1. Filter out already processed inputs
    this.pendingInputs = this.pendingInputs.filter((input) => input.seq > lastProcessedSeq);

    // 2. Re-apply all pending inputs starting from server state
    let reconX = serverX;
    let reconY = serverY;

    for (const input of this.pendingInputs) {
      const pos = this.predict(reconX, reconY, input);
      reconX = pos.x;
      reconY = pos.y;
    }

    return { x: reconX, y: reconY };
  }

  public clear(): void {
    this.pendingInputs = [];
  }
}

export const prediction = new ClientPrediction();
