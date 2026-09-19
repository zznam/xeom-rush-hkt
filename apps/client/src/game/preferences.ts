export interface GamePreferences {
  sound: boolean;
  reducedMotion: boolean;
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
    /* Private browsing can disable storage. */
  }
}

export function loadPreferences(): GamePreferences {
  return {
    sound: readStored('sound', 'true') === 'true',
    reducedMotion:
      readStored('reducedMotion', String(window.matchMedia('(prefers-reduced-motion: reduce)').matches)) === 'true',
  };
}
