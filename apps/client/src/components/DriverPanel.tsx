import { useEffect, useState } from 'react';
import {
  activeObjectives,
  COSMETICS,
  mastery,
  LANDMARKS,
  DISTRICTS,
  type CareerProfile,
  type ShiftSummary,
} from '@xeom-rush/shared';
import { useGameDialog } from './useGameDialog';
import { inputHandler } from '../game/input';

type PublicCareer = Omit<CareerProfile, 'contributions'>;
export function DriverPanel({
  career,
  summary,
  ranking,
  serverUrl,
  onCommand,
  onClose,
}: {
  career: PublicCareer | null;
  summary: ShiftSummary | null;
  ranking: { id: string; username: string; score: number; deliveries: number }[];
  serverUrl: string;
  onClose: () => void;
  onCommand: (action: string, target?: string) => void;
}) {
  const dialogRef = useGameDialog(true, onClose);
  const [leaders, setLeaders] = useState<PublicCareer[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    inputHandler.clear();
    onCommand('profile');
    const controller = new AbortController();
    const url = new URL(serverUrl);
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    url.search = '';
    url.pathname = url.pathname.replace(/\/$/, '') + '/api/careers';
    void fetch(url, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        setLeaders(await r.json());
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Chưa tải được bảng nghề nghiệp. Thử lại sau nhé.');
      });
    return () => controller.abort();
  }, [serverUrl, onCommand]);
  return (
    <div className='club-cover'>
      <section ref={dialogRef} className='club-panel' role='dialog' aria-modal='true' aria-label='Hồ sơ tài xế'>
        <header>
          <h2>🛵 Câu lạc bộ tài xế</h2>
          <button autoFocus onClick={onClose}>
            Đóng
          </button>
        </header>
        <h3>Nghề nghiệp của bạn</h3>
        {career ? (
          <p>
            <strong>{career.careerScore.toLocaleString('vi-VN')}đ</strong> · {career.totalDeliveries} chuyến · Kỷ lục
            combo {career.peakStreak}
            <br />
            Chuyến nhanh nhất:{' '}
            {career.summary.fastestTripTicks
              ? `${(career.summary.fastestTripTicks / 20).toFixed(1)}s`
              : 'Chưa có'} · {career.summary.cleanTrips} chuyến an toàn
          </p>
        ) : (
          <p>Hoàn thành chuyến xe để ghi dấu nghề nghiệp.</p>
        )}
        {summary && (
          <p>
            Ca này: {Math.round(summary.distance)}m · {summary.cleanTrips} chuyến an toàn · Tiền phạt{' '}
            {summary.fines.toLocaleString('vi-VN')}đ
          </p>
        )}
        <h3>Mục tiêu mỗi ngày & hợp đồng tuần</h3>
        <p>Đổi ngày lúc 00:00 giờ Việt Nam; hợp đồng đổi vào thứ Hai. Nhận quà để mở màu xe và trang phục.</p>
        <ul className='objective-list'>
          {activeObjectives().map((o) => {
            const key = `${o.period}:${o.id}`,
              value = career?.progress[o.period]?.[o.metric] ?? 0;
            const claimed = career?.claims.includes(key);
            return (
              <li key={key}>
                <strong>{o.title}</strong>
                <small>
                  {o.period.startsWith('w:') ? 'Tuần' : 'Hôm nay'} · {Math.min(o.goal, Math.floor(value))}/{o.goal}
                </small>
                <progress value={value} max={o.goal} aria-label={o.title} />
                <button disabled={claimed || value < o.goal} onClick={() => onCommand('claim', key)}>
                  {claimed ? 'Đã nhận' : 'Nhận quà'}
                </button>
              </li>
            );
          })}
        </ul>
        <h3>Tủ đồ tài xế</h3>
        <p>Màu xe, mũ, áo và còi chỉ thay đổi diện mạo. Đã nhận {career?.claimCount ?? 0} quà.</p>
        <div className='wardrobe'>
          {['paint', 'helmet', 'jacket', 'horn'].map((slot) => (
            <label key={slot}>
              {
                (
                  { paint: 'Màu xe', helmet: 'Mũ bảo hiểm', jacket: 'Áo khoác', horn: 'Tiếng còi' } as Record<
                    string,
                    string
                  >
                )[slot]
              }
              <select
                value={career?.equipped[slot] ?? `${slot}-0`}
                onChange={(e) => onCommand('equip', e.target.value)}
              >
                {COSMETICS.filter((c) => c.slot === slot).map((c) => (
                  <option key={c.id} value={c.id} disabled={!career?.unlocked.includes(c.id)}>
                    {c.name}
                    {career?.unlocked.includes(c.id) ? '' : ` · ${c.claims} quà`}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <h3>Huy hiệu tay lái</h3>
        <ul className='badge-list'>
          {career &&
            mastery(career as CareerProfile).map((b) => (
              <li key={b.id} className={b.earned ? 'is-discovered' : ''}>
                {b.earned ? '🏅' : '○'} {b.title} · {Math.min(b.goal, Math.floor(b.value))}/{b.goal}
              </li>
            ))}
        </ul>
        <h3>Thành phố hiện tại</h3>
        <ol>
          {ranking.map((p) => (
            <li key={p.id}>
              {p.username} — {p.score.toLocaleString('vi-VN')}đ · {p.deliveries} chuyến
            </li>
          ))}
        </ol>
        <h3>Hộ chiếu Sài Gòn</h3>
        <p>{DISTRICTS.map((d) => `${d.icon} ${d.name}`).join(' · ')}</p>
        <ul className='passport-list'>
          {LANDMARKS.map((l) => {
            const found = summary?.visited.includes(l.id) || career?.summary.visited.includes(l.id);
            return (
              <li key={l.id} className={found ? 'is-discovered' : ''}>
                <strong>
                  {found ? '✓' : '○'} {l.icon} {l.name}
                </strong>
                <small>{l.story}</small>
              </li>
            );
          })}
        </ul>
        <h3>Nghề nghiệp đã lưu</h3>
        {error && <p role='status'>{error}</p>}
        <ol>
          {leaders.map((p) => (
            <li key={p.id}>
              {p.username} — {p.careerScore.toLocaleString('vi-VN')}đ · {p.totalDeliveries} chuyến
            </li>
          ))}
        </ol>
        <p className='club-note'>Hồ sơ gắn với trình duyệt này. Đổi biệt danh vẫn giữ nghề nghiệp.</p>
      </section>
    </div>
  );
}
