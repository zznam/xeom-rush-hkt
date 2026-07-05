import { clampVectorMagnitude, rotateTowardAngle, smoothVectorToward } from '@xeom-rush/shared';

const INPUT_ACCELERATION_PER_SECOND = 8;
const INPUT_TURN_RATE_RAD_PER_SECOND = 10;
const INPUT_DEADZONE = 0.015;

export class InputHandler {
  private keys: { [key: string]: boolean } = {};

  private joystickInput: { dx: number; dy: number } | null = null;
  private smoothedInput = { x: 0, y: 0 };
  private smoothedAngle = 0;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => {
        if (e.key) {
          this.keys[e.key.toLowerCase()] = true;
        }
      });

      window.addEventListener('keyup', (e) => {
        if (e.key) {
          this.keys[e.key.toLowerCase()] = false;
        }
      });
    }
  }

  public setJoystickInput(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) {
      this.joystickInput = null;
    } else {
      this.joystickInput = { dx, dy };
    }
  }

  public getInputVector(dt: number = 1 / 60): { dx: number; dy: number; angle: number } {
    const target = this.readRawInputVector();
    this.smoothedInput = smoothVectorToward(this.smoothedInput, target, dt, INPUT_ACCELERATION_PER_SECOND);

    if (Math.hypot(this.smoothedInput.x, this.smoothedInput.y) < INPUT_DEADZONE) {
      this.smoothedInput = { x: 0, y: 0 };
    }

    if (this.smoothedInput.x !== 0 || this.smoothedInput.y !== 0) {
      const targetAngle = Math.atan2(this.smoothedInput.y, this.smoothedInput.x);
      this.smoothedAngle = rotateTowardAngle(this.smoothedAngle, targetAngle, INPUT_TURN_RATE_RAD_PER_SECOND * dt);
    }

    return {
      dx: this.smoothedInput.x,
      dy: this.smoothedInput.y,
      angle: this.smoothedAngle,
    };
  }

  private readRawInputVector(): { x: number; y: number } {
    if (this.joystickInput) {
      return clampVectorMagnitude({ x: this.joystickInput.dx, y: this.joystickInput.dy });
    }

    let dx = 0;
    let dy = 0;

    if (this.keys['w'] || this.keys['arrowup']) dy -= 1;
    if (this.keys['s'] || this.keys['arrowdown']) dy += 1;
    if (this.keys['a'] || this.keys['arrowleft']) dx -= 1;
    if (this.keys['d'] || this.keys['arrowright']) dx += 1;

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
