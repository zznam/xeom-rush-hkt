import {
  type PassengerState,
  type TrafficLightState,
  type PedestrianState,
  MAP_SIZE,
  CHUNK_SIZE,
} from '@xeom-rush/shared';
import { prediction } from './prediction';

const STREET_LINES = [50, 450, 850, 1250, 1650, 2050, 2450, 2850, 3250, 3650];
const ROUNDABOUT_CHANCE = 0.12;
const TRAFFIC_LIGHT_CHANCE = 0.3;
const CROSSWALK_CHANCE = 0.4;
const ROUNDABOUT_RADIUS = 24;

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
  private reducedMotion = false;
  private rider = new Image();
  private passengerArt = new Image();
  private particles: { x: number; y: number; vx: number; vy: number; born: number; color: string }[] = [];
  public setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
    if (value) {
      this.shakeMagnitude = 0;
      this.particles = [];
    }
  }
  public celebrate(x: number, y: number, kind: 'pickup' | 'delivery'): void {
    if (this.reducedMotion) return;
    for (let i = 0; i < (kind === 'delivery' ? 24 : 12); i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 100;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        born: performance.now(),
        color: ['#ffca5b', '#f47c65', '#5cbb99', '#fff8dc'][i % 4],
      });
    }
    this.particles = this.particles.slice(-80);
  }
  private staticRoundabouts: StaticRoundabout[] = [];
  private staticCrosswalks: StaticCrosswalk[] = [];
  private viewport = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.rider.src = '/art/scooter-rider.png';
    this.passengerArt.src = '/art/waving-passenger.png';
    this.generateStaticCityFeatures();
  }

  public resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  public triggerShake(magnitude: number = 10): void {
    if (!this.reducedMotion) this.shakeMagnitude = magnitude;
  }

  /**
   * Main render method
   */
  public draw(
    localPlayer: { x: number; y: number; angle: number; username: string; score: number; passengerId: string | null },
    otherPlayers: Map<
      string,
      { x: number; y: number; angle: number; username: string; score: number; passengerId: string | null }
    >,
    passengers: PassengerState[],
    trafficLights: TrafficLightState[],
    pedestrians: PedestrianState[],
    showDebug: boolean,
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

    // Calculate viewport boundaries with 100px padding for safety culling
    this.viewport.minX = this.camera.x - width / 2 - 100;
    this.viewport.maxX = this.camera.x + width / 2 + 100;
    this.viewport.minY = this.camera.y - height / 2 - 100;
    this.viewport.maxY = this.camera.y + height / 2 + 100;

    // 2. Clear screen
    ctx.fillStyle = '#acc9b7'; // Slate 800 dark background
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
    this.drawMotorbike(
      ctx,
      localPlayer.x,
      localPlayer.y,
      localPlayer.angle,
      localPlayer.username,
      true,
      localPlayer.passengerId !== null,
    );

    const now = performance.now();
    this.particles = this.particles.filter((p) => now - p.born < 900);
    for (const p of this.particles) {
      const age = (now - p.born) / 1000;
      ctx.globalAlpha = Math.max(0, 1 - age / 0.9);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x + p.vx * age, p.y + p.vy * age + age * age * 45, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
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
      // Frustum culling check
      if (
        crosswalk.x < this.viewport.minX - 60 ||
        crosswalk.x > this.viewport.maxX + 60 ||
        crosswalk.y < this.viewport.minY - 60 ||
        crosswalk.y > this.viewport.maxY + 60
      ) {
        continue;
      }
      this.drawCrosswalk(ctx, crosswalk);
    }

    for (const roundabout of this.staticRoundabouts) {
      // Frustum culling check
      const bound = roundabout.radius + 40;
      if (
        roundabout.x < this.viewport.minX - bound ||
        roundabout.x > this.viewport.maxX + bound ||
        roundabout.y < this.viewport.minY - bound ||
        roundabout.y > this.viewport.maxY + bound
      ) {
        continue;
      }
      this.drawRoundabout(ctx, roundabout);
    }

    for (const light of trafficLights) {
      // Frustum culling check
      if (
        light.x < this.viewport.minX - 60 ||
        light.x > this.viewport.maxX + 60 ||
        light.y < this.viewport.minY - 60 ||
        light.y > this.viewport.maxY + 60
      ) {
        continue;
      }
      this.drawTrafficLight(ctx, light);
    }

    for (const pedestrian of pedestrians) {
      // Frustum culling check
      if (
        pedestrian.x < this.viewport.minX - 20 ||
        pedestrian.x > this.viewport.maxX + 20 ||
        pedestrian.y < this.viewport.minY - 20 ||
        pedestrian.y > this.viewport.maxY + 20
      ) {
        continue;
      }
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
      const angle = (i * Math.PI) / 2 + Math.PI / 4;
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
    ctx.fillStyle = '#d2d7bf';
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    ctx.save();
    ctx.strokeStyle = '#f9f4d9';
    ctx.lineWidth = 3;
    ctx.setLineDash([18, 22]);
    for (const line of STREET_LINES) {
      ctx.beginPath();
      ctx.moveTo(line, 0);
      ctx.lineTo(line, MAP_SIZE);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, line);
      ctx.lineTo(MAP_SIZE, line);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = '#ece2b9';
    ctx.fillRect(1600, 1600, 800, 800);
    ctx.strokeStyle = '#bea97d';
    ctx.lineWidth = 5;
    ctx.strokeRect(1600, 1600, 800, 800);
    ctx.fillStyle = '#6b7753';
    ctx.textAlign = 'center';
    ctx.font = '900 28px "Be Vietnam Pro", sans-serif';
    ctx.fillText('CHỢ BẾN THÀNH', 2000, 1660);
    ctx.font = '700 13px "Be Vietnam Pro", sans-serif';
    ctx.fillText('ĐÓN KHÁCH · KHÁM PHÁ · LÊN ĐƯỜNG', 2000, 1685);
    ctx.restore();
  }

  private drawBuildings(ctx: CanvasRenderingContext2D): void {
    const colors = ['#e8a58a', '#e9cb80', '#93c5b4', '#b9b0ce', '#dfbc99'];
    for (const rect of prediction.getBuildings()) {
      if (
        rect.x + rect.width < this.viewport.minX ||
        rect.x > this.viewport.maxX ||
        rect.y + rect.height < this.viewport.minY ||
        rect.y > this.viewport.maxY
      )
        continue;
      const index = Math.floor(rect.x / 400 + rect.y / 400) % colors.length;
      ctx.fillStyle = '#52654c35';
      ctx.fillRect(rect.x + 8, rect.y + 10, rect.width, rect.height);
      ctx.fillStyle = colors[index];
      ctx.strokeStyle = '#53634e';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(rect.x, rect.y, rect.width, rect.height, 10);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#ffffff55';
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x + 14, rect.y + 14, rect.width - 28, rect.height - 28);
      for (let wx = rect.x + 35; wx < rect.x + rect.width - 25; wx += 75) {
        for (let wy = rect.y + 40; wy < rect.y + rect.height - 25; wy += 75) {
          ctx.fillStyle = '#3d656675';
          ctx.beginPath();
          ctx.roundRect(wx, wy, 27, 32, 4);
          ctx.fill();
          ctx.fillStyle = '#fff8d585';
          ctx.fillRect(wx + 4, wy + 4, 8, 12);
        }
      }
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? '#fff5da' : '#e57660';
        ctx.fillRect(rect.x + 30 + i * 40, rect.y + rect.height - 26, 40, 23);
      }
      ctx.fillStyle = '#38694e';
      ctx.beginPath();
      ctx.arc(rect.x + 24, rect.y + 23, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#78ab6d';
      ctx.beginPath();
      ctx.arc(rect.x + 19, rect.y + 17, 14, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawPassengers(
    ctx: CanvasRenderingContext2D,
    passengers: PassengerState[],
    localPassengerId: string | null,
  ): void {
    for (const p of passengers) {
      if (p.isCarried) continue;

      const color = ['#248566', '#bf8c27', '#8860bd'][p.tier];
      const bob = this.reducedMotion ? 0 : Math.sin(Date.now() / 240 + p.x) * 2;
      ctx.fillStyle = color + '35';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 2, 22, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      if (this.passengerArt.complete && this.passengerArt.naturalWidth) {
        ctx.drawImage(this.passengerArt, p.x - 25, p.y - 43 + bob, 50, 50);
      } else {
        ctx.font = '30px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🙋', p.x, p.y + bob);
      }
      ctx.fillStyle = '#fff9e7';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(p.x - 28, p.y - 60 + bob, 56, 20, 7);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = '900 10px "Be Vietnam Pro", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${p.tier === 2 ? '★ ' : ''}${(p.reward / 1000).toFixed(0)}kđ`, p.x, p.y - 46 + bob);
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
        ctx.font = '900 12px "Be Vietnam Pro", sans-serif';
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
    hasPassenger: boolean,
  ): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    ctx.fillStyle = '#334e4438';
    ctx.beginPath();
    ctx.ellipse(1, 4, 24, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    if (this.rider.complete && this.rider.naturalWidth) {
      if (!isLocal) ctx.filter = 'hue-rotate(135deg)';
      ctx.drawImage(this.rider, -32, -32, 64, 64);
      ctx.filter = 'none';
    } else {
      ctx.fillStyle = isLocal ? '#2eaa90' : '#ef927b';
      ctx.strokeStyle = '#253e39';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(-19, -9, 40, 18, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff2cf';
      ctx.beginPath();
      ctx.arc(-2, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (hasPassenger) {
      ctx.fillStyle = '#ffd666';
      ctx.strokeStyle = '#253e39';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(-17, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();

    // 6. Draw Username Tag Above Player
    ctx.save();
    ctx.font = isLocal ? 'bold 13px "Be Vietnam Pro", sans-serif' : '11px "Be Vietnam Pro", sans-serif';
    ctx.fillStyle = isLocal ? '#165e50' : '#804e3a';
    ctx.strokeStyle = '#fff9e9';
    ctx.lineWidth = 4;
    ctx.textAlign = 'center';

    let tag = username;
    if (hasPassenger) {
      tag += ' 🛵💨'; // Show passenger riding along emoji
    }
    ctx.strokeText(tag, x, y - 27);
    ctx.fillText(tag, x, y - 27);
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
