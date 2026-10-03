import { readStored, writeStored } from '../game/preferences';
import { useEffect, useState } from 'react';
import { roomApiBase, roomGuest } from '../game/rooms';
import { useGameDialog } from './useGameDialog';
interface Capabilities {
  available: boolean;
  apiUrl: string;
  identityUrl: string;
  modes: string[];
}
export function RoomLauncher({
  serverUrl,
  onJoin,
  initialInvite = '',
  username,
}: {
  serverUrl: string;
  onJoin: (url: string, name?: string) => void;
  username?: string;
  initialInvite?: string;
}) {
  const [cap, setCap] = useState<Capabilities | null>(null),
    [open, setOpen] = useState(!!initialInvite);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${roomApiBase(serverUrl)}/api/rooms/capabilities`, { signal: controller.signal })
      .then((r) => r.json())
      .then(setCap)
      .catch(() => {});
    return () => controller.abort();
  }, [serverUrl]);
  if (!cap?.available && !initialInvite) return null;
  return (
    <>
      <button type='button' className='toon-button' aria-label='Phòng bạn bè' onClick={() => setOpen(true)}>
        🤝 Phòng bạn bè
      </button>
      {open && (
        <RoomHub
          username={username}
          cap={cap}
          initialInvite={initialInvite}
          onJoin={onJoin}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
export function RoomHub({
  cap,
  initialInvite,
  onJoin,
  onClose,
  username,
}: {
  username?: string;
  cap: Capabilities | null;
  initialInvite: string;
  onJoin: (url: string, name?: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(username ?? readStored('name'));
  const [invite, setInvite] = useState(initialInvite),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const ref = useGameDialog(true, onClose);
  async function join(endpoint: string, identity?: string) {
    const url = new URL(endpoint);
    if (!['http:', 'https:'].includes(url.protocol) || !url.pathname.match(/\/api\/rooms\/[a-f0-9]{48}$/))
      throw new Error('Liên kết mời chưa đúng.');
    const view = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!view.ok) throw new Error('Phòng đã đóng hoặc tạm nghỉ.');
    const data = await view.json(),
      guest = await roomGuest(identity ?? data.identityUrl);
    const response = await fetch(`${endpoint}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guest }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Chưa vào được phòng. Thử lại nhé.');
    writeStored('name', name.trim());
    onJoin((await response.json()).serverUrl, name.trim());
  }
  async function act(create: boolean) {
    setBusy(true);
    setError('');
    try {
      if (create) {
        if (!cap?.available) throw new Error('Dịch vụ phòng chưa sẵn sàng.');
        const guest = await roomGuest(cap.identityUrl);
        const r = await fetch(`${cap.apiUrl}/api/rooms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guest }),
          signal: AbortSignal.timeout(5000),
        });
        if (!r.ok) throw new Error('Chủ phòng đang đông. Thử lại sau nhé.');
        const room = await r.json();
        await join(`${room.apiUrl}/api/rooms/${room.invite}`, room.identityUrl);
      } else {
        const pasted = new URL(invite);
        const endpoint = pasted.searchParams.get('room') ?? invite;
        await join(endpoint);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className='club-cover'>
      <section ref={ref} className='club-panel' role='dialog' aria-modal='true' aria-label='Phòng bạn bè'>
        <header>
          <h2>Chuyến xe cùng bạn bè</h2>
          <button autoFocus onClick={onClose}>
            Đóng
          </button>
        </header>
        <p>Tối đa tám người. Mỗi vòng năm phút, có kết quả và chơi lại. Chia sẻ liên kết trong phòng để mời bạn.</p>
        <label className='invite-field'>
          Biệt danh trong phòng
          <input maxLength={15} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {cap?.available && (
          <button disabled={busy || !name.trim()} onClick={() => void act(true)}>
            Tạo phòng riêng
          </button>
        )}
        <label className='invite-field'>
          Liên kết mời
          <input value={invite} onChange={(e) => setInvite(e.target.value)} placeholder='Dán liên kết mời ở đây' />
        </label>
        <button disabled={busy || !invite || !name.trim()} onClick={() => void act(false)}>
          Tham gia phòng mời
        </button>
        {error && <p role='alert'>{error}</p>}
        {busy && <p role='status'>Đang tìm bạn đồng hành…</p>}
      </section>
    </div>
  );
}
