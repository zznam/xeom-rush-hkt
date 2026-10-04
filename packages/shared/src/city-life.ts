import { districtAt } from './atlas';
import type { Building } from './city-map';
import type { Vector2D } from './types';
export const DEMAND_EVENTS = [
  { id: 'morning-market', name: 'Chợ sáng đông vui', district: 'market', icon: '🧺' },
  { id: 'office-lunch', name: 'Giờ trưa văn phòng', district: 'downtown', icon: '🥡' },
  { id: 'lantern-festival', name: 'Đêm hội đèn lồng', district: 'old-town', icon: '🏮' },
  { id: 'river-picnic', name: 'Hẹn cuối tuần bên sông', district: 'riverside', icon: '🌿' },
  { id: 'flower-market', name: 'Phiên chợ hoa', district: 'market', icon: '🌸' },
  { id: 'music-night', name: 'Đêm nhạc phố trung tâm', district: 'downtown', icon: '🎵' },
] as const;
export interface RoadClosure {
  id: string;
  rect: Building;
  announcedAt: number;
  startsAt: number;
  endsAt: number;
  active: boolean;
}
export interface CityLifeState {
  tick: number;
  enabled: boolean;
  phase: 'day' | 'sunset' | 'night' | 'dawn';
  rain: boolean;
  rainEndsAt: number;
  event: ((typeof DEMAND_EVENTS)[number] & { endsAt: number; multiplier: number }) | null;
  closure: RoadClosure | null;
  roadRevision: number;
}
export function cityAtTick(tick: number): CityLifeState {
  const time = tick % 14400,
    rainPhase = tick % 7200,
    eventPhase = tick % 3600;
  const event =
    tick >= 3600 && eventPhase < 1200 ? DEMAND_EVENTS[(Math.floor(tick / 3600) - 1) % DEMAND_EVENTS.length] : null;
  const closurePhase = tick % 4800,
    cycle = Math.floor(tick / 4800),
    activeCycle = cycle > 0 && closurePhase < 1400;
  const rect: Building =
    cycle % 2 ? { x: 800, y: 1100, width: 100, height: 60 } : { x: 3200, y: 2700, width: 100, height: 60 };
  return {
    tick,
    enabled: true,
    phase: time < 7200 ? 'day' : time < 8400 ? 'sunset' : time < 13200 ? 'night' : 'dawn',
    rain: tick >= 7200 && rainPhase < 1800,
    rainEndsAt: Math.floor(tick / 7200) * 7200 + 1800,
    event: event ? { ...event, endsAt: tick - eventPhase + 1200, multiplier: 1.25 } : null,
    closure: activeCycle
      ? {
          id: `works-${cycle}`,
          rect,
          announcedAt: cycle * 4800,
          startsAt: cycle * 4800 + 200,
          endsAt: cycle * 4800 + 1400,
          active: closurePhase >= 200,
        }
      : null,
    roadRevision: activeCycle && closurePhase >= 200 ? cycle * 2 : cycle * 2 + 1,
  };
}
export function movementConditions(rain: boolean) {
  return { speed: rain ? 0.95 : 1, acceleration: rain ? 6 : 8, turn: rain ? 8 : 10 };
}
export function environmentMultiplier(city: CityLifeState, point: Vector2D, rushHour: boolean) {
  return Math.max(
    rushHour ? 1.5 : 1,
    city.rain ? 1.15 : 1,
    city.event?.district === districtAt(point).id ? city.event.multiplier : 1,
  );
}
