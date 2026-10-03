import { MOTORBIKE_SPEED } from '@xeom-rush/shared';
import { PhysicsEngine } from '@xeom-rush/game-core';
export type { Rectangle } from '@xeom-rush/game-core';

export interface PendingInput {
  seq: number;
  dx: number;
  dy: number;
  angle: number;
  dt: number;
}

export class ClientPrediction extends PhysicsEngine {
  private pendingInputs: PendingInput[] = [];
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
