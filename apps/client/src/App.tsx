import { RoomLauncher } from './components/RoomHub';
import { useCallback, useEffect, useState } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { readStored, writeStored } from './game/preferences';
import './App.css';
import { regions, measureRegions, matchRegion } from './game/matchmaking';

const defaultServerUrl =
  import.meta.env.VITE_WS_URL || (import.meta.env.DEV ? 'ws://localhost:3002' : 'wss://xeom-rush.zznam.deno.net');

export default function App() {
  const [username, setUsername] = useState(() => readStored('name'));
  const [selectedRegion, setSelectedRegion] = useState(() => {
    const stored = readStored('region');
    return regions.some((region) => region.id === stored) ? stored : 'auto';
  });
  const [latencies, setLatencies] = useState<Record<string, number | null>>({});
  const [matching, setMatching] = useState(false);
  const [cityLabel, setCityLabel] = useState('');
  const [matchedUrl, setMatchedUrl] = useState('');
  useEffect(() => {
    let active = true;
    void measureRegions().then((values) => {
      if (active) setLatencies(values);
    });
    return () => {
      active = false;
    };
  }, []);
  const [isPlaying, setIsPlaying] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState(defaultServerUrl);
  const handleRoomJoin = useCallback((url: string, name?: string) => {
    if (name) setUsername(name);
    setMatchedUrl(url);
    setCityLabel('Phòng bạn bè');
    setIsPlaying(true);
  }, []);
  const handleDisconnect = useCallback((reason?: string) => {
    setIsPlaying(false);
    setMatchedUrl('');
    setCityLabel('');
    setConnectionError(reason || null);
  }, []);

  if (isPlaying)
    return (
      <GameCanvas
        username={username.trim()}
        serverUrl={matchedUrl || serverUrl.trim()}
        cityLabel={cityLabel}
        onDisconnect={handleDisconnect}
        onRoomJoin={handleRoomJoin}
      />
    );

  return (
    <main className='lobby'>
      <header className='lobby-nav'>
        <a className='wordmark' href='/' aria-label='Xe Ôm Rush home'>
          <span>🛵</span> XE ÔM RUSH<span className='edition'>CITY CLUB</span>
        </a>
        <a className='how-link' href='#how-to-play'>
          Cách chơi <span>↗</span>
        </a>
      </header>
      <section className='hero'>
        <img
          className='hero-art'
          src='/art/saigon-rush-hero.png'
          alt='Tài xế và hành khách vui vẻ trên chiếc xe máy giữa phố Sài Gòn đầy màu sắc'
        />
        <div className='hero-wash' />
        <div className='hero-copy'>
          <span className='eyebrow'>
            <i /> MỘT VÒNG SÀI GÒN, NGÀN NIỀM VUI
          </span>
          <h1>
            Phố nhỏ.
            <br />
            Chuyến xe <em>lớn!</em>
          </h1>
          <p>
            Đón khách, luồn hẻm, gom tiền thưởng.
            <br />
            Cả thành phố đang chờ tay lái của bạn.
          </p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (!username.trim() || matching) return;
              if (regions.length) {
                setMatching(true);
                setConnectionError(null);
                try {
                  const measured = Object.keys(latencies).length ? latencies : await measureRegions();
                  const region =
                    selectedRegion === 'auto'
                      ? [...regions]
                          .filter((r) => measured[r.id] != null)
                          .sort((a, b) => measured[a.id]! - measured[b.id]!)[0]
                      : regions.find((r) => r.id === selectedRegion);
                  if (!region) throw new Error('Chưa kết nối được khu vực. Vui lòng chọn và thử lại.');
                  const match = await matchRegion(region);
                  setMatchedUrl(match.wsUrl);
                  setCityLabel(`${region.label} · ${match.room}`);
                  writeStored('name', username.trim());
                  writeStored('region', selectedRegion);
                  setIsPlaying(true);
                } catch (error) {
                  setConnectionError(
                    error instanceof Error && error.name !== 'TimeoutError'
                      ? error.message
                      : 'Kết nối hơi chậm. Vui lòng thử lại.',
                  );
                } finally {
                  setMatching(false);
                }
                return;
              }
              try {
                const url = new URL(serverUrl.trim());
                if (
                  !['ws:', 'wss:'].includes(url.protocol) ||
                  (location.protocol === 'https:' && url.protocol !== 'wss:')
                )
                  throw new Error();
              } catch {
                setConnectionError('Địa chỉ kết nối chưa hợp lệ. Vui lòng dùng WSS trên trang HTTPS.');
                return;
              }
              writeStored('name', username.trim());
              setConnectionError(null);
              setIsPlaying(true);
            }}
          >
            <label htmlFor='username'>BIỆT DANH TÀI XẾ</label>
            <div className='join-row'>
              <input
                id='username'
                required
                maxLength={15}
                autoComplete='nickname'
                placeholder='Bạn tên gì nè?'
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
              <button type='submit' className='join-button' disabled={matching} aria-busy={matching}>
                {matching ? 'ĐANG TÌM XE' : 'LÊN XE'} <span>↗</span>
              </button>
            </div>
            {regions.length > 0 && (
              <div className='region-picker'>
                <label htmlFor='region'>KHU VỰC CHƠI</label>
                <select
                  id='region'
                  value={selectedRegion}
                  onChange={(event) => setSelectedRegion(event.target.value)}
                  disabled={matching}
                >
                  <option value='auto'>Tự động · kết nối nhanh nhất</option>
                  {regions.map((region) => (
                    <option key={region.id} value={region.id}>
                      {region.label}
                      {latencies[region.id] === undefined
                        ? ' · đang đo…'
                        : latencies[region.id] === null
                          ? ' · chưa kết nối'
                          : ` · ${latencies[region.id]} ms`}
                    </option>
                  ))}
                </select>
                <small>Gặp tài xế cùng khu vực. Thành tích được lưu riêng theo khu vực.</small>
              </div>
            )}
            {connectionError && (
              <p className='connection-error' role='alert'>
                {connectionError}
              </p>
            )}
            {import.meta.env.DEV && (
              <details className='server-settings'>
                <summary>Kết nối phát triển</summary>
                <label htmlFor='serverUrl'>Địa chỉ server</label>
                <input id='serverUrl' value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} />
              </details>
            )}
          </form>
          <RoomLauncher
            serverUrl={
              regions.length ? (regions.find((r) => r.id === selectedRegion)?.apiUrl ?? regions[0].apiUrl) : serverUrl
            }
            initialInvite={new URLSearchParams(location.search).get('room') ?? ''}
            username={username}
            onJoin={handleRoomJoin}
          />
          <div className='play-notes'>
            <span>✦ Chơi miễn phí</span>
            <span>✦ Không cần tải</span>
            <span>✦ Máy tính & điện thoại</span>
          </div>
        </div>
        <div className='hero-sticker'>
          <span>ĐI CHILL</span>
          <strong>
            KIẾM
            <br />
            TIỀN!
          </strong>
          <small>trong game thôi nha 😉</small>
        </div>
      </section>
      <section className='how-to-play' id='how-to-play' aria-label='Cách chơi'>
        <div className='how-intro'>
          <span className='eyebrow'>BẮT NHỊP THÀNH PHỐ</span>
          <h2>Ba bước. Một chuyến vui.</h2>
          <p>
            WASD / phím mũi tên để lái.
            <br />
            Điện thoại? Dùng cần điều khiển!
          </p>
        </div>
        <article>
          <span className='step-icon mint'>🙋</span>
          <div>
            <small>01 / ĐÓN KHÁCH</small>
            <h3>Khách vẫy, mình tới.</h3>
            <p>Lái lại gần khách để tự động đón.</p>
          </div>
        </article>
        <article>
          <span className='step-icon peach'>🧭</span>
          <div>
            <small>02 / TÌM ĐƯỜNG</small>
            <h3>Len lỏi từng con hẻm.</h3>
            <p>Theo dấu chỉ đường đến điểm trả.</p>
          </div>
        </article>
        <article>
          <span className='step-icon butter'>✦</span>
          <div>
            <small>03 / NHẬN THƯỞNG</small>
            <h3>Chuyến tốt, ví đầy.</h3>
            <p>Trả khách liên tiếp để tăng combo!</p>
          </div>
        </article>
      </section>
      <footer className='lobby-footer'>
        <span>MADE FOR THE JOY OF THE RIDE.</span>
        <span>Sài Gòn trong tim. An toàn trên đường. ♡</span>
      </footer>
    </main>
  );
}
