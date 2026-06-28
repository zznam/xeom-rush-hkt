import { type InputPayload, type PassengerState, type PlayerState, MAP_SIZE } from '@xeom-rush/shared';
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

interface BotPersonality {
  lawfulness: number;
  riskTolerance: number;
  aggression: number;
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
  personality: BotPersonality;
  routeJitterSeed: number;
  laneOffset: number;
  stopOffset: number;
  avoidedRoundabouts: Map<string, number>;
}

export class BotManager {
  private bots: Map<string, BotAgent> = new Map();
  private targetedPassengerIds: Set<string> = new Set();
  private nextBotIndex = 0;

  constructor(
    private world: GameWorld,
    private physics: PhysicsEngine,
  ) {}

  private generateStreetPosition(): { x: number; y: number } {
    const maxAttempts = 50;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Keep inside map bounds with safety padding
      const x = 200 + Math.random() * (MAP_SIZE - 400);
      const y = 200 + Math.random() * (MAP_SIZE - 400);

      // Verify not inside building and not inside roundabout
      if (!this.physics.isInsideBuilding(x, y) && !this.world.getCityFeatures().isInsideRoundabout(x, y)) {
        return { x, y };
      }
    }
    // Fallback near map center
    return { x: 2000, y: 2000 };
  }

  public spawnBots(count: number): string[] {
    const spawnedIds: string[] = [];

    for (let i = 0; i < count; i++) {
      const idx = this.nextBotIndex++;
      const playerId = `bot-${idx}`;
      const username = `🤖 Bot-${idx}`;

      const spawnPos = this.generateStreetPosition();
      this.world.addPlayer(playerId, username, spawnPos.x, spawnPos.y);
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
        personality: {
          lawfulness: 0.65 + Math.random() * 0.3,
          riskTolerance: 0.05 + Math.random() * 0.25,
          aggression: 0.35 + Math.random() * 0.45,
        },
        routeJitterSeed: idx * 2654435761,
        laneOffset: ((idx % 5) - 2) * 4,
        stopOffset: (idx % 6) * 9,
        avoidedRoundabouts: new Map(),
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
        this.markNearbyRoundaboutAvoided(bot, player.x, player.y);
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
          bot.path = this.calculatePath(bot, player.x, player.y, target.x, target.y);
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
        const nearest = this.findNearestAvailablePassenger(bot, player);
        if (nearest) {
          bot.targetPassengerId = nearest.id;
          bot.state = EBotState.NAVIGATING_TO_PICKUP;
          this.targetedPassengerIds.add(nearest.id);
          bot.path = this.calculatePath(bot, player.x, player.y, nearest.x, nearest.y);
          bot.pathIndex = 0;
          bot.stuckTicks = 0;
        } else {
          // If no passengers are available, choose a random street intersection to wander to
          if (bot.path.length === 0) {
            const randIx = Math.floor(Math.random() * STREET_LINES.length);
            const randIy = Math.floor(Math.random() * STREET_LINES.length);
            const targetX = STREET_LINES[randIx];
            const targetY = STREET_LINES[randIy];
            bot.path = this.calculatePath(bot, player.x, player.y, targetX, targetY);
            bot.pathIndex = 0;
          }
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
            bot.path = this.calculatePath(bot, player.x, player.y, passenger.destX, passenger.destY);
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

  private findNearestAvailablePassenger(bot: BotAgent, player: PlayerState): PassengerState | null {
    const passengerMap = this.world.getPassengerMap();
    let best: PassengerState | null = null;
    let bestScore = -Infinity;

    for (const passenger of passengerMap.values()) {
      // Skip carried or already targeted by another bot
      if (passenger.isCarried) continue;
      if (this.targetedPassengerIds.has(passenger.id)) continue;

      const pickupDist = Math.hypot(passenger.x - player.x, passenger.y - player.y);
      const tripDist = Math.hypot(passenger.destX - passenger.x, passenger.destY - passenger.y);
      const valueScore = passenger.reward / Math.max(400, pickupDist + tripDist * 0.6);
      const nearbyBonus = pickupDist < 650 ? 4 : 0;
      const crowdPenalty = this.countNearbyBots(passenger.x, passenger.y) * 2.2;
      const preferenceNoise = (this.hash01(`${bot.routeJitterSeed}:${passenger.id}`) - 0.5) * 7;

      if (valueScore + nearbyBonus + preferenceNoise - crowdPenalty > bestScore) {
        bestScore = valueScore + nearbyBonus + preferenceNoise - crowdPenalty;
        best = passenger;
      }
    }

    return best;
  }

  // ── Input Generation ────────────────────────────────────────────

  private generateInput(bot: BotAgent, player: PlayerState): InputPayload {
    bot.inputSeq++;

    // 1. Stuck resolution: if stuck for >10 ticks, back up for the next 15 ticks to slide out
    if (bot.stuckTicks > 10 && bot.stuckTicks <= 25) {
      const reverseAngle = bot.currentAngle + Math.PI;
      return {
        seq: bot.inputSeq,
        dx: Math.cos(reverseAngle) * 0.8,
        dy: Math.sin(reverseAngle) * 0.8,
        angle: bot.currentAngle, // keep original facing angle
      };
    }

    // Calculate a path if missing but we have a target
    if (bot.path.length === 0) {
      const target = this.getTargetPosition(bot);
      if (target) {
        bot.path = this.calculatePath(bot, player.x, player.y, target.x, target.y);
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

    // Clear path if we've arrived at the final destination
    if (bot.pathIndex === bot.path.length - 1 && distToWaypoint < 30) {
      bot.path = [];
      bot.pathIndex = 0;
    }

    // Path direction vector
    const pathAngle = Math.atan2(currentWaypoint.y - player.y, currentWaypoint.x - player.x);
    let moveX = Math.cos(pathAngle);
    let moveY = Math.sin(pathAngle);

    // Dynamic driver-to-driver avoidance steering (separation)
    const nearbyIds = this.world.getSpatialGrid().getNearbyEntities(player.x, player.y);
    const avoidanceRadius = 55; // Reduced from 105 to only avoid close entities
    let avoidX = 0;
    let avoidY = 0;
    let avoidCount = 0;

    for (const otherId of nearbyIds) {
      if (otherId === bot.playerId) continue;
      
      // Avoid both human players and other AI bots
      if (otherId.startsWith('player-') || otherId.startsWith('bot-')) {
        const other = this.world.getPlayer(otherId);
        if (other) {
          const dx = player.x - other.x;
          const dy = player.y - other.y;
          const dist = Math.hypot(dx, dy);
          
          if (dist > 0 && dist < avoidanceRadius) {
            // Repulsion strength is inversely proportional to distance
            const strength = ((avoidanceRadius - dist) / avoidanceRadius) * (dist < 35 ? 2.0 : 1);
            avoidX += (dx / dist) * strength;
            avoidY += (dy / dist) * strength;
            avoidCount++;
          }
        }
      }
    }

    if (avoidCount > 0) {
      // Normalize avoidance force and cap its contribution to at most 0.45 of path vector
      const avoidMag = Math.hypot(avoidX, avoidY) || 1;
      moveX += (avoidX / avoidMag) * 0.45;
      moveY += (avoidY / avoidMag) * 0.45;
    }

    const roundaboutSteer = this.getRoundaboutTangentialSteer(player.x, player.y);
    // Scale roundabout tangential correction gently so it acts as a guide (0.3) rather than overpowering
    moveX += roundaboutSteer.x * 0.3;
    moveY += roundaboutSteer.y * 0.3;

    const city = this.world.getCityFeatures();
    const mag = Math.hypot(moveX, moveY) || 1;
    const headingX = moveX / mag;
    const headingY = moveY / mag;

    const pedestrianAvoidance = city.getPedestrianAvoidance(player.x, player.y, headingX, headingY);
    if (pedestrianAvoidance.shouldBrake && bot.personality.aggression < 0.72) {
      return {
        seq: bot.inputSeq,
        dx: 0,
        dy: 0,
        angle: bot.currentAngle,
      };
    }
    
    // Scale pedestrian avoidance contribution gently (at most 0.5 contribution)
    const pedAvoidMag = Math.hypot(pedestrianAvoidance.x, pedestrianAvoidance.y);
    if (pedAvoidMag > 0) {
      moveX += (pedestrianAvoidance.x / pedAvoidMag) * 0.5;
      moveY += (pedestrianAvoidance.y / pedAvoidMag) * 0.5;
    }

    const finalAngle = Math.atan2(moveY, moveX);
    
    // Smooth angle interpolation to prevent instant robotic snapping (max 0.16 rad/tick)
    let angleDiff = finalAngle - bot.currentAngle;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;

    const maxTurnPerTick = 0.16; // Limit turning speed
    if (Math.abs(angleDiff) > maxTurnPerTick) {
      bot.currentAngle += Math.sign(angleDiff) * maxTurnPerTick;
    } else {
      bot.currentAngle = finalAngle;
    }

    const trafficDecision = city.getTrafficDecisionAhead(
      player.x,
      player.y,
      Math.cos(bot.currentAngle),
      Math.sin(bot.currentAngle),
    );
    if (trafficDecision?.shouldStop && this.shouldBotObeyTrafficLight(bot, player)) {
      const queueOffset = this.getTrafficQueueOffset(bot, Math.cos(bot.currentAngle), Math.sin(bot.currentAngle));
      return {
        seq: bot.inputSeq,
        dx: queueOffset.dx,
        dy: queueOffset.dy,
        angle: bot.currentAngle,
      };
    }

    return {
      seq: bot.inputSeq,
      dx: Math.cos(bot.currentAngle),
      dy: Math.sin(bot.currentAngle),
      angle: bot.currentAngle,
    };
  }

  private shouldBotObeyTrafficLight(bot: BotAgent, player: PlayerState): boolean {
    const passenger = player.passengerId ? this.world.getPassengerMap().get(player.passengerId) : null;
    const highValueRide = (passenger?.reward ?? 0) >= 18000;
    const runLightChance = highValueRide ? bot.personality.riskTolerance : bot.personality.riskTolerance * 0.35;
    return Math.random() >= runLightChance || Math.random() < bot.personality.lawfulness;
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

  private calculatePath(bot: BotAgent, fromX: number, fromY: number, toX: number, toY: number): Waypoint[] {
    const start = this.getClosestNode(fromX, fromY);
    const end = this.getClosestNode(toX, toY);

    const startKey = `${start.ix},${start.iy}`;
    const endKey = `${end.ix},${end.iy}`;

    if (startKey === endKey) {
      return [this.applyWaypointJitter(bot, { x: toX, y: toY })];
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
        const nodePath: GridNode[] = [];
        let tempKey: string | undefined = currentKey;
        while (tempKey) {
          const [ixS, iyS] = tempKey.split(',').map(Number);
          nodePath.unshift({ ix: ixS, iy: iyS });
          tempKey = cameFrom.get(tempKey);
        }
        const path = this.expandRoundaboutWaypoints(bot, nodePath);
        path.push(this.applyWaypointJitter(bot, { x: toX, y: toY }));
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
        if (neighborKey !== endKey && this.isRoundaboutTemporarilyAvoided(bot, neighborKey)) {
          continue;
        }
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

    return [this.applyWaypointJitter(bot, { x: toX, y: toY })];
  }

  private expandRoundaboutWaypoints(bot: BotAgent, nodes: GridNode[]): Waypoint[] {
    const path: Waypoint[] = [];
    const city = this.world.getCityFeatures();

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const x = STREET_LINES[node.ix];
      const y = STREET_LINES[node.iy];

      if (!city.isRoundaboutAt(node.ix, node.iy)) {
        path.push(this.applyWaypointJitter(bot, { x, y }));
        continue;
      }

      const roundabout = city.roundabouts.find((r) => r.id === `roundabout-${node.ix}-${node.iy}`);
      const prev = nodes[i - 1];
      const next = nodes[i + 1];
      if (!roundabout || !prev || !next) {
        path.push(this.applyWaypointJitter(bot, { x, y }));
        continue;
      }

      const ringRadius = roundabout.radius + 28 + bot.laneOffset;
      let entryAngle = Math.atan2(STREET_LINES[prev.iy] - y, STREET_LINES[prev.ix] - x);
      const exitAngle = Math.atan2(STREET_LINES[next.iy] - y, STREET_LINES[next.ix] - x);
      entryAngle += bot.laneOffset * 0.015;

      while (entryAngle <= exitAngle) {
        entryAngle += Math.PI * 2;
      }

      const steps = Math.max(2, Math.ceil((entryAngle - exitAngle) / (Math.PI / 4)));
      for (let step = 0; step <= steps; step++) {
        const t = step / steps;
        const angle = entryAngle + (exitAngle - entryAngle) * t;
        path.push({
          x: x + Math.cos(angle) * ringRadius,
          y: y + Math.sin(angle) * ringRadius,
        });
      }
    }

    return path;
  }

  private countNearbyBots(x: number, y: number): number {
    return this.world
      .getSpatialGrid()
      .getNearbyEntities(x, y)
      .filter((id) => id.startsWith('bot-'))
      .length;
  }

  private hash01(value: string): number {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 0xffffffff;
  }

  private applyWaypointJitter(bot: BotAgent, waypoint: Waypoint): Waypoint {
    const jitterX = (this.hash01(`${bot.routeJitterSeed}:${waypoint.x}:x`) - 0.5) * 14 + bot.laneOffset;
    const jitterY = (this.hash01(`${bot.routeJitterSeed}:${waypoint.y}:y`) - 0.5) * 14 - bot.laneOffset;
    const candidate = {
      x: waypoint.x + jitterX,
      y: waypoint.y + jitterY,
    };

    if (this.physics.isInsideBuilding(candidate.x, candidate.y)) {
      return waypoint;
    }

    return candidate;
  }

  private markNearbyRoundaboutAvoided(bot: BotAgent, x: number, y: number): void {
    const roundabout = this.world
      .getCityFeatures()
      .roundabouts.find((r) => Math.hypot(r.x - x, r.y - y) < r.radius + 95);

    if (!roundabout) return;

    const ix = STREET_LINES.findIndex((line) => line === roundabout.x);
    const iy = STREET_LINES.findIndex((line) => line === roundabout.y);
    if (ix >= 0 && iy >= 0) {
      bot.avoidedRoundabouts.set(`${ix},${iy}`, this.world.getTick() + 160);
    }
  }

  private isRoundaboutTemporarilyAvoided(bot: BotAgent, key: string): boolean {
    const until = bot.avoidedRoundabouts.get(key) ?? 0;
    if (until <= this.world.getTick()) {
      bot.avoidedRoundabouts.delete(key);
      return false;
    }

    return true;
  }

  private getRoundaboutTangentialSteer(x: number, y: number): { x: number; y: number } {
    const roundabout = this.world
      .getCityFeatures()
      .roundabouts.find((r) => Math.hypot(r.x - x, r.y - y) < r.radius + 120);

    if (!roundabout) {
      return { x: 0, y: 0 };
    }

    const dx = x - roundabout.x;
    const dy = y - roundabout.y;
    const dist = Math.hypot(dx, dy) || 1;
    const targetRadius = roundabout.radius + 58;
    const radialError = targetRadius - dist;

    return {
      x: (-dy / dist) * 0.75 + (dx / dist) * radialError * 0.012,
      y: (dx / dist) * 0.75 + (dy / dist) * radialError * 0.012,
    };
  }

  private getTrafficQueueOffset(bot: BotAgent, headingX: number, headingY: number): { dx: number; dy: number } {
    if (bot.stopOffset <= 0) {
      return { dx: 0, dy: 0 };
    }

    const sideSign = bot.laneOffset >= 0 ? 1 : -1;
    return {
      dx: -headingX * 0.12 + -headingY * sideSign * 0.08,
      dy: -headingY * 0.12 + headingX * sideSign * 0.08,
    };
  }
}
