import { useRef, useState } from 'react';
import {
  BINDING_LABELS,
  CONTROL_PRESETS,
  bindingError,
  defaultPreferences,
  exportPreferences,
  importPreferences,
  type BindingAction,
  type GamePreferences,
} from '../game/preferences';
import './SettingsPanel.css';
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
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [resetPending, setResetPending] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const selectedPreset =
    CONTROL_PRESETS.find((preset) =>
      Object.entries(preset.bindings).every(([key, value]) => p.bindings[key as BindingAction] === value),
    )?.id ?? 'custom';
  const feedback = (message: string, failure = false) => {
    setError(failure ? message : '');
    setNotice(failure ? '' : message);
  };
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
        <label className='settings-preset'>
          Bộ phím nhanh
          <select
            value={selectedPreset}
            onChange={(e) => {
              const preset = CONTROL_PRESETS.find((entry) => entry.id === e.target.value);
              if (!preset) return;
              onChange({ ...p, bindings: { ...preset.bindings } });
              feedback(`Đã áp dụng ${preset.label}.`);
            }}
          >
            <option value='custom' disabled>
              Tự chọn
            </option>
            {CONTROL_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        <p id='binding-help'>Chọn ô rồi nhấn phím mới. Mỗi phím dùng cho một thao tác. Mũi tên luôn lái đúng hướng.</p>
        <div className='settings-grid'>
          {Object.entries(p.bindings).map(([key, value]) => (
            <label key={key}>
              {BINDING_LABELS[key as BindingAction]}
              <input
                aria-label={`Phím ${key}`}
                aria-describedby='binding-help'
                value={value}
                readOnly
                onKeyDown={(e) => {
                  if (!['Tab', 'Escape'].includes(e.key)) {
                    e.preventDefault();
                    const issue =
                      e.ctrlKey || e.altKey || e.metaKey
                        ? 'Chọn một phím riêng, không kèm Ctrl, Alt hoặc Command.'
                        : bindingError(key as BindingAction, e.key, p.bindings);
                    if (issue) {
                      feedback(issue, true);
                      return;
                    }
                    onChange({ ...p, bindings: { ...p.bindings, [key]: e.key.toLowerCase() } });
                    feedback(`Đã đổi phím ${BINDING_LABELS[key as BindingAction]}.`);
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
        <section className='settings-backup' aria-label='Sao lưu cài đặt'>
          <h3>Sao lưu & khôi phục</h3>
          <p>Tệp chỉ chứa cài đặt điều khiển, âm thanh và hình ảnh. Nghề nghiệp không nằm trong bản sao lưu này.</p>
          <div className='settings-actions'>
            <button
              onClick={() => {
                const url = URL.createObjectURL(new Blob([exportPreferences(p)], { type: 'application/json' }));
                const link = document.createElement('a');
                link.href = url;
                link.download = 'xeom-rush-settings.json';
                link.click();
                window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                feedback('Đã xuất bản sao lưu cài đặt.');
              }}
            >
              Xuất cài đặt
            </button>
            <button onClick={() => importInput.current?.click()}>Nhập cài đặt</button>
            <input
              ref={importInput}
              hidden
              type='file'
              accept='.json,application/json'
              aria-label='Tệp cài đặt'
              onChange={async (event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (!file) return;
                try {
                  if (file.size > 32768) throw new Error('Tệp quá lớn. Bản sao lưu cài đặt phải nhỏ hơn 32 KB.');
                  const restored = importPreferences(await file.text());
                  onChange(restored);
                  setResetPending(false);
                  feedback('Đã nhập cài đặt. Các thay đổi được áp dụng ngay.');
                } catch (reason) {
                  feedback(reason instanceof Error ? reason.message : 'Không đọc được tệp cài đặt.', true);
                }
              }}
            />
            <button onClick={() => setResetPending(true)}>Đặt lại cài đặt</button>
          </div>
          {resetPending && (
            <div className='settings-reset' role='group' aria-label='Xác nhận đặt lại'>
              <p>Khôi phục mọi cài đặt về mặc định? Giảm chuyển động sẽ theo thiết bị của bạn.</p>
              <button
                onClick={() => {
                  onChange(defaultPreferences());
                  setResetPending(false);
                  feedback('Đã khôi phục cài đặt mặc định.');
                }}
              >
                Khôi phục mặc định
              </button>{' '}
              <button onClick={() => setResetPending(false)}>Giữ cài đặt</button>
            </div>
          )}
        </section>
        {error && (
          <p className='settings-feedback is-error' role='alert'>
            {error}
          </p>
        )}
        {notice && (
          <p className='settings-feedback' role='status'>
            {notice}
          </p>
        )}
      </section>
    </div>
  );
}
