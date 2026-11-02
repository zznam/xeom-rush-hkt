import { useGameDialog } from './useGameDialog';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { JOB_LABELS, PERSONAS, type GameplayState, type PassengerState, type PlayerState } from '@xeom-rush/shared';
import { network } from '../game/network';
import { inputHandler } from '../game/input';
import './PickupFilters.css';
const TIERS = ['Thường', 'Công việc', 'VIP'];
export function TripGuide({
  state,
  player,
  passengers,
  tutorialDone,
}: {
  state: GameplayState | null;
  player: PlayerState;
  passengers: PassengerState[];
  tutorialDone: boolean;
}) {
  const [choosing, setChoosing] = useState(false);
  const [jobFilter, setJobFilter] = useState('all');
  const [tierFilter, setTierFilter] = useState('all');
  const [sort, setSort] = useState('distance');
  const dialogRef = useGameDialog(choosing, () => setChoosing(false));
  if (state?.teamNavigation)
    return (
      <div className='trip-guide'>
        <small className='hud-label'>TIẾP SỨC HAI ĐỘI</small>
        <h3>📦 {state.teamNavigation}</h3>
        <p>
          {state.navigation
            ? `${Math.ceil(state.navigation.distance)}m · Lái theo GPS; trao gói khi hai người cách nhau dưới 70m.`
            : 'Đợi kết quả vòng năm phút.'}
        </p>
      </div>
    );
  const nav = state?.navigation,
    trip = state?.trip;
  const offers = new Map(state?.offers?.map((offer) => [offer.id, offer]));
  const available = passengers
    .filter((p) => !p.isCarried && (p.deadline === 0 || p.deadline > (state?.tick ?? 0)))
    .flatMap((passenger) => {
      const offer = offers.get(passenger.id);
      return offer ? [{ passenger, offer, distance: Math.hypot(passenger.x - player.x, passenger.y - player.y) }] : [];
    });
  const nearby = available
    .filter(
      ({ passenger, offer }) =>
        (jobFilter === 'all' || offer.kind === jobFilter) &&
        (tierFilter === 'all' || passenger.tier === Number(tierFilter)),
    )
    .sort((a, b) => {
      if (sort === 'fare' && a.offer.fare.total !== b.offer.fare.total) return b.offer.fare.total - a.offer.fare.total;
      if (sort === 'expiry') {
        const expiryA = a.passenger.deadline || Infinity;
        const expiryB = b.passenger.deadline || Infinity;
        if (expiryA !== expiryB) return expiryA - expiryB;
      }
      return a.distance - b.distance || a.passenger.id.localeCompare(b.passenger.id);
    });
  const filtered = jobFilter !== 'all' || tierFilter !== 'all';
  return (
    <div className='trip-guide'>
      <small className='hud-label'>
        {state?.practice ? 'TẬP LÁI RIÊNG CHO BẠN' : tutorialDone ? 'CHUYẾN XE HIỆN TẠI' : 'CHUYẾN ĐẦU TIÊN'}
      </small>
      <h3>
        {trip
          ? `${trip.kind === 'parcel' ? '📦' : trip.kind === 'food' ? '🥡' : '🏁'} ${JOB_LABELS[trip.kind]} · ${trip.stopIndex + 1}/${trip.stops.length}`
          : '🙋 Có người đang đợi!'}
      </h3>
      {state?.practice && (
        <p>Khách này dành riêng cho bạn. Lái theo GPS để thử đón và trả khách; chuyến tập không tính điểm.</p>
      )}
      {nav ? (
        <>
          <p className='trip-fare'>
            {TIERS[nav.tier]} · Gốc {nav.fare.base.toLocaleString('vi-VN')}đ<br />
            <strong>Dự kiến {nav.fare.total.toLocaleString('vi-VN')}đ</strong> · {Math.ceil(nav.distance)}m
          </p>
          <p className='trip-timing'>
            {trip
              ? !state?.city.enabled
                ? 'Chuyến thường · nhận cước khi đến nơi'
                : trip.clean
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
      {trip?.dialogue && (
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
      {!player.passengerId && !state?.practice && (
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
              <div className='pickup-filters'>
                <label>
                  Loại chuyến
                  <select value={jobFilter} onChange={(event) => setJobFilter(event.target.value)}>
                    <option value='all'>Tất cả loại chuyến</option>
                    {Object.entries(JOB_LABELS).map(([kind, label]) => (
                      <option key={kind} value={kind}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Hạng khách
                  <select value={tierFilter} onChange={(event) => setTierFilter(event.target.value)}>
                    <option value='all'>Tất cả hạng khách</option>
                    {TIERS.map((tier, index) => (
                      <option key={tier} value={index}>
                        {tier}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Sắp xếp chuyến
                  <select value={sort} onChange={(event) => setSort(event.target.value)}>
                    <option value='distance'>Gần nhất</option>
                    <option value='fare'>Cước cao nhất</option>
                    <option value='expiry'>Sắp hết giờ chờ</option>
                  </select>
                </label>
              </div>
              <p className='pickup-result-count' role='status'>
                {nearby.length}/{available.length} chuyến phù hợp trong các đề nghị gần bạn.
              </p>
              {filtered && (
                <button
                  onClick={() => {
                    setJobFilter('all');
                    setTierFilter('all');
                  }}
                >
                  Xóa bộ lọc
                </button>
              )}{' '}
              <button
                onClick={() => {
                  network.command('select-pickup');
                  setChoosing(false);
                }}
              >
                Tự động đón khách gần
              </button>
              <div className='pickup-list'>
                {nearby.map(({ passenger: p, offer, distance }) => {
                  const fare = offer.fare;
                  return (
                    <button
                      key={p.id}
                      data-pickup-id={p.id}
                      aria-pressed={state?.selectedPickup === p.id}
                      onClick={() => {
                        network.command('select-pickup', p.id);
                        setChoosing(false);
                      }}
                    >
                      <strong>
                        {JOB_LABELS[offer.kind]} · {fare.total.toLocaleString('vi-VN')}đ
                      </strong>
                      <small>
                        {TIERS[p.tier]} · {offer.stops} điểm · {offer.goalLabel} · Gốc{' '}
                        {p.reward.toLocaleString('vi-VN')}đ · Cách {Math.ceil(distance)}m
                        {p.deadline > 0 && state
                          ? ` · Chờ ${Math.max(0, Math.ceil((p.deadline - state.tick) / 20))}s`
                          : ''}
                      </small>
                    </button>
                  );
                })}
              </div>
              {!nearby.length && (
                <p>
                  {available.length
                    ? 'Không có chuyến phù hợp. Xóa bộ lọc để xem các đề nghị khác.'
                    : 'Chưa có đề nghị quanh đây. Lái tới khu chợ hoặc đợi khách mới nhé.'}
                </p>
              )}
            </section>
          </div>,
          document.querySelector('.game-shell') ?? document.body,
        )}
    </div>
  );
}
