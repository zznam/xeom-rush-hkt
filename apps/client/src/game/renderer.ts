import { type PassengerState, MAP_SIZE, CHUNK_SIZE } from '@xeom-rush/shared';
import { prediction } from './prediction';

export class GameRenderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private camera = { x: 2000, y: 2000 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  public resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  /**
   * Main render method
   */
  public draw(
    localPlayer: { x: number; y: number; angle: number; username: string; score: number; passengerId: string | null },
    otherPlayers: Map<string, { x: number; y: number; angle: number; username: string; score: number; passengerId: string | null }>,
    passengers: PassengerState[],
    showDebug: boolean
  ): void {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    // 1. Center camera on player
    this.camera.x = localPlayer.x;
    this.camera.y = localPlayer.y;

    // 2. Clear screen
    ctx.fillStyle = '#1e293b'; // Slate 800 dark background
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    // Translate context to center camera
    ctx.translate(width / 2 - this.camera.x, height / 2 - this.camera.y);

    // 3. Draw grid system (roads/background)
    this.drawMapBackground(ctx);

    // 4. Draw obstacles (buildings / alleys)
    this.drawBuildings(ctx);

    // 5. Draw passengers
    this.drawPassengers(ctx, passengers, localPlayer.passengerId);

    // 6. Draw other players
    for (const op of otherPlayers.values()) {
      this.drawMotorbike(ctx, op.x, op.y, op.angle, op.username, false, op.passengerId !== null);
    }

    // 7. Draw local player
    this.drawMotorbike(ctx, localPlayer.x, localPlayer.y, localPlayer.angle, localPlayer.username, true, localPlayer.passengerId !== null);

    // 8. Draw spatial chunk grid if debug is enabled
    if (showDebug) {
      this.drawChunkGrid(ctx, localPlayer.x, localPlayer.y);
    }

    ctx.restore();
  }

  private drawMapBackground(ctx: CanvasRenderingContext2D): void {
    // Fill the map area
    ctx.fillStyle = '#0f172a'; // Deep dark Slate 900 for buildings/blocks backing
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

    // Draw main roads
    ctx.fillStyle = '#334155'; // Grey Slate 700 for roads
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE); // Let roads cover all, and buildings draw over

    // Highlight Center Market hotspot (Chợ Bến Thành zone)
    const marketSize = 800;
    const startX = MAP_SIZE / 2 - marketSize / 2;
    const startY = MAP_SIZE / 2 - marketSize / 2;
    
    ctx.save();
    ctx.fillStyle = 'rgba(234, 179, 8, 0.08)'; // Golden yellow market overlay
    ctx.fillRect(startX, startY, marketSize, marketSize);
    
    // Draw market border
    ctx.strokeStyle = 'rgba(234, 179, 8, 0.4)';
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 10]);
    ctx.strokeRect(startX, startY, marketSize, marketSize);
    
    ctx.fillStyle = 'rgba(234, 179, 8, 0.6)';
    ctx.font = '900 24px Outfit, Inter, sans-serif';
    ctx.fillText('🔴 CHỢ BẾN THÀNH - HOTSPOT', startX + 40, startY + 50);
    ctx.restore();
  }

  private drawBuildings(ctx: CanvasRenderingContext2D): void {
    const buildings = prediction.getBuildings();
    ctx.fillStyle = '#0f172a'; // Building block color
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;

    for (const rect of buildings) {
      // Draw building block
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

      // Add a simple window lattice patterns inside building block to look premium
      ctx.fillStyle = 'rgba(51, 65, 85, 0.3)';
      for (let wx = rect.x + 30; wx < rect.x + rect.width; wx += 80) {
        for (let wy = rect.y + 30; wy < rect.y + rect.height; wy += 80) {
          ctx.fillRect(wx, wy, 20, 20);
        }
      }
      ctx.fillStyle = '#0f172a'; // Restore
    }
  }

  private drawPassengers(ctx: CanvasRenderingContext2D, passengers: PassengerState[], localPassengerId: string | null): void {
    for (const p of passengers) {
      if (p.isCarried) continue;

      // Draw pickup point
      ctx.beginPath();
      ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(34, 197, 94, 0.2)'; // Green aura
      ctx.fill();

      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#22c55e'; // Green solid center
      ctx.fill();

      // Pulsing effect
      const pulse = 8 + Math.abs(Math.sin(Date.now() / 150)) * 6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, pulse, 0, Math.PI * 2);
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Draw tag text for passenger reward
      ctx.fillStyle = '#22c55e';
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${(p.reward / 1000).toFixed(1)}kđ`, p.x, p.y - 18);
    }

    // If local player is carrying a passenger, draw a highlighted route to destination
    if (localPassengerId) {
      const activePass = passengers.find((p) => p.id === localPassengerId);
      if (activePass) {
        // Draw destination zone
        ctx.save();
        ctx.beginPath();
        ctx.arc(activePass.destX, activePass.destY, 35, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(239, 68, 68, 0.15)'; // Red destination circle
        ctx.fill();

        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.arc(activePass.destX, activePass.destY, 35, 0, Math.PI * 2);
        ctx.stroke();

        // Draw pin
        ctx.beginPath();
        ctx.arc(activePass.destX, activePass.destY, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#ef4444';
        ctx.fill();

        ctx.fillStyle = '#ef4444';
        ctx.font = '900 12px Inter, sans-serif';
        ctx.fillText('🏁 ĐIỂM TRẢ KHÁCH', activePass.destX, activePass.destY - 45);
        ctx.fillText(`${Math.floor(activePass.reward).toLocaleString()} VNĐ`, activePass.destX, activePass.destY - 30);

        // Draw navigation line from player to dropoff destination
        ctx.beginPath();
        ctx.moveTo(this.camera.x, this.camera.y);
        ctx.lineTo(activePass.destX, activePass.destY);
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.35)';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([8, 8]);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  private drawMotorbike(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    angle: number,
    username: string,
    isLocal: boolean,
    hasPassenger: boolean
  ): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // 1. Draw headlight cone in front of motorbike
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 75, -Math.PI / 6, Math.PI / 6);
    ctx.closePath();
    const grad = ctx.createRadialGradient(0, 0, 10, 0, 0, 75);
    grad.addColorStop(0, isLocal ? 'rgba(59, 130, 246, 0.3)' : 'rgba(239, 68, 68, 0.2)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fill();

    // 2. Draw vehicle body
    // Triangluar design representing a fast bike
    ctx.beginPath();
    ctx.moveTo(15, 0); // Front tip
    ctx.lineTo(-12, -8); // Back left
    ctx.lineTo(-8, 0); // Center rear indent
    ctx.lineTo(-12, 8); // Back right
    ctx.closePath();

    ctx.fillStyle = isLocal ? '#3b82f6' : '#ef4444'; // Local = Blue, Other = Red
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 3. Draw wheels
    ctx.fillStyle = '#000000';
    ctx.fillRect(8, -2, 5, 4); // Front tire
    ctx.fillRect(-10, -2, 5, 4); // Rear tire

    // 4. Draw driver head/helmet
    ctx.beginPath();
    ctx.arc(-2, 0, 5, 0, Math.PI * 2);
    ctx.fillStyle = isLocal ? '#93c5fd' : '#fca5a5';
    ctx.fill();
    ctx.stroke();

    // 5. Draw Passenger if carried
    if (hasPassenger) {
      ctx.beginPath();
      ctx.arc(-8, 0, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#22c55e'; // Green passenger helmet
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();

    // 6. Draw Username Tag Above Player
    ctx.save();
    ctx.font = isLocal ? 'bold 13px Inter, sans-serif' : '11px Inter, sans-serif';
    ctx.fillStyle = isLocal ? '#60a5fa' : '#f87171';
    ctx.textAlign = 'center';
    
    let tag = username;
    if (hasPassenger) {
      tag += ' 🛵💨'; // Show passenger riding along emoji
    }
    ctx.fillText(tag, x, y - 22);
    ctx.restore();
  }

  /**
   * Draws a visual layout of the 3x3 active grid chunks centered on the player.
   */
  private drawChunkGrid(ctx: CanvasRenderingContext2D, px: number, py: number): void {
    const cx = Math.floor(px / CHUNK_SIZE);
    const cy = Math.floor(py / CHUNK_SIZE);

    ctx.save();
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.25)'; // Green border for active chunks
    ctx.lineWidth = 2.5;
    ctx.setLineDash([4, 4]);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const x = (cx + dx) * CHUNK_SIZE;
        const y = (cy + dy) * CHUNK_SIZE;

        // Highlight center active chunk differently
        if (dx === 0 && dy === 0) {
          ctx.fillStyle = 'rgba(16, 185, 129, 0.05)';
          ctx.fillRect(x, y, CHUNK_SIZE, CHUNK_SIZE);
        }
        
        ctx.strokeRect(x, y, CHUNK_SIZE, CHUNK_SIZE);

        // Print chunk key
        ctx.fillStyle = 'rgba(16, 185, 129, 0.4)';
        ctx.font = '900 11px courier';
        ctx.fillText(`Chunk: ${cx + dx},${cy + dy}`, x + 15, y + 25);
      }
    }
    ctx.restore();
  }
}
