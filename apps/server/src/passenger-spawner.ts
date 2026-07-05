import {
  PassengerState,
  EPassengerTier,
  MAP_SIZE,
  MAX_PASSENGERS,
  COLLISION_RADIUS,
  TICK_RATE,
  RUSH_HOUR_SPAWN_MULTIPLIER,
  RUSH_HOUR_MULTIPLIER,
  TIER_WEIGHT_BUSINESS,
  TIER_WEIGHT_VIP,
  TIER_MULTIPLIER_BUSINESS,
  TIER_MULTIPLIER_VIP,
} from '@xeom-rush/shared';
import { PhysicsEngine } from './physics';

// Deadline multipliers per tier (fraction of estimated travel time)
const DEADLINE_MULTIPLIER_REGULAR = 0; // no deadline
const DEADLINE_MULTIPLIER_BUSINESS = 0.7;
const DEADLINE_MULTIPLIER_VIP = 1.2;

// Speed estimate for deadline calculation (conservative estimate)
const ESTIMATED_SPEED_UNITS_PER_TICK = 10;

export interface VIPSpawnEvent {
  passengerId: string;
}

export class PassengerSpawner {
  private passengers: Map<string, PassengerState> = new Map();
  private nextId: number = 1;
  private physics: PhysicsEngine;
  private pendingVIPEvents: VIPSpawnEvent[] = [];

  constructor(physics: PhysicsEngine) {
    this.physics = physics;

    // Populate initial batch — all Regular to start
    for (let i = 0; i < MAX_PASSENGERS; i++) {
      this.spawnPassenger(0);
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

  /** Drain and return any VIP spawn events that occurred since last call. */
  public drainVIPEvents(): VIPSpawnEvent[] {
    const events = this.pendingVIPEvents;
    this.pendingVIPEvents = [];
    return events;
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

  /** Pick a passenger tier based on weighted probability. */
  private pickTier(): EPassengerTier {
    const roll = Math.random();
    if (roll < TIER_WEIGHT_VIP) return EPassengerTier.VIP;
    if (roll < TIER_WEIGHT_VIP + TIER_WEIGHT_BUSINESS) return EPassengerTier.BUSINESS;
    return EPassengerTier.REGULAR;
  }

  /** Calculate deadline tick for a passenger (0 = no deadline). */
  private calculateDeadline(currentTick: number, distance: number, tier: EPassengerTier): number {
    let deadlineMultiplier: number;
    switch (tier) {
      case EPassengerTier.BUSINESS:
        deadlineMultiplier = DEADLINE_MULTIPLIER_BUSINESS;
        break;
      case EPassengerTier.VIP:
        deadlineMultiplier = DEADLINE_MULTIPLIER_VIP;
        break;
      default:
        deadlineMultiplier = DEADLINE_MULTIPLIER_REGULAR;
    }

    if (deadlineMultiplier === 0) return 0;

    const ticksNeeded = distance / ESTIMATED_SPEED_UNITS_PER_TICK;
    return Math.floor(currentTick + ticksNeeded * deadlineMultiplier);
  }

  /**
   * Spawn a passenger. Pass `currentTick` so deadlines can be set relative to it.
   * Pass a forced `tier` override (e.g. in tests) or let it be randomly assigned.
   */
  public spawnPassenger(
    currentTick: number,
    forceTier?: EPassengerTier,
    rushHourActive: boolean = false,
  ): PassengerState {
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

    // Determine tier
    const tier = forceTier ?? this.pickTier();

    // Reward calculation
    const distanceBonus = Math.floor(distance * 10);
    const marketBonus = isMarket ? 500 : 0;
    const baseReward = 1000 + distanceBonus + marketBonus;

    let tierMultiplier = 1;
    if (tier === EPassengerTier.BUSINESS) tierMultiplier = TIER_MULTIPLIER_BUSINESS;
    if (tier === EPassengerTier.VIP) tierMultiplier = TIER_MULTIPLIER_VIP;

    const rushMultiplier = rushHourActive ? RUSH_HOUR_MULTIPLIER : 1;
    const reward = Math.floor(baseReward * tierMultiplier * rushMultiplier);

    const deadline = this.calculateDeadline(currentTick, distance, tier);

    const passenger: PassengerState = {
      id,
      x: spawnPos.x,
      y: spawnPos.y,
      destX: destPos.x,
      destY: destPos.y,
      reward,
      spawnedAt: Date.now(),
      isCarried: false,
      tier,
      deadline,
    };

    this.passengers.set(id, passenger);

    // Emit a VIP event so the world can announce it
    if (tier === EPassengerTier.VIP) {
      this.pendingVIPEvents.push({ passengerId: id });
    }

    return passenger;
  }

  /** Remove passengers whose deadline has passed and they're still not carried. */
  public reapExpiredPassengers(currentTick: number): void {
    for (const [id, passenger] of this.passengers.entries()) {
      if (passenger.deadline > 0 && currentTick > passenger.deadline && !passenger.isCarried) {
        this.passengers.delete(id);
      }
    }
  }

  public tick(currentTick: number, rushHourActive: boolean = false): void {
    // Reap expired passengers first
    this.reapExpiredPassengers(currentTick);

    // Respawn up to limit — double spawn count during rush hour
    const spawnBatchSize = rushHourActive ? RUSH_HOUR_SPAWN_MULTIPLIER : 1;

    if (this.passengers.size < MAX_PASSENGERS) {
      const needed = MAX_PASSENGERS - this.passengers.size;
      const toSpawn = Math.min(needed, spawnBatchSize);
      for (let i = 0; i < toSpawn; i++) {
        this.spawnPassenger(currentTick, undefined, rushHourActive);
      }
    }
  }
}
