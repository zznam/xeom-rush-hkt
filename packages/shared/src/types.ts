export interface Vector2D {
  x: number;
  y: number;
}

export enum EPassengerTier {
  REGULAR = 0,
  BUSINESS = 1,
  VIP = 2,
}

export interface PlayerState {
  id: string;
  username: string;
  x: number;
  y: number;
  angle: number;
  score: number;
  lastProcessedSeq: number;
  passengerId: string | null; // Passenger being carried, if any
  connected: boolean;
  lastViolation?: ViolationState;
}

export type ViolationType = 'red-light' | 'pedestrian' | 'driver-collision';

export interface ViolationState {
  type: ViolationType;
  amount: number;
  tick: number;
}

export interface PassengerState {
  id: string;
  x: number;
  y: number;
  destX: number;
  destY: number;
  reward: number;
  spawnedAt: number;
  isCarried: boolean;
  tier: EPassengerTier;
  deadline: number; // Absolute server tick when passenger expires (0 = no deadline)
}

export interface PedestrianState {
  id: string;
  x: number;
  y: number;
  angle: number;
}

export interface TrafficLightState {
  id: string;
  x: number;
  y: number;
  isRedNS: boolean; // True if Red for North-South (and Green for East-West), false otherwise
  isYellow: boolean; // True if in transition warning phase
}

export enum EMessageType {
  JOIN = 1,
  INPUT = 2,
  LEAVE = 3,
  SNAPSHOT = 4,
  CONFIG = 5,
  DELTA_SNAPSHOT = 6,
}

export type SnapshotPacketKind = 'full' | 'delta';

export interface SnapshotPacketMeta {
  bytes: number;
  kind: SnapshotPacketKind;
}

// Client -> Server
export interface JoinPayload {
  username: string;
}

export interface InputPayload {
  seq: number;
  dx: number; // directional x [-1, 1]
  dy: number; // directional y [-1, 1]
  angle: number;
}

// Server -> Client
export interface ConfigPayload {
  myId: string;
  mapSize: number;
  chunkSize: number;
}

export interface WorldSnapshot {
  tick: number;
  players: PlayerState[];
  passengers: PassengerState[];
  trafficLights: TrafficLightState[];
  pedestrians: PedestrianState[];
  rushHour: boolean;
  streaks: Record<string, number>; // playerId -> streak count
}
