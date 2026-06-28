import React, { useMemo } from 'react';
import { type PlayerState, type PassengerState, TICK_RATE } from '@xeom-rush/shared';
import { Minimap } from './Minimap';

interface HUDProps {
  localPlayer: PlayerState | null;
  players: PlayerState[];
  passengers: PassengerState[];
  rushHour: boolean;
  rushHourTicksRemaining: number;
  myStreak: number;
}

function getStreakMultiplier(streak: number): number {
  if (streak >= 10) return 3.0;
  if (streak >= 5) return 2.0;
  if (streak >= 3) return 1.5;
  return 1.0;
}

export const HUD: React.FC<HUDProps> = ({
  localPlayer,
  players,
  passengers,
  rushHour,
  rushHourTicksRemaining,
  myStreak,
}) => {
  if (!localPlayer) return null;

  // Compute leaderboard sorted by score
  const leaderboard = useMemo(
    () => [...players].sort((a, b) => b.score - a.score).slice(0, 5),
    [players],
  );

  // Retrieve active passenger if local player is carrying one
  const carriedPassenger = localPlayer.passengerId
    ? passengers.find((p) => p.id === localPlayer.passengerId) ?? null
    : null;

  const streakMultiplier = getStreakMultiplier(myStreak);
  const rushHourSecondsLeft = Math.ceil(rushHourTicksRemaining / TICK_RATE);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: 'none',
      }}
      className="hud-container"
    >
      {/* ── Rush Hour Banner ── */}
      {rushHour && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            padding: '8px 16px',
            background: 'linear-gradient(90deg, rgba(251,191,36,0.12), rgba(251,191,36,0.20), rgba(251,191,36,0.12))',
            borderBottom: '1px solid rgba(251,191,36,0.35)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 12,
            animation: 'rushHourPulse 1.5s ease-in-out infinite',
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 900, color: '#fbbf24', letterSpacing: '0.05em' }}>
            ⚡ GIỜ CAO ĐIỂM
          </span>
          <span style={{ fontSize: 12, color: '#fde68a', fontWeight: 700 }}>
            +50% THƯỞNG · 2× TỐC ĐỘ SPAWN
          </span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 900,
              color: '#fbbf24',
              minWidth: 40,
              textAlign: 'right',
            }}
          >
            {rushHourSecondsLeft}s
          </span>
        </div>
      )}

      {/* ── Score & Passenger Info ── */}
      <div style={{ pointerEvents: 'auto', position: 'absolute', top: rushHour ? 52 : 20, left: 20, width: 320 }} className="glass-panel p-4">
        <div className="flex flex-col gap-1">
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: '#94a3b8' }}>
            THU NHẬP ĐƯỜNG PHỐ (VNĐ)
          </span>
          <span style={{ fontSize: 32, fontWeight: 900, fontFamily: 'Outfit', color: '#fbbf24' }}>
            {localPlayer.score.toLocaleString()} đ
          </span>
        </div>

        {/* Streak badge */}
        {myStreak > 0 && (
          <div
            style={{
              marginTop: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 10px',
              borderRadius: 20,
              background: myStreak >= 10
                ? 'linear-gradient(90deg, rgba(168,85,247,0.25), rgba(236,72,153,0.25))'
                : myStreak >= 5
                ? 'rgba(251,191,36,0.15)'
                : 'rgba(34,197,94,0.12)',
              border: '1px solid',
              borderColor: myStreak >= 10 ? 'rgba(168,85,247,0.4)' : myStreak >= 5 ? 'rgba(251,191,36,0.3)' : 'rgba(34,197,94,0.2)',
              width: 'fit-content',
            }}
          >
            <span style={{ fontSize: 14 }}>🔥</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: myStreak >= 10 ? '#c084fc' : myStreak >= 5 ? '#fbbf24' : '#86efac' }}>
              {myStreak} COMBO
            </span>
            {streakMultiplier > 1 && (
              <span style={{
                fontSize: 11,
                fontWeight: 900,
                color: '#f8fafc',
                background: 'rgba(0,0,0,0.3)',
                padding: '1px 6px',
                borderRadius: 10,
              }}>
                ×{streakMultiplier.toFixed(1)}
              </span>
            )}
          </div>
        )}

        <div style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.08)', margin: '12px 0' }} />

        {/* Carry status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              backgroundColor: carriedPassenger ? '#ef4444' : '#22c55e',
              boxShadow: carriedPassenger ? '0 0 8px #ef4444' : '0 0 8px #22c55e',
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8' }}>TRẠNG THÁI TÀI XẾ</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {carriedPassenger
                ? `Đang chở khách tới điểm hẹn!`
                : 'Đang tìm khách tại Chợ Bến Thành...'}
            </span>
          </div>
        </div>

        {carriedPassenger && (
          <div
            style={{
              marginTop: 12,
              padding: 10,
              backgroundColor: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.15)',
              borderRadius: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <span style={{ fontSize: 10, fontWeight: 700, color: '#fca5a5' }}>
              📍 KHÁCH HÀNG THU NHẬP:
            </span>
            <span style={{ fontSize: 12, fontWeight: 800, color: '#fca5a5' }}>
              +{carriedPassenger.reward.toLocaleString()} VNĐ
            </span>
            <span style={{ fontSize: 11, color: '#e2e8f0', marginTop: 4 }}>
              Hãy đi theo đường chỉ dẫn màu đỏ trên bản đồ.
            </span>
          </div>
        )}
      </div>

      {/* ── Minimap (top-center) ── */}
      <Minimap
        localPlayerId={localPlayer.id}
        players={players}
        passengers={passengers}
        carriedPassengerId={localPlayer.passengerId}
      />

      {/* ── Leaderboard ── */}
      <div style={{ pointerEvents: 'auto', position: 'absolute', top: rushHour ? 52 : 20, right: 20, width: 280 }} className="glass-panel p-4">
        <h3 style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.05em', color: '#94a3b8', marginBottom: 12 }}>
          🏆 BANG XẾP HẠNG TÀI XẾ
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {leaderboard.map((player, idx) => {
            const isMe = player.id === localPlayer.id;
            return (
              <div
                key={player.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '6px 10px',
                  borderRadius: 8,
                  backgroundColor: isMe ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                  border: isMe ? '1px solid rgba(59, 130, 246, 0.25)' : '1px solid transparent',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: idx === 0 ? '#fbbf24' : '#94a3b8' }}>
                    #{idx + 1}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: isMe ? 700 : 500, color: isMe ? '#93c5fd' : '#f8fafc' }}>
                    {player.username} {isMe && '(Bạn)'}
                  </span>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#cbd5e1' }}>
                  {player.score.toLocaleString()}đ
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Navigation Controls Indicator ── */}
      <div
        style={{
          pointerEvents: 'auto',
          position: 'absolute',
          bottom: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 16,
          padding: '8px 16px',
          fontSize: 12,
          fontWeight: 600,
          color: '#94a3b8',
        }}
        className="glass-panel"
      >
        <span>⌨️ Di chuyển: <strong>WASD</strong> hoặc <strong>Phím Mũi Tên</strong></span>
        <span style={{ color: 'rgba(255,255,255,0.1)' }}>|</span>
        <span>📯 Còi: <strong>H</strong></span>
        <span style={{ color: 'rgba(255,255,255,0.1)' }}>|</span>
        <span>🛵 Trả khách tại điểm màu đỏ để nhận tiền!</span>
      </div>

      <style>{`
        .p-4 { padding: 16px; }
        .flex { display: flex; }
        .flex-col { flex-direction: column; }
        .gap-1 { gap: 4px; }
        @keyframes rushHourPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.75; }
        }
      `}</style>
    </div>
  );
};
