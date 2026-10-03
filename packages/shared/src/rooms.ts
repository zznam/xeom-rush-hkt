import type { CareerContribution } from './career';
export type RoomMode = 'competitive' | 'co-op' | 'relay';
export interface RoomCheckpoint {
  profileId: string;
  sessionId: string;
  stats: CareerContribution;
}
export interface RoomParticipant {
  id: string;
  playerId: string;
  username: string;
  connected: boolean;
  team: number;
}
export interface RoomResult {
  id: string;
  username: string;
  score: number;
  deliveries: number;
}
export interface RoomState {
  invite: string;
  hostId: string;
  roundId: string;
  status: 'lobby' | 'running' | 'results' | 'interrupted';
  mode: RoomMode;
  remainingTicks: number;
  fillBots: boolean;
  players: RoomParticipant[];
  results: RoomResult[];
  reason: string;
  ownerEpoch: string;
  emptyExpiresAt: number;
}
export interface DurableRoom {
  state: RoomState;
  checkpoints: RoomCheckpoint[];
  roundResults?: RoomResult[];
}
export const ROOM_DURATION_MS = 300000,
  ROOM_EMPTY_TTL_MS = 600000,
  ROOM_RECONNECT_MS = 30000;

export function parseRoomCheckpoint(value: unknown): RoomCheckpoint | null {
  const c = value as RoomCheckpoint;
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  if (
    !c ||
    !uuid.test(c.profileId) ||
    typeof c.sessionId !== 'string' ||
    !new RegExp(`^room:[a-f0-9]{48}:[a-f0-9-]{36}:${c.profileId}$`).test(c.sessionId) ||
    !c.stats
  )
    return null;
  const s = c.stats,
    n = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e9;
  if (
    typeof s.username !== 'string' ||
    s.username.length > 32 ||
    ![s.score, s.peakStreak, s.deliveriesCount, s.revision].every(n) ||
    !s.summary
  )
    return null;
  if (
    !['distance', 'cleanTrips', 'baseFares', 'bonuses', 'tips', 'fines', 'fastestTripTicks'].every((k) =>
      n(s.summary![k as keyof typeof s.summary]),
    ) ||
    !Array.isArray(s.summary.visited) ||
    s.summary.visited.length > 12 ||
    !s.summary.visited.every((k) => typeof k === 'string' && /^[a-z-]{1,32}$/.test(k))
  )
    return null;
  if (
    Object.entries(s.progress ?? {}).length > 16 ||
    !Object.entries(s.progress ?? {}).every(
      ([period, counts]) =>
        /^[dw]:\d{4}-\d{2}-\d{2}$/.test(period) &&
        !!counts &&
        typeof counts === 'object' &&
        !Array.isArray(counts) &&
        Object.entries(counts).length <= 16 &&
        Object.entries(counts).every(
          ([key, value]) =>
            /^(distance|deliveries|clean|passenger|food|parcel|market|downtown|old-town|riverside|rain|night|tipped)$/.test(
              key,
            ) && n(value),
        ),
    )
  )
    return null;
  return {
    profileId: c.profileId,
    sessionId: c.sessionId,
    stats: {
      username: s.username,
      score: s.score,
      peakStreak: s.peakStreak,
      deliveriesCount: s.deliveriesCount,
      revision: s.revision,
      summary: structuredClone(s.summary),
      progress: structuredClone(s.progress ?? {}),
    },
  };
}
