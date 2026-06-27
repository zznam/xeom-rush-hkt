import { EMessageType, type InputPayload, type PlayerState, type PassengerState, type WorldSnapshot, type ConfigPayload } from './types';

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
export function encodeSnapshot(tick: number, players: PlayerState[], passengers: PassengerState[]): ArrayBuffer {
  // Estimate length:
  // type(1) + tick(4) + numPlayers(2) + numPassengers(2) = 9 bytes base
  let size = 9;
  for (const p of players) {
    size += 1 + p.id.length;        // ID length + string
    size += 1 + p.username.length;  // Username length + string
    size += 4 + 4 + 4 + 4 + 4;      // x, y, angle, score, lastSeq (5 x 4 bytes)
    size += 1;                      // hasPassenger (1 byte)
    if (p.passengerId) {
      size += 1 + p.passengerId.length;
    }
  }

  for (const pa of passengers) {
    size += 1 + pa.id.length;       // ID length + string
    size += 4 + 4 + 4 + 4 + 4;      // x, y, destX, destY, reward (5 x 4 bytes)
    size += 1;                      // isCarried (1 byte)
  }

  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);

  view.setUint8(0, EMessageType.SNAPSHOT);
  view.setUint32(1, tick);
  view.setUint16(5, players.length);
  view.setUint16(7, passengers.length);

  let offset = 9;

  // Serialize players
  for (const p of players) {
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
  }

  // Serialize passengers
  for (const pa of passengers) {
    offset = writeString(view, offset, pa.id);
    view.setFloat32(offset, pa.x);
    view.setFloat32(offset + 4, pa.y);
    view.setFloat32(offset + 8, pa.destX);
    view.setFloat32(offset + 12, pa.destY);
    view.setInt32(offset + 16, pa.reward);
    view.setUint8(offset + 20, pa.isCarried ? 1 : 0);
    offset += 21;
  }

  return buffer;
}

export function decodeSnapshot(buffer: ArrayBuffer): WorldSnapshot {
  const view = new DataView(buffer);
  const tick = view.getUint32(1);
  const numPlayers = view.getUint16(5);
  const numPassengers = view.getUint16(7);

  let offset = 9;
  const players: PlayerState[] = [];
  const passengers: PassengerState[] = [];

  // Deserialize players
  for (let i = 0; i < numPlayers; i++) {
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

    players.push({
      id,
      username,
      x,
      y,
      angle,
      score,
      lastProcessedSeq,
      passengerId,
      connected: true,
    });
  }

  // Deserialize passengers
  for (let i = 0; i < numPassengers; i++) {
    const { value: id, nextOffset } = readString(view, offset);
    offset = nextOffset;

    const x = view.getFloat32(offset);
    const y = view.getFloat32(offset + 4);
    const destX = view.getFloat32(offset + 8);
    const destY = view.getFloat32(offset + 12);
    const reward = view.getInt32(offset + 16);
    const isCarried = view.getUint8(offset + 20) === 1;
    offset += 21;

    passengers.push({
      id,
      x,
      y,
      destX,
      destY,
      reward,
      spawnedAt: 0, // client doesn't need actual spawn time timestamp
      isCarried,
    });
  }

  return { tick, players, passengers };
}
