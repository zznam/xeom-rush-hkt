import { expect, it } from 'vitest';
import { encodeJoin, LANDMARKS } from '@xeom-rush/shared';
import { RoomOwner, type RoomTransport } from './room-owner';
const invite = 'b'.repeat(48),
  ids = [1, 2, 3, 4].map((i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
function fixture() {
  let now = 1,
    sequence = 0;
  const room = new RoomOwner(invite, { now: () => now });
  const sockets = new Map<string, RoomTransport>();
  const join = (id: string) => {
    const s = { send: () => {}, close: () => {} };
    sockets.set(id, s);
    room.connect(id, s);
    room.receive(id, s, encodeJoin('Bạn đường'));
  };
  const command = (id: string, action: string, target?: string, value?: string) =>
    room.receive(
      id,
      sockets.get(id)!,
      `control:${JSON.stringify({ version: 1, id: `test-${++sequence}`, action, target, value })}`,
    );
  const position = (id: string, x: number, y: number) => {
    const p = room.world.getPlayer(`room-${id}`)!;
    p.x = x;
    p.y = y;
  };
  return {
    room,
    join,
    command,
    position,
    sockets,
    advance: (ms: number) => {
      now += ms;
      room.tick();
    },
  };
}
it('requires human teammates and reserves distinct dispatch jobs with a fixed shared target', () => {
  const f = fixture();
  f.join(ids[0]);
  f.command(ids[0], 'room-mode', undefined, 'co-op');
  expect(f.room.start()).toBe(false);
  f.join(ids[1]);
  expect(f.room.start()).toBe(true);
  f.command(ids[0], 'dispatch-job');
  f.command(ids[1], 'dispatch-job');
  const state = f.room.view().teamPlay!;
  expect(state.kind).toBe('co-op');
  if (state.kind !== 'co-op') return;
  expect(state.target).toBe(40000);
  expect(new Set(Object.values(state.assignments)).size).toBe(2);
  const target = state.assignments[ids[0]];
  expect(f.room.world.canCollect(`room-${ids[1]}`, target)).toBe(false);
  f.position(ids[0], 2050, 2200);
  f.position(ids[1], 2250, 2200);
  f.room.world.getPlayer(`room-${ids[0]}`)!.score = 20000;
  f.room.world.getPlayer(`room-${ids[1]}`)!.score = 20000;
  f.room.tick();
  expect(f.room.view().teamPlay).toMatchObject({ earned: 40000, completed: true });
  f.room.disconnect(ids[1], f.sockets.get(ids[1])!);
  f.advance(31000);
  expect(f.room.view().teamPlay).toMatchObject({ earned: 40000, target: 40000 });
});
it('validates ordered relay arrivals and nearby teammate handoffs without awarding career fares', () => {
  const f = fixture();
  for (const id of ids) f.join(id);
  f.command(ids[0], 'room-mode', undefined, 'relay');
  expect(f.room.start()).toBe(true);
  let state = f.room.view().teamPlay!;
  if (state.kind !== 'relay') throw Error('relay missing');
  const team = state.teams[0],
    carrier = team.carrierId,
    next = team.nextRiderId!,
    target = LANDMARKS.find((l) => l.id === team.legs[0])!;
  f.command(carrier, 'relay-handoff', next);
  expect(team.leg).toBe(0);
  f.position(carrier, target.x, target.y);
  f.room.tick();
  f.command(carrier, 'relay-handoff', next);
  expect(f.room.view().teamPlay).toMatchObject({ teams: [{ leg: 0, handoffPending: true }, {}] });
  f.position(next, target.x + 50, target.y);
  f.command(carrier, 'relay-handoff', next);
  state = f.room.view().teamPlay!;
  if (state.kind !== 'relay') return;
  expect(state.teams[0]).toMatchObject({ leg: 1, carrierId: next, handoffPending: false, score: 10000 });
  expect(f.room.world.getPlayer(`room-${carrier}`)!.score).toBe(0);
  expect(f.room.world.getSessionStatsForPlayer(`room-${carrier}`)!.deliveriesCount).toBe(0);
  const recovered = new RoomOwner(invite, { persisted: f.room.durable() });
  expect(recovered.state.status).toBe('interrupted');
  expect(recovered.state.results.find((p) => p.id === carrier)?.score).toBe(10000);
});
it('reassigns remaining relay legs after grace and ends a team without eligible teammates', () => {
  const f = fixture();
  for (const id of ids) f.join(id);
  f.command(ids[0], 'room-mode', undefined, 'relay');
  f.room.start();
  let state = f.room.view().teamPlay!;
  if (state.kind !== 'relay') return;
  const carrier = state.teams[0].carrierId,
    next = state.teams[0].nextRiderId!;
  f.room.disconnect(carrier, f.sockets.get(carrier)!);
  f.advance(29000);
  expect((f.room.view().teamPlay as typeof state).teams[0].carrierId).toBe(carrier);
  f.advance(1001);
  state = f.room.view().teamPlay as typeof state;
  expect(state.teams[0].carrierId).toBe(next);
  f.room.disconnect(next, f.sockets.get(next)!);
  f.advance(30001);
  expect((f.room.view().teamPlay as typeof state).teams[0].failed).toContain('Không còn');
});
it('accepts only catalog emotes at a three-second cooldown', () => {
  const f = fixture();
  f.join(ids[0]);
  f.room.start();
  f.command(ids[0], 'emote', 'invented');
  expect(f.room.view().emotes).toHaveLength(0);
  f.command(ids[0], 'emote', 'hello');
  f.command(ids[0], 'emote', 'thanks');
  expect(f.room.view().emotes).toHaveLength(1);
  f.advance(3001);
  f.command(ids[0], 'emote', 'thanks');
  expect(f.room.view().emotes?.[0].id).toBe('thanks');
});
