import { type TrafficLightState, type PedestrianState, MAP_SIZE } from '@xeom-rush/shared';
import type { PhysicsEngine } from './physics';

// Street centerlines derived from the map grid layout
const STREET_LINES = [50, 450, 850, 1250, 1650, 2050, 2450, 2850, 3250, 3650];

// The fraction of intersections that get each feature
const ROUNDABOUT_CHANCE = 0.12; // ~12% of intersections become roundabouts
const TRAFFIC_LIGHT_CHANCE = 0.3; // ~30% of intersections get lights
const CROSSWALK_CHANCE = 0.4; // ~40% of intersections get crosswalks
const ROUNDABOUT_RADIUS = 24;

const PEDESTRIANS_PER_CROSSWALK = 2;
const PEDESTRIAN_SPEED = 30; // units per second
const PEDESTRIAN_WALK_HALF_LENGTH = 90; // Half the length of the crosswalk corridor
const PEDESTRIAN_RESPAWN_MIN_TICKS = 120; // 6 seconds at 20Hz (walk-off)
const PEDESTRIAN_RESPAWN_JITTER_TICKS = 80; // extra 0-4 seconds random
const PEDESTRIAN_HIT_RESPAWN_MIN_TICKS = 200; // 10 seconds at 20Hz (hit by player)
const PEDESTRIAN_HIT_RESPAWN_JITTER_TICKS = 100; // extra 0-5 seconds random

// Traffic light timing (in server ticks at 20Hz)
const TICKS_GREEN = 160; // 8 seconds
const TICKS_YELLOW = 40; // 2 seconds
const TICKS_DIRECTION_TOTAL = TICKS_GREEN + TICKS_YELLOW;
const TICKS_TOTAL = TICKS_DIRECTION_TOTAL * 2;
const STOP_LINE_DIST = 46;
const STOP_LINE_HALF_LENGTH = 42;

export interface RoundaboutData {
  id: string;
  x: number;
  y: number;
  radius: number;
}

export interface CrosswalkData {
  id: string;
  x: number;
  y: number;
  direction: 'horizontal' | 'vertical';
}

export interface TrafficDecision {
  shouldStop: boolean;
  light: TrafficLightState;
  distance: number;
}

interface PedestrianAgent {
  state: PedestrianState;
  direction: 1 | -1; // walking forward or backward along crosswalk
  crosswalkDirection: 'horizontal' | 'vertical';
  originX: number; // center of crosswalk
  originY: number;
  slotIndex: number;
  respawnTick: number | null;
  wasHit: boolean; // whether deactivated by player hit (longer respawn)
}

export class CityFeatures {
  public roundabouts: RoundaboutData[] = [];
  public crosswalks: CrosswalkData[] = [];
  private trafficLightMap: Map<string, TrafficLightState & { tickOffset: number }> = new Map();
  private pedestrianAgents: Map<string, PedestrianAgent> = new Map();
  private nextPedId = 0;

  constructor(private physics: PhysicsEngine) {
    this.generateFeatures();
  }

  private generateFeatures(): void {
    const seeded = new SeededRng(42); // deterministic — same map every server restart

    for (let xi = 0; xi < STREET_LINES.length; xi++) {
      for (let yi = 0; yi < STREET_LINES.length; yi++) {
        const cx = STREET_LINES[xi];
        const cy = STREET_LINES[yi];

        // Skip near-edge intersections and the open market centre
        const inCenter = Math.abs(cx - MAP_SIZE / 2) < 400 && Math.abs(cy - MAP_SIZE / 2) < 400;
        const nearEdge = cx < 150 || cy < 150 || cx > MAP_SIZE - 150 || cy > MAP_SIZE - 150;
        if (inCenter || nearEdge) continue;

        const roll = seeded.next();

        if (roll < ROUNDABOUT_CHANCE) {
          this.addRoundabout(xi, yi, cx, cy);
        } else if (roll < ROUNDABOUT_CHANCE + TRAFFIC_LIGHT_CHANCE) {
          this.addTrafficLight(xi, yi, cx, cy, seeded);
        } else if (roll < ROUNDABOUT_CHANCE + TRAFFIC_LIGHT_CHANCE + CROSSWALK_CHANCE) {
          this.addCrosswalk(xi, yi, cx, cy, seeded);
        }
      }
    }
  }

  private addRoundabout(xi: number, yi: number, cx: number, cy: number): void {
    const id = `roundabout-${xi}-${yi}`;
    const roundabout: RoundaboutData = { id, x: cx, y: cy, radius: ROUNDABOUT_RADIUS };
    this.roundabouts.push(roundabout);
    // Register the roundabout centre as a circular obstacle in physics
    this.physics.addCircleObstacle(cx, cy, ROUNDABOUT_RADIUS);
  }

  private addTrafficLight(xi: number, yi: number, cx: number, cy: number, rng: SeededRng): void {
    const id = `tl-${xi}-${yi}`;
    // Stagger offsets so not all lights turn green at the same time
    const tickOffset = Math.floor(rng.next() * TICKS_TOTAL);
    this.trafficLightMap.set(id, {
      id,
      x: cx,
      y: cy,
      isRedNS: false,
      isYellow: false,
      tickOffset,
    });
  }

  private addCrosswalk(xi: number, yi: number, cx: number, cy: number, rng: SeededRng): void {
    const dir: 'horizontal' | 'vertical' = rng.next() < 0.5 ? 'horizontal' : 'vertical';
    const id = `cw-${xi}-${yi}`;
    this.crosswalks.push({ id, x: cx, y: cy, direction: dir });

    // Spawn N pedestrians per crosswalk, staggered from both sides with random offsets.
    for (let k = 0; k < PEDESTRIANS_PER_CROSSWALK; k++) {
      const pedId = `ped-${this.nextPedId++}`;
      const direction: 1 | -1 = k % 2 === 0 ? 1 : -1;
      // Stagger initial position: random 0-70% along the crosswalk corridor
      const startOffset = Math.random() * PEDESTRIAN_WALK_HALF_LENGTH * 0.7;

      const agent: PedestrianAgent = {
        state: this.createPedestrianState(pedId, cx, cy, dir, direction, startOffset),
        direction,
        crosswalkDirection: dir,
        originX: cx,
        originY: cy,
        slotIndex: k,
        respawnTick: null,
        wasHit: false,
      };
      this.pedestrianAgents.set(pedId, agent);
    }
  }

  private createPedestrianState(
    id: string,
    originX: number,
    originY: number,
    direction: 'horizontal' | 'vertical',
    walkDirection: 1 | -1,
    startOffset: number = 0,
  ): PedestrianState {
    // Start from the edge, shifted inward by startOffset
    const edgePos = -walkDirection * PEDESTRIAN_WALK_HALF_LENGTH;
    const start = edgePos + walkDirection * startOffset;
    return {
      id,
      x: direction === 'vertical' ? originX + start : originX,
      y: direction === 'horizontal' ? originY + start : originY,
      angle:
        direction === 'horizontal' ? (walkDirection > 0 ? Math.PI / 2 : -Math.PI / 2) : walkDirection > 0 ? 0 : Math.PI,
    };
  }

  /**
   * Advance traffic lights and pedestrian positions each server tick.
   */
  public tick(tickCount: number, dt: number): void {
    this.tickTrafficLights(tickCount);
    this.tickPedestrians(dt);
    this.tickRespawns();
  }

  private tickTrafficLights(tickCount: number): void {
    for (const light of this.trafficLightMap.values()) {
      const phase = (tickCount + light.tickOffset) % TICKS_TOTAL;

      if (phase < TICKS_GREEN) {
        // North-south may go, east-west must stop.
        light.isRedNS = false;
        light.isYellow = false;
      } else if (phase < TICKS_GREEN + TICKS_YELLOW) {
        // North-south warning before east-west gets right-of-way.
        light.isRedNS = false;
        light.isYellow = true;
      } else if (phase < TICKS_DIRECTION_TOTAL + TICKS_GREEN) {
        // East-west may go, north-south must stop.
        light.isRedNS = true;
        light.isYellow = false;
      } else {
        // East-west warning before north-south gets right-of-way.
        light.isRedNS = true;
        light.isYellow = true;
      }
    }
  }

  private tickPedestrians(dt: number): void {
    for (const agent of this.pedestrianAgents.values()) {
      if (agent.respawnTick !== null) continue;

      const step = PEDESTRIAN_SPEED * dt * agent.direction;

      if (agent.crosswalkDirection === 'horizontal') {
        agent.state.y += step;
        agent.state.angle = agent.direction > 0 ? Math.PI / 2 : -Math.PI / 2;
        const relY = agent.state.y - agent.originY;
        if (Math.abs(relY) > PEDESTRIAN_WALK_HALF_LENGTH) {
          const walkOffDelay =
            PEDESTRIAN_RESPAWN_MIN_TICKS + Math.floor(Math.random() * PEDESTRIAN_RESPAWN_JITTER_TICKS);
          this.deactivatePedestrian(agent, walkOffDelay, false);
        }
      } else {
        agent.state.x += step;
        agent.state.angle = agent.direction > 0 ? 0 : Math.PI;
        const relX = agent.state.x - agent.originX;
        if (Math.abs(relX) > PEDESTRIAN_WALK_HALF_LENGTH) {
          const walkOffDelay =
            PEDESTRIAN_RESPAWN_MIN_TICKS + Math.floor(Math.random() * PEDESTRIAN_RESPAWN_JITTER_TICKS);
          this.deactivatePedestrian(agent, walkOffDelay, false);
        }
      }
    }
  }

  private deactivatePedestrian(agent: PedestrianAgent, respawnDelayTicks: number, wasHit: boolean): void {
    agent.respawnTick = respawnDelayTicks;
    agent.wasHit = wasHit;
  }

  public tickRespawns(): void {
    for (const agent of this.pedestrianAgents.values()) {
      if (agent.respawnTick === null) continue;

      agent.respawnTick--;
      if (agent.respawnTick <= 0) {
        // Randomize walk direction on respawn (50% chance to flip)
        agent.direction = Math.random() < 0.5 ? 1 : -1;
        // Random start offset: 0-30% into the crosswalk for organic feel
        const respawnOffset = Math.random() * PEDESTRIAN_WALK_HALF_LENGTH * 0.3;
        agent.state = this.createPedestrianState(
          agent.state.id,
          agent.originX,
          agent.originY,
          agent.crosswalkDirection,
          agent.direction,
          respawnOffset,
        );
        agent.respawnTick = null;
        agent.wasHit = false;
      }
    }
  }

  public getTrafficLights(): TrafficLightState[] {
    return Array.from(this.trafficLightMap.values()).map(({ id, x, y, isRedNS, isYellow }) => ({
      id,
      x,
      y,
      isRedNS,
      isYellow,
    }));
  }

  public getPedestrians(): PedestrianState[] {
    return Array.from(this.pedestrianAgents.values())
      .filter((a) => a.respawnTick === null)
      .map((a) => a.state);
  }

  public getPedestrianMap(): Map<string, PedestrianState> {
    const map = new Map<string, PedestrianState>();
    for (const [id, agent] of this.pedestrianAgents) {
      if (agent.respawnTick !== null) continue;
      map.set(id, agent.state);
    }
    return map;
  }

  /**
   * Returns the traffic light at the given intersection, if any.
   */
  public getTrafficLightAt(ix: number, iy: number): (TrafficLightState & { tickOffset: number }) | undefined {
    const id = `tl-${ix}-${iy}`;
    return this.trafficLightMap.get(id);
  }

  public getVisibleTrafficLights(x: number, y: number, radius: number): TrafficLightState[] {
    return this.getTrafficLights().filter((light) => Math.hypot(light.x - x, light.y - y) <= radius);
  }

  public getVisiblePedestrians(x: number, y: number, radius: number): PedestrianState[] {
    return this.getPedestrians().filter((ped) => Math.hypot(ped.x - x, ped.y - y) <= radius);
  }

  public getVisibleRoundabouts(x: number, y: number, radius: number): RoundaboutData[] {
    return this.roundabouts.filter((roundabout) => Math.hypot(roundabout.x - x, roundabout.y - y) <= radius);
  }

  public getVisibleCrosswalks(x: number, y: number, radius: number): CrosswalkData[] {
    return this.crosswalks.filter((crosswalk) => Math.hypot(crosswalk.x - x, crosswalk.y - y) <= radius);
  }

  /**
   * Returns true if there is a roundabout at the given intersection.
   */
  public isRoundaboutAt(ix: number, iy: number): boolean {
    return this.roundabouts.some((r) => r.id === `roundabout-${ix}-${iy}`);
  }

  /**
   * Check if a position is inside any roundabout circle obstacle.
   */
  public isInsideRoundabout(px: number, py: number): boolean {
    for (const r of this.roundabouts) {
      if (Math.hypot(px - r.x, py - r.y) < r.radius) return true;
    }
    return false;
  }

  public getHitPedestrianId(playerX: number, playerY: number, playerRadius: number = 15): string | null {
    for (const [id, agent] of this.pedestrianAgents) {
      if (agent.respawnTick !== null) continue;
      const dist = Math.hypot(agent.state.x - playerX, agent.state.y - playerY);
      if (dist < playerRadius + 10) return id;
    }
    return null;
  }

  public removePedestrian(id: string): void {
    const agent = this.pedestrianAgents.get(id);
    if (agent) {
      const hitDelay =
        PEDESTRIAN_HIT_RESPAWN_MIN_TICKS + Math.floor(Math.random() * PEDESTRIAN_HIT_RESPAWN_JITTER_TICKS);
      this.deactivatePedestrian(agent, hitDelay, true);
    }
  }

  public getPedestrianAvoidance(
    playerX: number,
    playerY: number,
    headingX: number,
    headingY: number,
    lookAhead: number = 110,
  ): { x: number; y: number; shouldBrake: boolean } {
    let avoidX = 0;
    let avoidY = 0;
    let shouldBrake = false;

    for (const agent of this.pedestrianAgents.values()) {
      if (agent.respawnTick !== null) continue;
      const dx = agent.state.x - playerX;
      const dy = agent.state.y - playerY;
      const dist = Math.hypot(dx, dy);
      if (dist <= 0 || dist > lookAhead) continue;

      const forwardDot = (dx / dist) * headingX + (dy / dist) * headingY;
      if (forwardDot < 0.35) continue;

      const side = headingX * dy - headingY * dx;
      const lateralDist = Math.abs(side);
      if (lateralDist > 35) continue;

      const strength = (lookAhead - dist) / lookAhead;
      avoidX += -headingY * Math.sign(side || 1) * strength;
      avoidY += headingX * Math.sign(side || 1) * strength;
      shouldBrake = shouldBrake || dist < 45;
    }

    return { x: avoidX, y: avoidY, shouldBrake };
  }

  public checkRedLightViolation(playerX: number, playerY: number, prevX: number, prevY: number): boolean {
    const DETECT_RADIUS = 120; // How close to intersection we check

    for (const light of this.trafficLightMap.values()) {
      const dx = playerX - light.x;
      const dy = playerY - light.y;
      const dist = Math.hypot(dx, dy);
      if (dist > DETECT_RADIUS) continue;

      const prevDist = Math.hypot(prevX - light.x, prevY - light.y);
      if (prevDist < STOP_LINE_DIST) continue;

      // Player is moving toward/through the center — check for stop line crossing
      if (light.isRedNS) {
        // North-South is red: crossing either horizontal stop line toward the center.
        const movingSouth = playerY > prevY;
        const stopY = light.y + (movingSouth ? -STOP_LINE_DIST : STOP_LINE_DIST);
        const crossingNS =
          Math.abs(prevX - light.x) < STOP_LINE_HALF_LENGTH &&
          ((prevY < stopY && playerY >= stopY) || (prevY > stopY && playerY <= stopY));
        if (crossingNS) return true;
      } else {
        // East-West is red: crossing either vertical stop line toward the center.
        const movingEast = playerX > prevX;
        const stopX = light.x + (movingEast ? -STOP_LINE_DIST : STOP_LINE_DIST);
        const crossingEW =
          Math.abs(prevY - light.y) < STOP_LINE_HALF_LENGTH &&
          ((prevX < stopX && playerX >= stopX) || (prevX > stopX && playerX <= stopX));
        if (crossingEW) return true;
      }
    }

    return false;
  }

  public getTrafficDecisionAhead(
    playerX: number,
    playerY: number,
    headingX: number,
    headingY: number,
    lookAhead: number = 135,
  ): TrafficDecision | null {
    let closest: TrafficDecision | null = null;

    for (const light of this.trafficLightMap.values()) {
      const dx = light.x - playerX;
      const dy = light.y - playerY;
      const dist = Math.hypot(dx, dy);
      if (dist <= 0 || dist > lookAhead) continue;

      const forwardDot = (dx / dist) * headingX + (dy / dist) * headingY;
      if (forwardDot < 0.65) continue;

      const movingNS = Math.abs(headingY) >= Math.abs(headingX);
      const redForDirection = movingNS ? light.isRedNS : !light.isRedNS;
      const yellowForDirection = movingNS ? !light.isRedNS && light.isYellow : light.isRedNS && light.isYellow;
      const shouldStop = redForDirection || yellowForDirection;
      if (!shouldStop) continue;
      if (!this.isBeforeStopLine(playerX, playerY, headingX, headingY, light, movingNS)) continue;

      if (!closest || dist < closest.distance) {
        closest = { shouldStop, light, distance: dist };
      }
    }

    return closest;
  }

  private isBeforeStopLine(
    playerX: number,
    playerY: number,
    headingX: number,
    headingY: number,
    light: TrafficLightState,
    movingNS: boolean,
  ): boolean {
    if (movingNS) {
      const movingSouth = headingY > 0;
      const stopY = light.y + (movingSouth ? -STOP_LINE_DIST : STOP_LINE_DIST);
      return movingSouth ? playerY < stopY : playerY > stopY;
    }

    const movingEast = headingX > 0;
    const stopX = light.x + (movingEast ? -STOP_LINE_DIST : STOP_LINE_DIST);
    return movingEast ? playerX < stopX : playerX > stopX;
  }
}

/**
 * Simple deterministic seeded pseudo-random number generator (LCG).
 * Produces the same sequence on every server restart, ensuring a stable map.
 */
class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed;
  }

  next(): number {
    // LCG parameters from Numerical Recipes
    this.state = (this.state * 1664525 + 1013904223) & 0xffffffff;
    return (this.state >>> 0) / 0xffffffff;
  }
}
