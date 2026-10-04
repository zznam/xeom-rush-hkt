import {
  limitMovementInput,
  type MovementInputState,
  cityAtTick,
  movementConditions,
  type CityLifeState,
  MOTORBIKE_SPEED,
} from '@xeom-rush/shared';
import { PhysicsEngine } from '@xeom-rush/game-core';
export type { Rectangle } from '@xeom-rush/game-core';

export interface PendingInput {
  seq: number;
  dx: number;
  dy: number;
  angle: number;
  dt: number;
  speed?: number;
}

export class ClientPrediction extends PhysicsEngine {
  private life: CityLifeState | null = null;
  private tick = 0;
  private speed = MOTORBIKE_SPEED;
  private paused = false;
  private revision = -1;
  public configure(speed = MOTORBIKE_SPEED, paused = false, revision = 0): void {
    if (!Number.isFinite(speed) || speed < 100 || speed > 1000) return;
    if (revision !== this.revision || speed !== this.speed || paused !== this.paused) this.clear();
    this.speed = speed;
    this.paused = paused;
    this.revision = revision;
  }
  public setCityLife(life: CityLifeState) {
    this.life = life;
    this.setClosures(life.closure?.active ? [life.closure.rect] : []);
  }
  public setTick(tick: number) {
    this.tick = tick;
  }
  public get raining() {
    return !!this.life?.enabled && cityAtTick(this.tick).rain;
  }
  public get speedMultiplier() {
    return movementConditions(this.raining).speed;
  }
  private motion: MovementInputState = { dx: 0, dy: 0, angle: 0 };
  private history = new Map<number, MovementInputState>();
  public setMovement(state: MovementInputState & { seq: number }) {
    this.history.set(state.seq, { dx: state.dx, dy: state.dy, angle: state.angle });
    if (this.history.size > 512) this.history.delete(this.history.keys().next().value!);
  }
  private pendingInputs: PendingInput[] = [];
  public addInput(input: PendingInput): void {
    this.pendingInputs.push(input);
  }

  /**
   * Integrates inputs locally and predicts current player position.
   */
  public predict(currentX: number, currentY: number, raw: PendingInput): { x: number; y: number; angle: number } {
    if (this.paused) return { x: currentX, y: currentY, angle: raw.angle };
    this.motion = limitMovementInput(this.motion, raw, raw.dt, (raw.speed ?? this.speedMultiplier) < 1);
    this.setMovement({ ...this.motion, seq: raw.seq });
    const input = { ...raw, ...this.motion };
    if (input.dx === 0 && input.dy === 0) {
      return { x: currentX, y: currentY, angle: this.motion.angle };
    }

    const mag = Math.sqrt(input.dx * input.dx + input.dy * input.dy);
    const throttle = Math.min(1, mag);
    const ndx = input.dx / mag;
    const ndy = input.dy / mag;

    const deltaX = ndx * this.speed * (input.speed ?? this.speedMultiplier) * throttle * input.dt;
    const deltaY = ndy * this.speed * (input.speed ?? this.speedMultiplier) * throttle * input.dt;

    return { ...this.resolveMove(currentX, currentY, currentX + deltaX, currentY + deltaY), angle: this.motion.angle };
  }

  /**
   * Reconciles the local position when a new server snapshot is received.
   */
  public reconcile(serverX: number, serverY: number, lastProcessedSeq: number): { x: number; y: number } {
    this.motion = this.history.get(lastProcessedSeq) ?? this.motion;
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
    this.motion = { dx: 0, dy: 0, angle: 0 };
    this.history.clear();
  }
}

export const prediction = new ClientPrediction();
