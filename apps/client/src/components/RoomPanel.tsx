import { useState } from 'react';
import type { RoomState } from '@xeom-rush/shared';
import { network } from '../game/network';
import { roomApiBase } from '../game/rooms';
import { useGameDialog } from './useGameDialog';
export function RoomPanel({
  state,
  playerId,
  serverUrl,
  onLeave,
}: {
  state: RoomState;
  playerId: string;
  serverUrl: string;
  onLeave: () => void;
}) {
  const [copied, setCopied] = useState(false),
    waiting = state.status !== 'running';
  const ref = useGameDialog(waiting, onLeave);
  const me = state.players.find((p) => p.playerId === playerId),
    host = me?.id === state.hostId;
  const link = new URL(location.origin);
  link.searchParams.set('room', `${roomApiBase(serverUrl)}/api/rooms/${state.invite}`);
  if (!waiting) return null;
  return (
    <div className='club-cover'>
      <section ref={ref} className='club-panel' role='dialog' aria-modal='true' aria-label='Phòng riêng'>
        <header>
          <h2>
            {state.status === 'lobby'
              ? 'Bạn bè đã sẵn sàng?'
              : state.status === 'interrupted'
                ? 'Vòng chơi bị gián đoạn'
                : 'Kết quả vòng chơi'}
          </h2>
          <button autoFocus onClick={onLeave}>
            Rời phòng
          </button>
        </header>
        <p>{state.reason || 'Đợi bạn bè vào phòng rồi bắt đầu vòng năm phút.'}</p>
        <label className='invite-field'>
          Liên kết mời
          <input readOnly value={link.toString()} onFocus={(e) => e.currentTarget.select()} />
        </label>
        <button
          onClick={() =>
            void navigator.clipboard
              .writeText(link.toString())
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }
        >
          {copied ? 'Đã sao chép' : 'Sao chép lời mời'}
        </button>
        {host && (
          <label>
            Chế độ vòng
            <select
              aria-label='Chế độ vòng'
              value={state.mode}
              onChange={(e) => network.command('room-mode', undefined, e.target.value)}
            >
              <option value='competitive'>Thi đua cá nhân</option>
              <option value='co-op'>Co-op điều phối</option>
              <option value='relay'>Tiếp sức hai đội</option>
            </select>
          </label>
        )}
        {state.mode === 'relay' && (
          <div>
            <p>Mỗi đội hai đến bốn người thật. Bạn thuộc đội {me?.team}.</p>
            <button onClick={() => network.command('room-team', undefined, '1')}>Vào đội 1</button>
            <button onClick={() => network.command('room-team', undefined, '2')}>Vào đội 2</button>
          </div>
        )}
        <ul>
          {state.players.map((p) => (
            <li key={p.id}>
              {p.connected ? '●' : '○'} {p.username}
              {p.id === state.hostId ? ' · Chủ phòng' : ''}
              {p.id === me?.id ? ' · Bạn' : ''}
              {state.mode === 'relay' ? ` · Đội ${p.team}` : ''}
            </li>
          ))}
        </ul>
        {state.teamPlay?.kind === 'relay' &&
          state.status !== 'lobby' &&
          state.teamPlay.teams.map((t) => (
            <p key={t.id}>
              Đội {t.id}: {t.score.toLocaleString('vi-VN')}đ ·{' '}
              {t.failed || (t.completed ? 'Đã hoàn thành' : 'Chưa tới đích')}
            </p>
          ))}
        {!!state.results.length && (
          <ol className='room-results'>
            {state.results.map((p) => (
              <li key={p.id}>
                <strong>{p.username}</strong> · {p.score.toLocaleString('vi-VN')}đ · {p.deliveries} chuyến
              </li>
            ))}
          </ol>
        )}
        <p>Điểm vòng chơi tính riêng. Thu nhập chuyến xe được ghi vào nghề nghiệp của bạn.</p>
        {host && (
          <>
            <label className='room-bots-toggle'>
              <input
                type='checkbox'
                disabled={state.mode !== 'competitive'}
                checked={state.fillBots}
                onChange={(e) => network.command('room-bots', undefined, String(e.target.checked))}
              />{' '}
              Thêm bot vào chỗ trống
            </label>
            <button
              className='toon-button'
              onClick={() => network.command(state.status === 'lobby' ? 'room-start' : 'room-rematch')}
            >
              {state.status === 'lobby' ? 'Bắt đầu vòng' : 'Chơi lại vòng'}
            </button>
          </>
        )}
        {!host && <p role='status'>Chờ chủ phòng bắt đầu. Chủ phòng tự chuyển khi người trước rời đi.</p>}
      </section>
    </div>
  );
}
