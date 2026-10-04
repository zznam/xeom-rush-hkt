import type { GamePreferences } from '../game/preferences';
import { useGameDialog } from './useGameDialog';
export function SettingsPanel({
  preferences: p,
  onChange,
  onClose,
}: {
  preferences: GamePreferences;
  onChange: (p: GamePreferences) => void;
  onClose: () => void;
}) {
  const ref = useGameDialog(true, onClose);
  const change = (key: keyof GamePreferences, value: unknown) => onChange({ ...p, [key]: value });
  return (
    <div className='club-cover'>
      <section
        ref={ref}
        className='club-panel settings-panel'
        role='dialog'
        aria-modal='true'
        aria-label='Tùy chỉnh điều khiển'
      >
        <header>
          <h2>Tùy chỉnh tay lái</h2>
          <button autoFocus onClick={onClose}>
            Đóng
          </button>
        </header>
        <p>Cài đặt được lưu trên trình duyệt. Áp dụng ngay trong chuyến xe.</p>
        <div className='settings-grid'>
          <label>
            Tay thuận
            <select value={p.handedness} onChange={(e) => change('handedness', e.target.value)}>
              <option value='right'>Tay phải · cần bên trái</option>
              <option value='left'>Tay trái · cần bên phải</option>
            </select>
          </label>
          <label>
            Kích thước cần · {p.joystickSize}px
            <input
              aria-label='Kích thước cần'
              type='range'
              min='100'
              max='160'
              step='10'
              value={p.joystickSize}
              onChange={(e) => change('joystickSize', Number(e.target.value))}
            />
          </label>
          <label>
            Khoảng cách mép · {p.joystickOffset}px
            <input
              aria-label='Khoảng cách mép'
              type='range'
              min='0'
              max='40'
              step='4'
              value={p.joystickOffset}
              onChange={(e) => change('joystickOffset', Number(e.target.value))}
            />
          </label>
          <label>
            Độ nhạy · {p.sensitivity.toFixed(1)}
            <input
              aria-label='Độ nhạy'
              type='range'
              min='.5'
              max='1.5'
              step='.1'
              value={p.sensitivity}
              onChange={(e) => change('sensitivity', Number(e.target.value))}
            />
          </label>
          <label>
            Cỡ chữ
            <select value={p.textSize} onChange={(e) => change('textSize', Number(e.target.value))}>
              <option value='1'>Chuẩn</option>
              <option value='1.15'>Lớn</option>
              <option value='1.3'>Rất lớn</option>
            </select>
          </label>
          <label>
            Đồ họa
            <select value={p.graphics} onChange={(e) => change('graphics', e.target.value)}>
              <option value='auto'>Tự động theo thiết bị</option>
              <option value='high'>Nhiều chi tiết</option>
              <option value='low'>Ít hiệu ứng</option>
            </select>
          </label>
        </div>
        <h3>Phím lái xe</h3>
        <div className='settings-grid'>
          {Object.entries(p.bindings).map(([key, value]) => (
            <label key={key}>
              {
                (
                  { up: 'Đi lên', down: 'Đi xuống', left: 'Sang trái', right: 'Sang phải', horn: 'Bấm còi' } as Record<
                    string,
                    string
                  >
                )[key]
              }
              <input
                aria-label={`Phím ${key}`}
                value={value}
                readOnly
                onKeyDown={(e) => {
                  if (!['Tab', 'Escape'].includes(e.key)) {
                    e.preventDefault();
                    onChange({ ...p, bindings: { ...p.bindings, [key]: e.key.toLowerCase() } });
                  }
                }}
              />
            </label>
          ))}
        </div>
        <button aria-label='Âm thanh' aria-pressed={p.sound} onClick={() => change('sound', !p.sound)}>
          ♫ {p.sound ? 'Âm thanh bật' : 'Âm thanh tắt'}
        </button>{' '}
        <button
          aria-label='Giảm chuyển động'
          aria-pressed={p.reducedMotion}
          onClick={() => change('reducedMotion', !p.reducedMotion)}
        >
          {p.reducedMotion ? 'Ít chuyển động' : 'Chuyển động'}
        </button>
      </section>
    </div>
  );
}
