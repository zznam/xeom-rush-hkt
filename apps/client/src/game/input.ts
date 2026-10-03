import type { GamePreferences } from './preferences';
import { movementConditions, clampVectorMagnitude, rotateTowardAngle, smoothVectorToward } from '@xeom-rush/shared';

const INPUT_DEADZONE = 0.015;

export class InputHandler {
  private blocked = 0;
  private bindings = { up: 'w', down: 's', left: 'a', right: 'd', horn: 'h' };
  private sensitivity = 1;
  public configure(p: { bindings: GamePreferences['bindings']; sensitivity: number }) {
    this.bindings = p.bindings;
    this.sensitivity = p.sensitivity;
    this.clear();
  }
  public suspend() {
    this.blocked++;
    this.clear();
  }
  public resume() {
    this.blocked = Math.max(0, this.blocked - 1);
    this.clear();
  }
  public get suspended() {
    return this.blocked > 0;
  }
  private rain = false;
  public setRain(rain: boolean) {
    this.rain = rain;
  }
  private keys: { [key: string]: boolean } = {};

  private joystickInput: { dx: number; dy: number } | null = null;
  private smoothedInput = { x: 0, y: 0 };
  private smoothedAngle = 0;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => {
        if (
          this.suspended ||
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          e.target instanceof HTMLSelectElement
        )
          return;
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
        if (e.key) {
          this.keys[e.key.toLowerCase()] = true;
        }
      });

      window.addEventListener('blur', () => this.clear());
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.clear();
      });
      window.addEventListener('keyup', (e) => {
        if (e.key) {
          this.keys[e.key.toLowerCase()] = false;
        }
      });
    }
  }

  public setJoystickInput(dx: number, dy: number): void {
    if (this.suspended) return;
    if (dx === 0 && dy === 0) {
      this.joystickInput = null;
    } else {
      this.joystickInput = { dx, dy };
    }
  }

  public getInputVector(dt: number = 1 / 60): { dx: number; dy: number; angle: number } {
    if (this.suspended) return { dx: 0, dy: 0, angle: this.smoothedAngle };
    const target = this.readRawInputVector();
    this.smoothedInput = smoothVectorToward(this.smoothedInput, target, dt, movementConditions(this.rain).acceleration);

    if (Math.hypot(this.smoothedInput.x, this.smoothedInput.y) < INPUT_DEADZONE) {
      this.smoothedInput = { x: 0, y: 0 };
    }

    if (this.smoothedInput.x !== 0 || this.smoothedInput.y !== 0) {
      const targetAngle = Math.atan2(this.smoothedInput.y, this.smoothedInput.x);
      this.smoothedAngle = rotateTowardAngle(this.smoothedAngle, targetAngle, movementConditions(this.rain).turn * dt);
    }

    return {
      dx: this.smoothedInput.x,
      dy: this.smoothedInput.y,
      angle: this.smoothedAngle,
    };
  }

  private readRawInputVector(): { x: number; y: number } {
    if (this.joystickInput) {
      return clampVectorMagnitude({
        x: this.joystickInput.dx * this.sensitivity,
        y: this.joystickInput.dy * this.sensitivity,
      });
    }

    let dx = 0;
    let dy = 0;

    if (this.keys[this.bindings.up] || this.keys['arrowup']) dy -= 1;
    if (this.keys[this.bindings.down] || this.keys['arrowdown']) dy += 1;
    if (this.keys[this.bindings.left] || this.keys['arrowleft']) dx -= 1;
    if (this.keys[this.bindings.right] || this.keys['arrowright']) dx += 1;

    return clampVectorMagnitude({ x: dx, y: dy });
  }

  public clear(): void {
    this.keys = {};
    this.joystickInput = null;
    this.smoothedInput = { x: 0, y: 0 };
    this.smoothedAngle = 0;
  }
}

export const inputHandler = new InputHandler();
