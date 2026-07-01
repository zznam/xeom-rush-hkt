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

export class ClientPrediction {
  private buildings: Rectangle[] = [];
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

  public resolveMove(oldX: number, oldY: number, newX: number, newY: number, radius: number = 15): { x: number; y: number } {
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
