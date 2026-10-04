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
  let stored: Partial<GamePreferences> = {};
  try {
    stored = JSON.parse(readStored('controls', '{}'));
  } catch {
    /* Retain defaults for older settings. */
  }
  const number = (value: unknown, min: number, max: number, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  const defaults = { up: 'w', down: 's', left: 'a', right: 'd', horn: 'h' },
    bindings = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
    const v = stored.bindings?.[key];
    if (typeof v === 'string' && v.length > 0 && v.length <= 16) bindings[key] = v.toLowerCase();
  }
  return {
    sound: readStored('sound', 'true') === 'true',
    reducedMotion:
      readStored('reducedMotion', String(window.matchMedia('(prefers-reduced-motion: reduce)').matches)) === 'true',
    handedness: stored.handedness === 'left' ? 'left' : 'right',
    joystickSize: number(stored.joystickSize, 100, 160, 120),
    joystickOffset: number(stored.joystickOffset, 0, 40, 8),
    sensitivity: number(stored.sensitivity, 0.5, 1.5, 1),
    textSize: number(stored.textSize, 1, 1.3, 1),
    graphics: ['high', 'low'].includes(stored.graphics ?? '') ? (stored.graphics as 'high' | 'low') : 'auto',
    bindings,
  };
}
export function savePreferences(p: GamePreferences) {
  writeStored('sound', String(p.sound));
  writeStored('reducedMotion', String(p.reducedMotion));
  writeStored('controls', JSON.stringify(p));
}
