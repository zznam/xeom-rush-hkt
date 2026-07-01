import React, { useState, useEffect } from 'react';
import { type PlayerState, type PassengerState, type SnapshotPacketKind } from '@xeom-rush/shared';

interface DebugOverlayProps {
  rtt: number;
  tickRate: number;
  lastSnapshotBytes: number;
  lastPacketKind: SnapshotPacketKind;
  players: PlayerState[];
  passengers: PassengerState[];
  showDebug: boolean;
  onToggleDebug: (val: boolean) => void;
  onSpawnBots: () => void;
  serverUrl: string;
}

export const DebugOverlay: React.FC<DebugOverlayProps> = ({
  rtt,
  tickRate,
  lastSnapshotBytes,
  lastPacketKind,
  players,
  passengers,
  showDebug,
  onToggleDebug,
  onSpawnBots,
  serverUrl,
}) => {
  const [approxJsonBytes, setApproxJsonBytes] = useState(0);
  const [activeTab, setActiveTab] = useState<'stats' | 'logs'>('stats');
  const [botLogs, setBotLogs] = useState<any[]>([]);
  const [botStats, setBotStats] = useState<any>(null);
  const consoleEndRef = React.useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (activeTab !== 'logs') return;

    const httpUrl = serverUrl.replace('ws://', 'http://').replace('wss://', 'https://');
    const fetchLogs = async () => {
      try {
        const res = await fetch(`${httpUrl}/api/bot-logs`);
        if (!res.ok) throw new Error('API error');
        const data = await res.json();
        setBotLogs(data.logs || []);
        setBotStats(data.stats || null);
      } catch (err) {
        console.error('Error fetching bot logs:', err);
      }
    };

    fetchLogs();
    const interval = setInterval(fetchLogs, 1000);
    return () => clearInterval(interval);
  }, [activeTab, serverUrl]);

  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [botLogs]);

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
    <div className="debug-overlay-fixed glass-panel p-4" style={{ width: 330 }}>
      {/* Premium Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 8 }}>
        <button
          onClick={() => setActiveTab('stats')}
          style={{
            flex: 1,
            background: activeTab === 'stats' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
            border: '1px solid ' + (activeTab === 'stats' ? 'rgba(59, 130, 246, 0.3)' : 'transparent'),
            color: activeTab === 'stats' ? '#93c5fd' : '#94a3b8',
            borderRadius: 8,
            padding: '6px 12px',
            fontSize: 11,
            fontWeight: 800,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          📊 HỆ THỐNG
        </button>
        <button
          onClick={() => setActiveTab('logs')}
          style={{
            flex: 1,
            background: activeTab === 'logs' ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
            border: '1px solid ' + (activeTab === 'logs' ? 'rgba(16, 185, 129, 0.3)' : 'transparent'),
            color: activeTab === 'logs' ? '#34d399' : '#94a3b8',
            borderRadius: 8,
            padding: '6px 12px',
            fontSize: 11,
            fontWeight: 800,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          🤖 NHẬT KÝ BOT
        </button>
      </div>

      {activeTab === 'stats' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
          <h3 style={{ fontSize: 12, fontWeight: 900, color: '#10b981', letterSpacing: '0.05em', marginBottom: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>📊 THÔNG SỐ ENGINE</span>
            <span style={{ fontSize: 9, backgroundColor: 'rgba(16, 185, 129, 0.15)', padding: '2px 6px', borderRadius: 4 }}>TRACK 2</span>
          </h3>

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
            <span style={{ color: '#94a3b8' }}>Chế độ Snapshot:</span>
            <span style={{ fontWeight: 800, color: lastPacketKind === 'delta' ? '#22c55e' : '#fbbf24' }}>
              {lastPacketKind === 'delta' ? 'DELTA' : 'FULL'}
            </span>
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
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
          {botStats && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, backgroundColor: 'rgba(255,255,255,0.02)', padding: 10, borderRadius: 10, border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                <span style={{ color: '#94a3b8' }}>Tổng số Bots AI:</span>
                <span style={{ fontWeight: 800, color: '#10b981' }}>{botStats.totalBots} bots</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                <span style={{ color: '#94a3b8' }}>Trạng thái:</span>
                <span style={{ fontWeight: 600, color: '#e2e8f0' }}>
                  🔍 {botStats.states.SEEKING_PASSENGER} | 🟢 {botStats.states.NAVIGATING_TO_PICKUP} | 🏁 {botStats.states.NAVIGATING_TO_DROPOFF}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                <span style={{ color: '#94a3b8' }}>Số bot bị kẹt:</span>
                <span style={{ fontWeight: 800, color: botStats.stuckCount > 0 ? '#f87171' : '#10b981' }}>
                  ⚠️ {botStats.stuckCount} bot {botStats.stuckCount > 0 && '(Đang giải vây)'}
                </span>
              </div>
            </div>
          )}

          <div style={{
            height: 200,
            overflowY: 'auto',
            fontFamily: 'monospace',
            fontSize: 10,
            backgroundColor: 'rgba(0,0,0,0.4)',
            padding: 8,
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.05)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}>
            {botLogs.length === 0 ? (
              <div style={{ color: '#64748b', textAlign: 'center', marginTop: 90 }}>Đang chờ nhật ký từ máy chủ...</div>
            ) : (
              botLogs.map((log, index) => {
                const style = EVENT_STYLES[log.event] || { bg: 'rgba(100, 116, 139, 0.15)', text: '#94a3b8' };
                return (
                  <div key={index} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)', paddingBottom: 4, lineHeight: '1.4' }}>
                    <span style={{ color: '#64748b', marginRight: 4 }}>[{log.timestamp}]</span>
                    <span style={{ color: '#60a5fa', marginRight: 4, fontWeight: 600 }}>{log.botId}</span>
                    <span style={{ backgroundColor: style.bg, color: style.text, fontSize: 8, padding: '1px 4px', borderRadius: 4, fontWeight: 900, marginRight: 6, display: 'inline-block' }}>
                      {log.event}
                    </span>
                    <span style={{ color: '#cbd5e1' }}>{log.details}</span>
                  </div>
                );
              })
            )}
            <div ref={consoleEndRef} />
          </div>
        </div>
      )}
    </div>
  );
};

const EVENT_STYLES: Record<string, { bg: string, text: string }> = {
  SPAWN: { bg: 'rgba(16, 185, 129, 0.15)', text: '#34d399' },
  STATE_CHANGE: { bg: 'rgba(59, 130, 246, 0.15)', text: '#60a5fa' },
  MILD_STUCK: { bg: 'rgba(234, 179, 8, 0.15)', text: '#fbbf24' },
  HARD_STUCK: { bg: 'rgba(239, 68, 68, 0.15)', text: '#f87171' },
  TRAFFIC: { bg: 'rgba(249, 115, 22, 0.15)', text: '#fb923c' },
  WANDER: { bg: 'rgba(139, 92, 246, 0.15)', text: '#c084fc' },
};
