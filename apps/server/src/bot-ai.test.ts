import { describe, it, expect, beforeEach } from 'vitest';
import { GameWorld } from './world';
import { PhysicsEngine } from './physics';
import { BotManager } from './bot-ai';

describe('BotManager - Roundabout Navigation & Anti-Clustering', () => {
  let world: GameWorld;
  let physics: PhysicsEngine;
  let botManager: BotManager;

  beforeEach(() => {
    world = new GameWorld();
    physics = world.getPhysics();
    botManager = new BotManager(world, physics);
  });

  it('generates path waypoints that never collide with roundabout center obstacles', () => {
    const roundabouts = world.getCityFeatures().roundabouts;
    expect(roundabouts.length).toBeGreaterThan(0);

    const r = roundabouts[0];
    const spawnedIds = botManager.spawnBots(1);
    const botId = spawnedIds[0];
    const bot = (botManager as unknown as { bots: Map<string, any> }).bots.get(botId);
    expect(bot).toBeDefined();

    // Test paths entering from all 4 directions across the roundabout:
    // West to East
    const pathWE = (botManager as any).calculatePath(bot, r.x - 400, r.y, r.x + 400, r.y);
    for (const wp of pathWE) {
      const dist = Math.hypot(wp.x - r.x, wp.y - r.y);
      // Waypoint must never be inside the center obstacle (radius 24) or collision threshold (39)
      if (Math.hypot(wp.x - (r.x + 400), wp.y - r.y) > 50 && Math.hypot(wp.x - (r.x - 400), wp.y - r.y) > 50) {
        expect(dist).toBeGreaterThanOrEqual(39);
        expect(dist).toBeLessThanOrEqual(50);
      }
    }

    // North to South
    const pathNS = (botManager as any).calculatePath(bot, r.x, r.y - 400, r.x, r.y + 400);
    for (const wp of pathNS) {
      const dist = Math.hypot(wp.x - r.x, wp.y - r.y);
      if (Math.hypot(wp.x - r.x, wp.y - (r.y + 400)) > 50 && Math.hypot(wp.x - r.x, wp.y - (r.y - 400)) > 50) {
        expect(dist).toBeGreaterThanOrEqual(39);
        expect(dist).toBeLessThanOrEqual(50);
      }
    }
  });

  it('correctly paths when bot starts at or near the roundabout without snapping to center', () => {
    const roundabouts = world.getCityFeatures().roundabouts;
    const r = roundabouts[0];

    const spawnedIds = botManager.spawnBots(1);
    const botId = spawnedIds[0];
    const bot = (botManager as unknown as { bots: Map<string, any> }).bots.get(botId);

    // Bot is currently positioned on the roundabout ring (e.g. at radius 43)
    const fromX = r.x + 43;
    const fromY = r.y;
    const toX = r.x - 400;
    const toY = r.y;

    const path = (botManager as any).calculatePath(bot, fromX, fromY, toX, toY);
    expect(path.length).toBeGreaterThan(0);

    for (const wp of path) {
      // None of the waypoints should be at the center (r.x, r.y)
      const dist = Math.hypot(wp.x - r.x, wp.y - r.y);
      if (Math.hypot(wp.x - toX, wp.y - toY) > 50) {
        expect(dist).toBeGreaterThanOrEqual(38);
      }
    }
  });

  it('circulates counter-clockwise through the roundabout', () => {
    const roundabouts = world.getCityFeatures().roundabouts;
    const r = roundabouts[0];

    const spawnedIds = botManager.spawnBots(1);
    const botId = spawnedIds[0];
    const bot = (botManager as unknown as { bots: Map<string, any> }).bots.get(botId);

    // Path from West (r.x - 400) to East (r.x + 400)
    const path = (botManager as any).calculatePath(bot, r.x - 400, r.y, r.x + 400, r.y);
    const ringWaypoints = path.filter((wp: any) => {
      const dist = Math.hypot(wp.x - r.x, wp.y - r.y);
      return dist < 55;
    });

    expect(ringWaypoints.length).toBeGreaterThanOrEqual(3);
    // In right-hand traffic from West to East, the vehicle passes through the South side (y > r.y)
    for (const wp of ringWaypoints) {
      expect(wp.y).toBeGreaterThan(r.y);
    }
  });

  it('simulates multiple bots over 100 ticks without clustering at roundabouts', () => {
    botManager.spawnBots(15);
    expect(botManager.getBotCount()).toBe(15);

    for (let t = 0; t < 100; t++) {
      botManager.tick();
      world.tick(0.05);
    }

    const roundabouts = world.getCityFeatures().roundabouts;
    // Check that no single roundabout has more than 3 bots trapped around it
    for (const r of roundabouts) {
      const botsNearby = (botManager as any).countNearbyBots(r.x, r.y);
      expect(botsNearby).toBeLessThan(4);
    }

    const stats = botManager.getStats();
    // Vast majority of bots should be active, not permanently stuck
    expect(stats.stuckCount).toBeLessThan(4);
  });
});
