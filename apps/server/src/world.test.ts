import { describe, expect, it } from 'vitest';
import { COLLISION_RADIUS } from '@xeom-rush/shared';
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

    for (let i = 0; i < 130; i++) {
      world.tick(0.05);
    }

    expect(world.getCityFeatures().getPedestrians().some((p) => p.id === pedestrian.id)).toBe(true);
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
});
