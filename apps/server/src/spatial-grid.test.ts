import { describe, it, expect } from 'vitest';
import { SpatialGrid } from './spatial-grid';

describe('Spatial Grid Cell Partitioning', () => {
  it('should query nearby entities within surrounding chunks', () => {
    const grid = new SpatialGrid(500);

    // Add entities inside chunk (4, 4) -> x: 2200, y: 2200
    grid.insert('player-1', 2200, 2200);
    grid.insert('player-2', 2400, 2400);

    // Query center chunk (4, 4)
    const nearby = grid.getNearbyEntities(2200, 2200);
    expect(nearby).toContain('player-1');
    expect(nearby).toContain('player-2');
  });

  it('should ignore distant entities outside the 3x3 surrounding chunks', () => {
    const grid = new SpatialGrid(500);

    // Entity in chunk (4, 4)
    grid.insert('player-1', 2200, 2200);

    // Entity in chunk (10, 10) -> x: 5200, y: 5200 (far away!)
    grid.insert('player-far', 5200, 5200);

    const nearby = grid.getNearbyEntities(2200, 2200);
    expect(nearby).toContain('player-1');
    expect(nearby).not.toContain('player-far');
  });

  it('should successfully update entity chunk allocations on movement', () => {
    const grid = new SpatialGrid(500);

    // Initial insert at chunk (4, 4)
    grid.insert('player-1', 2200, 2200);

    // Check occupancy
    expect(grid.getChunkOccupancy()['4,4']).toBe(1);

    // Move to chunk (4, 5) -> x: 2200, y: 2700
    grid.update('player-1', 2200, 2700);

    const occupancy = grid.getChunkOccupancy();
    expect(occupancy['4,4']).toBeUndefined(); // Should be cleaned up
    expect(occupancy['4,5']).toBe(1); // Moved to new cell

    // Verify neighbors in (4, 4) can still see it since it is directly adjacent
    const nearbyOldCell = grid.getNearbyEntities(2200, 2200);
    expect(nearbyOldCell).toContain('player-1');

    // Move very far away to chunk (10, 10)
    grid.update('player-1', 5200, 5200);

    const nearbyOldCellFar = grid.getNearbyEntities(2200, 2200);
    expect(nearbyOldCellFar).not.toContain('player-1');
  });

  it('should remove entities cleanly', () => {
    const grid = new SpatialGrid(500);

    grid.insert('player-1', 2200, 2200);
    expect(grid.getNearbyEntities(2200, 2200)).toContain('player-1');

    grid.remove('player-1');
    expect(grid.getNearbyEntities(2200, 2200)).not.toContain('player-1');
    expect(Object.keys(grid.getChunkOccupancy()).length).toBe(0);
  });
});
