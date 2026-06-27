import { describe, it, expect } from 'vitest';
import { PhysicsEngine } from './physics';

describe('Authoritative Physics Collision Resolver', () => {
  it('should restrict players inside the map boundary', () => {
    const physics = new PhysicsEngine();
    
    // Bounded by MAP_SIZE (4000)
    // Moving outside left boundary (x: -50)
    const posLeft = physics.resolveMove(50, 2000, -50, 2000, 15);
    expect(posLeft.x).toBe(15); // Stays at radius bounds

    // Moving outside top boundary (y: -50)
    const posTop = physics.resolveMove(2000, 50, 2000, -50, 15);
    expect(posTop.y).toBe(15);

    // Moving outside right boundary (x: 4050) at a street Y-level (450) to avoid building overlap
    const posRight = physics.resolveMove(3950, 450, 4050, 450, 15);
    expect(posRight.x).toBe(3985); // MAP_SIZE - radius (4000 - 15)
  });

  it('should permit free movement when path is unobstructed', () => {
    const physics = new PhysicsEngine();
    // Open center area (around 2000, 2000 has no buildings)
    const resolved = physics.resolveMove(2000, 2000, 2010, 2010, 15);
    expect(resolved.x).toBe(2010);
    expect(resolved.y).toBe(2010);
  });

  it('should slide along building blocks instead of locking completely', () => {
    const physics = new PhysicsEngine();
    const buildings = physics.getBuildings();
    
    if (buildings.length === 0) return;

    // Pick first building obstacle
    const rect = buildings[0];
    
    // Player is moving down-right and hits the left edge of the building
    // Let's place player at: x = rect.x - 10, y = rect.y + 50 (overlapping in x soon)
    const playerX = rect.x - 10;
    const playerY = rect.y + 50;

    // Try moving right (into the building)
    const intoBuilding = physics.resolveMove(playerX, playerY, playerX + 15, playerY, 15);

    // X movement should be blocked or corrected, resolving to oldX
    expect(intoBuilding.x).toBe(playerX);
    // Y movement should be fine since there is no building wall in y path here
    expect(intoBuilding.y).toBe(playerY);
  });
});
