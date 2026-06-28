export class InputHandler {
  private keys: { [key: string]: boolean } = {};

  private joystickInput: { dx: number; dy: number } | null = null;

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

  public getInputVector(): { dx: number; dy: number; angle: number } {
    if (this.joystickInput) {
      const { dx, dy } = this.joystickInput;
      let angle = 0;
      if (dx !== 0 || dy !== 0) {
        angle = Math.atan2(dy, dx);
      }
      return { dx, dy, angle };
    }

    let dx = 0;
    let dy = 0;

    if (this.keys['w'] || this.keys['arrowup']) dy -= 1;
    if (this.keys['s'] || this.keys['arrowdown']) dy += 1;
    if (this.keys['a'] || this.keys['arrowleft']) dx -= 1;
    if (this.keys['d'] || this.keys['arrowright']) dx += 1;

    let angle = 0;
    if (dx !== 0 || dy !== 0) {
      angle = Math.atan2(dy, dx);
    }

    return { dx, dy, angle };
  }

  public clear(): void {
    this.keys = {};
  }
}

export const inputHandler = new InputHandler();
