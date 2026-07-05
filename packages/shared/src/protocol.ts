import {
  EMessageType,
  EPassengerTier,
  type InputPayload,
  type PlayerState,
  type PassengerState,
  type TrafficLightState,
  type PedestrianState,
  type WorldSnapshot,
  type ConfigPayload,
  type ViolationType,
} from './types';

const VIOLATION_TYPE_TO_CODE: Record<ViolationType, number> = {
  'red-light': 1,
  pedestrian: 2,
  'driver-collision': 3,
};

const VIOLATION_CODE_TO_TYPE: Record<number, ViolationType> = {
  1: 'red-light',
  2: 'pedestrian',
  3: 'driver-collision',
};

// Helper to write string to DataView
function writeString(view: DataView, offset: number, str: string): number {
  view.setUint8(offset, str.length);
  offset += 1;
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
  return offset + str.length;
}

// Helper to read string from DataView
function readString(view: DataView, offset: number): { value: string; nextOffset: number } {
  const len = view.getUint8(offset);
  let value = '';
  for (let i = 0; i < len; i++) {
    value += String.fromCharCode(view.getUint8(offset + 1 + i));
  }
  return { value, nextOffset: offset + 1 + len };
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function indexById<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function getChangedItems<T extends { id: string }>(previous: T[], next: T[]): T[] {
  const previousById = indexById(previous);
  return next.filter((item) => !sameValue(previousById.get(item.id), item));
}

function getRemovedIds<T extends { id: string }>(previous: T[], next: T[]): string[] {
  const nextIds = new Set(next.map((item) => item.id));
  return previous.filter((item) => !nextIds.has(item.id)).map((item) => item.id);
}

function mergeById<T extends { id: string }>(previous: T[], changed: T[], removedIds: string[]): T[] {
  const removed = new Set(removedIds);
  const changedById = indexById(changed);
  const merged: T[] = [];

  for (const item of previous) {
    if (removed.has(item.id)) continue;
    merged.push(changedById.get(item.id) ?? item);
    changedById.delete(item.id);
  }

  for (const item of changed) {
    if (changedById.has(item.id)) merged.push(item);
  }

  return merged;
}

function getChangedStreaks(previous: Record<string, number>, next: Record<string, number>): Record<string, number> {
  const changed: Record<string, number> = {};
  for (const [id, count] of Object.entries(next)) {
    if (previous[id] !== count) changed[id] = count;
  }
  return changed;
}

function getRemovedStreakIds(previous: Record<string, number>, next: Record<string, number>): string[] {
  return Object.keys(previous).filter((id) => !(id in next));
}

function sizePlayer(p: PlayerState): number {
  let size = 1 + p.id.length;
  size += 1 + p.username.length;
  size += 4 + 4 + 4 + 4 + 4;
  size += 1;
  if (p.passengerId) size += 1 + p.passengerId.length;
  size += 1;
  if (p.lastViolation) size += 1 + 4 + 4;
  return size;
}

function writePlayer(view: DataView, offset: number, p: PlayerState): number {
  offset = writeString(view, offset, p.id);
  offset = writeString(view, offset, p.username);
  view.setFloat32(offset, p.x);
  view.setFloat32(offset + 4, p.y);
  view.setFloat32(offset + 8, p.angle);
  view.setInt32(offset + 12, p.score);
  view.setUint32(offset + 16, p.lastProcessedSeq);
  offset += 20;
  if (p.passengerId) {
    view.setUint8(offset, 1);
    offset = writeString(view, offset + 1, p.passengerId);
  } else {
    view.setUint8(offset, 0);
    offset += 1;
  }

  if (p.lastViolation) {
    view.setUint8(offset, 1);
    view.setUint8(offset + 1, VIOLATION_TYPE_TO_CODE[p.lastViolation.type] ?? 0);
    view.setInt32(offset + 2, p.lastViolation.amount);
    view.setUint32(offset + 6, p.lastViolation.tick);
    offset += 10;
  } else {
    view.setUint8(offset, 0);
    offset += 1;
  }

  return offset;
}

function readPlayer(view: DataView, offset: number): { value: PlayerState; nextOffset: number } {
  const { value: id, nextOffset: no1 } = readString(view, offset);
  const { value: username, nextOffset: no2 } = readString(view, no1);
  offset = no2;

  const x = view.getFloat32(offset);
  const y = view.getFloat32(offset + 4);
  const angle = view.getFloat32(offset + 8);
  const score = view.getInt32(offset + 12);
  const lastProcessedSeq = view.getUint32(offset + 16);
  offset += 20;

  const hasPassenger = view.getUint8(offset) === 1;
  offset += 1;

  let passengerId: string | null = null;
  if (hasPassenger) {
    const { value: pId, nextOffset } = readString(view, offset);
    passengerId = pId;
    offset = nextOffset;
  }

  const hasViolation = view.getUint8(offset) === 1;
  offset += 1;

  const player: PlayerState = { id, username, x, y, angle, score, lastProcessedSeq, passengerId, connected: true };
  if (hasViolation) {
    const violationCode = view.getUint8(offset);
    const amount = view.getInt32(offset + 1);
    const violationTick = view.getUint32(offset + 5);
    offset += 9;

    const type = VIOLATION_CODE_TO_TYPE[violationCode];
    if (type) {
      player.lastViolation = { type, amount, tick: violationTick };
    }
  }

  return { value: player, nextOffset: offset };
}

function sizePassenger(pa: PassengerState): number {
  return 1 + pa.id.length + 26;
}

function writePassenger(view: DataView, offset: number, pa: PassengerState): number {
  offset = writeString(view, offset, pa.id);
  view.setFloat32(offset, pa.x);
  view.setFloat32(offset + 4, pa.y);
  view.setFloat32(offset + 8, pa.destX);
  view.setFloat32(offset + 12, pa.destY);
  view.setInt32(offset + 16, pa.reward);
  view.setUint8(offset + 20, pa.isCarried ? 1 : 0);
  view.setUint8(offset + 21, pa.tier);
  view.setUint32(offset + 22, pa.deadline);
  return offset + 26;
}

function readPassenger(view: DataView, offset: number): { value: PassengerState; nextOffset: number } {
  const { value: id, nextOffset } = readString(view, offset);
  offset = nextOffset;

  const x = view.getFloat32(offset);
  const y = view.getFloat32(offset + 4);
  const destX = view.getFloat32(offset + 8);
  const destY = view.getFloat32(offset + 12);
  const reward = view.getInt32(offset + 16);
  const isCarried = view.getUint8(offset + 20) === 1;
  const tier = view.getUint8(offset + 21) as EPassengerTier;
  const deadline = view.getUint32(offset + 22);
  offset += 26;

  return { value: { id, x, y, destX, destY, reward, spawnedAt: 0, isCarried, tier, deadline }, nextOffset: offset };
}

function sizeTrafficLight(tl: TrafficLightState): number {
  return 1 + tl.id.length + 10;
}

function writeTrafficLight(view: DataView, offset: number, tl: TrafficLightState): number {
  offset = writeString(view, offset, tl.id);
  view.setFloat32(offset, tl.x);
  view.setFloat32(offset + 4, tl.y);
  view.setUint8(offset + 8, tl.isRedNS ? 1 : 0);
  view.setUint8(offset + 9, tl.isYellow ? 1 : 0);
  return offset + 10;
}

function readTrafficLight(view: DataView, offset: number): { value: TrafficLightState; nextOffset: number } {
  const { value: id, nextOffset } = readString(view, offset);
  offset = nextOffset;
  const x = view.getFloat32(offset);
  const y = view.getFloat32(offset + 4);
  const isRedNS = view.getUint8(offset + 8) === 1;
  const isYellow = view.getUint8(offset + 9) === 1;
  return { value: { id, x, y, isRedNS, isYellow }, nextOffset: offset + 10 };
}

function sizePedestrian(ped: PedestrianState): number {
  return 1 + ped.id.length + 12;
}

function writePedestrian(view: DataView, offset: number, ped: PedestrianState): number {
  offset = writeString(view, offset, ped.id);
  view.setFloat32(offset, ped.x);
  view.setFloat32(offset + 4, ped.y);
  view.setFloat32(offset + 8, ped.angle);
  return offset + 12;
}

function readPedestrian(view: DataView, offset: number): { value: PedestrianState; nextOffset: number } {
  const { value: id, nextOffset } = readString(view, offset);
  offset = nextOffset;
  const x = view.getFloat32(offset);
  const y = view.getFloat32(offset + 4);
  const angle = view.getFloat32(offset + 8);
  return { value: { id, x, y, angle }, nextOffset: offset + 12 };
}

function sizeStringList(values: string[]): number {
  return values.reduce((sum, value) => sum + 1 + value.length, 0);
}

function writeStringList(view: DataView, offset: number, values: string[]): number {
  for (const value of values) {
    offset = writeString(view, offset, value);
  }
  return offset;
}

function readStringList(view: DataView, offset: number, count: number): { values: string[]; nextOffset: number } {
  const values: string[] = [];
  for (let i = 0; i < count; i++) {
    const { value, nextOffset } = readString(view, offset);
    values.push(value);
    offset = nextOffset;
  }
  return { values, nextOffset: offset };
}

// --- Join Message (Client -> Server) ---
export function encodeJoin(username: string): ArrayBuffer {
  const buffer = new ArrayBuffer(2 + username.length);
  const view = new DataView(buffer);
  view.setUint8(0, EMessageType.JOIN);
  writeString(view, 1, username);
  return buffer;
}

export function decodeJoin(buffer: ArrayBuffer): string {
  const view = new DataView(buffer);
  // Skip message type
  const { value } = readString(view, 1);
  return value;
}

// --- Config Message (Server -> Client) ---
export function encodeConfig(myId: string, mapSize: number, chunkSize: number): ArrayBuffer {
  // 1 byte msgType + 1 byte idLen + id bytes + 4 bytes mapSize + 4 bytes chunkSize
  const buffer = new ArrayBuffer(1 + 1 + myId.length + 4 + 4);
  const view = new DataView(buffer);
  view.setUint8(0, EMessageType.CONFIG);
  let offset = writeString(view, 1, myId);
  view.setFloat32(offset, mapSize);
  offset += 4;
  view.setFloat32(offset, chunkSize);
  return buffer;
}

export function decodeConfig(buffer: ArrayBuffer): ConfigPayload {
  const view = new DataView(buffer);
  const { value: myId, nextOffset } = readString(view, 1);
  const mapSize = view.getFloat32(nextOffset);
  const chunkSize = view.getFloat32(nextOffset + 4);
  return { myId, mapSize, chunkSize };
}

// --- Input Message (Client -> Server) ---
export function encodeInput(seq: number, dx: number, dy: number, angle: number): ArrayBuffer {
  // MsgType(1) + Seq(4) + dx(4) + dy(4) + angle(4) = 17 bytes
  const buffer = new ArrayBuffer(17);
  const view = new DataView(buffer);
  view.setUint8(0, EMessageType.INPUT);
  view.setUint32(1, seq);
  view.setFloat32(5, dx);
  view.setFloat32(9, dy);
  view.setFloat32(13, angle);
  return buffer;
}

export function decodeInput(buffer: ArrayBuffer): InputPayload {
  const view = new DataView(buffer);
  const seq = view.getUint32(1);
  const dx = view.getFloat32(5);
  const dy = view.getFloat32(9);
  const angle = view.getFloat32(13);
  return { seq, dx, dy, angle };
}

// --- Snapshot Message (Server -> Client) ---
// Layout:
//   type(1) + tick(4) + numPlayers(2) + numPassengers(2) + numLights(2) + numPedestrians(2)
//   + rushHour(1) + numStreaks(2) = 16 bytes base header
//   Per streak entry: idLen(1) + id bytes + streakCount(2)
//   Per player: idLen+id + usernameLen+username + x(4)+y(4)+angle(4)+score(4)+lastSeq(4)
//               + hasPassenger(1) [+ passengerId] + hasViolation(1) [+ type(1)+amount(4)+tick(4)]
//   Per passenger: idLen+id + x(4)+y(4)+destX(4)+destY(4)+reward(4)+isCarried(1)+tier(1)+deadline(4) = +5 vs old
//   Per trafficLight: idLen+id + x(4)+y(4)+isRedNS(1)+isYellow(1)
//   Per pedestrian: idLen+id + x(4)+y(4)+angle(4)
export function encodeSnapshot(
  tick: number,
  players: PlayerState[],
  passengers: PassengerState[],
  trafficLights: TrafficLightState[] = [],
  pedestrians: PedestrianState[] = [],
  rushHour: boolean = false,
  streaks: Record<string, number> = {},
): ArrayBuffer {
  const streakEntries = Object.entries(streaks).filter(([, count]) => count > 0);

  let size = 16; // base header (13 old + rushHour(1) + numStreaks(2))

  // Streak entries
  for (const [id] of streakEntries) {
    size += 1 + id.length + 2; // idLen + id + streakCount(Uint16)
  }

  for (const p of players) {
    size += sizePlayer(p);
  }
  for (const pa of passengers) {
    size += sizePassenger(pa);
  }
  for (const tl of trafficLights) {
    size += sizeTrafficLight(tl);
  }
  for (const ped of pedestrians) {
    size += sizePedestrian(ped);
  }

  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);

  view.setUint8(0, EMessageType.SNAPSHOT);
  view.setUint32(1, tick);
  view.setUint16(5, players.length);
  view.setUint16(7, passengers.length);
  view.setUint16(9, trafficLights.length);
  view.setUint16(11, pedestrians.length);
  view.setUint8(13, rushHour ? 1 : 0);
  view.setUint16(14, streakEntries.length);

  let offset = 16;

  // Serialize streaks
  for (const [id, count] of streakEntries) {
    offset = writeString(view, offset, id);
    view.setUint16(offset, count);
    offset += 2;
  }

  // Serialize players
  for (const p of players) {
    offset = writePlayer(view, offset, p);
  }

  // Serialize passengers
  for (const pa of passengers) {
    offset = writePassenger(view, offset, pa);
  }

  // Serialize traffic lights
  for (const tl of trafficLights) {
    offset = writeTrafficLight(view, offset, tl);
  }

  // Serialize pedestrians
  for (const ped of pedestrians) {
    offset = writePedestrian(view, offset, ped);
  }

  return buffer;
}

export function decodeSnapshot(buffer: ArrayBuffer): WorldSnapshot {
  const view = new DataView(buffer);
  const tick = view.getUint32(1);
  const numPlayers = view.getUint16(5);
  const numPassengers = view.getUint16(7);
  const numTrafficLights = view.getUint16(9);
  const numPedestrians = view.getUint16(11);
  const rushHour = view.getUint8(13) === 1;
  const numStreaks = view.getUint16(14);

  let offset = 16;
  const players: PlayerState[] = [];
  const passengers: PassengerState[] = [];
  const trafficLights: TrafficLightState[] = [];
  const pedestrians: PedestrianState[] = [];
  const streaks: Record<string, number> = {};

  // Deserialize streaks
  for (let i = 0; i < numStreaks; i++) {
    const { value: id, nextOffset } = readString(view, offset);
    offset = nextOffset;
    streaks[id] = view.getUint16(offset);
    offset += 2;
  }

  // Deserialize players
  for (let i = 0; i < numPlayers; i++) {
    const { value: player, nextOffset } = readPlayer(view, offset);
    offset = nextOffset;
    players.push(player);
  }

  // Deserialize passengers
  for (let i = 0; i < numPassengers; i++) {
    const { value: passenger, nextOffset } = readPassenger(view, offset);
    offset = nextOffset;
    passengers.push(passenger);
  }

  // Deserialize traffic lights
  for (let i = 0; i < numTrafficLights; i++) {
    const { value: trafficLight, nextOffset } = readTrafficLight(view, offset);
    offset = nextOffset;
    trafficLights.push(trafficLight);
  }

  // Deserialize pedestrians
  for (let i = 0; i < numPedestrians; i++) {
    const { value: pedestrian, nextOffset } = readPedestrian(view, offset);
    offset = nextOffset;
    pedestrians.push(pedestrian);
  }

  return { tick, players, passengers, trafficLights, pedestrians, rushHour, streaks };
}

// --- Delta Snapshot Message (Server -> Client) ---
// Layout:
//   type(1) + tick(4)
//   + changedPlayers(2) + removedPlayers(2)
//   + changedPassengers(2) + removedPassengers(2)
//   + changedTrafficLights(2) + removedTrafficLights(2)
//   + changedPedestrians(2) + removedPedestrians(2)
//   + rushHour(1) + changedStreaks(2) + removedStreaks(2) = 28 bytes base header
//   Changed entities use the same complete record encoding as full snapshots.
//   Removed entity/streak lists are idLen(1)+id bytes.
export function encodeDeltaSnapshot(previous: WorldSnapshot, next: WorldSnapshot): ArrayBuffer {
  const changedPlayers = getChangedItems(previous.players, next.players);
  const removedPlayerIds = getRemovedIds(previous.players, next.players);
  const changedPassengers = getChangedItems(previous.passengers, next.passengers);
  const removedPassengerIds = getRemovedIds(previous.passengers, next.passengers);
  const changedTrafficLights = getChangedItems(previous.trafficLights, next.trafficLights);
  const removedTrafficLightIds = getRemovedIds(previous.trafficLights, next.trafficLights);
  const changedPedestrians = getChangedItems(previous.pedestrians, next.pedestrians);
  const removedPedestrianIds = getRemovedIds(previous.pedestrians, next.pedestrians);
  const changedStreaks = getChangedStreaks(previous.streaks, next.streaks);
  const changedStreakEntries = Object.entries(changedStreaks).filter(([, count]) => count > 0);
  const removedStreakIds = getRemovedStreakIds(previous.streaks, next.streaks);

  let size = 28;
  size += changedPlayers.reduce((sum, player) => sum + sizePlayer(player), 0);
  size += sizeStringList(removedPlayerIds);
  size += changedPassengers.reduce((sum, passenger) => sum + sizePassenger(passenger), 0);
  size += sizeStringList(removedPassengerIds);
  size += changedTrafficLights.reduce((sum, light) => sum + sizeTrafficLight(light), 0);
  size += sizeStringList(removedTrafficLightIds);
  size += changedPedestrians.reduce((sum, pedestrian) => sum + sizePedestrian(pedestrian), 0);
  size += sizeStringList(removedPedestrianIds);
  for (const [id] of changedStreakEntries) {
    size += 1 + id.length + 2;
  }
  size += sizeStringList(removedStreakIds);

  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);

  view.setUint8(0, EMessageType.DELTA_SNAPSHOT);
  view.setUint32(1, next.tick);
  view.setUint16(5, changedPlayers.length);
  view.setUint16(7, removedPlayerIds.length);
  view.setUint16(9, changedPassengers.length);
  view.setUint16(11, removedPassengerIds.length);
  view.setUint16(13, changedTrafficLights.length);
  view.setUint16(15, removedTrafficLightIds.length);
  view.setUint16(17, changedPedestrians.length);
  view.setUint16(19, removedPedestrianIds.length);
  view.setUint8(21, next.rushHour ? 1 : 0);
  view.setUint16(22, changedStreakEntries.length);
  view.setUint16(24, removedStreakIds.length);
  view.setUint16(26, 0); // reserved for future delta flags

  let offset = 28;
  for (const player of changedPlayers) offset = writePlayer(view, offset, player);
  offset = writeStringList(view, offset, removedPlayerIds);
  for (const passenger of changedPassengers) offset = writePassenger(view, offset, passenger);
  offset = writeStringList(view, offset, removedPassengerIds);
  for (const light of changedTrafficLights) offset = writeTrafficLight(view, offset, light);
  offset = writeStringList(view, offset, removedTrafficLightIds);
  for (const pedestrian of changedPedestrians) offset = writePedestrian(view, offset, pedestrian);
  offset = writeStringList(view, offset, removedPedestrianIds);
  for (const [id, count] of changedStreakEntries) {
    offset = writeString(view, offset, id);
    view.setUint16(offset, count);
    offset += 2;
  }
  writeStringList(view, offset, removedStreakIds);

  return buffer;
}

export function decodeDeltaSnapshot(buffer: ArrayBuffer, previous: WorldSnapshot): WorldSnapshot {
  const view = new DataView(buffer);
  const tick = view.getUint32(1);
  const changedPlayerCount = view.getUint16(5);
  const removedPlayerCount = view.getUint16(7);
  const changedPassengerCount = view.getUint16(9);
  const removedPassengerCount = view.getUint16(11);
  const changedTrafficLightCount = view.getUint16(13);
  const removedTrafficLightCount = view.getUint16(15);
  const changedPedestrianCount = view.getUint16(17);
  const removedPedestrianCount = view.getUint16(19);
  const rushHour = view.getUint8(21) === 1;
  const changedStreakCount = view.getUint16(22);
  const removedStreakCount = view.getUint16(24);

  let offset = 28;
  const changedPlayers: PlayerState[] = [];
  const changedPassengers: PassengerState[] = [];
  const changedTrafficLights: TrafficLightState[] = [];
  const changedPedestrians: PedestrianState[] = [];

  for (let i = 0; i < changedPlayerCount; i++) {
    const { value, nextOffset } = readPlayer(view, offset);
    changedPlayers.push(value);
    offset = nextOffset;
  }
  const removedPlayers = readStringList(view, offset, removedPlayerCount);
  offset = removedPlayers.nextOffset;

  for (let i = 0; i < changedPassengerCount; i++) {
    const { value, nextOffset } = readPassenger(view, offset);
    changedPassengers.push(value);
    offset = nextOffset;
  }
  const removedPassengers = readStringList(view, offset, removedPassengerCount);
  offset = removedPassengers.nextOffset;

  for (let i = 0; i < changedTrafficLightCount; i++) {
    const { value, nextOffset } = readTrafficLight(view, offset);
    changedTrafficLights.push(value);
    offset = nextOffset;
  }
  const removedTrafficLights = readStringList(view, offset, removedTrafficLightCount);
  offset = removedTrafficLights.nextOffset;

  for (let i = 0; i < changedPedestrianCount; i++) {
    const { value, nextOffset } = readPedestrian(view, offset);
    changedPedestrians.push(value);
    offset = nextOffset;
  }
  const removedPedestrians = readStringList(view, offset, removedPedestrianCount);
  offset = removedPedestrians.nextOffset;

  const streaks: Record<string, number> = { ...previous.streaks };
  for (let i = 0; i < changedStreakCount; i++) {
    const { value: id, nextOffset } = readString(view, offset);
    offset = nextOffset;
    streaks[id] = view.getUint16(offset);
    offset += 2;
  }
  const removedStreaks = readStringList(view, offset, removedStreakCount);
  for (const id of removedStreaks.values) {
    delete streaks[id];
  }

  return {
    tick,
    players: mergeById(previous.players, changedPlayers, removedPlayers.values),
    passengers: mergeById(previous.passengers, changedPassengers, removedPassengers.values),
    trafficLights: mergeById(previous.trafficLights, changedTrafficLights, removedTrafficLights.values),
    pedestrians: mergeById(previous.pedestrians, changedPedestrians, removedPedestrians.values),
    rushHour,
    streaks,
  };
}
