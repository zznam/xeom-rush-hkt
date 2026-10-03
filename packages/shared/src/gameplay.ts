import { STREAK_MULTIPLIERS } from './constants';
import type { PassengerState, Vector2D } from './types';

export const GAMEPLAY_VERSION = 1;
export interface Fare {
  base: number;
  combo: number;
  environment: number;
  clean: number;
  tip: number;
  total: number;
}
export function calculateFare(base: number, streak = 0, environment = 1, clean = false, tip = 0): Fare {
  const multiplier = STREAK_MULTIPLIERS.find((s) => streak >= s.minStreak)?.multiplier ?? 1;
  const combo = Math.floor(base * (multiplier - 1));
  const event = Math.floor((base + combo) * (Math.max(1, Math.min(1.5, environment)) - 1));
  const bonus = clean ? Math.floor((base + combo + event) * 0.1) : 0;
  return {
    base,
    combo,
    environment: event,
    clean: bonus,
    tip: Math.max(0, Math.floor(tip)),
    total: base + combo + event + bonus + Math.max(0, Math.floor(tip)),
  };
}
export interface TripMetadata {
  passenger: PassengerState;
  route: Vector2D[];
  fare: Fare;
  clean: boolean;
  pickedUpTick: number;
  stopIndex: number;
  stops: Vector2D[];
  kind: 'passenger' | 'food' | 'parcel';
  dialogue: string;
  freshness: number;
  damage: number;
  goalLabel: string;
  persona: string;
  quickTicksRemaining: number;
}
export interface ShiftSummary {
  distance: number;
  cleanTrips: number;
  baseFares: number;
  bonuses: number;
  tips: number;
  fines: number;
  fastestTripTicks: number;
  visited: string[];
}
export type GameCommand = { version: 1; id: string; action: string; target?: string; value?: string };
export function parseGameCommand(text: string): GameCommand | null {
  if (text.length > 1024) return null;
  try {
    const c = JSON.parse(text);
    if (
      c.version !== 1 ||
      typeof c.id !== 'string' ||
      !/^[a-zA-Z0-9-]{1,64}$/.test(c.id) ||
      typeof c.action !== 'string' ||
      c.action.length > 32 ||
      (c.target !== undefined && (typeof c.target !== 'string' || c.target.length > 100)) ||
      (c.value !== undefined && (typeof c.value !== 'string' || c.value.length > 100))
    )
      return null;
    return c;
  } catch {
    return null;
  }
}
export interface GameplayState {
  version: 1;
  tick: number;
  city: import('./city-life').CityLifeState;
  trip: TripMetadata | null;
  selectedPickup: string | null;
  comboTicksRemaining: number;
  summary: ShiftSummary;
  cityRanking: { id: string; username: string; score: number; deliveries: number }[];
  offers: {
    id: string;
    kind: import('./jobs').JobKind;
    persona: string;
    goalLabel: string;
    fare: Fare;
    stops: number;
  }[];
  navigation: {
    targetId: string;
    target: Vector2D;
    route: Vector2D[];
    distance: number;
    pickupExpiryTick: number;
    fare: Fare;
    tier: number;
  } | null;
}
