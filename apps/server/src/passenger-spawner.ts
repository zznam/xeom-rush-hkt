import { PassengerState, MAP_SIZE, MAX_PASSENGERS, COLLISION_RADIUS } from '@xeom-rush/shared';
import { PhysicsEngine } from './physics';

export class PassengerSpawner {
  private passengers: Map<string, PassengerState> = new Map();
  private nextId: number = 1;
  private physics: PhysicsEngine;

  constructor(physics: PhysicsEngine) {
    this.physics = physics;

    // Populate initial batch
    for (let i = 0; i < MAX_PASSENGERS; i++) {
      this.spawnPassenger();
    }
  }

  public getPassengers(): PassengerState[] {
    return Array.from(this.passengers.values());
  }

  public getPassengerMap(): Map<string, PassengerState> {
    return this.passengers;
  }

  public remove(id: string): void {
    this.passengers.delete(id);
  }

  public updateCarriedStatus(id: string, isCarried: boolean): void {
    const passenger = this.passengers.get(id);
    if (passenger) {
      passenger.isCarried = isCarried;
    }
  }

  /**
   * Generates a random position on a street (not inside any building).
   * Retries up to maxAttempts to find a valid position.
   */
  private generateStreetPosition(nearCenter: boolean): { x: number; y: number } {
    const maxAttempts = 50;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let x: number;
      let y: number;

      if (nearCenter) {
        // Spawn near the middle market area (MAP_SIZE / 2)
        const center = MAP_SIZE / 2;
        x = center + (Math.random() - 0.5) * 300;
        y = center + (Math.random() - 0.5) * 300;
      } else {
        // Random coordinates, keeping some padding from edges
        x = 100 + Math.random() * (MAP_SIZE - 200);
        y = 100 + Math.random() * (MAP_SIZE - 200);
      }

      // Validate position is not inside a building
      if (!this.physics.isInsideBuilding(x, y)) {
        return { x, y };
      }
    }

    // Fallback: place at center market area (always open)
    const center = MAP_SIZE / 2;
    return {
      x: center + (Math.random() - 0.5) * 100,
      y: center + (Math.random() - 0.5) * 100,
    };
  }

  public spawnPassenger(): PassengerState {
    const id = `pass-${this.nextId++}`;
    
    // Choose spawn point: 30% chance near market hot-zones, 70% random
    const isMarket = Math.random() < 0.3;
    const spawnPos = this.generateStreetPosition(isMarket);

    // Set destination at least 1000 units away, also on a street
    let destPos = { x: 0, y: 0 };
    let distance = 0;
    
    do {
      destPos = this.generateStreetPosition(false);
      const dx = destPos.x - spawnPos.x;
      const dy = destPos.y - spawnPos.y;
      distance = Math.sqrt(dx * dx + dy * dy);
    } while (distance < 1000);

    // Reward proportional to distance, with market bonus
    const distanceBonus = Math.floor(distance * 10);
    const marketBonus = isMarket ? 500 : 0;
    const reward = 1000 + distanceBonus + marketBonus; // VNĐ currency representation

    const passenger: PassengerState = {
      id,
      x: spawnPos.x,
      y: spawnPos.y,
      destX: destPos.x,
      destY: destPos.y,
      reward,
      spawnedAt: Date.now(),
      isCarried: false,
    };

    this.passengers.set(id, passenger);
    return passenger;
  }

  public tick(): void {
    // Respawn up to limit
    if (this.passengers.size < MAX_PASSENGERS) {
      const needed = MAX_PASSENGERS - this.passengers.size;
      for (let i = 0; i < needed; i++) {
        this.spawnPassenger();
      }
    }
  }
}
