import React, { useState, useEffect } from 'react';
import { type PlayerState, type PassengerState } from '@xeom-rush/shared';

interface DebugOverlayProps {
  rtt: number;
  tickRate: number;
  lastSnapshotBytes: number;
  players: PlayerState[];
  passengers: PassengerState[];
  showDebug: boolean;
  onToggleDebug: (val: boolean) => void;
  onSpawnBots: () => void;
}

export const DebugOverlay: React.FC<DebugOverlayProps> = ({
  rtt,
  tickRate,
  lastSnapshotBytes,
  players,
  passengers,
  showDebug,
  onToggleDebug,
  onSpawnBots,
}) => {
  const [approxJsonBytes, setApproxJsonBytes] = useState(0);

  // Compute equivalent JSON size in bytes to display comparative metrics
  useEffect(() => {
    const rawData = {
      players: players.map((p) => ({
        id: p.id,
        u: p.username,
        x: Number(p.x.toFixed(2)),
        y: Number(p.y.toFixed(2)),
        a: Number(p.angle.toFixed(2)),
        s: p.score,
        seq: p.lastProcessedSeq,
        pid: p.passengerId,
      })),
      passengers: passengers.map((pa) => ({
        id: pa.id,
        x: Number(pa.x.toFixed(2)),
        y: Number(pa.y.toFixed(2)),
        dx: Number(pa.destX.toFixed(2)),
        dy: Number(pa.destY.toFixed(2)),
        r: pa.reward,
      })),
    };
    const jsonStr = JSON.stringify(rawData);
    setApproxJsonBytes(new Blob([jsonStr]).size);
  }, [players, passengers]);

  const compressionRatio = lastSnapshotBytes > 0 ? (approxJsonBytes / lastSnapshotBytes).toFixed(1) : '0.0';

  return (
    <div style={{ pointerEvents: 'auto', position: 'absolute', bottom: 20, right: 20, width: 340 }} className="glass-panel p-4">
      <h3 style={{ fontSize: 12, fontWeight: 900, color: '#10b981', letterSpacing: '0.05em', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>📊 THÔNG SỐ ENGINE HỆ THỐNG</span>
        <span style={{ fontSize: 9, backgroundColor: 'rgba(16, 185, 129, 0.15)', padding: '2px 6px', borderRadius: 4 }}>TRACK 2</span>
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
        {/* Ping / RTT */}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#94a3b8' }}>Độ trễ Mạng (RTT):</span>
          <span style={{ fontWeight: 700, color: rtt < 80 ? '#22c55e' : rtt < 150 ? '#eab308' : '#ef4444' }}>
            {rtt} ms
          </span>
        </div>

        {/* Server Tick Rate */}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#94a3b8' }}>Tần số Server Tick (Hz):</span>
          <span style={{ fontWeight: 700, color: tickRate > 18 ? '#22c55e' : '#ef4444' }}>
            {tickRate.toFixed(1)} / 20.0 ticks/s
          </span>
        </div>

        {/* Binary vs JSON Bytes */}
        <div style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.08)', margin: '4px 0' }} />

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#94a3b8' }}>Kích thước Packet Binary:</span>
          <span style={{ fontWeight: 800, color: '#3b82f6' }}>{lastSnapshotBytes} Bytes</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#94a3b8' }}>Kích thước nếu gửi JSON:</span>
          <span style={{ fontWeight: 500, color: '#e2e8f0' }}>{approxJsonBytes} Bytes</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(59, 130, 246, 0.08)', padding: '6px 10px', borderRadius: 8, border: '1px dashed rgba(59, 130, 246, 0.2)' }}>
          <span style={{ color: '#93c5fd', fontWeight: 600 }}>Tỷ lệ Nén Binary:</span>
          <span style={{ fontWeight: 900, color: '#fbbf24', fontSize: 13 }}>{compressionRatio}x Nhỏ Hơn!</span>
        </div>

        {/* Entities (Spatial Filter Demonstration) */}
        <div style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.08)', margin: '4px 0' }} />

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#94a3b8' }}>Tài xế trong vùng (3x3 Chunks):</span>
          <span style={{ fontWeight: 700, color: '#f8fafc' }}>{players.length} xe</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#94a3b8' }}>Khách hàng trong vùng:</span>
          <span style={{ fontWeight: 700, color: '#f8fafc' }}>{passengers.length} khách</span>
        </div>

        {/* Controls inside panel */}
        <div style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.08)', margin: '4px 0' }} />

        {/* Checkbox spatial debug */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none', margin: '4px 0' }}>
          <input
            type="checkbox"
            checked={showDebug}
            onChange={(e) => onToggleDebug(e.target.checked)}
            style={{ width: 14, height: 14, accentColor: '#10b981', cursor: 'pointer' }}
          />
          <span style={{ fontWeight: 600, color: '#e2e8f0' }}>Vẽ Lưới Chunk Phân Vùng Bản Đồ</span>
        </label>

        {/* Bot spawner button for demo */}
        <button
          onClick={onSpawnBots}
          style={{
            marginTop: 8,
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            color: '#10b981',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 11,
            fontWeight: 800,
            cursor: 'pointer',
            transition: 'all 0.2s',
            textAlign: 'center',
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(16, 185, 129, 0.25)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(16, 185, 129, 0.15)';
          }}
        >
          🤖 KHỞI CHẠY 25 BOTS GIẢ LẬP TẢI
        </button>
      </div>
    </div>
  );
};
