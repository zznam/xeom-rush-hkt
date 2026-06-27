export interface Vector2D {
  x: number;
  y: number;
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
}

export enum EMessageType {
  JOIN = 1,
  INPUT = 2,
  LEAVE = 3,
  SNAPSHOT = 4,
  CONFIG = 5,
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
}
