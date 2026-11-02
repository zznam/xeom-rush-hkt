import { useEffect, useState } from 'react';
import {
  GOAL_LABELS,
  MODE_LABELS,
  SHIFT_LIMIT,
  loadShiftGoal,
  loadShifts,
  saveShift,
  storeNotebook,
  type GoalMetric,
  type ShiftGoal,
  type ShiftRecord,
} from '../game/shift-notebook';
import './ShiftNotebook.css';

type Metrics = Pick<ShiftRecord, GoalMetric>;

function GoalProgress({ goal, metrics }: { goal: ShiftGoal; metrics: Metrics }) {
  const value = Math.floor(metrics[goal.metric]);
  return (
    <div className='shift-goal-progress' aria-label='Tiến độ mục tiêu'>
      <p>
        {GOAL_LABELS[goal.metric]}: {value.toLocaleString('vi-VN')} / {goal.target.toLocaleString('vi-VN')}
      </p>
      <progress aria-label='Mục tiêu ca xe' max={goal.target} value={Math.min(value, goal.target)} />
      <span role='status'>
        {value >= goal.target
          ? '✓ Đã đạt mục tiêu!'
          : `Còn ${(goal.target - value).toLocaleString('vi-VN')} để đạt mục tiêu.`}
      </span>
    </div>
  );
}

export function ShiftNotebook({ metrics }: { metrics: Metrics }) {
  const [goal, setGoal] = useState(loadShiftGoal);
  const [metric, setMetric] = useState<GoalMetric>(goal?.metric ?? 'deliveries');
  const [target, setTarget] = useState(String(goal?.target ?? 5));
  const [shifts, setShifts] = useState(loadShifts);
  const [status, setStatus] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  return (
    <section className='shift-notebook' aria-label='Sổ ca xe'>
      <h3>Mục tiêu ca xe</h3>
      <p>Tự chọn thử thách cho ca này. Mục tiêu được giữ cho ca sau, tiến độ tính lại từ đầu mỗi ca.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const value = Number(target);
          if (!Number.isInteger(value) || value < 1 || value > 10_000_000) {
            setStatus('Nhập số nguyên từ 1 đến 10.000.000.');
            return;
          }
          const next = { metric, target: value };
          if (!storeNotebook('shift-goal', next)) {
            setStatus('Trình duyệt không cho lưu mục tiêu. Hãy bật bộ nhớ trình duyệt rồi thử lại.');
            return;
          }
          setGoal(next);
          setStatus('Đã lưu mục tiêu.');
        }}
      >
        <div className='settings-grid'>
          <label>
            Loại mục tiêu
            <select value={metric} onChange={(e) => setMetric(e.target.value as GoalMetric)}>
              {Object.entries(GOAL_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Đích ca xe
            <input
              type='number'
              min='1'
              max='10000000'
              step='1'
              required
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </label>
        </div>
        <button type='submit'>Lưu mục tiêu</button>{' '}
        {goal && (
          <button
            type='button'
            onClick={() => {
              if (storeNotebook('shift-goal', null)) {
                setGoal(null);
                setStatus('Đã tắt mục tiêu.');
              } else setStatus('Chưa tắt được mục tiêu. Bộ nhớ trình duyệt không khả dụng.');
            }}
          >
            Tắt mục tiêu
          </button>
        )}
      </form>
      {goal && <GoalProgress goal={goal} metrics={metrics} />}
      <p role='status'>{status}</p>
      <h3>Nhật ký ca xe</h3>
      <p>
        Lưu tối đa {SHIFT_LIMIT} ca đã kết thúc trên trình duyệt này. Đây là sổ cá nhân; ca chơi thử và phòng bạn bè
        được ghi riêng.
      </p>
      {!shifts.length ? (
        <p>Chưa có ca đã lưu. Chọn Kết thúc để ghi ca đầu tiên.</p>
      ) : (
        <>
          <ol className='shift-history'>
            {shifts.map((shift) => (
              <li key={shift.id}>
                <b>
                  {MODE_LABELS[shift.mode]} · {shift.score.toLocaleString('vi-VN')}đ
                </b>
                <span>
                  {new Intl.DateTimeFormat('vi-VN', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                    timeZone: 'Asia/Ho_Chi_Minh',
                  }).format(shift.endedAt)}
                </span>
                <span>
                  {shift.deliveries} chuyến · {shift.cleanTrips} an toàn · {shift.distance.toLocaleString('vi-VN')}m ·
                  Phạt {shift.fines.toLocaleString('vi-VN')}đ
                </span>
              </li>
            ))}
          </ol>
          {confirmClear ? (
            <div>
              <p>Xóa nhật ký trên trình duyệt này? Điểm nghề nghiệp trên máy chủ vẫn được giữ.</p>
              <button
                onClick={() => {
                  if (storeNotebook('shift-history', { version: 1, shifts: [] })) {
                    setShifts([]);
                    setConfirmClear(false);
                    setStatus('Đã xóa nhật ký ca xe.');
                  } else setStatus('Chưa xóa được nhật ký. Bộ nhớ trình duyệt không khả dụng.');
                }}
              >
                Xác nhận xóa nhật ký
              </button>{' '}
              <button onClick={() => setConfirmClear(false)}>Giữ nhật ký</button>
            </div>
          ) : (
            <button onClick={() => setConfirmClear(true)}>Xóa nhật ký</button>
          )}
        </>
      )}
    </section>
  );
}

export function ShiftResult({ record }: { record: ShiftRecord }) {
  const [previous] = useState(() => loadShifts().filter((s) => s.mode === record.mode && s.id !== record.id));
  const [goal] = useState(loadShiftGoal);
  const [saved, setSaved] = useState<boolean | null>(null);
  useEffect(() => {
    setSaved(saveShift(record));
  }, [record]);
  return (
    <section className='shift-result' aria-label='Thành tích cá nhân'>
      <h3>
        So với {previous.length} ca {MODE_LABELS[record.mode].toLowerCase()} gần đây
      </h3>
      {!previous.length ? (
        <p>Ca đầu tiên làm mốc cho lần sau.</p>
      ) : (
        <ul>
          {(['score', 'deliveries', 'cleanTrips', 'distance'] as const).map((metric) => {
            const best = Math.max(...previous.map((s) => s[metric]));
            return (
              <li key={metric}>
                {GOAL_LABELS[metric]}: {record[metric].toLocaleString('vi-VN')} ·{' '}
                {record[metric] > best ? 'Kỷ lục mới!' : `Mốc tốt nhất ${best.toLocaleString('vi-VN')}`}
              </li>
            );
          })}
        </ul>
      )}
      {goal && <GoalProgress goal={goal} metrics={record} />}
      <p role='status'>
        {saved === null
          ? 'Đang lưu nhật ký…'
          : saved
            ? 'Đã lưu vào nhật ký ca xe trên trình duyệt.'
            : 'Chưa lưu được nhật ký. Bộ nhớ trình duyệt không khả dụng.'}
      </p>
    </section>
  );
}
