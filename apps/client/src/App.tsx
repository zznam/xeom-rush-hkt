import { useCallback, useState } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { readStored, writeStored } from './game/preferences';
import './App.css';

const defaultServerUrl =
  import.meta.env.VITE_WS_URL || (import.meta.env.DEV ? 'ws://localhost:3002' : 'wss://xeom-rush.zznam.deno.net');

export default function App() {
  const [username, setUsername] = useState(() => readStored('name'));
  const [isPlaying, setIsPlaying] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState(defaultServerUrl);
  const handleDisconnect = useCallback((reason?: string) => {
    setIsPlaying(false);
    setConnectionError(reason || null);
  }, []);

  if (isPlaying)
    return <GameCanvas username={username.trim()} serverUrl={serverUrl.trim()} onDisconnect={handleDisconnect} />;

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
            onSubmit={(event) => {
              event.preventDefault();
              if (!username.trim()) return;
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
              <button type='submit' className='join-button'>
                LÊN XE <span>↗</span>
              </button>
            </div>
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
