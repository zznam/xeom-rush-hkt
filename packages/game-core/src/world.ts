import {
  progressionPeriods,
  districtAt,
  cityAtTick,
  environmentMultiplier,
  movementConditions,
  StreetNavigator,
  type CityLifeState,
  createJob,
  jobTip,
  freshness,
  type JobState,
  LANDMARKS,
  calculateFare,
  findStreetRoute,
  type GameplayState,
  type Vector2D,
  emptySummary,
  type ShiftSummary,
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
const PEDESTRIAN_PENALTY = 5000;
const PENALTY_COOLDOWN_TICKS = 20;
const CITY_VISIBILITY_RADIUS = CHUNK_SIZE * 1.5;

function getStreakMultiplier(streak: number): number {
  for (const { minStreak, multiplier } of STREAK_MULTIPLIERS) {
    if (streak >= minStreak) return multiplier;
  }
  return 1.0;
}

export class GameWorld {
  private life: CityLifeState = cityAtTick(0);
  private closureId = '';
  private closureAllowed = false;
  private closedNavigator: StreetNavigator | null = null;
  private practice = new Map<string, string>();
  private practiceCompleted = new Set<string>();
  private reservations = new Map<string, string>();
  public canCollect(playerId: string, passengerId: string) {
    return !this.reservations.has(passengerId) || this.reservations.get(passengerId) === playerId;
  }
  public beginPractice(id: string) {
    const p = this.players.get(id);
    if (
      !this.options.enhanced ||
      !p ||
      p.passengerId ||
      this.practice.has(id) ||
      this.practiceCompleted.has(id) ||
      (this.sessionDeliveries.get(id) ?? 0) > 0
    )
      return false;
    p.x = 2050;
    p.y = 2200;
    this.spatialGrid.update(id, p.x, p.y);
    const target = `pass-practice-${id}`;
    const passenger: PassengerState = {
      id: target,
      x: 2050,
      y: 2280,
      destX: 2050,
      destY: 2380,
      reward: 0,
      tier: 0,
      deadline: 0,
      spawnedAt: this.tickCount,
      isCarried: false,
    };
    this.passengers.getPassengerMap().set(target, passenger);
    this.spatialGrid.insert(target, passenger.x, passenger.y);
    this.practice.set(id, target);
    this.reservations.set(target, id);
    this.selectedPickups.set(id, target);
    return true;
  }
  private periods = progressionPeriods();
  private progress = new Map<string, Record<string, Record<string, number>>>();
  private appearances = new Map<string, Record<string, string>>();
  public setAppearance(id: string, equipped: Record<string, string>) {
    this.appearances.set(id, { ...equipped });
  }
  public getAppearances() {
    return Object.fromEntries(this.appearances);
  }
  private trackProgress(id: string, metric: string, amount = 1) {
    if (!this.options.enhanced || !amount || this.practice.has(id)) return;
    const counts = this.progress.get(id) ?? {};
    for (const period of Object.values(this.periods)) {
      counts[period] ??= {};
      counts[period][metric] = (counts[period][metric] ?? 0) + amount;
    }
    this.progress.set(id, counts);
  }
  private jobs = new Map<string, JobState>();
  private getJob(passenger: PassengerState) {
    let job = this.jobs.get(passenger.id);
    if (!job) {
      job = createJob(passenger);
      this.jobs.set(passenger.id, job);
    }
    return job;
  }
  private selectedPickups = new Map<string, string>();
  private routeCache = new Map<string, { key: string; from: Vector2D; route: Vector2D[] }>();
  private summaries = new Map<string, ShiftSummary>();
  private pickupTicks = new Map<string, number>();
  private dirtyTrips = new Set<string>();
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

  constructor(private options: { enhanced?: boolean; now?: () => number } = {}) {
    this.life = { ...cityAtTick(0), enabled: !!options.enhanced };
    this.spatialGrid = new SpatialGrid();
    this.physics = new PhysicsEngine();
    this.cityFeatures = new CityFeatures(this.physics);
    this.passengers = new PassengerSpawner(this.physics, !!options.enhanced);
  }

  public addPlayer(id: string, username: string, spawnX?: number, spawnY?: number): void {
    let startX = spawnX ?? 2000 + (Math.random() - 0.5) * 200;
    let startY = spawnY ?? 2000 + (Math.random() - 0.5) * 200;
    if (spawnX === undefined && this.physics.isInsideBuilding(startX, startY)) {
      startX = 2050;
      startY = 2050;
    }

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

    this.summaries.set(id, emptySummary());
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
        const passenger = this.passengers.getPassengerMap().get(player.passengerId),
          job = this.jobs.get(player.passengerId);
        if (passenger && job) {
          const last = job.stops[job.stops.length - 1];
          passenger.destX = last.x;
          passenger.destY = last.y;
        }
        this.jobs.delete(player.passengerId);
        this.passengers.updateCarriedStatus(player.passengerId, false);
      }
      this.selectedPickups.delete(id);
      this.routeCache.delete(id);
      this.summaries.delete(id);
      this.pickupTicks.delete(id);
      this.dirtyTrips.delete(id);
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
      const practice = this.practice.get(id);
      if (practice) {
        this.passengers.remove(practice);
        this.reservations.delete(practice);
      }
      this.practice.delete(id);
      this.practiceCompleted.delete(id);
      this.progress.delete(id);
      this.appearances.delete(id);
      this.sessionViolations.delete(id);
    }
  }

  public getSessionStatsForPlayer(playerId: string) {
    const player = this.players.get(playerId);
    if (!player) return null;

    return {
      username: player.username,
      revision: this.tickCount,
      progress: structuredClone(this.progress.get(playerId) ?? {}),
      summary: structuredClone(this.summaries.get(playerId) ?? emptySummary()),
      score: player.score,
      peakStreak: this.sessionPeakStreaks.get(playerId) ?? 0,
      deliveriesCount: this.sessionDeliveries.get(playerId) ?? 0,
      violations: this.sessionViolations.get(playerId) ?? { redLights: 0, pedestrianHits: 0, driverCollisions: 0 },
    };
  }

  public queueInput(playerId: string, input: InputPayload): void {
    const queue = this.inputQueues.get(playerId);
    if (queue && Number.isFinite(input.dx) && Number.isFinite(input.dy) && Number.isFinite(input.angle)) {
      if (queue.length >= 8) queue.shift();
      queue.push(input);
    }
  }

  public setConnected(id: string, connected: boolean): void {
    const player = this.players.get(id);
    if (player) player.connected = connected;
    this.inputQueues.set(id, []);
  }

  public getCityLife(): CityLifeState {
    return structuredClone(this.life);
  }
  public getNavigationRoute(from: Vector2D, to: Vector2D): Vector2D[] {
    return this.life.closure?.active && this.closedNavigator
      ? this.closedNavigator.route(from, to)
      : findStreetRoute(from, to);
  }
  private advanceCity(): void {
    if (!this.options.enhanced) {
      this.life = { ...cityAtTick(0), tick: this.tickCount, enabled: false };
      return;
    }
    const life = cityAtTick(this.tickCount),
      closure = life.closure;
    const inside = (point: Vector2D, padding = 70) =>
      !!closure &&
      point.x > closure.rect.x - padding &&
      point.x < closure.rect.x + closure.rect.width + padding &&
      point.y > closure.rect.y - padding &&
      point.y < closure.rect.y + closure.rect.height + padding;
    if (closure && closure.id !== this.closureId) {
      this.closureId = closure.id;
      this.closureAllowed = false;
      const targets = [
        ...LANDMARKS,
        ...this.passengers.getPassengers().flatMap((p) => [
          { x: p.x, y: p.y },
          { x: p.destX, y: p.destY },
        ]),
        ...[...this.jobs.values()].flatMap((j) => j.stops),
      ];
      if (!targets.some((p) => inside(p))) {
        const navigator = new StreetNavigator([closure.rect]);
        this.closureAllowed = targets.every((target) => navigator.route({ x: 2050, y: 2050 }, target).length > 1);
        if (this.closureAllowed) this.closedNavigator = navigator;
      }
    }
    if (
      closure?.active &&
      !this.life.closure?.active &&
      ([...this.players.values()].some((p) => inside(p)) ||
        this.passengers.getPassengers().some((p) => inside(p, 35) || inside({ x: p.destX, y: p.destY }, 35)))
    )
      this.closureAllowed = false;
    if (!this.closureAllowed) life.closure = null;
    this.life = life;
    this.physics.setClosures(life.closure?.active ? [life.closure.rect] : []);
  }

  public selectPickup(id: string, target?: string): boolean {
    if (this.practice.has(id) || !this.players.has(id) || this.players.get(id)!.passengerId) return false;
    if (!target) {
      this.selectedPickups.delete(id);
      return true;
    }
    const p = this.passengers.getPassengerMap().get(target);
    if (!p || !this.canCollect(id, p.id) || p.isCarried || (p.deadline > 0 && p.deadline <= this.tickCount))
      return false;
    this.selectedPickups.set(id, target);
    return true;
  }
  public getGameplayState(id: string): GameplayState | null {
    const p = this.players.get(id);
    if (!p) return null;
    const passenger = p.passengerId
      ? this.passengers.getPassengerMap().get(p.passengerId)
      : (this.passengers.getPassengerMap().get(this.selectedPickups.get(id) ?? '') ??
        [...this.passengers.getPassengerMap().values()]
          .filter((t) => this.canCollect(id, t.id) && !t.isCarried && (t.deadline === 0 || t.deadline > this.tickCount))
          .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0]);
    const offers = [...this.passengers.getPassengerMap().values()]
      .filter((t) => this.canCollect(id, t.id) && !t.isCarried && (t.deadline === 0 || t.deadline > this.tickCount))
      .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))
      .slice(0, 8)
      .map((t) => {
        const job = this.getJob(t);
        return {
          id: t.id,
          kind: job.kind,
          persona: job.persona,
          goalLabel: job.goalLabel,
          fare: calculateFare(
            t.reward,
            this.streakCounts.get(id) ?? 0,
            this.options.enhanced ? environmentMultiplier(this.life, t, this.isRushHour()) : 1,
            true,
            Math.floor(t.reward * 0.15),
          ),
          stops: job.stops.length,
        };
      });
    let navigation: GameplayState['navigation'] = null;
    let trip: GameplayState['trip'] = null;
    if (passenger) {
      const target = p.passengerId ? { x: passenger.destX, y: passenger.destY } : { x: passenger.x, y: passenger.y };
      const key = `${passenger.id}:${target.x}:${target.y}:${this.life.roadRevision}`;
      let cached = this.routeCache.get(id);
      if (!cached || cached.key !== key || Math.hypot(cached.from.x - p.x, cached.from.y - p.y) > 200) {
        cached = { key, from: { x: p.x, y: p.y }, route: this.getNavigationRoute(p, target) };
        this.routeCache.set(id, cached);
      }
      const route = [...cached.route];
      while (route.length > 2 && Math.hypot(route[1].x - p.x, route[1].y - p.y) < 70) route.shift();
      const job = this.options.enhanced ? this.getJob(passenger) : null;
      const fare = calculateFare(
        passenger.reward,
        this.streakCounts.get(id) ?? 0,
        this.options.enhanced ? environmentMultiplier(this.life, p, this.isRushHour()) : 1,
        !!this.options.enhanced && (!p.passengerId || !this.dirtyTrips.has(id)),
        job
          ? p.passengerId
            ? jobTip(passenger.reward, job, this.tickCount, this.dirtyTrips.has(id))
            : Math.floor(passenger.reward * 0.15)
          : 0,
      );
      navigation = {
        targetId: passenger.id,
        target,
        route,
        distance: route.reduce(
          (sum, n, i) => (i ? sum + Math.hypot(n.x - route[i - 1].x, n.y - route[i - 1].y) : sum),
          0,
        ),
        pickupExpiryTick: p.passengerId ? 0 : passenger.deadline,
        fare,
        tier: passenger.tier,
      };
      if (p.passengerId)
        trip = {
          passenger: { ...passenger },
          route,
          fare,
          clean: !this.dirtyTrips.has(id),
          pickedUpTick: this.pickupTicks.get(id) ?? this.tickCount,
          stopIndex: job?.stopIndex ?? 0,
          stops: job?.stops ?? [target],
          kind: job?.kind ?? 'passenger',
          dialogue: job?.dialogue ?? '',
          freshness: job ? freshness(job, this.tickCount) : 1,
          damage: job?.damage ?? 0,
          goalLabel: job?.goalLabel ?? '',
          persona: job?.persona ?? '',
          quickTicksRemaining: job ? Math.max(0, job.quickTicks - (this.tickCount - job.pickedUpTick)) : 0,
        };
    }
    return {
      version: 1,
      practice: this.practice.has(id),
      practiceCompleted: this.practiceCompleted.has(id),
      reservations: Object.fromEntries(this.reservations),
      tick: this.tickCount,
      city: this.getCityLife(),
      trip,
      navigation,
      offers,
      selectedPickup: this.selectedPickups.get(id) ?? null,
      comboTicksRemaining: this.lastDeliveryTicks.has(id)
        ? Math.max(0, STREAK_RESET_TICKS - (this.tickCount - this.lastDeliveryTicks.get(id)!))
        : 0,
      summary: structuredClone(this.summaries.get(id)!),
      cityRanking: this.getCityRanking(),
    };
  }

  public getCityRanking(includeBots = false) {
    return [...this.players.values()]
      .filter((p) => includeBots || !p.id.startsWith('bot-'))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, 10)
      .map((p) => ({
        id: p.id,
        username: p.username,
        score: p.score,
        deliveries: this.sessionDeliveries.get(p.id) ?? 0,
      }));
  }

  public getPlayerCount(): number {
    return [...this.players.values()].filter((p) => p.connected && !p.id.startsWith('bot-')).length;
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
    this.periods = progressionPeriods(this.options.now?.() ?? Date.now());
    this.advanceCity();
    for (const [id, target] of this.selectedPickups) {
      const p = this.passengers.getPassengerMap().get(target);
      if (!p || !this.canCollect(id, p.id) || p.isCarried || (p.deadline > 0 && p.deadline < this.tickCount))
        this.selectedPickups.delete(id);
    }
    this.cityFeatures.tick(this.tickCount, dt);

    // Auto-trigger rush hour on schedule
    if (!this.isRushHour() && this.tickCount >= this.nextRushHourTick) {
      this.triggerRushHour();
    }

    // Reset streaks for idle players
    this.reapIdleStreaks();

    // 1. Process player movements
    for (const [playerId, player] of this.players.entries()) {
      if (!player.connected) continue;
      const inputs = this.inputQueues.get(playerId) || [];
      const prevX = player.x;
      const prevY = player.y;

      const moveDx = 0;
      const moveDy = 0;
      let lastAngle = player.angle;
      let lastSeq = player.lastProcessedSeq;

      const stunnedUntilTick = this.stunnedUntilTicks.get(playerId) ?? 0;
      const isStunned = this.tickCount < stunnedUntilTick;

      // Drain input queue, applying each input across proportional time slices
      if (inputs.length > 0) {
        const stepDt = dt / inputs.length;
        while (inputs.length > 0) {
          const input = inputs.shift()!;
          lastAngle = input.angle;
          lastSeq = input.seq;

          if (!isStunned && (input.dx !== 0 || input.dy !== 0)) {
            const mag = Math.hypot(input.dx, input.dy);
            const throttle = Math.min(1, mag);
            const ndx = input.dx / mag;
            const ndy = input.dy / mag;

            const deltaX = ndx * MOTORBIKE_SPEED * movementConditions(this.life.rain).speed * throttle * stepDt;
            const deltaY = ndy * MOTORBIKE_SPEED * movementConditions(this.life.rain).speed * throttle * stepDt;

            const resolved = this.physics.resolveMove(player.x, player.y, player.x + deltaX, player.y + deltaY);
            player.x = resolved.x;
            player.y = resolved.y;
          }
        }
      }

      if (!isStunned) {
        player.angle = lastAngle;
      }
      player.lastProcessedSeq = lastSeq;

      // Update spatial index
      this.spatialGrid.update(player.id, player.x, player.y);

      const summary = this.summaries.get(playerId)!;
      const distance = Math.hypot(player.x - prevX, player.y - prevY);
      if (!this.practice.has(playerId)) summary.distance += distance;
      this.trackProgress(playerId, 'distance', distance);
      for (const landmark of LANDMARKS)
        if (
          !this.practice.has(playerId) &&
          !summary.visited.includes(landmark.id) &&
          Math.hypot(player.x - landmark.x, player.y - landmark.y) < 80
        )
          summary.visited.push(landmark.id);
      if (player.passengerId) {
        const passenger = this.passengers.getPassengerMap().get(player.passengerId);
        if (passenger && LANDMARKS.some((l) => Math.hypot(player.x - l.x, player.y - l.y) < 80))
          this.getJob(passenger).scenic = true;
      }
      if (!this.practice.has(playerId)) this.checkCityRuleInteractions(player, prevX, prevY);
    }

    // 1.5. Check player-to-player collisions
    const playerIds = [...this.players.values()].filter((p) => p.connected).map((p) => p.id);
    for (let i = 0; i < playerIds.length; i++) {
      for (let j = i + 1; j < playerIds.length; j++) {
        const p1 = this.players.get(playerIds[i])!;
        const p2 = this.players.get(playerIds[j])!;

        if (this.practice.has(p1.id) || this.practice.has(p2.id)) continue;
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
            const amount = Math.min(p1.score, DRIVER_COLLISION_PENALTY);
            p1.score -= amount;
            this.recordViolation(p1, 'driver-collision', DRIVER_COLLISION_PENALTY, amount);
            this.collisionCooldowns.set(p1.id, currentTick + PENALTY_COOLDOWN_TICKS);
          }

          const cooldown2 = this.collisionCooldowns.get(p2.id) || 0;
          if (currentTick > cooldown2) {
            const amount = Math.min(p2.score, DRIVER_COLLISION_PENALTY);
            p2.score -= amount;
            this.recordViolation(p2, 'driver-collision', DRIVER_COLLISION_PENALTY, amount);
            this.collisionCooldowns.set(p2.id, currentTick + PENALTY_COOLDOWN_TICKS);
          }
        }
      }
    }

    // Resolve fares only after every collision and violation for this tick.
    for (const player of this.players.values()) if (player.connected) this.checkPlayerInteractions(player);

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
    this.passengers.tick(this.tickCount, this.isRushHour(), this.life.event?.district);
    for (const id of this.jobs.keys()) if (!this.passengers.getPassengerMap().has(id)) this.jobs.delete(id);
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
          if (
            passenger &&
            this.canCollect(player.id, passenger.id) &&
            !passenger.isCarried &&
            (!this.selectedPickups.has(player.id) || this.selectedPickups.get(player.id) === passenger.id)
          ) {
            // Check radius
            const dx = passenger.x - player.x;
            const dy = passenger.y - player.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < COLLISION_RADIUS) {
              // Pick up!
              this.selectedPickups.delete(player.id);
              this.pickupTicks.set(player.id, this.tickCount);
              this.dirtyTrips.delete(player.id);
              player.passengerId = passenger.id;
              passenger.isCarried = true;
              if (this.options.enhanced) {
                const job = this.getJob(passenger);
                job.pickedUpTick = this.tickCount;
                job.stopIndex = 0;
                job.damage = 0;
                job.scenic = false;
                passenger.destX = job.stops[0].x;
                passenger.destY = job.stops[0].y;
              }
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
          if (this.practice.get(player.id) === passenger.id) {
            this.practice.delete(player.id);
            this.practiceCompleted.add(player.id);
            this.reservations.delete(passenger.id);
            this.jobs.delete(passenger.id);
            this.passengers.remove(passenger.id);
            player.passengerId = null;
            this.pickupTicks.delete(player.id);
            this.dirtyTrips.delete(player.id);
            return;
          }
          const job = this.options.enhanced ? this.getJob(passenger) : null;
          if (job && job.stopIndex < job.stops.length - 1) {
            job.stopIndex++;
            passenger.destX = job.stops[job.stopIndex].x;
            passenger.destY = job.stops[job.stopIndex].y;
            this.routeCache.delete(player.id);
            return;
          }
          // Success! Apply streak multiplier to reward
          const streak = this.streakCounts.get(player.id) ?? 0;
          const multiplier = getStreakMultiplier(streak);
          const fare = calculateFare(
            passenger.reward,
            streak,
            this.options.enhanced ? environmentMultiplier(this.life, player, this.isRushHour()) : 1,
            !!this.options.enhanced && !this.dirtyTrips.has(player.id),
            job ? jobTip(passenger.reward, job, this.tickCount, this.dirtyTrips.has(player.id)) : 0,
          );
          const reward = this.options.enhanced ? fare.total : Math.floor(passenger.reward * multiplier);

          this.trackProgress(player.id, 'deliveries');
          this.trackProgress(player.id, job?.kind ?? 'passenger');
          this.trackProgress(player.id, districtAt(player).id);
          if (!this.dirtyTrips.has(player.id)) this.trackProgress(player.id, 'clean');
          if (this.life.rain) this.trackProgress(player.id, 'rain');
          if (this.life.phase === 'night') this.trackProgress(player.id, 'night');
          if (fare.tip > 0) this.trackProgress(player.id, 'tipped');
          player.score += reward;
          const summary = this.summaries.get(player.id)!;
          summary.baseFares += passenger.reward;
          summary.tips += this.options.enhanced ? fare.tip : 0;
          summary.bonuses += reward - passenger.reward - (this.options.enhanced ? fare.tip : 0);
          if (!this.dirtyTrips.has(player.id)) summary.cleanTrips++;
          const duration = Math.max(1, this.tickCount - (this.pickupTicks.get(player.id) ?? this.tickCount));
          summary.fastestTripTicks = summary.fastestTripTicks ? Math.min(summary.fastestTripTicks, duration) : duration;

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

          this.jobs.delete(passenger.id);
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
        const amount = Math.min(player.score, RED_LIGHT_PENALTY);
        player.score -= amount;
        this.recordViolation(player, 'red-light', RED_LIGHT_PENALTY, amount);
        this.redLightCooldowns.set(player.id, currentTick + PENALTY_COOLDOWN_TICKS);
      }
    }

    const hitPedestrianId = this.cityFeatures.getHitPedestrianId(player.x, player.y);
    if (hitPedestrianId) {
      const cooldown = this.pedestrianCooldowns.get(player.id) || 0;
      if (currentTick > cooldown) {
        const amount = Math.min(player.score, PEDESTRIAN_PENALTY);
        player.score -= amount;
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

  private recordViolation(player: PlayerState, type: ViolationType, amount: number, charged = amount): void {
    this.summaries.get(player.id)!.fines += charged;
    if (player.passengerId) {
      this.dirtyTrips.add(player.id);
      const job = this.jobs.get(player.passengerId);
      if (job && type !== 'red-light') job.damage = Math.min(1, job.damage + 0.25);
    }
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

    // Make sure the player sees themselves (clone to prevent in-place mutation breaking delta encoding)
    visiblePlayers.push({ ...player });

    for (const entityId of nearbyEntityIds) {
      if (entityId === targetPlayerId) continue;

      if (entityId.startsWith('pass-')) {
        const passenger = passMap.get(entityId);
        if (passenger && !passenger.isCarried) {
          visiblePassengers.push({ ...passenger });
        }
      } else {
        const otherPlayer = this.players.get(entityId);
        if (otherPlayer) {
          visiblePlayers.push({ ...otherPlayer });
        }
      }
    }

    // Also include the passenger currently carried by the player so the client can render their destination line
    if (player.passengerId) {
      const carried = passMap.get(player.passengerId);
      if (carried) {
        visiblePassengers.push({ ...carried });
      }
    }

    return {
      players: visiblePlayers,
      passengers: visiblePassengers,
      trafficLights: this.cityFeatures.getVisibleTrafficLights(player.x, player.y, CITY_VISIBILITY_RADIUS),
      pedestrians: this.cityFeatures
        .getVisiblePedestrians(player.x, player.y, CITY_VISIBILITY_RADIUS)
        .map((p) => ({ ...p })),
      rushHour: this.isRushHour(),
      streaks: this.getAllStreaks(),
    };
  }
}
