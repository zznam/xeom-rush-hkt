import { CHUNK_SIZE } from '@xeom-rush/shared';

export class SpatialGrid {
  private chunkSize: number;
  // Key: "chunkX,chunkY", Value: Set of entity IDs
  private chunks: Map<string, Set<string>>;
  // Map of entityId -> current chunk key
  private entityToChunk: Map<string, string>;

  constructor(chunkSize: number = CHUNK_SIZE) {
    this.chunkSize = chunkSize;
    this.chunks = new Map();
    this.entityToChunk = new Map();
  }

  private getChunkKey(x: number, y: number): string {
    const cx = Math.floor(x / this.chunkSize);
    const cy = Math.floor(y / this.chunkSize);
    return `${cx},${cy}`;
  }

  public insert(id: string, x: number, y: number): void {
    const key = this.getChunkKey(x, y);
    if (!this.chunks.has(key)) {
      this.chunks.set(key, new Set());
    }
    this.chunks.get(key)!.add(id);
    this.entityToChunk.set(id, key);
  }

  public update(id: string, x: number, y: number): void {
    const oldKey = this.entityToChunk.get(id);
    const newKey = this.getChunkKey(x, y);

    if (oldKey === newKey) return; // Still in same chunk

    if (oldKey) {
      const oldSet = this.chunks.get(oldKey);
      if (oldSet) {
        oldSet.delete(id);
        if (oldSet.size === 0) {
          this.chunks.delete(oldKey);
        }
      }
    }

    if (!this.chunks.has(newKey)) {
      this.chunks.set(newKey, new Set());
    }
    this.chunks.get(newKey)!.add(id);
    this.entityToChunk.set(id, newKey);
  }

  public remove(id: string): void {
    const key = this.entityToChunk.get(id);
    if (key) {
      const set = this.chunks.get(key);
      if (set) {
        set.delete(id);
        if (set.size === 0) {
          this.chunks.delete(key);
        }
      }
      this.entityToChunk.delete(id);
    }
  }

  /**
   * Returns a list of entity IDs present in the 3x3 grid around (x, y)
   */
  public getNearbyEntities(x: number, y: number): string[] {
    const cx = Math.floor(x / this.chunkSize);
    const cy = Math.floor(y / this.chunkSize);
    const result: string[] = [];

    // Query 3x3 area
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${cx + dx},${cy + dy}`;
        const set = this.chunks.get(key);
        if (set) {
          result.push(...set);
        }
      }
    }
    return result;
  }

  public getChunkOccupancy(): { [key: string]: number } {
    const occupancy: { [key: string]: number } = {};
    for (const [key, set] of this.chunks.entries()) {
      occupancy[key] = set.size;
    }
    return occupancy;
  }

  public clear(): void {
    this.chunks.clear();
    this.entityToChunk.clear();
  }
}
