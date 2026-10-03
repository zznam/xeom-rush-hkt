import React, { useEffect, useRef } from 'react';
import {
  LANDMARKS,
  DISTRICTS,
  type GameplayState,
  type PlayerState,
  type PassengerState,
  EPassengerTier,
  MAP_SIZE,
} from '@xeom-rush/shared';

const TIER_COLORS: Record<EPassengerTier, string> = {
  [EPassengerTier.REGULAR]: '#22c55e', // green
  [EPassengerTier.BUSINESS]: '#fbbf24', // gold
  [EPassengerTier.VIP]: '#a855f7', // purple
};

interface MinimapProps {
  navigation?: GameplayState['navigation'];
  localPlayerId: string | null;
  players: PlayerState[];
  passengers: PassengerState[];
  carriedPassengerId: string | null;
  size?: number;
  className?: string;
}

export const Minimap: React.FC<MinimapProps> = ({
  navigation,
  localPlayerId,
  players,
  passengers,
  carriedPassengerId,
  size = 150,
  className = 'hud-minimap',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scale = size / MAP_SIZE;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Dark map background
    ctx.fillStyle = 'rgba(10, 15, 30, 0.92)';
    ctx.fillRect(0, 0, size, size);

    DISTRICTS.forEach((district, i) => {
      ctx.fillStyle = district.color + '22';
      ctx.fillRect(((i % 2) * size) / 2, (Math.floor(i / 2) * size) / 2, size / 2, size / 2);
    });
    for (const landmark of LANDMARKS) {
      ctx.strokeStyle = '#fff1ae';
      ctx.lineWidth = 1;
      ctx.strokeRect(landmark.x * scale - 2, landmark.y * scale - 2, 4, 4);
    }
    // Subtle grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 0.5;
    const gridStep = size / 8;
    for (let i = 0; i <= 8; i++) {
      ctx.beginPath();
      ctx.moveTo(i * gridStep, 0);
      ctx.lineTo(i * gridStep, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * gridStep);
      ctx.lineTo(size, i * gridStep);
      ctx.stroke();
    }

    if (navigation) {
      ctx.strokeStyle = '#ffcf69';
      ctx.lineWidth = 2;
      ctx.beginPath();
      navigation.route.forEach((p, i) => {
        if (i) ctx.lineTo(p.x * scale, p.y * scale);
        else ctx.moveTo(p.x * scale, p.y * scale);
      });
      ctx.stroke();
      ctx.strokeStyle = '#ff7967';
      ctx.strokeRect(navigation.target.x * scale - 3, navigation.target.y * scale - 3, 6, 6);
    }
    // Draw passengers (blips, color-coded by tier)
    for (const passenger of passengers) {
      if (passenger.isCarried) continue;

      const mx = passenger.x * scale;
      const my = passenger.y * scale;

      ctx.beginPath();
      ctx.arc(mx, my, 2, 0, Math.PI * 2);
      ctx.fillStyle = TIER_COLORS[passenger.tier] ?? TIER_COLORS[EPassengerTier.REGULAR];
      ctx.fill();
    }

    // Draw carried passenger destination (red X)
    if (carriedPassengerId) {
      const carried = passengers.find((p) => p.id === carriedPassengerId);
      if (carried) {
        const dx = carried.destX * scale;
        const dy = carried.destY * scale;
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
      const mx = player.x * scale;
      const my = player.y * scale;
      ctx.beginPath();
      ctx.arc(mx, my, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.fill();
    }

    // Draw local player (blue dot, larger, with direction indicator)
    const localPlayer = players.find((p) => p.id === localPlayerId);
    if (localPlayer) {
      const mx = localPlayer.x * scale;
      const my = localPlayer.y * scale;

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
      ctx.lineTo(mx + Math.cos(localPlayer.angle) * dirLen, my + Math.sin(localPlayer.angle) * dirLen);
      ctx.stroke();
    }
  }, [localPlayerId, players, passengers, carriedPassengerId, size, scale, navigation]);

  return (
    <div id='minimap-container' className={className}>
      <span className='hud-label'>🗺 BẢN ĐỒ</span>
      <canvas id='minimap' ref={canvasRef} width={size} height={size} aria-label='Bản đồ thành phố' />
      <div className='minimap-legend'>
        <span style={{ color: '#65d997' }}>● Thường</span>
        <span style={{ color: '#fbbf24' }}>● KD</span>
        <span style={{ color: '#c084fc' }}>● VIP</span>
        <span style={{ color: '#93c5fd' }}>● Bạn</span>
      </div>
    </div>
  );
};
