import {
  type InputPayload,
  type PassengerState,
  type PlayerState,
  MAP_SIZE,
  rotateTowardAngle,
  shortestAngleDelta,
} from '@xeom-rush/shared';
import type { PhysicsEngine } from './physics';
import type { GameWorld } from './world';

const STREET_LINES = [50, 450, 850, 1250, 1650, 2050, 2450, 2850, 3250, 3650];

/** Number of ticks to track for sliding-window displacement detection */
const DISPLACEMENT_WINDOW = 20;
/** If net displacement over the window is below this, the bot is "stuck" */
const STUCK_DISPLACEMENT_THRESHOLD = 15;
/** Distance at which bots switch from waypoint following to direct-to-target steering */
const DIRECT_APPROACH_RADIUS = 60;
/** Maximum bot steering turn per server tick. */
const BOT_MAX_TURN_PER_TICK = 0.35;

enum EBotState {
  SEEKING_PASSENGER,
  NAVIGATING_TO_PICKUP,
  NAVIGATING_TO_DROPOFF,
}

export interface BotLogEntry {
  timestamp: string;
  tick: number;
  botId: string;
  event: 'SPAWN' | 'STATE_CHANGE' | 'MILD_STUCK' | 'HARD_STUCK' | 'TRAFFIC' | 'WANDER';
  details: string;
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
  /** Circular buffer of recent positions for sliding-window displacement */
  positionHistory: { x: number; y: number }[];
  positionHistoryIndex: number;
  /** Perpendicular escape sign flips each stuck recovery attempt */
  escapeFlip: 1 | -1;
  /** Whether the bot is intentionally stopped at a red light or pedestrian crosswalk */
  isWaitingTraffic: boolean;
}

export class BotManager {
  private bots: Map<string, BotAgent> = new Map();
  private targetedPassengerIds: Set<string> = new Set();
  private nextBotIndex = 0;
  private logs: BotLogEntry[] = [];
  private maxLogs = 200;

  constructor(
    private world: GameWorld,
    private physics: PhysicsEngine,
  ) {}

  private logEvent(botId: string, event: BotLogEntry['event'], details: string): void {
    const logEntry: BotLogEntry = {
      timestamp: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
      tick: this.world.getTick(),
      botId,
      event,
      details,
    };
    this.logs.push(logEntry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    console.log(`[Bot AI t:${logEntry.tick}] [${botId}] [${event}] ${details}`);
  }

  public getLogs(): BotLogEntry[] {
    return this.logs;
  }

  public getStats() {
    const stats = {
      totalBots: this.bots.size,
      states: {
        SEEKING_PASSENGER: 0,
        NAVIGATING_TO_PICKUP: 0,
        NAVIGATING_TO_DROPOFF: 0,
      },
      stuckCount: 0,
    };
    for (const bot of this.bots.values()) {
      if (bot.state === EBotState.SEEKING_PASSENGER) stats.states.SEEKING_PASSENGER++;
      else if (bot.state === EBotState.NAVIGATING_TO_PICKUP) stats.states.NAVIGATING_TO_PICKUP++;
      else if (bot.state === EBotState.NAVIGATING_TO_DROPOFF) stats.states.NAVIGATING_TO_DROPOFF++;

      if (bot.stuckTicks > 0) {
        stats.stuckCount++;
      }
    }
    return stats;
  }

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

      const initialPos = { x: player?.x ?? 0, y: player?.y ?? 0 };
      const botObj: BotAgent = {
        playerId,
        state: EBotState.SEEKING_PASSENGER,
        targetPassengerId: null,
        stuckTicks: 0,
        lastX: initialPos.x,
        lastY: initialPos.y,
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
        positionHistory: Array.from({ length: DISPLACEMENT_WINDOW }, () => ({ ...initialPos })),
        positionHistoryIndex: 0,
        escapeFlip: 1,
        isWaitingTraffic: false,
      };
      this.bots.set(playerId, botObj);

      this.logEvent(
        playerId,
        'SPAWN',
        `Spawned at (${spawnPos.x.toFixed(0)}, ${spawnPos.y.toFixed(0)}) [law:${botObj.personality.lawfulness.toFixed(2)}, risk:${botObj.personality.riskTolerance.toFixed(2)}, agg:${botObj.personality.aggression.toFixed(2)}]`,
      );

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

      // Sliding-window displacement-based stuck detection (ignore if intentionally waiting for traffic)
      bot.positionHistory[bot.positionHistoryIndex] = { x: player.x, y: player.y };
      bot.positionHistoryIndex = (bot.positionHistoryIndex + 1) % DISPLACEMENT_WINDOW;
      const oldestPos = bot.positionHistory[bot.positionHistoryIndex];
      const netDisplacement = Math.hypot(player.x - oldestPos.x, player.y - oldestPos.y);

      if (netDisplacement < STUCK_DISPLACEMENT_THRESHOLD && !bot.isWaitingTraffic) {
        bot.stuckTicks++;
      } else {
        bot.stuckTicks = 0;
      }
      bot.lastX = player.x;
      bot.lastY = player.y;

      // Handle stuck behavior to keep bots fluid and competing
      if (bot.stuckTicks > 40) {
        this.markNearbyRoundaboutAvoided(bot, player.x, player.y);

        const city = this.world.getCityFeatures();
        const nearbyRoundabout = city.roundabouts.find(
          (r) => Math.hypot(r.x - player.x, r.y - player.y) < r.radius + 45,
        );
        if (nearbyRoundabout) {
          // Push bot outward towards clear road if stuck near fountain
          const rdx = player.x - nearbyRoundabout.x;
          const rdy = player.y - nearbyRoundabout.y;
          const rdist = Math.hypot(rdx, rdy) || 1;
          player.x = nearbyRoundabout.x + (rdx / rdist) * (nearbyRoundabout.radius + 35);
          player.y = nearbyRoundabout.y + (rdy / rdist) * (nearbyRoundabout.radius + 35);
          this.world.getSpatialGrid().update(bot.playerId, player.x, player.y);
        }

        if (player.passengerId) {
          // Hard-stuck while carrying: preserve the ride and reroute to the dropoff.
          const passenger = this.world.getPassengerMap().get(player.passengerId);
          bot.targetPassengerId = player.passengerId;
          bot.state = EBotState.NAVIGATING_TO_DROPOFF;
          bot.path = passenger ? this.calculatePath(bot, player.x, player.y, passenger.destX, passenger.destY) : [];
          bot.pathIndex = 0;
          bot.stuckTicks = 0;
          bot.escapeFlip = bot.escapeFlip === 1 ? -1 : 1;
          this.logEvent(
            bot.playerId,
            'HARD_STUCK',
            `Hard stuck while carrying ${player.passengerId} at (${player.x.toFixed(0)}, ${player.y.toFixed(0)}). Rerouting to dropoff.`,
          );
        } else {
          // Hard stuck while empty: release target, flip escape direction, and seek another passenger.
          this.logEvent(
            bot.playerId,
            'HARD_STUCK',
            `Hard stuck at (${player.x.toFixed(0)}, ${player.y.toFixed(0)}). Releasing target and seeking passenger.`,
          );
          if (bot.targetPassengerId) {
            this.targetedPassengerIds.delete(bot.targetPassengerId);
          }
          bot.targetPassengerId = null;
          bot.state = EBotState.SEEKING_PASSENGER;
          bot.path = [];
          bot.pathIndex = 0;
          bot.stuckTicks = 0;
          bot.escapeFlip = bot.escapeFlip === 1 ? -1 : 1;
        }
      } else if (bot.stuckTicks > 10 && bot.stuckTicks % 10 === 0) {
        // Mildly stuck: recalculate path from current location to target
        const target = this.getTargetPosition(bot);
        if (target) {
          this.logEvent(
            bot.playerId,
            'MILD_STUCK',
            `Stuck for ${bot.stuckTicks} ticks. Recalculating path to target (${target.x.toFixed(0)}, ${target.y.toFixed(0)}).`,
          );
          bot.path = this.calculatePath(bot, player.x, player.y, target.x, target.y);
          bot.pathIndex = 0;
        } else {
          this.logEvent(
            bot.playerId,
            'MILD_STUCK',
            `Stuck for ${bot.stuckTicks} ticks without target, forcing new wander path.`,
          );
          bot.path = [];
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
          this.logEvent(
            bot.playerId,
            'STATE_CHANGE',
            `Found passenger ${nearest.id}. Transitioned to NAVIGATING_TO_PICKUP.`,
          );
        } else {
          // If no passengers are available, choose a random street intersection to wander to
          if (bot.path.length === 0) {
            const randIx = Math.floor(Math.random() * STREET_LINES.length);
            const randIy = Math.floor(Math.random() * STREET_LINES.length);
            const targetX = STREET_LINES[randIx];
            const targetY = STREET_LINES[randIy];
            bot.path = this.calculatePath(bot, player.x, player.y, targetX, targetY);
            bot.pathIndex = 0;
            this.logEvent(
              bot.playerId,
              'WANDER',
              `No passenger available. Pathing to wander destination (${targetX.toFixed(0)}, ${targetY.toFixed(0)}).`,
            );
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
          this.logEvent(
            bot.playerId,
            'STATE_CHANGE',
            `Picked up passenger ${player.passengerId}! Transitioned to NAVIGATING_TO_DROPOFF.`,
          );

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
            this.logEvent(
              bot.playerId,
              'STATE_CHANGE',
              `Target passenger ${bot.targetPassengerId} was stolen or despawned. Reverting to SEEKING_PASSENGER.`,
            );
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
          this.logEvent(
            bot.playerId,
            'STATE_CHANGE',
            `Passenger delivered successfully! Reverting to SEEKING_PASSENGER.`,
          );
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

    // 1. Stuck resolution
    if (bot.stuckTicks > 10 && bot.stuckTicks <= 38) {
      // Check if near a roundabout
      const city = this.world.getCityFeatures();
      const nearbyRoundabout = city.roundabouts.find((r) => Math.hypot(r.x - player.x, r.y - player.y) < r.radius + 45);

      if (nearbyRoundabout) {
        // In roundabout: flow counter-clockwise forward and outward rather than reversing
        const rdx = player.x - nearbyRoundabout.x;
        const rdy = player.y - nearbyRoundabout.y;
        const rdist = Math.hypot(rdx, rdy) || 1;
        const tangentX = rdy / rdist;
        const tangentY = -rdx / rdist;
        const radialX = rdx / rdist;
        const radialY = rdy / rdist;

        const escapeX = tangentX * 0.75 + radialX * 0.4;
        const escapeY = tangentY * 0.75 + radialY * 0.4;
        const escapeMag = Math.hypot(escapeX, escapeY) || 1;
        bot.currentAngle = Math.atan2(escapeY, escapeX);
        return {
          seq: bot.inputSeq,
          dx: (escapeX / escapeMag) * 0.8,
          dy: (escapeY / escapeMag) * 0.8,
          angle: bot.currentAngle,
        };
      }

      // Normal street stuck: perpendicular escape with alternating direction
      const currentFlip = bot.stuckTicks <= 25 ? bot.escapeFlip : (-bot.escapeFlip as 1 | -1);
      const perpAngle = bot.currentAngle + (Math.PI / 2) * currentFlip;
      const reverseAngle = bot.currentAngle + Math.PI;
      const escapeX = Math.cos(reverseAngle) * 0.5 + Math.cos(perpAngle) * 0.5;
      const escapeY = Math.sin(reverseAngle) * 0.5 + Math.sin(perpAngle) * 0.5;
      const escapeMag = Math.hypot(escapeX, escapeY) || 1;
      return {
        seq: bot.inputSeq,
        dx: (escapeX / escapeMag) * 0.8,
        dy: (escapeY / escapeMag) * 0.8,
        angle: bot.currentAngle, // keep original facing angle
      };
    }

    // 2. Direct-to-target approach: if we have a target and are close, steer directly without clearing path
    const finalTarget = this.getTargetPosition(bot);
    if (finalTarget) {
      const distToTarget = Math.hypot(finalTarget.x - player.x, finalTarget.y - player.y);
      if (distToTarget < DIRECT_APPROACH_RADIUS && !this.physics.isInsideBuilding(finalTarget.x, finalTarget.y)) {
        // Steer directly to the actual target
        const directAngle = Math.atan2(finalTarget.y - player.y, finalTarget.x - player.x);
        bot.currentAngle = rotateTowardAngle(bot.currentAngle, directAngle, BOT_MAX_TURN_PER_TICK);
        if (distToTarget < 20) {
          bot.path = [];
          bot.pathIndex = 0;
        }
        bot.isWaitingTraffic = false;
        return {
          seq: bot.inputSeq,
          dx: Math.cos(bot.currentAngle),
          dy: Math.sin(bot.currentAngle),
          angle: bot.currentAngle,
        };
      }
    }

    // Calculate a path if missing but we have a target
    if (bot.path.length === 0) {
      if (finalTarget) {
        bot.path = this.calculatePath(bot, player.x, player.y, finalTarget.x, finalTarget.y);
        bot.pathIndex = 0;
      }
    }

    // Default to wandering if no valid target path
    if (bot.path.length === 0) {
      return this.createWanderInput(bot, player);
    }

    // Advance waypoints if we are close enough or already progressing towards the next one
    let currentWaypoint = bot.path[bot.pathIndex];
    let distToWaypoint = Math.hypot(currentWaypoint.x - player.x, currentWaypoint.y - player.y);

    while (bot.pathIndex < bot.path.length - 1) {
      const nextWaypoint = bot.path[bot.pathIndex + 1];
      const distToNext = Math.hypot(nextWaypoint.x - player.x, nextWaypoint.y - player.y);
      if (distToWaypoint < 32 || distToNext < distToWaypoint * 0.85) {
        bot.pathIndex++;
        currentWaypoint = bot.path[bot.pathIndex];
        distToWaypoint = Math.hypot(currentWaypoint.x - player.x, currentWaypoint.y - player.y);
      } else {
        break;
      }
    }

    // Clear path if we've arrived at the final destination
    if (bot.pathIndex === bot.path.length - 1 && distToWaypoint < 28) {
      bot.path = [];
      bot.pathIndex = 0;
    }

    // Path direction vector
    const pathAngle = Math.atan2(currentWaypoint.y - player.y, currentWaypoint.x - player.x);
    let moveX = Math.cos(pathAngle);
    let moveY = Math.sin(pathAngle);

    // Dynamic driver-to-driver avoidance steering (separation)
    const nearbyIds = this.world.getSpatialGrid().getNearbyEntities(player.x, player.y);
    const avoidanceRadius = 55; // Avoid close entities
    let avoidX = 0;
    let avoidY = 0;
    let avoidCount = 0;

    let isFollowingInRoundabout = false;
    const city = this.world.getCityFeatures();
    const activeRoundabout = city.roundabouts.find((r) => Math.hypot(r.x - player.x, r.y - player.y) < 60);

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
            if (activeRoundabout) {
              // In roundabout: check if other is ahead in traffic flow
              const headingDot = (other.x - player.x) * moveX + (other.y - player.y) * moveY;
              if (headingDot > 0 && dist < 42) {
                isFollowingInRoundabout = true;
              }
              // In roundabout, reduce lateral avoidance so bots don't push into walls/curbs
              const strength = ((avoidanceRadius - dist) / avoidanceRadius) * 0.6;
              avoidX += (dx / dist) * strength;
              avoidY += (dy / dist) * strength;
              avoidCount++;
            } else {
              // Repulsion strength is inversely proportional to distance
              const strength = ((avoidanceRadius - dist) / avoidanceRadius) * (dist < 35 ? 2.0 : 1);
              avoidX += (dx / dist) * strength;
              avoidY += (dy / dist) * strength;
              avoidCount++;
            }
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

    const roundaboutSteer = this.getRoundaboutTangentialSteer(player.x, player.y, currentWaypoint);
    // Scale roundabout tangential correction gently so it acts as a guide (0.3) rather than overpowering
    moveX += roundaboutSteer.x * 0.3;
    moveY += roundaboutSteer.y * 0.3;

    const mag = Math.hypot(moveX, moveY) || 1;
    const headingX = moveX / mag;
    const headingY = moveY / mag;

    const pedestrianAvoidance = city.getPedestrianAvoidance(player.x, player.y, headingX, headingY);
    if (pedestrianAvoidance.shouldBrake && bot.personality.aggression < 0.72) {
      bot.isWaitingTraffic = true;
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
    const turnDelta = Math.abs(shortestAngleDelta(bot.currentAngle, finalAngle));
    bot.currentAngle = rotateTowardAngle(bot.currentAngle, finalAngle, BOT_MAX_TURN_PER_TICK);
    // Smooth speed reduction when turning sharply (e.g. 90-degree corners) or following convoy in roundabout
    let turnThrottle = turnDelta > 0.8 ? 0.65 : 1.0;
    if (isFollowingInRoundabout) {
      turnThrottle = Math.min(turnThrottle, 0.55);
    }

    const trafficDecision = city.getTrafficDecisionAhead(
      player.x,
      player.y,
      Math.cos(bot.currentAngle),
      Math.sin(bot.currentAngle),
    );
    if (trafficDecision?.shouldStop) {
      const obeying = this.shouldBotObeyTrafficLight(bot, player);
      if (obeying) {
        bot.isWaitingTraffic = true;
        if (bot.inputSeq % 20 === 0) {
          this.logEvent(bot.playerId, 'TRAFFIC', `Obeying traffic light: STOP.`);
        }
        const queueOffset = this.getTrafficQueueOffset(bot, Math.cos(bot.currentAngle), Math.sin(bot.currentAngle));
        return {
          seq: bot.inputSeq,
          dx: queueOffset.dx,
          dy: queueOffset.dy,
          angle: bot.currentAngle,
        };
      } else {
        bot.isWaitingTraffic = false;
        if (bot.inputSeq % 20 === 0) {
          this.logEvent(bot.playerId, 'TRAFFIC', `Decided to RUN the red light!`);
        }
      }
    }

    bot.isWaitingTraffic = false;

    return {
      seq: bot.inputSeq,
      dx: Math.cos(bot.currentAngle) * turnThrottle,
      dy: Math.sin(bot.currentAngle) * turnThrottle,
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

  private createWanderInput(bot: BotAgent, player: PlayerState): InputPayload {
    // Street-aware wandering: pick a random nearby intersection and path to it
    if (bot.path.length === 0) {
      const currentNode = this.getClosestNode(player.x, player.y);
      // Pick a random intersection 1-3 blocks away
      const offsetIx = Math.floor(Math.random() * 3) + 1;
      const offsetIy = Math.floor(Math.random() * 3) + 1;
      const signX = Math.random() < 0.5 ? 1 : -1;
      const signY = Math.random() < 0.5 ? 1 : -1;
      const targetIx = Math.min(STREET_LINES.length - 1, Math.max(0, currentNode.ix + offsetIx * signX));
      const targetIy = Math.min(STREET_LINES.length - 1, Math.max(0, currentNode.iy + offsetIy * signY));
      const targetX = STREET_LINES[targetIx];
      const targetY = STREET_LINES[targetIy];
      bot.path = this.calculatePath(bot, player.x, player.y, targetX, targetY);
      bot.pathIndex = 0;
    }

    // If we still have no path (shouldn't happen), fall back to gentle random steering
    if (bot.path.length === 0) {
      bot.currentAngle += (Math.random() - 0.5) * 0.3;
      return {
        seq: bot.inputSeq,
        dx: Math.cos(bot.currentAngle),
        dy: Math.sin(bot.currentAngle),
        angle: bot.currentAngle,
      };
    }

    // Follow the wander path normally (the main generateInput will handle it next tick)
    const wp = bot.path[bot.pathIndex];
    const wanderAngle = Math.atan2(wp.y - player.y, wp.x - player.x);
    bot.currentAngle = rotateTowardAngle(bot.currentAngle, wanderAngle, BOT_MAX_TURN_PER_TICK);
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

  private calculatePath(
    bot: BotAgent,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    useAvoidance = true,
  ): Waypoint[] {
    const start = this.getClosestNode(fromX, fromY);
    const end = this.getClosestNode(toX, toY);

    const startKey = `${start.ix},${start.iy}`;
    const endKey = `${end.ix},${end.iy}`;

    const city = this.world.getCityFeatures();

    if (startKey === endKey) {
      if (city.isRoundaboutAt(start.ix, start.iy)) {
        return this.expandRoundaboutWaypoints(bot, [start], fromX, fromY, toX, toY);
      }
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
        return this.expandRoundaboutWaypoints(bot, nodePath, fromX, fromY, toX, toY);
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
        if (useAvoidance && currentKey !== startKey && neighborKey !== endKey) {
          if (this.isRoundaboutTemporarilyAvoided(bot, neighborKey)) {
            continue;
          }
          // Avoid routing through heavily congested roundabouts (>= 3 bots already present)
          if (city.isRoundaboutAt(neighbor.ix, neighbor.iy)) {
            const nx = STREET_LINES[neighbor.ix];
            const ny = STREET_LINES[neighbor.iy];
            if (this.countNearbyBots(nx, ny) >= 3) {
              continue;
            }
          }
        }
        const tentativeGScore = (gScore.get(currentKey) ?? Infinity) + this.distance(current, neighbor);

        if (tentativeGScore < (gScore.get(neighborKey) ?? Infinity)) {
          cameFrom.set(neighborKey, currentKey);
          gScore.set(neighborKey, tentativeGScore);
          fScore.set(neighborKey, tentativeGScore + this.heuristic(neighbor, end));

          if (!openSet.some((n) => n.ix === neighbor.ix && n.iy === neighbor.iy)) {
            openSet.push(neighbor);
          }
        }
      }
    }

    // If search with avoidance failed to find a path, retry without avoidance filters
    if (useAvoidance) {
      return this.calculatePath(bot, fromX, fromY, toX, toY, false);
    }

    return [this.applyWaypointJitter(bot, { x: toX, y: toY })];
  }

  private expandRoundaboutWaypoints(
    bot: BotAgent,
    nodes: GridNode[],
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
  ): Waypoint[] {
    const path: Waypoint[] = [];
    const city = this.world.getCityFeatures();
    const RING_RADIUS = 43; // Safe distance: 4px from fountain curb (39) and 6.5px from diagonal buildings (49.5)

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const cx = STREET_LINES[node.ix];
      const cy = STREET_LINES[node.iy];

      if (!city.isRoundaboutAt(node.ix, node.iy)) {
        path.push(this.applyWaypointJitter(bot, { x: cx, y: cy }));
        continue;
      }

      const roundabout = city.roundabouts.find((r) => r.id === `roundabout-${node.ix}-${node.iy}`);
      if (!roundabout) {
        path.push({ x: cx, y: cy });
        continue;
      }

      // Safe ring radius with tiny individual variation (+-2px)
      const clampedLane = Math.max(-2, Math.min(2, bot.laneOffset * 0.25));
      const ringRadius = RING_RADIUS + clampedLane;

      // Determine incoming approach direction
      let inX: number;
      let inY: number;
      if (i > 0) {
        const prev = nodes[i - 1];
        inX = STREET_LINES[prev.ix] - cx;
        inY = STREET_LINES[prev.iy] - cy;
      } else {
        // Bot is starting at or near this roundabout
        const dx = fromX - cx;
        const dy = fromY - cy;
        const dist = Math.hypot(dx, dy);
        if (dist > 15) {
          inX = dx;
          inY = dy;
        } else {
          inX = -100;
          inY = 0;
        }
      }

      // Determine outgoing exit direction
      let outX: number;
      let outY: number;
      if (i < nodes.length - 1) {
        const next = nodes[i + 1];
        outX = STREET_LINES[next.ix] - cx;
        outY = STREET_LINES[next.iy] - cy;
      } else {
        // Roundabout is the destination area
        const dx = toX - cx;
        const dy = toY - cy;
        const dist = Math.hypot(dx, dy);
        if (dist > 15) {
          outX = dx;
          outY = dy;
        } else {
          outX = 100;
          outY = 0;
        }
      }

      // Right-hand traffic lane entry & exit calculation
      const inDist = Math.hypot(inX, inY) || 1;
      const inNx = inX / inDist;
      const inNy = inY / inDist;
      const entryPx = inNx * ringRadius + inNy * 16;
      const entryPy = inNy * ringRadius - inNx * 16;
      let entryAngle = Math.atan2(entryPy, entryPx);

      const outDist = Math.hypot(outX, outY) || 1;
      const outNx = outX / outDist;
      const outNy = outY / outDist;
      const exitPx = outNx * ringRadius - outNy * 16;
      const exitPy = outNy * ringRadius + outNx * 16;
      const exitAngle = Math.atan2(exitPy, exitPx);

      // In canvas (+y down), counter-clockwise rotation means angle DECREASES.
      while (entryAngle <= exitAngle) {
        entryAngle += Math.PI * 2;
      }

      const angleSpan = entryAngle - exitAngle;
      const steps = Math.max(3, Math.ceil(angleSpan / (Math.PI / 3.5)));

      for (let step = 0; step <= steps; step++) {
        const t = step / steps;
        const angle = entryAngle - angleSpan * t;
        const wx = cx + Math.cos(angle) * ringRadius;
        const wy = cy + Math.sin(angle) * ringRadius;
        path.push({ x: wx, y: wy });
      }
    }

    // Append final destination jittered, ensuring it's not inside any roundabout obstacle
    const finalWp = this.applyWaypointJitter(bot, { x: toX, y: toY });
    for (const r of city.roundabouts) {
      const dist = Math.hypot(finalWp.x - r.x, finalWp.y - r.y);
      if (dist < r.radius + 16) {
        finalWp.x = r.x + ((finalWp.x - r.x) / (dist || 1)) * (r.radius + 20);
        finalWp.y = r.y + ((finalWp.y - r.y) / (dist || 1)) * (r.radius + 20);
      }
    }
    path.push(finalWp);

    return path;
  }

  private countNearbyBots(x: number, y: number, radius: number = 90): number {
    return this.world
      .getSpatialGrid()
      .getNearbyEntities(x, y)
      .filter((id) => {
        if (!id.startsWith('bot-')) return false;
        const p = this.world.getPlayer(id);
        return p && Math.hypot(p.x - x, p.y - y) <= radius;
      }).length;
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
      bot.avoidedRoundabouts.set(`${ix},${iy}`, this.world.getTick() + 300);
      this.logEvent(
        bot.playerId,
        'HARD_STUCK',
        `Roundabout at (${roundabout.x}, ${roundabout.y}) marked as avoided for 300 ticks (15s).`,
      );
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

  private getRoundaboutTangentialSteer(x: number, y: number, currentWaypoint?: Waypoint): { x: number; y: number } {
    const roundabout = this.world
      .getCityFeatures()
      .roundabouts.find((r) => Math.hypot(r.x - x, r.y - y) < r.radius + 36);

    if (!roundabout) {
      return { x: 0, y: 0 };
    }

    const dx = x - roundabout.x;
    const dy = y - roundabout.y;
    const dist = Math.hypot(dx, dy) || 1;

    // If bot is exiting (target waypoint is outside the roundabout circle > 60px away)
    if (currentWaypoint && Math.hypot(currentWaypoint.x - roundabout.x, currentWaypoint.y - roundabout.y) > 60) {
      // Only repel outward if dangerously close to fountain curb (radius 24 + 14 = 38)
      if (dist < roundabout.radius + 14) {
        return {
          x: (dx / dist) * 0.6,
          y: (dy / dist) * 0.6,
        };
      }
      return { x: 0, y: 0 };
    }

    // Inside roundabout: gentle counter-clockwise guidance and radial keeping at 43
    const targetRadius = 43;
    const radialError = targetRadius - dist;
    const pushOut = dist < roundabout.radius + 14 ? 0.5 : radialError * 0.02;

    // Use counter-clockwise steering (Vietnamese right-hand traffic rule)
    return {
      x: (dy / dist) * 0.4 + (dx / dist) * pushOut,
      y: (-dx / dist) * 0.4 + (dy / dist) * pushOut,
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
