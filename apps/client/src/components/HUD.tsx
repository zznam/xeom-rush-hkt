import { TripGuide } from './TripGuide';
import type { GameplayState } from '@xeom-rush/shared';
import React, { useMemo, useState, useEffect } from 'react';
import { districtAt, type PlayerState, type PassengerState, TICK_RATE } from '@xeom-rush/shared';
import { Minimap } from './Minimap';
import { Joystick } from './Joystick';
import { inputHandler } from '../game/input';
import { soundEngine } from '../game/sound-engine';

interface HUDProps {
  gameplay: GameplayState | null;
  localPlayer: PlayerState | null;
  players: PlayerState[];
  passengers: PassengerState[];
  rushHour: boolean;
  rushHourTicksRemaining: number;
  myStreak: number;
  deliveries: number;
  tutorialDone: boolean;
  cityLabel?: string;
}

function getStreakMultiplier(streak: number): number {
  if (streak >= 10) return 3.0;
  if (streak >= 5) return 2.0;
  if (streak >= 3) return 1.5;
  return 1.0;
}

export const HUD: React.FC<HUDProps> = ({
  gameplay,
  localPlayer,
  players,
  passengers,
  rushHour,
  rushHourTicksRemaining,
  myStreak,
  deliveries,
  tutorialDone,
  cityLabel,
}) => {
  const [isCompact, setIsCompact] = useState(() => window.matchMedia('(max-width: 768px), (pointer: coarse)').matches);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const leaderboard = useMemo(() => [...players].sort((a, b) => b.score - a.score).slice(0, 5), [players]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 768px), (pointer: coarse)');
    const update = () => setIsCompact(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => () => inputHandler.setJoystickInput(0, 0), [isCompact]);

  if (!localPlayer) return null;

  const carriedPassenger = localPlayer.passengerId
    ? (passengers.find((p) => p.id === localPlayer.passengerId) ?? null)
    : null;
  const isCarrying = Boolean(localPlayer.passengerId);
  const streakMultiplier = getStreakMultiplier(myStreak);

  const minimap = (
    <Minimap
      localPlayerId={localPlayer.id}
      players={players}
      passengers={passengers}
      carriedPassengerId={localPlayer.passengerId}
      size={isCompact ? 110 : 150}
      className='hud-minimap'
      navigation={gameplay?.navigation ?? null}
    />
  );

  const ranking = (
    <section id='nearby-drivers' className='hud-leaderboard glass-panel' aria-label='Tài xế quanh bạn'>
      <h3 className='hud-label'>🏆 TÀI XẾ QUANH BẠN</h3>
      <ol className='leaderboard-list'>
        {leaderboard.map((player, idx) => (
          <li key={player.id} className={player.id === localPlayer.id ? 'leaderboard-row is-me' : 'leaderboard-row'}>
            <span className='leaderboard-rank'>#{idx + 1}</span>
            <span className='leaderboard-name' title={player.username}>
              {player.username} {player.id === localPlayer.id && <small>(Bạn)</small>}
            </span>
            <strong>{player.score.toLocaleString('vi-VN')}đ</strong>
          </li>
        ))}
      </ol>
    </section>
  );

  return (
    <div className={`hud-container${isCompact ? ' hud-compact' : ''}${rushHour ? ' has-rush-hour' : ''}`}>
      {rushHour && (
        <div className='rush-hour-banner' role='status'>
          <strong>⚡ GIỜ CAO ĐIỂM</strong>
          <span>+50% thưởng · 2× khách</span>
          <b>{Math.ceil(rushHourTicksRemaining / TICK_RATE)}s</b>
        </div>
      )}

      <div className='hud-left'>
        <section className='hud-summary glass-panel' aria-label='Chuyến xe của bạn'>
          {localPlayer && (
            <p className='hud-city' aria-label='Thành phố hiện tại' title={cityLabel}>
              {cityLabel || 'Sài Gòn'} · {districtAt(localPlayer).name}
            </p>
          )}
          <span className='hud-label'>THU NHẬP ĐƯỜNG PHỐ</span>
          <div className='hud-earnings'>
            <strong>
              {localPlayer.score.toLocaleString('vi-VN')}
              <small> đ</small>
            </strong>
            {myStreak > 0 && (
              <span className={`streak-badge${myStreak >= 5 ? ' streak-high' : ''}`}>
                🔥 {myStreak} COMBO {streakMultiplier > 1 && <b>×{streakMultiplier.toFixed(1)}</b>}
              </span>
            )}
          </div>
          <div className={`driver-status${isCarrying ? ' is-carrying' : ''}`}>
            <i aria-hidden='true' />
            <span>{isCarrying ? 'Đang chở khách' : 'Sẵn sàng đón khách'}</span>
            {carriedPassenger && <strong>+{carriedPassenger.reward.toLocaleString('vi-VN')}đ</strong>}
          </div>
          <TripGuide
            state={gameplay}
            player={localPlayer}
            passengers={passengers}
            streak={myStreak}
            tutorialDone={tutorialDone}
          />
          <p className='trip-progress'>✦ {deliveries} chuyến hoàn thành</p>
        </section>
        {!isCompact && minimap}
      </div>

      <div className='hud-right'>
        {isCompact ? (
          <>
            {minimap}
            <button
              className='leaderboard-toggle-btn'
              aria-label='Tài xế quanh bạn'
              aria-expanded={showLeaderboard}
              aria-controls='nearby-drivers'
              onClick={() => setShowLeaderboard((prev) => !prev)}
            >
              🏆 <span>Xếp hạng</span>
            </button>
            {showLeaderboard && ranking}
          </>
        ) : (
          ranking
        )}
      </div>

      {isCompact && (
        <>
          <div className='joystick-mobile'>
            <Joystick onChange={({ dx, dy }) => inputHandler.setJoystickInput(dx, dy)} />
          </div>
          <button
            className='honk-btn-mobile'
            aria-label='Bấm còi'
            onPointerDown={(event) => {
              event.preventDefault();
              soundEngine.playHonk();
            }}
          >
            <span>📯</span>
            <small>CÒI</small>
          </button>
        </>
      )}
    </div>
  );
};
