import { expect, it } from 'vitest';
import { RoomOwner, type RoomTransport } from './room-owner';
import { encodeJoin, parseRoomCheckpoint } from '@xeom-rush/shared';
const invite = 'a'.repeat(48),
  a = '00000000-0000-4000-8000-000000000001',
  b = '00000000-0000-4000-8000-000000000002';
function socket() {
  const messages: (string | ArrayBuffer)[] = [];
  return {
    messages,
    send: (data: string | ArrayBuffer) => messages.push(data),
    close: () => {},
  } satisfies RoomTransport & { messages: (string | ArrayBuffer)[] };
}
function join(room: RoomOwner, id: string) {
  const s = socket();
  room.connect(id, s);
  room.receive(id, s, encodeJoin('Tài xế'));
  return s;
}
it('runs one five-minute round, transfers host, reconnects in grace and rematches', () => {
  let now = 100;
  const room = new RoomOwner(invite, { now: () => now });
  const sa = join(room, a),
    sb = join(room, b);
  expect(room.view().hostId).toBe(a);
  expect(room.start()).toBe(true);
  room.tick();
  room.disconnect(a, sa);
  expect(room.view().hostId).toBe(b);
  now += 29000;
  const resumed = join(room, a);
  expect(room.view().players).toHaveLength(2);
  room.tick();
  expect(resumed.messages.some((m) => m instanceof ArrayBuffer)).toBe(true);
  now = 300101;
  room.tick();
  expect(room.state.status).toBe('results');
  expect(room.state.results).toHaveLength(2);
  expect(room.start()).toBe(true);
  expect(room.state.status).toBe('running');
  expect(room.state.remainingTicks).toBe(6000);
  room.disconnect(b, sb);
});
it('ends a replaced owner explicitly and retains retry-safe career contributions', () => {
  let now = 1;
  const room = new RoomOwner(invite, { now: () => now });
  join(room, a);
  room.start();
  room.world.getPlayer(`room-${a}`)!.score = 10000;
  room.tick();
  const persisted = room.durable();
  const replacement = new RoomOwner(invite, { persisted, now: () => now });
  expect(replacement.state.status).toBe('interrupted');
  expect(replacement.state.results[0].score).toBe(10000);
  expect(replacement.checkpoints()).toEqual(persisted.checkpoints);
  expect(parseRoomCheckpoint(replacement.checkpoints()[0])).not.toBeNull();
  const checkpoint = replacement.checkpoints()[0];
  replacement.acknowledge(checkpoint.sessionId, checkpoint.stats.revision!);
  expect(replacement.checkpoints()).toHaveLength(0);
  now += 600001;
  expect(replacement.expired).toBe(true);
});
it('enforces eight humans and expires reconnect grace without dropping retained scores', () => {
  let now = 0;
  const room = new RoomOwner(invite, { now: () => now });
  const s = join(room, a);
  join(room, b);
  for (let i = 3; i <= 8; i++) join(room, `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  expect(() => join(room, '00000000-0000-4000-8000-000000000009')).toThrow('tám');
  room.start();
  room.world.getPlayer(`room-${a}`)!.score = 1234;
  room.disconnect(a, s);
  now = 30001;
  room.tick();
  expect(() => join(room, a)).toThrow('nối lại');
  now = 300001;
  room.tick();
  expect(room.state.results.find((p) => p.id === a)!.score).toBe(1234);
});
it('ignores duplicate commands and never lets guests supply scores', () => {
  const room = new RoomOwner(invite),
    s = join(room, a);
  const send = (action: string, id: string, value?: string) =>
    room.receive(a, s, `control:${JSON.stringify({ version: 1, id, action, value })}`);
  send('score', 'one', '999999');
  expect(room.world.getPlayer(`room-${a}`)!.score).toBe(0);
  send('room-start', 'start');
  const round = room.state.roundId;
  send('room-start', 'start');
  expect(room.state.roundId).toBe(round);
});

it('retains round results after career acknowledgements and owner replacement', () => {
  const room = new RoomOwner(invite);
  join(room, a);
  room.start();
  room.world.getPlayer(`room-${a}`)!.score = 12345;
  room.tick();
  for (const c of room.checkpoints()) room.acknowledge(c.sessionId, c.stats.revision!);
  const persisted = room.durable();
  expect(persisted.checkpoints).toHaveLength(0);
  const recovered = new RoomOwner(invite, { persisted });
  expect(recovered.state.results[0].score).toBe(12345);
});

it('includes competitive filler bots in round results without career checkpoints', () => {
  let now = 0;
  const room = new RoomOwner(invite, { now: () => now });
  join(room, a);
  room.state.fillBots = true;
  room.start();
  now = 300001;
  room.tick();
  expect(room.state.results).toHaveLength(8);
  expect(room.checkpoints()).toHaveLength(1);
});
