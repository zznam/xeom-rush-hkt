import { type PassengerState, type TrafficLightState, type PedestrianState, MAP_SIZE, CHUNK_SIZE } from '@xeom-rush/shared';
import { prediction } from './prediction';

const STREET_LINES = [50, 450, 850, 1250, 1650, 2050, 2450, 2850, 3250, 3650];
const ROUNDABOUT_CHANCE = 0.12;
const TRAFFIC_LIGHT_CHANCE = 0.30;
const CROSSWALK_CHANCE = 0.40;
const ROUNDABOUT_RADIUS = 34;

interface StaticRoundabout {
  id: string;
  x: number;
  y: number;
  radius: number;
}

interface StaticCrosswalk {
  id: string;
  x: number;
  y: number;
  direction: 'horizontal' | 'vertical';
}

export class GameRenderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private camera = { x: 2000, y: 2000 };
  private shakeMagnitude: number = 0;
  private staticRoundabouts: StaticRoundabout[] = [];
  private staticCrosswalks: StaticCrosswalk[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.generateStaticCityFeatures();
  }

  public resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  public triggerShake(magnitude: number = 10): void {
    this.shakeMagnitude = magnitude;
  }

  /**
   * Main render method
   */
  public draw(
    localPlayer: { x: number; y: number; angle: number; username: string; score: number; passengerId: string | null },
    otherPlayers: Map<string, { x: number; y: number; angle: number; username: string; score: number; passengerId: string | null }>,
    passengers: PassengerState[],
    trafficLights: TrafficLightState[],
    pedestrians: PedestrianState[],
    showDebug: boolean
  ): void {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Apply camera shake if any
    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeMagnitude > 0.1) {
      shakeX = (Math.random() - 0.5) * this.shakeMagnitude;
      shakeY = (Math.random() - 0.5) * this.shakeMagnitude;
      this.shakeMagnitude *= 0.9; // decay
    }

    // 1. Center camera on player
    this.camera.x = localPlayer.x + shakeX;
    this.camera.y = localPlayer.y + shakeY;

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

    // 5. Draw city realism layer
    this.drawCityFeatures(ctx, trafficLights, pedestrians);

    // 6. Draw passengers
    this.drawPassengers(ctx, passengers, localPlayer.passengerId);

    // 7. Draw other players
    for (const op of otherPlayers.values()) {
      this.drawMotorbike(ctx, op.x, op.y, op.angle, op.username, false, op.passengerId !== null);
    }

    // 8. Draw local player
    this.drawMotorbike(ctx, localPlayer.x, localPlayer.y, localPlayer.angle, localPlayer.username, true, localPlayer.passengerId !== null);

    // 9. Draw spatial chunk grid if debug is enabled
    if (showDebug) {
      this.drawChunkGrid(ctx, localPlayer.x, localPlayer.y);
    }

    ctx.restore();
  }

  private generateStaticCityFeatures(): void {
    const rng = new SeededRng(42);

    for (let xi = 0; xi < STREET_LINES.length; xi++) {
      for (let yi = 0; yi < STREET_LINES.length; yi++) {
        const cx = STREET_LINES[xi];
        const cy = STREET_LINES[yi];
        const inCenter = Math.abs(cx - MAP_SIZE / 2) < 400 && Math.abs(cy - MAP_SIZE / 2) < 400;
        const nearEdge = cx < 150 || cy < 150 || cx > MAP_SIZE - 150 || cy > MAP_SIZE - 150;
        if (inCenter || nearEdge) continue;

        const roll = rng.next();
        if (roll < ROUNDABOUT_CHANCE) {
          this.staticRoundabouts.push({ id: `roundabout-${xi}-${yi}`, x: cx, y: cy, radius: ROUNDABOUT_RADIUS });
        } else if (roll < ROUNDABOUT_CHANCE + TRAFFIC_LIGHT_CHANCE) {
          rng.next();
        } else if (roll < ROUNDABOUT_CHANCE + TRAFFIC_LIGHT_CHANCE + CROSSWALK_CHANCE) {
          this.staticCrosswalks.push({
            id: `cw-${xi}-${yi}`,
            x: cx,
            y: cy,
            direction: rng.next() < 0.5 ? 'horizontal' : 'vertical',
          });
        }
      }
    }
  }

  private drawCityFeatures(
    ctx: CanvasRenderingContext2D,
    trafficLights: TrafficLightState[],
    pedestrians: PedestrianState[],
  ): void {
    for (const crosswalk of this.staticCrosswalks) {
      this.drawCrosswalk(ctx, crosswalk);
    }

    for (const roundabout of this.staticRoundabouts) {
      this.drawRoundabout(ctx, roundabout);
    }

    for (const light of trafficLights) {
      this.drawTrafficLight(ctx, light);
    }

    for (const pedestrian of pedestrians) {
      this.drawPedestrian(ctx, pedestrian);
    }
  }

  private drawCrosswalk(ctx: CanvasRenderingContext2D, crosswalk: StaticCrosswalk): void {
    ctx.save();
    ctx.fillStyle = 'rgba(248, 250, 252, 0.82)';

    const stripeCount = 7;
    const stripeWidth = 10;
    const stripeLength = 90;
    const spacing = 16;
    const start = -((stripeCount - 1) * spacing) / 2;

    for (let i = 0; i < stripeCount; i++) {
      const offset = start + i * spacing;
      if (crosswalk.direction === 'horizontal') {
        ctx.fillRect(crosswalk.x - stripeLength / 2, crosswalk.y + offset - stripeWidth / 2, stripeLength, stripeWidth);
      } else {
        ctx.fillRect(crosswalk.x + offset - stripeWidth / 2, crosswalk.y - stripeLength / 2, stripeWidth, stripeLength);
      }
    }

    ctx.restore();
  }

  private drawRoundabout(ctx: CanvasRenderingContext2D, roundabout: StaticRoundabout): void {
    ctx.save();
    ctx.beginPath();
    ctx.arc(roundabout.x, roundabout.y, roundabout.radius + 7, 0, Math.PI * 2);
    ctx.fillStyle = '#94a3b8';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(roundabout.x, roundabout.y, roundabout.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#15803d';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(roundabout.x, roundabout.y, roundabout.radius - 13, 0, Math.PI * 2);
    ctx.fillStyle = '#16a34a';
    ctx.fill();

    ctx.fillStyle = '#f8fafc';
    ctx.font = '900 15px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⛲', roundabout.x, roundabout.y + 5);

    ctx.strokeStyle = 'rgba(248, 250, 252, 0.55)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 9]);
    ctx.beginPath();
    ctx.arc(roundabout.x, roundabout.y, roundabout.radius + 27, 0.25, Math.PI * 1.75);
    ctx.stroke();

    ctx.fillStyle = 'rgba(248, 250, 252, 0.75)';
    ctx.font = '900 13px Inter, sans-serif';
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2 + Math.PI / 4;
      const ax = roundabout.x + Math.cos(angle) * (roundabout.radius + 27);
      const ay = roundabout.y + Math.sin(angle) * (roundabout.radius + 27);
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(angle + Math.PI / 2);
      ctx.fillText('➜', 0, 0);
      ctx.restore();
    }

    ctx.restore();
  }

  private drawTrafficLight(ctx: CanvasRenderingContext2D, light: TrafficLightState): void {
    const nsColor = light.isRedNS ? '#ef4444' : light.isYellow ? '#facc15' : '#22c55e';
    const ewColor = !light.isRedNS ? '#ef4444' : light.isYellow ? '#facc15' : '#22c55e';

    ctx.save();
    this.drawStopLines(ctx, light.x, light.y);
    this.drawSignalHead(ctx, light.x - 46, light.y - 46, nsColor, -Math.PI / 2);
    this.drawSignalHead(ctx, light.x + 46, light.y + 46, nsColor, Math.PI / 2);
    this.drawSignalHead(ctx, light.x + 46, light.y - 46, ewColor, 0);
    this.drawSignalHead(ctx, light.x - 46, light.y + 46, ewColor, Math.PI);
    ctx.restore();
  }

  private drawStopLines(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const offset = 46;
    const halfLength = 34;

    ctx.save();
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.72)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - halfLength, y - offset);
    ctx.lineTo(x + halfLength, y - offset);
    ctx.moveTo(x - halfLength, y + offset);
    ctx.lineTo(x + halfLength, y + offset);
    ctx.moveTo(x - offset, y - halfLength);
    ctx.lineTo(x - offset, y + halfLength);
    ctx.moveTo(x + offset, y - halfLength);
    ctx.lineTo(x + offset, y + halfLength);
    ctx.stroke();
    ctx.restore();
  }

  private drawSignalHead(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, angle: number): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    const glow = ctx.createRadialGradient(0, 0, 3, 0, 0, 18);
    glow.addColorStop(0, color);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#020617';
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-8, -13, 16, 26, 4);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, -6, 3, 0, Math.PI * 2);
    ctx.fillStyle = color === '#ef4444' ? '#ef4444' : 'rgba(100, 116, 139, 0.55)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fillStyle = color === '#facc15' ? '#facc15' : 'rgba(100, 116, 139, 0.55)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 6, 3, 0, Math.PI * 2);
    ctx.fillStyle = color === '#22c55e' ? '#22c55e' : 'rgba(100, 116, 139, 0.55)';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(0, -13);
    ctx.strokeStyle = 'rgba(203, 213, 225, 0.65)';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, 17);
    ctx.lineTo(5, 23);
    ctx.lineTo(-5, 23);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  private drawPedestrian(ctx: CanvasRenderingContext2D, pedestrian: PedestrianState): void {
    const bob = Math.sin(Date.now() / 120 + pedestrian.x * 0.01) * 2;

    ctx.save();
    ctx.translate(pedestrian.x, pedestrian.y + bob);
    ctx.rotate(pedestrian.angle);

    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-7, -6);
    ctx.lineTo(7, 6);
    ctx.moveTo(-7, 6);
    ctx.lineTo(7, -6);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#fbbf24';
    ctx.fill();
    ctx.strokeStyle = '#f8fafc';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(2, -2, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#2563eb';
    ctx.fill();
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

class SeededRng {
  constructor(private seed: number) {}

  public next(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 0xffffffff;
  }
}
