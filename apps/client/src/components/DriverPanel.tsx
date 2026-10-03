import { useEffect, useState } from 'react';
import type { CareerProfile, ShiftSummary } from '@xeom-rush/shared';
import { inputHandler } from '../game/input';

type PublicCareer = Omit<CareerProfile, 'contributions'>;
export function DriverPanel({
  career,
  summary,
  ranking,
  serverUrl,
  onClose,
}: {
  career: PublicCareer | null;
  summary: ShiftSummary | null;
  ranking: { id: string; username: string; score: number; deliveries: number }[];
  serverUrl: string;
  onClose: () => void;
}) {
  const [leaders, setLeaders] = useState<PublicCareer[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    inputHandler.clear();
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
  }, [serverUrl]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onClose]);
  return (
    <div className='club-cover'>
      <section className='club-panel' role='dialog' aria-modal='true' aria-label='Hồ sơ tài xế'>
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
        <h3>Thành phố hiện tại</h3>
        <ol>
          {ranking.map((p) => (
            <li key={p.id}>
              {p.username} — {p.score.toLocaleString('vi-VN')}đ · {p.deliveries} chuyến
            </li>
          ))}
        </ol>
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
