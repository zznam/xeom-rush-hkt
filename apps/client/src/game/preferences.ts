export interface GamePreferences {
  sound: boolean;
  reducedMotion: boolean;
  handedness: 'right' | 'left';
  joystickSize: number;
  joystickOffset: number;
  sensitivity: number;
  textSize: number;
  graphics: 'auto' | 'high' | 'low';
  bindings: { up: string; down: string; left: string; right: string; horn: string };
}
export type BindingAction = keyof GamePreferences['bindings'];
export const BINDING_LABELS: Record<BindingAction, string> = {
  up: 'Đi lên',
  down: 'Đi xuống',
  left: 'Sang trái',
  right: 'Sang phải',
  horn: 'Bấm còi',
};
export const CONTROL_PRESETS = [
  { id: 'wasd', label: 'WASD · tay trái', bindings: { up: 'w', down: 's', left: 'a', right: 'd', horn: 'h' } },
  {
    id: 'arrows',
    label: 'Phím mũi tên',
    bindings: { up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright', horn: 'h' },
  },
  { id: 'ijkl', label: 'IJKL · tay phải', bindings: { up: 'i', down: 'k', left: 'j', right: 'l', horn: 'h' } },
] as const;
const ACTIONS = Object.keys(BINDING_LABELS) as BindingAction[];
const ARROWS: Record<string, BindingAction> = {
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function defaultPreferences(): GamePreferences {
  return {
    sound: true,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    handedness: 'right',
    joystickSize: 120,
    joystickOffset: 8,
    sensitivity: 1,
    textSize: 1,
    graphics: 'auto',
    bindings: { ...CONTROL_PRESETS[0].bindings },
  };
}

export function bindingError(action: BindingAction, key: string, bindings: GamePreferences['bindings']): string | null {
  const normalized = key.toLowerCase();
  if (ARROWS[normalized] && ARROWS[normalized] !== action)
    return 'Phím mũi tên luôn dùng để lái theo hướng tương ứng. Hãy chọn phím khác.';
  if (!ARROWS[normalized] && (normalized.length !== 1 || !normalized.trim()))
    return 'Chọn một chữ, số, ký hiệu hoặc phím mũi tên đúng hướng.';
  const conflict = ACTIONS.find((other) => other !== action && bindings[other] === normalized);
  return conflict ? `Phím này đang dùng cho “${BINDING_LABELS[conflict]}”. Hãy chọn phím khác.` : null;
}

function validBindings(value: unknown): value is GamePreferences['bindings'] {
  return (
    isRecord(value) &&
    ACTIONS.every(
      (action) =>
        typeof value[action] === 'string' &&
        value[action] === value[action].toLowerCase() &&
        !bindingError(action, value[action], value as GamePreferences['bindings']),
    )
  );
}

export function readStored(key: string, fallback = ''): string {
  try {
    return localStorage.getItem(`xeom:${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}
export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(`xeom:${key}`, value);
  } catch {
    /* Browser storage may be disabled. */
  }
}
export function loadPreferences(): GamePreferences {
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readStored('controls', '{}'));
    if (isRecord(parsed)) stored = parsed;
  } catch {
    /* Retain defaults for older settings. */
  }
  const defaults = defaultPreferences();
  const number = (value: unknown, min: number, max: number, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  const bindings = { ...defaults.bindings };
  if (isRecord(stored.bindings)) {
    for (const action of ACTIONS) {
      const value = stored.bindings[action];
      if (typeof value === 'string') bindings[action] = value.toLowerCase();
    }
  }
  return {
    sound: readStored('sound', String(defaults.sound)) === 'true',
    reducedMotion: readStored('reducedMotion', String(defaults.reducedMotion)) === 'true',
    handedness: stored.handedness === 'left' ? 'left' : 'right',
    joystickSize: number(stored.joystickSize, 100, 160, defaults.joystickSize),
    joystickOffset: number(stored.joystickOffset, 0, 40, defaults.joystickOffset),
    sensitivity: number(stored.sensitivity, 0.5, 1.5, defaults.sensitivity),
    textSize: [1, 1.15, 1.3].includes(Number(stored.textSize)) ? Number(stored.textSize) : defaults.textSize,
    graphics: stored.graphics === 'high' || stored.graphics === 'low' ? stored.graphics : 'auto',
    bindings: validBindings(bindings) ? bindings : defaults.bindings,
  };
}
export function savePreferences(p: GamePreferences) {
  writeStored('sound', String(p.sound));
  writeStored('reducedMotion', String(p.reducedMotion));
  writeStored('controls', JSON.stringify(p));
}

export function exportPreferences(preferences: GamePreferences): string {
  return JSON.stringify({ format: 'xeom-rush-settings', version: 1, preferences }, null, 2);
}

/** Import is deliberately strict: malformed backups never partially replace live controls. */
export function importPreferences(text: string): GamePreferences {
  const fail = () => new Error('Tệp cài đặt không hợp lệ. Hãy chọn bản sao lưu Xe Ôm Rush phiên bản 1.');
  let backup: unknown;
  try {
    backup = JSON.parse(text);
  } catch {
    throw fail();
  }
  if (
    !isRecord(backup) ||
    backup.format !== 'xeom-rush-settings' ||
    backup.version !== 1 ||
    !isRecord(backup.preferences)
  )
    throw fail();
  const p = backup.preferences;
  const inRange = (value: unknown, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  if (
    typeof p.sound !== 'boolean' ||
    typeof p.reducedMotion !== 'boolean' ||
    (p.handedness !== 'left' && p.handedness !== 'right') ||
    !inRange(p.joystickSize, 100, 160) ||
    !inRange(p.joystickOffset, 0, 40) ||
    !inRange(p.sensitivity, 0.5, 1.5) ||
    ![1, 1.15, 1.3].includes(p.textSize as number) ||
    !['auto', 'high', 'low'].includes(p.graphics as string) ||
    !validBindings(p.bindings)
  )
    throw fail();
  const bindings = p.bindings;
  return {
    sound: p.sound,
    reducedMotion: p.reducedMotion,
    handedness: p.handedness,
    joystickSize: p.joystickSize as number,
    joystickOffset: p.joystickOffset as number,
    sensitivity: p.sensitivity as number,
    textSize: p.textSize as number,
    graphics: p.graphics as GamePreferences['graphics'],
    bindings: Object.fromEntries(ACTIONS.map((action) => [action, bindings[action]])) as GamePreferences['bindings'],
  };
}
