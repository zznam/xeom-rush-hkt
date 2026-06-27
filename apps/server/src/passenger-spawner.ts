import { PassengerState, MAP_SIZE, MAX_PASSENGERS } from '@xeom-rush/shared';

export class PassengerSpawner {
  private passengers: Map<string, PassengerState> = new Map();
  private nextId: number = 1;

  constructor() {
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

  public spawnPassenger(): PassengerState {
    const id = `pass-${this.nextId++}`;
    
    // Choose spawn point: 30% chance near market hot-zones, 70% random
    const isMarket = Math.random() < 0.3;
    let x = 0;
    let y = 0;

    if (isMarket) {
      // Spawn near the middle market area (MAP_SIZE / 2)
      const center = MAP_SIZE / 2;
      x = center + (Math.random() - 0.5) * 300;
      y = center + (Math.random() - 0.5) * 300;
    } else {
      // Random coordinates, keeping some padding from edges
      x = 100 + Math.random() * (MAP_SIZE - 200);
      y = 100 + Math.random() * (MAP_SIZE - 200);
    }

    // Set destination at least 1000 units away
    let destX = 0;
    let destY = 0;
    let distance = 0;
    
    do {
      destX = 100 + Math.random() * (MAP_SIZE - 200);
      destY = 100 + Math.random() * (MAP_SIZE - 200);
      const dx = destX - x;
      const dy = destY - y;
      distance = Math.sqrt(dx * dx + dy * dy);
    } while (distance < 1000);

    // Reward proportional to distance, with market bonus
    const distanceBonus = Math.floor(distance * 10);
    const marketBonus = isMarket ? 500 : 0;
    const reward = 1000 + distanceBonus + marketBonus; // VNĐ currency representation

    const passenger: PassengerState = {
      id,
      x,
      y,
      destX,
      destY,
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
