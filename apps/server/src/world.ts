import {
  PlayerState,
  PassengerState,
  InputPayload,
  MOTORBIKE_SPEED,
  COLLISION_RADIUS,
  CHUNK_SIZE,
  RUSH_HOUR_INTERVAL_TICKS,
  RUSH_HOUR_DURATION_TICKS,
  STREAK_RESET_TICKS,
  STREAK_MULTIPLIERS,
  type TrafficLightState,
  type PedestrianState,
  type ViolationType,
} from '@xeom-rush/shared';
import { SpatialGrid } from './spatial-grid';
import { PhysicsEngine } from './physics';
import { PassengerSpawner } from './passenger-spawner';
import { CityFeatures } from './city-features';

const DRIVER_COLLISION_PENALTY = 1000;
const RED_LIGHT_PENALTY = 2000;
const PEDESTRIAN_STUN_TICKS = 40;
const PENALTY_COOLDOWN_TICKS = 20;
const CITY_VISIBILITY_RADIUS = CHUNK_SIZE * 1.5;

function getStreakMultiplier(streak: number): number {
  for (const { minStreak, multiplier } of STREAK_MULTIPLIERS) {
    if (streak >= minStreak) return multiplier;
  }
  return 1.0;
}

export class GameWorld {
  private players: Map<string, PlayerState> = new Map();
  private inputQueues: Map<string, InputPayload[]> = new Map();
  private spatialGrid: SpatialGrid;
  private physics: PhysicsEngine;
  private cityFeatures: CityFeatures;
  private passengers: PassengerSpawner;
  private tickCount: number = 0;
  private collisionCooldowns: Map<string, number> = new Map();
  private redLightCooldowns: Map<string, number> = new Map();
  private pedestrianCooldowns: Map<string, number> = new Map();
  private stunnedUntilTicks: Map<string, number> = new Map();

  // Rush Hour subsystem
  private rushHourEndsAtTick: number = 0;
  private nextRushHourTick: number = RUSH_HOUR_INTERVAL_TICKS;

  // Combo/Streak subsystem
  private streakCounts: Map<string, number> = new Map();
  private lastDeliveryTicks: Map<string, number> = new Map();

  // Session tracking maps for DB persistence
  private sessionPeakStreaks: Map<string, number> = new Map();
  private sessionDeliveries: Map<string, number> = new Map();
  private sessionViolations: Map<string, { redLights: number; pedestrianHits: number; driverCollisions: number }> =
    new Map();

  constructor() {
    this.spatialGrid = new SpatialGrid();
    this.physics = new PhysicsEngine();
    this.cityFeatures = new CityFeatures(this.physics);
    this.passengers = new PassengerSpawner(this.physics);
  }

  public addPlayer(id: string, username: string, spawnX?: number, spawnY?: number): void {
    const startX = spawnX !== undefined ? spawnX : 2000 + (Math.random() - 0.5) * 200;
    const startY = spawnY !== undefined ? spawnY : 2000 + (Math.random() - 0.5) * 200;

    const player: PlayerState = {
      id,
      username,
      x: startX,
      y: startY,
      angle: 0,
      score: 0,
      lastProcessedSeq: 0,
      passengerId: null,
      connected: true,
    };

    this.players.set(id, player);
    this.inputQueues.set(id, []);
    this.spatialGrid.insert(id, startX, startY);
    this.streakCounts.set(id, 0);

    // Initialize session tracking stats
    this.sessionPeakStreaks.set(id, 0);
    this.sessionDeliveries.set(id, 0);
    this.sessionViolations.set(id, { redLights: 0, pedestrianHits: 0, driverCollisions: 0 });
  }

  public removePlayer(id: string): void {
    const player = this.players.get(id);
    if (player) {
      // If player carried a passenger, release the passenger
      if (player.passengerId) {
        this.passengers.updateCarriedStatus(player.passengerId, false);
      }
      this.players.delete(id);
      this.inputQueues.delete(id);
      this.spatialGrid.remove(id);
      this.collisionCooldowns.delete(id);
      this.redLightCooldowns.delete(id);
      this.pedestrianCooldowns.delete(id);
      this.stunnedUntilTicks.delete(id);
      this.streakCounts.delete(id);
      this.lastDeliveryTicks.delete(id);

      // Clean up session stats
      this.sessionPeakStreaks.delete(id);
      this.sessionDeliveries.delete(id);
      this.sessionViolations.delete(id);
    }
  }

  public getSessionStatsForPlayer(playerId: string) {
    const player = this.players.get(playerId);
    if (!player) return null;

    return {
      username: player.username,
      score: player.score,
      peakStreak: this.sessionPeakStreaks.get(playerId) ?? 0,
      deliveriesCount: this.sessionDeliveries.get(playerId) ?? 0,
      violations: this.sessionViolations.get(playerId) ?? { redLights: 0, pedestrianHits: 0, driverCollisions: 0 },
    };
  }

  public queueInput(playerId: string, input: InputPayload): void {
    const queue = this.inputQueues.get(playerId);
    if (queue) {
      queue.push(input);
    }
  }

  public getPlayer(id: string): PlayerState | undefined {
    return this.players.get(id);
  }

  public getPhysics(): PhysicsEngine {
    return this.physics;
  }

  public getCityFeatures(): CityFeatures {
    return this.cityFeatures;
  }

  public getSpatialGrid(): SpatialGrid {
    return this.spatialGrid;
  }

  public getTick(): number {
    return this.tickCount;
  }

  public getPassengerMap(): Map<string, PassengerState> {
    return this.passengers.getPassengerMap();
  }

  public isRushHour(): boolean {
    return this.tickCount < this.rushHourEndsAtTick;
  }

  public getRushHourTicksRemaining(): number {
    return Math.max(0, this.rushHourEndsAtTick - this.tickCount);
  }

  /** Manually trigger a rush hour event (for API endpoint and tests). */
  public triggerRushHour(): void {
    this.rushHourEndsAtTick = this.tickCount + RUSH_HOUR_DURATION_TICKS;
    // Reset next auto-trigger from now
    this.nextRushHourTick = this.tickCount + RUSH_HOUR_INTERVAL_TICKS;
  }

  public getStreakCounts(): Map<string, number> {
    return this.streakCounts;
  }

  public getStreakForPlayer(playerId: string): number {
    return this.streakCounts.get(playerId) ?? 0;
  }

  public getAllStreaks(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [id, count] of this.streakCounts.entries()) {
      if (count > 0) result[id] = count;
    }
    return result;
  }

  /**
   * Main game tick update loop: runs at 20Hz (every 50ms)
   */
  public tick(dt: number): void {
    this.tickCount++;
    this.cityFeatures.tick(this.tickCount, dt);

    // Auto-trigger rush hour on schedule
    if (!this.isRushHour() && this.tickCount >= this.nextRushHourTick) {
      this.triggerRushHour();
    }

    // Reset streaks for idle players
    this.reapIdleStreaks();

    // 1. Process player movements
    for (const [playerId, player] of this.players.entries()) {
      const inputs = this.inputQueues.get(playerId) || [];
      const prevX = player.x;
      const prevY = player.y;

      let moveDx = 0;
      let moveDy = 0;
      let lastAngle = player.angle;
      let lastSeq = player.lastProcessedSeq;

      // Drain input queue, applying them in order
      while (inputs.length > 0) {
        const input = inputs.shift()!;
        moveDx = input.dx;
        moveDy = input.dy;
        lastAngle = input.angle;
        lastSeq = input.seq;
      }

      const stunnedUntilTick = this.stunnedUntilTicks.get(playerId) ?? 0;
      const isStunned = this.tickCount < stunnedUntilTick;

      // Calculate new position
      if (!isStunned && (moveDx !== 0 || moveDy !== 0)) {
        const mag = Math.sqrt(moveDx * moveDx + moveDy * moveDy);
        const throttle = Math.min(1, mag);
        const ndx = moveDx / mag;
        const ndy = moveDy / mag;

        const deltaX = ndx * MOTORBIKE_SPEED * throttle * dt;
        const deltaY = ndy * MOTORBIKE_SPEED * throttle * dt;

        const resolved = this.physics.resolveMove(player.x, player.y, player.x + deltaX, player.y + deltaY);

        player.x = resolved.x;
        player.y = resolved.y;
      }

      if (!isStunned) {
        player.angle = lastAngle;
      }
      player.lastProcessedSeq = lastSeq;

      // Update spatial index
      this.spatialGrid.update(player.id, player.x, player.y);

      this.checkCityRuleInteractions(player, prevX, prevY);

      // Check actions: Pickup or Deliver
      this.checkPlayerInteractions(player);
    }

    // 1.5. Check player-to-player collisions
    const playerIds = Array.from(this.players.keys());
    for (let i = 0; i < playerIds.length; i++) {
      for (let j = i + 1; j < playerIds.length; j++) {
        const p1 = this.players.get(playerIds[i])!;
        const p2 = this.players.get(playerIds[j])!;

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.hypot(dx, dy);
        const minDist = 30; // 15 + 15 radius of motorbikes

        if (dist < minDist) {
          // Push them apart
          const overlap = minDist - dist;
          const nx = dx / (dist || 1);
          const ny = dy / (dist || 1);

          const p1TargetX = p1.x - nx * (overlap / 2);
          const p1TargetY = p1.y - ny * (overlap / 2);
          const p2TargetX = p2.x + nx * (overlap / 2);
          const p2TargetY = p2.y + ny * (overlap / 2);

          // Resolve against buildings so players don't clip through walls
          const p1Resolved = this.physics.resolveMove(p1.x, p1.y, p1TargetX, p1TargetY);
          const p2Resolved = this.physics.resolveMove(p2.x, p2.y, p2TargetX, p2TargetY);

          p1.x = p1Resolved.x;
          p1.y = p1Resolved.y;
          p2.x = p2Resolved.x;
          p2.y = p2Resolved.y;

          // Update spatial grid positions immediately
          this.spatialGrid.update(p1.id, p1.x, p1.y);
          this.spatialGrid.update(p2.id, p2.x, p2.y);

          // Reduce balance (score) with a 20-tick (1-second) cooldown
          const currentTick = this.tickCount;

          const cooldown1 = this.collisionCooldowns.get(p1.id) || 0;
          if (currentTick > cooldown1) {
            p1.score = Math.max(0, p1.score - DRIVER_COLLISION_PENALTY);
            this.recordViolation(p1, 'driver-collision', DRIVER_COLLISION_PENALTY);
            this.collisionCooldowns.set(p1.id, currentTick + PENALTY_COOLDOWN_TICKS);
          }

          const cooldown2 = this.collisionCooldowns.get(p2.id) || 0;
          if (currentTick > cooldown2) {
            p2.score = Math.max(0, p2.score - DRIVER_COLLISION_PENALTY);
            this.recordViolation(p2, 'driver-collision', DRIVER_COLLISION_PENALTY);
            this.collisionCooldowns.set(p2.id, currentTick + PENALTY_COOLDOWN_TICKS);
          }
        }
      }
    }

    // 2. Refresh spatial grid positions for passengers
    const passMap = this.passengers.getPassengerMap();
    for (const passenger of passMap.values()) {
      if (passenger.isCarried) {
        // If passenger is carried, remove from spatial grid so other players can't pick them up
        this.spatialGrid.remove(passenger.id);
      } else {
        // Register/update in spatial grid
        this.spatialGrid.update(passenger.id, passenger.x, passenger.y);
      }
    }

    // 3. Tick passenger spawner (handles expiry + respawn)
    this.passengers.tick(this.tickCount, this.isRushHour());
  }

  /** Reset streak for players who haven't delivered in STREAK_RESET_TICKS. */
  private reapIdleStreaks(): void {
    for (const [playerId, lastTick] of this.lastDeliveryTicks.entries()) {
      if (this.tickCount - lastTick > STREAK_RESET_TICKS) {
        this.streakCounts.set(playerId, 0);
        this.lastDeliveryTicks.delete(playerId);
      }
    }
  }

  /**
   * Checks passenger pickups and dropoffs
   */
  private checkPlayerInteractions(player: PlayerState): void {
    const passMap = this.passengers.getPassengerMap();

    if (!player.passengerId) {
      // 1. Can we pick up a passenger?
      const nearbyEntityIds = this.spatialGrid.getNearbyEntities(player.x, player.y);

      for (const entityId of nearbyEntityIds) {
        if (entityId.startsWith('pass-')) {
          const passenger = passMap.get(entityId);
          if (passenger && !passenger.isCarried) {
            // Check radius
            const dx = passenger.x - player.x;
            const dy = passenger.y - player.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < COLLISION_RADIUS) {
              // Pick up!
              player.passengerId = passenger.id;
              passenger.isCarried = true;
              this.spatialGrid.remove(passenger.id); // Remove from public grid
              break; // Pick up one at a time
            }
          }
        }
      }
    } else {
      // 2. We are carrying a passenger — are we near the destination?
      const passenger = passMap.get(player.passengerId);
      if (passenger) {
        const dx = passenger.destX - player.x;
        const dy = passenger.destY - player.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < COLLISION_RADIUS + 10) {
          // Success! Apply streak multiplier to reward
          const streak = this.streakCounts.get(player.id) ?? 0;
          const multiplier = getStreakMultiplier(streak);
          const reward = Math.floor(passenger.reward * multiplier);

          player.score += reward;

          // Increment streak
          const newStreak = streak + 1;
          this.streakCounts.set(player.id, newStreak);
          this.lastDeliveryTicks.set(player.id, this.tickCount);

          // Update session stats
          const currentPeak = this.sessionPeakStreaks.get(player.id) ?? 0;
          if (newStreak > currentPeak) {
            this.sessionPeakStreaks.set(player.id, newStreak);
          }
          const currentDeliveries = this.sessionDeliveries.get(player.id) ?? 0;
          this.sessionDeliveries.set(player.id, currentDeliveries + 1);

          this.passengers.remove(passenger.id);
          player.passengerId = null;
        }
      } else {
        // Passenger somehow disappeared (expired deadline), clear state
        player.passengerId = null;
      }
    }
  }

  private checkCityRuleInteractions(player: PlayerState, prevX: number, prevY: number): void {
    const currentTick = this.tickCount;

    if (this.cityFeatures.checkRedLightViolation(player.x, player.y, prevX, prevY)) {
      const cooldown = this.redLightCooldowns.get(player.id) || 0;
      if (currentTick > cooldown) {
        player.score = Math.max(0, player.score - RED_LIGHT_PENALTY);
        this.recordViolation(player, 'red-light', RED_LIGHT_PENALTY);
        this.redLightCooldowns.set(player.id, currentTick + PENALTY_COOLDOWN_TICKS);
      }
    }

    const hitPedestrianId = this.cityFeatures.getHitPedestrianId(player.x, player.y);
    if (hitPedestrianId) {
      const cooldown = this.pedestrianCooldowns.get(player.id) || 0;
      if (currentTick > cooldown) {
        const amount = player.score;
        player.score = 0;
        this.cityFeatures.removePedestrian(hitPedestrianId);
        this.recordViolation(player, 'pedestrian', amount);
        this.pedestrianCooldowns.set(player.id, currentTick + PEDESTRIAN_STUN_TICKS);
        this.stunnedUntilTicks.set(player.id, currentTick + PEDESTRIAN_STUN_TICKS);
        // Reset streak on harsh penalty
        this.streakCounts.set(player.id, 0);
        this.lastDeliveryTicks.delete(player.id);
      }
    }
  }

  private recordViolation(player: PlayerState, type: ViolationType, amount: number): void {
    player.lastViolation = {
      type,
      amount,
      tick: this.tickCount,
    };

    const viols = this.sessionViolations.get(player.id);
    if (viols) {
      if (type === 'red-light') viols.redLights++;
      else if (type === 'pedestrian') viols.pedestrianHits++;
      else if (type === 'driver-collision') viols.driverCollisions++;
    }
  }

  /**
   * Returns filtered player states and passenger states visible to a target player based on chunking.
   */
  public getVisibleSnapshotForPlayer(targetPlayerId: string): {
    players: PlayerState[];
    passengers: PassengerState[];
    trafficLights: TrafficLightState[];
    pedestrians: PedestrianState[];
    rushHour: boolean;
    streaks: Record<string, number>;
  } {
    const player = this.players.get(targetPlayerId);
    if (!player) {
      return { players: [], passengers: [], trafficLights: [], pedestrians: [], rushHour: false, streaks: {} };
    }

    const nearbyEntityIds = this.spatialGrid.getNearbyEntities(player.x, player.y);
    const visiblePlayers: PlayerState[] = [];
    const visiblePassengers: PassengerState[] = [];
    const passMap = this.passengers.getPassengerMap();

    // Make sure the player sees themselves
    visiblePlayers.push(player);

    for (const entityId of nearbyEntityIds) {
      if (entityId === targetPlayerId) continue;

      if (entityId.startsWith('pass-')) {
        const passenger = passMap.get(entityId);
        if (passenger && !passenger.isCarried) {
          visiblePassengers.push(passenger);
        }
      } else {
        const otherPlayer = this.players.get(entityId);
        if (otherPlayer) {
          visiblePlayers.push(otherPlayer);
        }
      }
    }

    // Also include the passenger currently carried by the player so the client can render their destination line
    if (player.passengerId) {
      const carried = passMap.get(player.passengerId);
      if (carried) {
        visiblePassengers.push(carried);
      }
    }

    return {
      players: visiblePlayers,
      passengers: visiblePassengers,
      trafficLights: this.cityFeatures.getVisibleTrafficLights(player.x, player.y, CITY_VISIBILITY_RADIUS),
      pedestrians: this.cityFeatures.getVisiblePedestrians(player.x, player.y, CITY_VISIBILITY_RADIUS),
      rushHour: this.isRushHour(),
      streaks: this.getAllStreaks(),
    };
  }
}
