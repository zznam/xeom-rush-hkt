import { useGameDialog } from './useGameDialog';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  JOB_LABELS,
  PERSONAS,
  calculateFare,
  type GameplayState,
  type PassengerState,
  type PlayerState,
} from '@xeom-rush/shared';
import { network } from '../game/network';
import { inputHandler } from '../game/input';
const TIERS = ['Thường', 'Công việc', 'VIP'];
export function TripGuide({
  state,
  player,
  passengers,
  streak,
  tutorialDone,
}: {
  state: GameplayState | null;
  player: PlayerState;
  passengers: PassengerState[];
  streak: number;
  tutorialDone: boolean;
}) {
  const [choosing, setChoosing] = useState(false);
  const dialogRef = useGameDialog(choosing, () => setChoosing(false));
  const nav = state?.navigation,
    trip = state?.trip;
  const nearby = passengers
    .filter((p) => !p.isCarried)
    .sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y))
    .slice(0, 8);
  return (
    <div className='trip-guide'>
      <small className='hud-label'>{tutorialDone ? 'CHUYẾN XE HIỆN TẠI' : 'CHUYẾN ĐẦU TIÊN'}</small>
      <h3>
        {trip
          ? `${trip.kind === 'parcel' ? '📦' : trip.kind === 'food' ? '🥡' : '🏁'} ${JOB_LABELS[trip.kind]} · ${trip.stopIndex + 1}/${trip.stops.length}`
          : '🙋 Có người đang đợi!'}
      </h3>
      {nav ? (
        <>
          <p className='trip-fare'>
            {TIERS[nav.tier]} · Gốc {nav.fare.base.toLocaleString('vi-VN')}đ<br />
            <strong>Dự kiến {nav.fare.total.toLocaleString('vi-VN')}đ</strong> · {Math.ceil(nav.distance)}m
          </p>
          <p className='trip-timing'>
            {trip
              ? trip.clean
                ? '✓ Đang giữ thưởng an toàn'
                : 'Chuyến đã có va chạm / vi phạm'
              : nav.pickupExpiryTick
                ? `Khách chờ thêm ${Math.max(0, Math.ceil((nav.pickupExpiryTick - state!.tick) / 20))}s`
                : 'Khách đang chờ bạn'}
          </p>
        </>
      ) : (
        <p>Lái lại gần khách đang vẫy tay để tự động đón.</p>
      )}
      {trip && (
        <div className='passenger-story'>
          <blockquote>“{trip.dialogue}”</blockquote>
          <small>
            {PERSONAS.find((p) => p.id === trip.persona)?.name} · {trip.goalLabel}
          </small>
          <p>
            {trip.kind === 'food'
              ? `Độ tươi ${Math.round(trip.freshness * 100)}%`
              : trip.kind === 'parcel'
                ? `Nguyên vẹn ${Math.round((1 - trip.damage) * 100)}%`
                : trip.quickTicksRemaining
                  ? `Gợi ý ${Math.ceil(trip.quickTicksRemaining / 20)}s`
                  : ''}{' '}
            · Tip hiện tại {trip.fare.tip.toLocaleString('vi-VN')}đ
          </p>
        </div>
      )}
      {!player.passengerId && (
        <button
          className='pickup-choice-button'
          onClick={() => {
            inputHandler.clear();
            setChoosing(true);
          }}
        >
          Chọn khách {state?.selectedPickup ? '✓' : '↗'}
        </button>
      )}
      {!!state?.comboTicksRemaining && (
        <p className='combo-clock'>🔥 Giữ combo · {Math.ceil(state.comboTicksRemaining / 20)}s</p>
      )}
      {choosing &&
        createPortal(
          <div className='club-cover'>
            <section ref={dialogRef} className='club-panel' role='dialog' aria-modal='true' aria-label='Chọn khách'>
              <header>
                <h2>Ai đang chờ bạn?</h2>
                <button autoFocus onClick={() => setChoosing(false)}>
                  Đóng
                </button>
              </header>
              <p>Chọn một khách để chỉ đón người đó. Khách vẫn có thể được tài xế khác đón.</p>
              <button
                onClick={() => {
                  network.command('select-pickup');
                  setChoosing(false);
                }}
              >
                Tự động đón khách gần
              </button>
              <div className='pickup-list'>
                {nearby.map((p) => {
                  const offer = state?.offers?.find((o) => o.id === p.id);
                  const fare = offer?.fare ?? calculateFare(p.reward, streak, 1, true);
                  return (
                    <button
                      key={p.id}
                      aria-pressed={state?.selectedPickup === p.id}
                      onClick={() => {
                        network.command('select-pickup', p.id);
                        setChoosing(false);
                      }}
                    >
                      <strong>
                        {offer ? JOB_LABELS[offer.kind] : TIERS[p.tier]} · {fare.total.toLocaleString('vi-VN')}đ
                      </strong>
                      <small>
                        {offer ? `${offer.stops} điểm · ${offer.goalLabel} · ` : ''}Gốc{' '}
                        {p.reward.toLocaleString('vi-VN')}đ · Cách{' '}
                        {Math.ceil(Math.hypot(p.x - player.x, p.y - player.y))}m
                        {p.deadline > 0 && state
                          ? ` · Chờ ${Math.max(0, Math.ceil((p.deadline - state.tick) / 20))}s`
                          : ''}
                      </small>
                    </button>
                  );
                })}
              </div>
              {!nearby.length && <p>Chưa có khách quanh đây. Lái tới khu chợ nhé.</p>}
            </section>
          </div>,
          document.querySelector('.game-shell') ?? document.body,
        )}
    </div>
  );
}
