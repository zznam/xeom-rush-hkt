export class InputHandler {
  private keys: { [key: string]: boolean } = {};

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => {
        this.keys[e.key.toLowerCase()] = true;
      });

      window.addEventListener('keyup', (e) => {
        this.keys[e.key.toLowerCase()] = false;
      });
    }
  }

  public getInputVector(): { dx: number; dy: number; angle: number } {
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
