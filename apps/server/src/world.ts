import { PlayerState, PassengerState, InputPayload, MOTORBIKE_SPEED, COLLISION_RADIUS } from '@xeom-rush/shared';
import { SpatialGrid } from './spatial-grid';
import { PhysicsEngine } from './physics';
import { PassengerSpawner } from './passenger-spawner';

export class GameWorld {
  private players: Map<string, PlayerState> = new Map();
  private inputQueues: Map<string, InputPayload[]> = new Map();
  private spatialGrid: SpatialGrid;
  private physics: PhysicsEngine;
  private passengers: PassengerSpawner;
  private tickCount: number = 0;

  constructor() {
    this.spatialGrid = new SpatialGrid();
    this.physics = new PhysicsEngine();
    this.passengers = new PassengerSpawner(this.physics);
  }

  public addPlayer(id: string, username: string): void {
    const startX = 2000 + (Math.random() - 0.5) * 200;
    const startY = 2000 + (Math.random() - 0.5) * 200;

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
    }
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

  public getSpatialGrid(): SpatialGrid {
    return this.spatialGrid;
  }

  public getTick(): number {
    return this.tickCount;
  }

  public getPassengerMap(): Map<string, PassengerState> {
    return this.passengers.getPassengerMap();
  }

  /**
   * Main game tick update loop: runs at 20Hz (every 50ms)
   */
  public tick(dt: number): void {
    this.tickCount++;

    // 1. Process player movements
    for (const [playerId, player] of this.players.entries()) {
      const inputs = this.inputQueues.get(playerId) || [];
      
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

      // Calculate new position
      if (moveDx !== 0 || moveDy !== 0) {
        // Normalize vector
        const mag = Math.sqrt(moveDx * moveDx + moveDy * moveDy);
        const ndx = moveDx / mag;
        const ndy = moveDy / mag;

        const deltaX = ndx * MOTORBIKE_SPEED * dt;
        const deltaY = ndy * MOTORBIKE_SPEED * dt;

        const resolved = this.physics.resolveMove(
          player.x,
          player.y,
          player.x + deltaX,
          player.y + deltaY
        );

        player.x = resolved.x;
        player.y = resolved.y;
      }

      player.angle = lastAngle;
      player.lastProcessedSeq = lastSeq;

      // Update spatial index
      this.spatialGrid.update(player.id, player.x, player.y);

      // Check actions: Pickup or Deliver
      this.checkPlayerInteractions(player);
    }

    // 2. Refresh spatial grid positions for passengers
    // We clear spatial grid and re-register everything to keep it simple and accurate
    // Wait, let's keep track of passenger updates in spatial grid as well
    const passMap = this.passengers.getPassengerMap();
    for (const passenger of passMap.values()) {
      if (passenger.isCarried) {
        // If passenger is carried, they are attached to their driver's position
        // Remove from spatial grid so other players can't pick them up
        this.spatialGrid.remove(passenger.id);
      } else {
        // Register/update in spatial grid
        this.spatialGrid.update(passenger.id, passenger.x, passenger.y);
      }
    }

    // 3. Tick passenger spawner
    this.passengers.tick();
  }

  /**
   * Checks passenger pickups and dropoffs
   */
  private checkPlayerInteractions(player: PlayerState): void {
    const passMap = this.passengers.getPassengerMap();

    if (!player.passengerId) {
      // 1. Can we pick up a passenger?
      // Find nearby passenger entities using spatial grid
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
      // 2. We are carrying a passenger, are we near the destination?
      const passenger = passMap.get(player.passengerId);
      if (passenger) {
        const dx = passenger.destX - player.x;
        const dy = passenger.destY - player.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < COLLISION_RADIUS + 10) {
          // Success! Drop off passenger
          player.score += passenger.reward;
          this.passengers.remove(passenger.id);
          player.passengerId = null;
        }
      } else {
        // Passenger somehow disappeared, clear state
        player.passengerId = null;
      }
    }
  }

  /**
   * Returns filtered player states and passenger states visible to a target player based on chunking.
   */
  public getVisibleSnapshotForPlayer(targetPlayerId: string): { players: PlayerState[]; passengers: PassengerState[] } {
    const player = this.players.get(targetPlayerId);
    if (!player) {
      return { players: [], passengers: [] };
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

    // Also include details for the passenger currently carried by the player so the client can render their destination line
    if (player.passengerId) {
      const carried = passMap.get(player.passengerId);
      if (carried) {
        visiblePassengers.push(carried);
      }
    }

    return {
      players: visiblePlayers,
      passengers: visiblePassengers,
    };
  }
}
