import { type InputPayload, type PassengerState, type PlayerState } from '@xeom-rush/shared';
import type { PhysicsEngine } from './physics';
import type { GameWorld } from './world';

const STREET_LINES = [50, 450, 850, 1250, 1650, 2050, 2450, 2850, 3250, 3650];

enum EBotState {
  SEEKING_PASSENGER,
  NAVIGATING_TO_PICKUP,
  NAVIGATING_TO_DROPOFF,
}

interface GridNode {
  ix: number;
  iy: number;
}

interface Waypoint {
  x: number;
  y: number;
}

interface BotAgent {
  playerId: string;
  state: EBotState;
  targetPassengerId: string | null;
  stuckTicks: number;
  lastX: number;
  lastY: number;
  inputSeq: number;
  currentAngle: number;
  path: Waypoint[];
  pathIndex: number;
}

export class BotManager {
  private bots: Map<string, BotAgent> = new Map();
  private targetedPassengerIds: Set<string> = new Set();
  private nextBotIndex = 0;

  constructor(
    private world: GameWorld,
    private physics: PhysicsEngine,
  ) {}

  public spawnBots(count: number): string[] {
    const spawnedIds: string[] = [];

    for (let i = 0; i < count; i++) {
      const idx = this.nextBotIndex++;
      const playerId = `bot-${idx}`;
      const username = `🤖 Bot-${idx}`;

      this.world.addPlayer(playerId, username);
      const player = this.world.getPlayer(playerId);

      this.bots.set(playerId, {
        playerId,
        state: EBotState.SEEKING_PASSENGER,
        targetPassengerId: null,
        stuckTicks: 0,
        lastX: player?.x ?? 0,
        lastY: player?.y ?? 0,
        inputSeq: 0,
        currentAngle: Math.random() * Math.PI * 2,
        path: [],
        pathIndex: 0,
      });

      spawnedIds.push(playerId);
    }

    return spawnedIds;
  }

  public getBotCount(): number {
    return this.bots.size;
  }

  /**
   * Run AI for all bots and queue their inputs.
   * Called once per server tick (20Hz).
   */
  public tick(): void {
    // Clean up stale passenger targets (passenger got taken or despawned)
    this.cleanStaleTargets();

    for (const bot of this.bots.values()) {
      const player = this.world.getPlayer(bot.playerId);
      if (!player) {
        this.bots.delete(bot.playerId);
        continue;
      }

      // Detect stuck state (hasn't moved meaningfully)
      const moveDist = Math.hypot(player.x - bot.lastX, player.y - bot.lastY);
      if (moveDist < 0.5) {
        bot.stuckTicks++;
      } else {
        bot.stuckTicks = 0;
      }
      bot.lastX = player.x;
      bot.lastY = player.y;

      // Handle stuck behavior to keep bots fluid and competing
      if (bot.stuckTicks > 40) {
        // Hard stuck: release target and seek another passenger
        if (bot.targetPassengerId) {
          this.targetedPassengerIds.delete(bot.targetPassengerId);
        }
        bot.targetPassengerId = null;
        bot.state = EBotState.SEEKING_PASSENGER;
        bot.path = [];
        bot.pathIndex = 0;
        bot.stuckTicks = 0;
      } else if (bot.stuckTicks > 10 && bot.stuckTicks % 10 === 0) {
        // Mildly stuck: recalculate path from current location to target
        const target = this.getTargetPosition(bot);
        if (target) {
          bot.path = this.calculatePath(player.x, player.y, target.x, target.y);
          bot.pathIndex = 0;
        }
      }

      // Run state machine transition
      this.updateState(bot, player);

      // Generate movement input and queue it
      const input = this.generateInput(bot, player);
      this.world.queueInput(bot.playerId, input);
    }
  }

  /**
   * Remove targets for passengers that no longer exist or were picked up by others.
   */
  private cleanStaleTargets(): void {
    const passengerMap = this.world.getPassengerMap();

    for (const passengerId of this.targetedPassengerIds) {
      const passenger = passengerMap.get(passengerId);
      if (!passenger || passenger.isCarried) {
        this.targetedPassengerIds.delete(passengerId);
      }
    }
  }

  // ── State Machine ───────────────────────────────────────────────

  private updateState(bot: BotAgent, player: PlayerState): void {
    const passengerMap = this.world.getPassengerMap();

    switch (bot.state) {
      case EBotState.SEEKING_PASSENGER: {
        const nearest = this.findNearestAvailablePassenger(player);
        if (nearest) {
          bot.targetPassengerId = nearest.id;
          bot.state = EBotState.NAVIGATING_TO_PICKUP;
          this.targetedPassengerIds.add(nearest.id);
          bot.path = this.calculatePath(player.x, player.y, nearest.x, nearest.y);
          bot.pathIndex = 0;
          bot.stuckTicks = 0;
        }
        break;
      }

      case EBotState.NAVIGATING_TO_PICKUP: {
        // If the player now carries a passenger, transition to delivery
        if (player.passengerId) {
          if (bot.targetPassengerId) {
            this.targetedPassengerIds.delete(bot.targetPassengerId);
          }
          bot.targetPassengerId = player.passengerId;
          bot.state = EBotState.NAVIGATING_TO_DROPOFF;
          bot.stuckTicks = 0;

          // Path to destination
          const passenger = passengerMap.get(player.passengerId);
          if (passenger) {
            bot.path = this.calculatePath(player.x, player.y, passenger.destX, passenger.destY);
            bot.pathIndex = 0;
          } else {
            bot.path = [];
            bot.pathIndex = 0;
          }
          break;
        }

        // Check if target was stolen or despawned
        if (bot.targetPassengerId) {
          const target = passengerMap.get(bot.targetPassengerId);
          if (!target || target.isCarried) {
            this.targetedPassengerIds.delete(bot.targetPassengerId);
            bot.targetPassengerId = null;
            bot.state = EBotState.SEEKING_PASSENGER;
            bot.path = [];
            bot.pathIndex = 0;
          }
        } else {
          bot.state = EBotState.SEEKING_PASSENGER;
          bot.path = [];
          bot.pathIndex = 0;
        }
        break;
      }

      case EBotState.NAVIGATING_TO_DROPOFF: {
        // If passengerId is now null, delivery succeeded
        if (!player.passengerId) {
          if (bot.targetPassengerId) {
            this.targetedPassengerIds.delete(bot.targetPassengerId);
          }
          bot.targetPassengerId = null;
          bot.state = EBotState.SEEKING_PASSENGER;
          bot.path = [];
          bot.pathIndex = 0;
          bot.stuckTicks = 0;
        }
        break;
      }
    }
  }

  // ── Target Selection ────────────────────────────────────────────

  private findNearestAvailablePassenger(player: PlayerState): PassengerState | null {
    const passengerMap = this.world.getPassengerMap();
    let nearest: PassengerState | null = null;
    let nearestDist = Infinity;

    for (const passenger of passengerMap.values()) {
      // Skip carried or already targeted by another bot
      if (passenger.isCarried) continue;
      if (this.targetedPassengerIds.has(passenger.id)) continue;

      const dist = Math.hypot(passenger.x - player.x, passenger.y - player.y);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = passenger;
      }
    }

    return nearest;
  }

  // ── Input Generation ────────────────────────────────────────────

  private generateInput(bot: BotAgent, player: PlayerState): InputPayload {
    bot.inputSeq++;

    // Calculate a path if missing but we have a target
    if (bot.path.length === 0) {
      const target = this.getTargetPosition(bot);
      if (target) {
        bot.path = this.calculatePath(player.x, player.y, target.x, target.y);
        bot.pathIndex = 0;
      }
    }

    // Default to wandering if no valid target path
    if (bot.path.length === 0) {
      return this.createWanderInput(bot);
    }

    // Advance waypoints if we are close enough
    let currentWaypoint = bot.path[bot.pathIndex];
    let distToWaypoint = Math.hypot(currentWaypoint.x - player.x, currentWaypoint.y - player.y);

    while (distToWaypoint < 30 && bot.pathIndex < bot.path.length - 1) {
      bot.pathIndex++;
      currentWaypoint = bot.path[bot.pathIndex];
      distToWaypoint = Math.hypot(currentWaypoint.x - player.x, currentWaypoint.y - player.y);
    }

    // Steer directly towards current waypoint
    const angle = Math.atan2(currentWaypoint.y - player.y, currentWaypoint.x - player.x);
    bot.currentAngle = angle;

    return {
      seq: bot.inputSeq,
      dx: Math.cos(angle),
      dy: Math.sin(angle),
      angle: angle,
    };
  }

  private getTargetPosition(bot: BotAgent): Waypoint | null {
    const passengerMap = this.world.getPassengerMap();
    if (bot.targetPassengerId) {
      const target = passengerMap.get(bot.targetPassengerId);
      if (target) {
        if (bot.state === EBotState.NAVIGATING_TO_PICKUP) {
          return { x: target.x, y: target.y };
        } else if (bot.state === EBotState.NAVIGATING_TO_DROPOFF) {
          return { x: target.destX, y: target.destY };
        }
      }
    }
    return null;
  }

  private createWanderInput(bot: BotAgent): InputPayload {
    bot.currentAngle += (Math.random() - 0.5) * 0.5;
    return {
      seq: bot.inputSeq,
      dx: Math.cos(bot.currentAngle),
      dy: Math.sin(bot.currentAngle),
      angle: bot.currentAngle,
    };
  }

  // ── A* Pathfinding Logic ────────────────────────────────────────

  private getClosestNode(x: number, y: number): GridNode {
    let closestIx = 0;
    let minDiffX = Infinity;
    for (let i = 0; i < STREET_LINES.length; i++) {
      const diff = Math.abs(x - STREET_LINES[i]);
      if (diff < minDiffX) {
        minDiffX = diff;
        closestIx = i;
      }
    }

    let closestIy = 0;
    let minDiffY = Infinity;
    for (let i = 0; i < STREET_LINES.length; i++) {
      const diff = Math.abs(y - STREET_LINES[i]);
      if (diff < minDiffY) {
        minDiffY = diff;
        closestIy = i;
      }
    }

    return { ix: closestIx, iy: closestIy };
  }

  private heuristic(a: GridNode, b: GridNode): number {
    return Math.abs(a.ix - b.ix) + Math.abs(a.iy - b.iy);
  }

  private distance(a: GridNode, b: GridNode): number {
    const ax = STREET_LINES[a.ix];
    const ay = STREET_LINES[a.iy];
    const bx = STREET_LINES[b.ix];
    const by = STREET_LINES[b.iy];
    return Math.hypot(ax - bx, ay - by);
  }

  private calculatePath(fromX: number, fromY: number, toX: number, toY: number): Waypoint[] {
    const start = this.getClosestNode(fromX, fromY);
    const end = this.getClosestNode(toX, toY);

    const startKey = `${start.ix},${start.iy}`;
    const endKey = `${end.ix},${end.iy}`;

    if (startKey === endKey) {
      return [{ x: toX, y: toY }];
    }

    const openSet: GridNode[] = [start];
    const cameFrom = new Map<string, string>();

    const gScore = new Map<string, number>();
    gScore.set(startKey, 0);

    const fScore = new Map<string, number>();
    fScore.set(startKey, this.heuristic(start, end));

    while (openSet.length > 0) {
      let currentIdx = 0;
      let minF = Infinity;
      for (let i = 0; i < openSet.length; i++) {
        const key = `${openSet[i].ix},${openSet[i].iy}`;
        const f = fScore.get(key) ?? Infinity;
        if (f < minF) {
          minF = f;
          currentIdx = i;
        }
      }

      const current = openSet[currentIdx];
      const currentKey = `${current.ix},${current.iy}`;

      if (currentKey === endKey) {
        // Reconstruct path
        const path: Waypoint[] = [];
        let tempKey: string | undefined = currentKey;
        while (tempKey) {
          const [ixS, iyS] = tempKey.split(',').map(Number);
          path.unshift({ x: STREET_LINES[ixS], y: STREET_LINES[iyS] });
          tempKey = cameFrom.get(tempKey);
        }
        // Add final destination coordinate
        path.push({ x: toX, y: toY });
        return path;
      }

      openSet.splice(currentIdx, 1);

      const { ix, iy } = current;
      const neighbors: GridNode[] = [];
      if (ix + 1 < STREET_LINES.length) neighbors.push({ ix: ix + 1, iy });
      if (ix - 1 >= 0) neighbors.push({ ix: ix - 1, iy });
      if (iy + 1 < STREET_LINES.length) neighbors.push({ ix, iy: iy + 1 });
      if (iy - 1 >= 0) neighbors.push({ ix, iy: iy - 1 });

      for (const neighbor of neighbors) {
        const neighborKey = `${neighbor.ix},${neighbor.iy}`;
        const tentativeGScore = (gScore.get(currentKey) ?? Infinity) + this.distance(current, neighbor);

        if (tentativeGScore < (gScore.get(neighborKey) ?? Infinity)) {
          cameFrom.set(neighborKey, currentKey);
          gScore.set(neighborKey, tentativeGScore);
          fScore.set(neighborKey, tentativeGScore + this.heuristic(neighbor, end));

          if (!openSet.some(n => n.ix === neighbor.ix && n.iy === neighbor.iy)) {
            openSet.push(neighbor);
          }
        }
      }
    }

    return [{ x: toX, y: toY }];
  }
}
