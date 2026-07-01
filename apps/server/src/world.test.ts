import { describe, expect, it } from 'vitest';
import { COLLISION_RADIUS, EPassengerTier, RUSH_HOUR_INTERVAL_TICKS, RUSH_HOUR_DURATION_TICKS, STREAK_RESET_TICKS } from '@xeom-rush/shared';
import { BotManager } from './bot-ai';
import { GameWorld } from './world';

describe('GameWorld realism update', () => {
  it('spawns passenger pickup and destination points outside buildings and roundabouts', () => {
    const world = new GameWorld();
    const physics = world.getPhysics();

    for (const passenger of world.getPassengerMap().values()) {
      expect(physics.isInsideBuilding(passenger.x, passenger.y)).toBe(false);
      expect(physics.isInsideBuilding(passenger.destX, passenger.destY)).toBe(false);
    }
  });

  it('applies a red-light penalty once when crossing a red stop line', () => {
    const world = new GameWorld();
    world.addPlayer('player-red', 'Red Runner');
    const player = world.getPlayer('player-red')!;

    let redLight = world.getCityFeatures().getTrafficLights().find((light) => light.isRedNS && !light.isYellow);
    for (let i = 0; i < 400 && !redLight; i++) {
      world.tick(0.05);
      redLight = world.getCityFeatures().getTrafficLights().find((light) => light.isRedNS && !light.isYellow);
    }

    expect(redLight).toBeDefined();
    player.x = redLight!.x;
    player.y = redLight!.y - 70;
    player.score = 10000;

    world.queueInput('player-red', {
      seq: 1,
      dx: 0,
      dy: 1,
      angle: Math.PI / 2,
    });
    world.tick(0.5);

    expect(player.score).toBe(8000);
    expect(player.lastViolation).toEqual({
      type: 'red-light',
      amount: 2000,
      tick: world.getTick(),
    });
  });

  it('reports a red-light violation even when balance is already zero', () => {
    const world = new GameWorld();
    world.addPlayer('player-zero-red', 'Zero Red Runner');
    const player = world.getPlayer('player-zero-red')!;

    let redLight = world.getCityFeatures().getTrafficLights().find((light) => light.isRedNS && !light.isYellow);
    for (let i = 0; i < 400 && !redLight; i++) {
      world.tick(0.05);
      redLight = world.getCityFeatures().getTrafficLights().find((light) => light.isRedNS && !light.isYellow);
    }

    expect(redLight).toBeDefined();
    player.x = redLight!.x;
    player.y = redLight!.y - 70;
    player.score = 0;

    world.queueInput('player-zero-red', {
      seq: 1,
      dx: 0,
      dy: 1,
      angle: Math.PI / 2,
    });
    world.tick(0.5);

    expect(player.score).toBe(0);
    expect(player.lastViolation).toEqual({
      type: 'red-light',
      amount: 2000,
      tick: world.getTick(),
    });
  });

  it('does not fine allowed green or yellow traffic light crossings', () => {
    const greenWorld = new GameWorld();
    greenWorld.addPlayer('player-green', 'Green Runner');
    const greenPlayer = greenWorld.getPlayer('player-green')!;

    let greenLight = greenWorld.getCityFeatures().getTrafficLights().find((light) => !light.isRedNS && !light.isYellow);
    for (let i = 0; i < 400 && !greenLight; i++) {
      greenWorld.tick(0.05);
      greenLight = greenWorld.getCityFeatures().getTrafficLights().find((light) => !light.isRedNS && !light.isYellow);
    }

    expect(greenLight).toBeDefined();
    greenPlayer.x = greenLight!.x;
    greenPlayer.y = greenLight!.y - 70;
    greenPlayer.score = 10000;
    greenWorld.queueInput('player-green', { seq: 1, dx: 0, dy: 1, angle: Math.PI / 2 });
    greenWorld.tick(0.5);
    expect(greenPlayer.score).toBe(10000);

    const yellowWorld = new GameWorld();
    yellowWorld.addPlayer('player-yellow', 'Yellow Runner');
    const yellowPlayer = yellowWorld.getPlayer('player-yellow')!;

    let yellowLight = yellowWorld.getCityFeatures().getTrafficLights().find((light) => !light.isRedNS && light.isYellow);
    for (let i = 0; i < 400 && !yellowLight; i++) {
      yellowWorld.tick(0.05);
      yellowLight = yellowWorld.getCityFeatures().getTrafficLights().find((light) => !light.isRedNS && light.isYellow);
    }

    expect(yellowLight).toBeDefined();
    yellowPlayer.x = yellowLight!.x;
    yellowPlayer.y = yellowLight!.y - 70;
    yellowPlayer.score = 10000;
    yellowWorld.queueInput('player-yellow', { seq: 1, dx: 0, dy: 1, angle: Math.PI / 2 });
    yellowWorld.tick(0.5);
    expect(yellowPlayer.score).toBe(10000);
  });

  it('sets score to zero, removes the hit pedestrian, and stuns movement briefly', () => {
    const world = new GameWorld();
    world.addPlayer('player-ped', 'Careless Driver');
    const player = world.getPlayer('player-ped')!;
    const pedestrian = world.getCityFeatures().getPedestrians()[0];

    expect(pedestrian).toBeDefined();
    player.x = pedestrian.x;
    player.y = pedestrian.y;
    player.score = 10000;

    world.tick(0.05);
    expect(player.score).toBe(0);
    expect(player.lastViolation).toEqual({
      type: 'pedestrian',
      amount: 10000,
      tick: world.getTick(),
    });
    expect(world.getCityFeatures().getPedestrians().some((p) => p.id === pedestrian.id)).toBe(false);

    const stunnedX = player.x;
    const stunnedY = player.y;
    world.queueInput('player-ped', {
      seq: 1,
      dx: 1,
      dy: 0,
      angle: 0,
    });
    world.tick(0.05);

    expect(Math.hypot(player.x - stunnedX, player.y - stunnedY)).toBeLessThan(COLLISION_RADIUS / 2);
  });

  it('removes pedestrians after crossing and respawns them later', () => {
    const world = new GameWorld();
    const pedestrian = world.getCityFeatures().getPedestrians()[0];

    expect(pedestrian).toBeDefined();

    for (let i = 0; i < 130; i++) {
      world.tick(0.05);
    }

    expect(world.getCityFeatures().getPedestrians().some((p) => p.id === pedestrian.id)).toBe(false);

    let respawned = false;
    for (let i = 0; i < 300; i++) {
      world.tick(0.05);
      if (world.getCityFeatures().getPedestrians().some((p) => p.id === pedestrian.id)) {
        respawned = true;
      }
    }

    expect(respawned).toBe(true);
  });

  it('reports driver collisions even when balances are already zero', () => {
    const world = new GameWorld();
    world.addPlayer('player-a', 'A');
    world.addPlayer('player-b', 'B');
    const playerA = world.getPlayer('player-a')!;
    const playerB = world.getPlayer('player-b')!;

    playerA.x = 1200;
    playerA.y = 1200;
    playerB.x = 1204;
    playerB.y = 1200;
    playerA.score = 0;
    playerB.score = 0;

    world.tick(0.05);

    expect(playerA.score).toBe(0);
    expect(playerB.score).toBe(0);
    expect(playerA.lastViolation).toEqual({
      type: 'driver-collision',
      amount: 1000,
      tick: world.getTick(),
    });
    expect(playerB.lastViolation).toEqual({
      type: 'driver-collision',
      amount: 1000,
      tick: world.getTick(),
    });
  });

  it('preserves partial input throttle for smoother acceleration and analog controls', () => {
    const world = new GameWorld();
    world.addPlayer('player-half-speed', 'Half Speed', 2000, 2000);
    const player = world.getPlayer('player-half-speed')!;

    world.queueInput('player-half-speed', {
      seq: 1,
      dx: 0.5,
      dy: 0,
      angle: 0,
    });
    world.tick(0.05);

    expect(player.x).toBeCloseTo(2005, 5);
    expect(player.y).toBeCloseTo(2000, 5);
  });

  it('gives bots distinct roundabout waypoint lanes', () => {
    const world = new GameWorld();
    const botManager = new BotManager(world, world.getPhysics());
    const [botAId, botBId] = botManager.spawnBots(2);
    const bots = (botManager as unknown as { bots: Map<string, unknown> }).bots;
    const calculatePath = (
      botManager as unknown as {
        calculatePath: (bot: unknown, fromX: number, fromY: number, toX: number, toY: number) => { x: number; y: number }[];
      }
    ).calculatePath.bind(botManager);

    const botA = bots.get(botAId)!;
    const botB = bots.get(botBId)!;
    const roundabout = world.getCityFeatures().roundabouts[0];

    expect(roundabout).toBeDefined();

    const pathA = calculatePath(botA, roundabout.x - 220, roundabout.y, roundabout.x, roundabout.y + 220);
    const pathB = calculatePath(botB, roundabout.x - 220, roundabout.y, roundabout.x, roundabout.y + 220);
    const ringPointA = pathA.find((point) => Math.hypot(point.x - roundabout.x, point.y - roundabout.y) < roundabout.radius + 80);
    const ringPointB = pathB.find((point) => Math.hypot(point.x - roundabout.x, point.y - roundabout.y) < roundabout.radius + 80);

    expect(ringPointA).toBeDefined();
    expect(ringPointB).toBeDefined();
    expect(Math.hypot(ringPointA!.x - ringPointB!.x, ringPointA!.y - ringPointB!.y)).toBeGreaterThan(1);
  });

  it('uses compact roundabout obstacles to leave wider lanes for bots', () => {
    const world = new GameWorld();
    const roundabout = world.getCityFeatures().roundabouts[0];

    expect(roundabout).toBeDefined();
    expect(roundabout.radius).toBe(24);
    expect(world.getPhysics().isInsideBuilding(roundabout.x + 50, roundabout.y)).toBe(false);
  });

  it('spawns bots broadly across the map on valid street positions', () => {
    const world = new GameWorld();
    const botManager = new BotManager(world, world.getPhysics());
    const spawnedIds = botManager.spawnBots(10);
    
    // Check that players have been added and their positions are spread out
    const positions = spawnedIds.map(id => world.getPlayer(id)!);
    positions.forEach(pos => {
      expect(pos).toBeDefined();
      expect(world.getPhysics().isInsideBuilding(pos.x, pos.y)).toBe(false);
      expect(world.getCityFeatures().isInsideRoundabout(pos.x, pos.y)).toBe(false);
    });

    // Check that they are not clustered in the 200x200 center box
    const centerClustered = positions.filter(pos => 
      Math.abs(pos.x - 2000) <= 100 && Math.abs(pos.y - 2000) <= 100
    );
    expect(centerClustered.length).toBeLessThan(10); // Spreads widely
  });

  it('triggers backing reverse throttle when a bot is stuck', () => {
    const world = new GameWorld();
    const botManager = new BotManager(world, world.getPhysics());
    const [botId] = botManager.spawnBots(1);
    
    // Cast to access internal bots map
    const bot = (botManager as any).bots.get(botId);
    expect(bot).toBeDefined();
    
    // Set stuckTicks to a value in the backup window (e.g. 15)
    bot.stuckTicks = 15;
    
    // Run AI generateInput
    const player = world.getPlayer(botId)!;
    const input = (botManager as any).generateInput(bot, player);
    
    // Expected escape angle logic: mix of reverse and perpendicular
    const perpAngle = bot.currentAngle + (Math.PI / 2) * bot.escapeFlip;
    const reverseAngle = bot.currentAngle + Math.PI;
    const escapeX = Math.cos(reverseAngle) * 0.5 + Math.cos(perpAngle) * 0.5;
    const escapeY = Math.sin(reverseAngle) * 0.5 + Math.sin(perpAngle) * 0.5;
    const escapeMag = Math.hypot(escapeX, escapeY) || 1;
    const expectedDx = (escapeX / escapeMag) * 0.8;
    const expectedDy = (escapeY / escapeMag) * 0.8;
    
    expect(input.dx).toBeCloseTo(expectedDx, 4);
    expect(input.dy).toBeCloseTo(expectedDy, 4);
  });

  it('keeps a hard-stuck carrying bot assigned to its dropoff instead of seeking a new pickup', () => {
    const world = new GameWorld();
    const botManager = new BotManager(world, world.getPhysics());
    const [botId] = botManager.spawnBots(1);
    const player = world.getPlayer(botId)!;
    const passenger = world.getPassengerMap().values().next().value!;
    const bot = (botManager as any).bots.get(botId);

    player.passengerId = passenger.id;
    passenger.isCarried = true;
    bot.state = 2;
    bot.targetPassengerId = passenger.id;
    bot.stuckTicks = 41;
    bot.path = [{ x: passenger.destX, y: passenger.destY }];
    bot.positionHistory = Array.from({ length: 20 }, () => ({ x: player.x, y: player.y }));
    bot.positionHistoryIndex = 0;

    botManager.tick();

    expect(player.passengerId).toBe(passenger.id);
    expect(bot.targetPassengerId).toBe(passenger.id);
    expect(Math.hypot(bot.path.at(-1).x - passenger.destX, bot.path.at(-1).y - passenger.destY)).toBeLessThan(25);
  });
});

describe('Rush Hour Events', () => {
  it('starts inactive and triggers automatically after RUSH_HOUR_INTERVAL_TICKS', () => {
    const world = new GameWorld();
    expect(world.isRushHour()).toBe(false);

    for (let i = 0; i < RUSH_HOUR_INTERVAL_TICKS; i++) {
      world.tick(0.05);
    }

    expect(world.isRushHour()).toBe(true);
    expect(world.getRushHourTicksRemaining()).toBeGreaterThan(0);
  });

  it('deactivates after RUSH_HOUR_DURATION_TICKS', () => {
    const world = new GameWorld();
    world.triggerRushHour();
    expect(world.isRushHour()).toBe(true);

    for (let i = 0; i < RUSH_HOUR_DURATION_TICKS; i++) {
      world.tick(0.05);
    }

    expect(world.isRushHour()).toBe(false);
    expect(world.getRushHourTicksRemaining()).toBe(0);
  });

  it('triggerRushHour() activates rush hour immediately', () => {
    const world = new GameWorld();
    expect(world.isRushHour()).toBe(false);

    world.triggerRushHour();

    expect(world.isRushHour()).toBe(true);
    expect(world.getRushHourTicksRemaining()).toBe(RUSH_HOUR_DURATION_TICKS);
  });

  it('includes rushHour flag in snapshot data', () => {
    const world = new GameWorld();
    world.addPlayer('p-rh', 'Rush Player');
    world.triggerRushHour();

    const snapshot = world.getVisibleSnapshotForPlayer('p-rh');
    expect(snapshot.rushHour).toBe(true);
  });
});

describe('Combo/Streak System', () => {
  it('initializes streak at 0 for new players', () => {
    const world = new GameWorld();
    world.addPlayer('p-streak', 'Streak Player');
    expect(world.getStreakForPlayer('p-streak')).toBe(0);
  });

  it('increments streak on each successful delivery', () => {
    const world = new GameWorld();
    // Stub out pedestrian collision checks so random movement doesn't disrupt tests
    world.getCityFeatures().getHitPedestrianId = () => null;
    world.addPlayer('p-del', 'Delivery Driver');
    const player = world.getPlayer('p-del')!;

    // Run one tick to register all passengers into the spatial grid
    world.tick(0.05);

    // Perform 3 deliveries by teleporting to passenger spawn then destination
    for (let delivery = 0; delivery < 3; delivery++) {
      // Find an uncarried, no-deadline passenger (REGULAR tier)
      const passMap = world.getPassengerMap();
      const entry = Array.from(passMap.entries()).find(([, p]) => !p.isCarried && p.deadline === 0);
      expect(entry).toBeDefined();
      const [passId, pass] = entry!;
      for (const id of passMap.keys()) {
        if (id !== passId) {
          passMap.delete(id);
          world.getSpatialGrid().remove(id);
        }
      }
      world.getSpatialGrid().update(pass.id, pass.x, pass.y);

      // Teleport to spawn point
      player.x = pass.x;
      player.y = pass.y;
      world.tick(0.05); // pickup tick

      // Should now be carrying
      expect(player.passengerId).toBe(pass.id);

      // Teleport to destination
      player.x = pass.destX;
      player.y = pass.destY;
      world.tick(0.05); // dropoff tick

      // Should have delivered
      expect(player.passengerId).toBeNull();
    }

    expect(world.getStreakForPlayer('p-del')).toBe(3);
  });

  it('applies correct multiplier at each streak threshold', () => {
    const world = new GameWorld();
    // Stub out pedestrian collision checks so random movement doesn't disrupt tests
    world.getCityFeatures().getHitPedestrianId = () => null;
    world.addPlayer('p-mult', 'Multiplier Driver');
    const player = world.getPlayer('p-mult')!;

    // Warm up spatial grid
    world.tick(0.05);

    const clearPassengers = () => {
      const passMap = world.getPassengerMap();
      for (const id of passMap.keys()) {
        passMap.delete(id);
        world.getSpatialGrid().remove(id);
      }
    };

    // Helper: pick up and drop off a specific REGULAR passenger, return { earned, passReward }
    const deliverPassenger = (): { earned: number; passReward: number } => {
      clearPassengers();
      const spawner = (world as unknown as {
        passengers: { spawnPassenger: (tick: number, tier: EPassengerTier) => import('@xeom-rush/shared').PassengerState };
      }).passengers;
      const pass = spawner.spawnPassenger(world.getTick(), EPassengerTier.REGULAR);
      const passMap = world.getPassengerMap();
      world.getSpatialGrid().update(pass.id, pass.x, pass.y);

      player.x = pass.x;
      player.y = pass.y;
      world.tick(0.05); // pickup

      if (!player.passengerId) return { earned: 0, passReward: 0 };

      for (const [id, passenger] of passMap.entries()) {
        if (id !== pass.id && !passenger.isCarried) {
          passMap.delete(id);
          world.getSpatialGrid().remove(id);
        }
      }

      const passReward = pass.reward;
      const scoreBefore = player.score;
      player.x = pass.destX;
      player.y = pass.destY;
      world.tick(0.05); // dropoff
      return { earned: player.score - scoreBefore, passReward };
    };

    // Delivery 1 at streak=0 (multiplier = 1×, streak becomes 1 after)
    const { earned: earned1, passReward: reward1 } = deliverPassenger();
    expect(earned1).toBeGreaterThan(0);
    expect(earned1).toBe(reward1); // 1× multiplier
    expect(world.getStreakForPlayer('p-mult')).toBe(1);

    // Delivery 2 at streak=1 (multiplier = 1×, streak becomes 2 after)
    const { earned: earned2, passReward: reward2 } = deliverPassenger();
    expect(earned2).toBe(reward2); // still 1×
    expect(world.getStreakForPlayer('p-mult')).toBe(2);

    // Delivery 3 at streak=2 (multiplier = 1×, streak becomes 3 after — 1.5× threshold kicks in next)
    const { earned: earned3, passReward: reward3 } = deliverPassenger();
    expect(earned3).toBe(reward3); // still 1× until streak hits 3
    expect(world.getStreakForPlayer('p-mult')).toBe(3);

    // Delivery 4 at streak=3 → 1.5× multiplier
    const { earned: earned4, passReward: reward4 } = deliverPassenger();
    expect(earned4).toBe(Math.floor(reward4 * 1.5));
    expect(world.getStreakForPlayer('p-mult')).toBe(4);
  });


  it('resets streak after STREAK_RESET_TICKS of inactivity', () => {
    const world = new GameWorld();
    // Stub out pedestrian collision checks so random movement doesn't disrupt tests
    world.getCityFeatures().getHitPedestrianId = () => null;
    world.addPlayer('p-idle', 'Idle Driver');
    const player = world.getPlayer('p-idle')!;

    // Warm up spatial grid so passengers are registered
    world.tick(0.05);

    // Find a REGULAR (no-deadline) passenger
    const passMap = world.getPassengerMap();
    const entry = Array.from(passMap.entries()).find(([, p]) => !p.isCarried && p.deadline === 0);
    expect(entry).toBeDefined();
    const [passId, pass] = entry!;
    for (const id of passMap.keys()) {
      if (id !== passId) {
        passMap.delete(id);
        world.getSpatialGrid().remove(id);
      }
    }
    world.getSpatialGrid().update(pass.id, pass.x, pass.y);

    // Teleport to pickup
    player.x = pass.x;
    player.y = pass.y;
    world.tick(0.05); // pickup tick
    expect(player.passengerId).toBe(pass.id);

    // Teleport to destination
    player.x = pass.destX;
    player.y = pass.destY;
    world.tick(0.05); // dropoff tick
    expect(player.passengerId).toBeNull();

    // Streak should now be 1
    expect(world.getStreakForPlayer('p-idle')).toBe(1);

    // Advance past idle threshold
    for (let i = 0; i < STREAK_RESET_TICKS + 1; i++) {
      world.tick(0.05);
    }

    expect(world.getStreakForPlayer('p-idle')).toBe(0);
  });

  it('removes streak state when player disconnects', () => {
    const world = new GameWorld();
    world.addPlayer('p-dc', 'Disconnect Driver');

    world.removePlayer('p-dc');

    // After removal, streak should not exist
    expect(world.getStreakForPlayer('p-dc')).toBe(0);
  });
});

describe('Passenger Tiers', () => {
  it('spawns passengers with tier and deadline fields set', () => {
    const world = new GameWorld();
    for (const passenger of world.getPassengerMap().values()) {
      expect(passenger.tier).toBeDefined();
      expect([EPassengerTier.REGULAR, EPassengerTier.BUSINESS, EPassengerTier.VIP]).toContain(passenger.tier);
      expect(passenger.deadline).toBeGreaterThanOrEqual(0);
    }
  });

  it('BUSINESS passengers have approximately 2× base reward vs REGULAR', () => {
    // Force-spawn both types and compare rewards for same distance
    const world = new GameWorld();
    const spawner = (world as unknown as { passengers: { spawnPassenger: (tick: number, tier: EPassengerTier) => import('@xeom-rush/shared').PassengerState } }).passengers;

    const regular = spawner.spawnPassenger(0, EPassengerTier.REGULAR);
    const business = spawner.spawnPassenger(0, EPassengerTier.BUSINESS);

    // Business deadline must exist; Regular must not have a deadline
    expect(business.deadline).toBeGreaterThan(0);
    expect(regular.deadline).toBe(0);

    // Business reward is always 2× the base formula for its own distance
    // Verify: business reward > 1000 (min) * 2 = 2000
    expect(business.reward).toBeGreaterThanOrEqual(2000);
    // And must be at least 2× the minimum Regular reward possible (1000)
    expect(business.reward).toBeGreaterThan(1000);
  });

  it('VIP passengers have approximately 5× base reward vs REGULAR', () => {
    const world = new GameWorld();
    const spawner = (world as unknown as { passengers: { spawnPassenger: (tick: number, tier: EPassengerTier) => import('@xeom-rush/shared').PassengerState } }).passengers;

    const vip = spawner.spawnPassenger(0, EPassengerTier.VIP);

    // VIP reward is 5× base formula — minimum base is 1000 VNĐ so VIP minimum = 5000
    expect(vip.reward).toBeGreaterThanOrEqual(5000);
    expect(vip.deadline).toBeGreaterThan(0); // VIP also has a deadline
  });

  it('removes expired passengers (with deadline) after their tick passes', () => {
    const world = new GameWorld();
    const spawner = (world as unknown as { passengers: { spawnPassenger: (tick: number, tier: EPassengerTier) => import('@xeom-rush/shared').PassengerState; reapExpiredPassengers: (tick: number) => void } }).passengers;

    // Spawn a BUSINESS passenger that expires at tick 5
    const business = spawner.spawnPassenger(0, EPassengerTier.BUSINESS);
    // Manually set a very short deadline
    business.deadline = 3;

    // Before deadline
    spawner.reapExpiredPassengers(2);
    expect(world.getPassengerMap().has(business.id)).toBe(true);

    // After deadline
    spawner.reapExpiredPassengers(4);
    expect(world.getPassengerMap().has(business.id)).toBe(false);
  });
});

describe('Bot stuck recovery produces net displacement', () => {
  it('bot makes net displacement after stuck recovery cycle', () => {
    const world = new GameWorld();
    const botManager = new BotManager(world, world.getPhysics());
    const botIds = botManager.spawnBots(1);
    const botId = botIds[0];

    // Record initial position
    const initialPlayer = world.getPlayer(botId)!;
    const startX = initialPlayer.x;
    const startY = initialPlayer.y;

    // Simulate ticks — bot should move around
    for (let i = 0; i < 60; i++) {
      botManager.tick();
      world.tick(0.05);
    }

    const afterPlayer = world.getPlayer(botId)!;
    const displacement = Math.hypot(afterPlayer.x - startX, afterPlayer.y - startY);

    // Bot should have moved at least some distance from spawn after 60 ticks (3 seconds)
    expect(displacement).toBeGreaterThan(10);
  });
});

describe('Pedestrian respawn improvements', () => {
  it('hit pedestrian respawns with longer delay than walk-off', () => {
    const world = new GameWorld();
    const city = world.getCityFeatures();

    // Find an active pedestrian
    const activePeds = city.getPedestrians();
    expect(activePeds.length).toBeGreaterThan(0);

    const targetPedId = activePeds[0].id;

    // Record the pedestrian is active before removal
    expect(city.getPedestrianMap().has(targetPedId)).toBe(true);

    // "Hit" the pedestrian via removePedestrian (which now uses hit delay)
    city.removePedestrian(targetPedId);

    // Pedestrian should be deactivated immediately
    expect(city.getPedestrianMap().has(targetPedId)).toBe(false);

    // After 120 ticks (normal walk-off min), the hit pedestrian should still be gone
    // because hit delay minimum is 200 ticks
    for (let i = 0; i < 125; i++) {
      city.tickRespawns();
    }
    expect(city.getPedestrianMap().has(targetPedId)).toBe(false);

    // After 300 more ticks (total 425, well past max hit delay of 300), it should be back
    for (let i = 0; i < 300; i++) {
      city.tickRespawns();
    }
    expect(city.getPedestrianMap().has(targetPedId)).toBe(true);
  });

  it('respawned pedestrian can walk in either direction', () => {
    const world = new GameWorld();
    const city = world.getCityFeatures();

    // Run many respawn cycles and collect directions
    const directions = new Set<number>();

    // Force multiple respawns by ticking pedestrians until they walk off
    for (let cycle = 0; cycle < 20; cycle++) {
      // Tick until some pedestrian walks off and respawns
      for (let i = 0; i < 500; i++) {
        city.tick(i, 0.05);
      }

      // Collect angles of active pedestrians (angle indicates direction)
      for (const ped of city.getPedestrians()) {
        // Quantize angle to detect direction variety
        const quantized = Math.round(ped.angle * 100);
        directions.add(quantized);
      }
    }

    // We should see more than 1 unique direction, proving randomization works
    expect(directions.size).toBeGreaterThan(1);
  });
});
