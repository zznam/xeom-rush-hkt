import { EMOTES, LANDMARKS, type RoomState } from '@xeom-rush/shared';
import { network } from '../game/network';
import { useGameDialog } from './useGameDialog';
export function TeamPlayPanel({ room, playerId, onClose }: { room: RoomState; playerId: string; onClose: () => void }) {
  const ref = useGameDialog(true, onClose),
    me = room.players.find((p) => p.playerId === playerId),
    play = room.teamPlay;
  const name = (id: string) => room.players.find((p) => p.id === id)?.username ?? 'Đồng đội';
  return (
    <div className='club-cover'>
      <section ref={ref} className='club-panel' role='dialog' aria-modal='true' aria-label='Đồng đội và biểu cảm'>
        <header>
          <h2>Đồng đội trên đường phố</h2>
          <button autoFocus onClick={onClose}>
            Đóng
          </button>
        </header>
        {play?.kind === 'co-op' && (
          <section>
            <h3>Cùng chạm mục tiêu</h3>
            <p>
              {play.earned.toLocaleString('vi-VN')} / {play.target.toLocaleString('vi-VN')}đ ·{' '}
              {play.completed ? 'Đã hoàn thành!' : 'Mỗi người góp một chuyến vui.'}
            </p>
            <button
              onClick={() => {
                network.command('dispatch-job');
                onClose();
              }}
            >
              Nhận chuyến điều phối
            </button>
            <ul>
              {Object.keys(play.assignments).map((id) => (
                <li key={id}>{name(id)} · Chuyến dành riêng · Lái theo GPS</li>
              ))}
            </ul>
          </section>
        )}
        {play?.kind === 'relay' &&
          play.teams.map((team) => (
            <section key={team.id} className='relay-team'>
              <h3>
                Đội {team.id} {team.members.includes(me?.id ?? '') ? '· Đội bạn' : ''}
              </h3>
              <p>
                {team.score.toLocaleString('vi-VN')}đ ·{' '}
                {team.failed || (team.completed ? 'Đã tới đích!' : `Chặng ${team.leg + 1}/${team.legs.length}`)}
              </p>
              <ol>
                {team.legs.map((id, i) => (
                  <li key={id}>
                    {i < team.leg || team.completed ? '✓ ' : ''}
                    {LANDMARKS.find((l) => l.id === id)?.name}
                  </li>
                ))}
              </ol>
              {!team.completed && !team.failed && (
                <p>
                  {name(team.carrierId)} đang giữ gói ·{' '}
                  {team.handoffPending ? `Gặp ${name(team.nextRiderId ?? '')} tại mốc để trao` : 'Lái theo GPS tới mốc'}
                </p>
              )}
              {team.carrierId === me?.id && team.handoffPending && !team.failed && (
                <button onClick={() => network.command('relay-handoff', team.nextRiderId)}>Trao gói tiếp sức</button>
              )}
            </section>
          ))}
        <h3>Gửi lời trên phố</h3>
        <p>Mỗi lời cách nhau ba giây. Biểu cảm không cộng điểm.</p>
        <div className='emote-options'>
          {EMOTES.map((e) => (
            <button
              key={e.id}
              onClick={() => {
                network.command('emote', e.id);
                onClose();
              }}
            >
              {e.icon} {e.text}
            </button>
          ))}
        </div>
        <div role='status'>
          {room.emotes?.map((e, i) => (
            <p key={`${e.profileId}-${i}`}>
              {name(e.profileId)}: {EMOTES.find((item) => item.id === e.id)?.text}
            </p>
          ))}
        </div>
      </section>
    </div>
  );
}
