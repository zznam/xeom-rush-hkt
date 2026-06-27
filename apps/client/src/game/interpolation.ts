import { type PlayerState } from '@xeom-rush/shared';

interface EntitySnapshot {
  timestamp: number;
  players: Map<string, PlayerState>;
}

export class EntityInterpolation {
  // Stored snapshots of other players
  private buffer: EntitySnapshot[] = [];
  // Buffer size limit
  private maxBufferSize: number = 20;
  // Delay interpolation by 100ms (2 ticks of server updates) to ensure smooth interpolation buffer
  private renderDelayMs: number = 100;

  public addSnapshot(players: PlayerState[]): void {
    const playerMap = new Map<string, PlayerState>();
    for (const p of players) {
      playerMap.set(p.id, { ...p });
    }

    this.buffer.push({
      timestamp: Date.now(),
      players: playerMap,
    });

    // Prune buffer
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }
  }

  /**
   * Calculates interpolated position of all players except the local client.
   */
  public getInterpolatedPlayers(localPlayerId: string): Map<string, { x: number; y: number; angle: number; username: string; score: number; passengerId: string | null }> {
    const interpolated = new Map<string, { x: number; y: number; angle: number; username: string; score: number; passengerId: string | null }>();
    const renderTime = Date.now() - this.renderDelayMs;

    // We need at least two snapshots to interpolate between
    if (this.buffer.length < 2) {
      // If we don't have enough snapshots, just return the latest snapshot state directly
      if (this.buffer.length === 1) {
        const latest = this.buffer[0];
        for (const [id, p] of latest.players.entries()) {
          if (id === localPlayerId) continue;
          interpolated.set(id, {
            x: p.x,
            y: p.y,
            angle: p.angle,
            username: p.username,
            score: p.score,
            passengerId: p.passengerId,
          });
        }
      }
      return interpolated;
    }

    // Find the two snapshots that surround renderTime
    let older: EntitySnapshot | null = null;
    let newer: EntitySnapshot | null = null;

    for (let i = 0; i < this.buffer.length - 1; i++) {
      const snapA = this.buffer[i];
      const snapB = this.buffer[i + 1];

      if (renderTime >= snapA.timestamp && renderTime <= snapB.timestamp) {
        older = snapA;
        newer = snapB;
        break;
      }
    }

    // If renderTime is older than our oldest snapshot, use oldest
    if (!older && !newer) {
      if (renderTime < this.buffer[0].timestamp) {
        older = this.buffer[0];
        newer = this.buffer[1];
      } else {
        // If renderTime is newer than our newest, extrapolate or just return latest
        older = this.buffer[this.buffer.length - 2];
        newer = this.buffer[this.buffer.length - 1];
      }
    }

    if (!older || !newer) return interpolated;

    const total = newer.timestamp - older.timestamp;
    const ratio = total > 0 ? (renderTime - older.timestamp) / total : 0;
    // Clamp ratio between 0 and 1
    const clampedRatio = Math.max(0, Math.min(1, ratio));

    // Interpolate players in newer snapshot
    for (const [id, newerPlayer] of newer.players.entries()) {
      if (id === localPlayerId) continue;

      const olderPlayer = older.players.get(id);
      if (olderPlayer) {
        // Lerp positions
        const x = olderPlayer.x + (newerPlayer.x - olderPlayer.x) * clampedRatio;
        const y = olderPlayer.y + (newerPlayer.y - olderPlayer.y) * clampedRatio;

        // Angle interpolation (handle wrapping correctly)
        let diff = newerPlayer.angle - olderPlayer.angle;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        const angle = olderPlayer.angle + diff * clampedRatio;

        interpolated.set(id, {
          x,
          y,
          angle,
          username: newerPlayer.username,
          score: newerPlayer.score,
          passengerId: newerPlayer.passengerId,
        });
      } else {
        // Just use newer state if player wasn't in older snapshot
        interpolated.set(id, {
          x: newerPlayer.x,
          y: newerPlayer.y,
          angle: newerPlayer.angle,
          username: newerPlayer.username,
          score: newerPlayer.score,
          passengerId: newerPlayer.passengerId,
        });
      }
    }

    return interpolated;
  }

  public clear(): void {
    this.buffer = [];
  }
}

export const interpolation = new EntityInterpolation();
