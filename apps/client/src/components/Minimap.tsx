import React, { useEffect, useRef } from 'react';
import { type PlayerState, type PassengerState, EPassengerTier, MAP_SIZE } from '@xeom-rush/shared';

const MINIMAP_SIZE = 150;
const SCALE = MINIMAP_SIZE / MAP_SIZE; // 150 / 4000 = 0.0375

const TIER_COLORS: Record<EPassengerTier, string> = {
  [EPassengerTier.REGULAR]: '#22c55e',   // green
  [EPassengerTier.BUSINESS]: '#fbbf24',  // gold
  [EPassengerTier.VIP]: '#a855f7',       // purple
};

interface MinimapProps {
  localPlayerId: string | null;
  players: PlayerState[];
  passengers: PassengerState[];
  carriedPassengerId: string | null;
}

export const Minimap: React.FC<MinimapProps> = ({ localPlayerId, players, passengers, carriedPassengerId }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Dark map background
    ctx.fillStyle = 'rgba(10, 15, 30, 0.92)';
    ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

    // Subtle grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 0.5;
    const gridStep = MINIMAP_SIZE / 8;
    for (let i = 0; i <= 8; i++) {
      ctx.beginPath();
      ctx.moveTo(i * gridStep, 0);
      ctx.lineTo(i * gridStep, MINIMAP_SIZE);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * gridStep);
      ctx.lineTo(MINIMAP_SIZE, i * gridStep);
      ctx.stroke();
    }

    // Draw passengers (blips, color-coded by tier)
    for (const passenger of passengers) {
      if (passenger.isCarried) continue;

      const mx = passenger.x * SCALE;
      const my = passenger.y * SCALE;

      ctx.beginPath();
      ctx.arc(mx, my, 2, 0, Math.PI * 2);
      ctx.fillStyle = TIER_COLORS[passenger.tier] ?? TIER_COLORS[EPassengerTier.REGULAR];
      ctx.fill();
    }

    // Draw carried passenger destination (red X)
    if (carriedPassengerId) {
      const carried = passengers.find((p) => p.id === carriedPassengerId);
      if (carried) {
        const dx = carried.destX * SCALE;
        const dy = carried.destY * SCALE;
        const s = 4;
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(dx - s, dy - s);
        ctx.lineTo(dx + s, dy + s);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(dx + s, dy - s);
        ctx.lineTo(dx - s, dy + s);
        ctx.stroke();
      }
    }

    // Draw other players (small white dots)
    for (const player of players) {
      if (player.id === localPlayerId) continue;
      const mx = player.x * SCALE;
      const my = player.y * SCALE;
      ctx.beginPath();
      ctx.arc(mx, my, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.fill();
    }

    // Draw local player (blue dot, larger, with direction indicator)
    const localPlayer = players.find((p) => p.id === localPlayerId);
    if (localPlayer) {
      const mx = localPlayer.x * SCALE;
      const my = localPlayer.y * SCALE;

      // Glow ring
      ctx.beginPath();
      ctx.arc(mx, my, 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(59, 130, 246, 0.25)';
      ctx.fill();

      // Core dot
      ctx.beginPath();
      ctx.arc(mx, my, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#60a5fa';
      ctx.fill();

      // Direction line
      const dirLen = 6;
      ctx.strokeStyle = '#93c5fd';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(
        mx + Math.cos(localPlayer.angle) * dirLen,
        my + Math.sin(localPlayer.angle) * dirLen,
      );
      ctx.stroke();
    }
  }, [localPlayerId, players, passengers, carriedPassengerId]);

  return (
    <div
      id="minimap-container"
      style={{
        position: 'absolute',
        top: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        pointerEvents: 'none',
      }}
    >
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: '#64748b',
          textTransform: 'uppercase',
        }}
      >
        🗺 BẢN ĐỒ
      </span>
      <canvas
        id="minimap"
        ref={canvasRef}
        width={MINIMAP_SIZE}
        height={MINIMAP_SIZE}
        style={{
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 6,
          display: 'block',
        }}
      />
      <div style={{ display: 'flex', gap: 8, fontSize: 8, color: '#64748b' }}>
        <span style={{ color: '#22c55e' }}>● Thường</span>
        <span style={{ color: '#fbbf24' }}>● KD</span>
        <span style={{ color: '#a855f7' }}>● VIP</span>
        <span style={{ color: '#60a5fa' }}>● Bạn</span>
      </div>
    </div>
  );
};
