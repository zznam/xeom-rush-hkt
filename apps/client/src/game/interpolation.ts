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
  // Delay interpolation by 60ms (~1.2 ticks) for real-time responsiveness without stutter
  private renderDelayMs: number = 60;

  public addSnapshot(players: PlayerState[]): void {
    const playerMap = new Map<string, PlayerState>();
    for (const p of players) {
      playerMap.set(p.id, { ...p });
    }

    this.buffer.push({
      timestamp: performance.now(),
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
  public getInterpolatedPlayers(
    localPlayerId: string,
  ): Map<string, { x: number; y: number; angle: number; username: string; score: number; passengerId: string | null }> {
    const interpolated = new Map<
      string,
      { x: number; y: number; angle: number; username: string; score: number; passengerId: string | null }
    >();

    if (this.buffer.length === 0) return interpolated;

    // Prune stale snapshots older than render window
    const now = performance.now();
    const renderTime = now - this.renderDelayMs;

    while (this.buffer.length > 2 && this.buffer[1].timestamp < renderTime - 100) {
      this.buffer.shift();
    }

    // We need at least two snapshots to interpolate between
    if (this.buffer.length < 2) {
      const latest = this.buffer[this.buffer.length - 1];
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
      return interpolated;
    }

    const latestSnap = this.buffer[this.buffer.length - 1];
    // If tab was paused or network lagged heavily (> 300ms gap), snap to latest to avoid stale extrapolation
    if (renderTime > latestSnap.timestamp + 300) {
      for (const [id, p] of latestSnap.players.entries()) {
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
        // If renderTime is newer than our newest, extrapolate smoothly
        older = this.buffer[this.buffer.length - 2];
        newer = this.buffer[this.buffer.length - 1];
      }
    }

    if (!older || !newer) return interpolated;

    const total = newer.timestamp - older.timestamp;
    const ratio = total > 0 ? (renderTime - older.timestamp) / total : 0;
    // Allow extrapolation up to 1.3 to prevent freezing during minor packet arrival jitter
    const clampedRatio = Math.max(0, Math.min(1.3, ratio));

    // Interpolate players in newer snapshot
    for (const [id, newerPlayer] of newer.players.entries()) {
      if (id === localPlayerId) continue;

      const olderPlayer = older.players.get(id);
      if (olderPlayer) {
        const dist = Math.hypot(newerPlayer.x - olderPlayer.x, newerPlayer.y - olderPlayer.y);
        // If entity jumped an impossible distance (> 200 units in 50ms), snap instead of lerping
        let x = newerPlayer.x;
        let y = newerPlayer.y;
        if (dist <= 200) {
          x = olderPlayer.x + (newerPlayer.x - olderPlayer.x) * clampedRatio;
          y = olderPlayer.y + (newerPlayer.y - olderPlayer.y) * clampedRatio;
        }

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
