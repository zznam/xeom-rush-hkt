import {
  ROOM_DURATION_MS,
  ROOM_EMPTY_TTL_MS,
  ROOM_RECONNECT_MS,
  MAP_SIZE,
  CHUNK_SIZE,
  decodeJoin,
  decodeInput,
  encodeConfig,
  encodeSnapshot,
  encodeDeltaSnapshot,
  parseGameCommand,
  EMessageType,
  type RoomState,
  type RoomResult,
  type DurableRoom,
  type RoomCheckpoint,
  type WorldSnapshot,
  type GameCommand,
} from '@xeom-rush/shared';
import { TeamPlay } from './team-play';
import { GameWorld } from './world';
import { BotManager } from './bot-ai';
export interface RoomTransport {
  send(data: string | ArrayBuffer): void;
  close(code: number, reason: string): void;
  bufferedAmount?: number;
}
interface Member {
  id: string;
  playerId: string;
  username: string;
  team: number;
  socket: RoomTransport | null;
  disconnectedAt: number;
  joined: boolean;
  last: WorldSnapshot | null;
  lastFull: number;
  commandIds: Set<string>;
  window: number;
  messages: number;
  commands: number;
  expired: boolean;
  tripKey: string;
}
export class RoomOwner {
  public world: GameWorld;
  public state: RoomState;
  private bots: BotManager;
  private teams: TeamPlay;
  private teamMembers() {
    return [...this.members.values()].map((p) => ({
      id: p.id,
      playerId: p.playerId,
      team: p.team,
      connected: !!p.socket && p.joined,
      disconnectedAt: p.disconnectedAt,
    }));
  }
  private members = new Map<string, Member>();
  public careerCommand: ((id: string, command: GameCommand) => void) | null = null;
  private acknowledged = new Map<string, number>();
  private appearances = new Map<string, Record<string, string>>();
  public sendCareer(id: string, profile: { equipped: Record<string, string> }) {
    const p = this.members.get(id);
    if (!p) return;
    this.appearances.set(id, profile.equipped);
    this.world.setAppearance(p.playerId, profile.equipped);
    this.control(p, 'career', profile);
  }
  private outbox = new Map<string, RoomCheckpoint>();
  private retained = new Map<string, RoomResult>();
  private endsAt = 0;
  private now: () => number;
  public dirty = true;
  constructor(invite: string, options: { now?: () => number; persisted?: DurableRoom } = {}) {
    this.now = options.now ?? Date.now;
    this.world = new GameWorld({ enhanced: true, now: this.now });
    this.bots = new BotManager(this.world, this.world.getPhysics());
    this.teams = new TeamPlay(this.world, () => this.teamMembers(), this.now);
    this.state = {
      invite,
      hostId: '',
      roundId: '',
      status: 'lobby',
      mode: 'competitive',
      remainingTicks: 6000,
      fillBots: false,
      players: [],
      results: [],
      reason: '',
      ownerEpoch: crypto.randomUUID(),
      emptyExpiresAt: this.now() + ROOM_EMPTY_TTL_MS,
    };
    if (options.persisted) {
      this.state = {
        ...options.persisted.state,
        ownerEpoch: this.state.ownerEpoch,
        emptyExpiresAt: options.persisted.state.emptyExpiresAt || this.now() + ROOM_EMPTY_TTL_MS,
      };
      this.teams.state = options.persisted.state.teamPlay ?? null;
      for (const p of this.state.players) {
        this.members.set(p.id, this.member(p.id, p.username, p.team));
        this.world.addPlayer(p.playerId, p.username);
      }
      for (const p of options.persisted.roundResults ?? []) this.retained.set(p.id, p);
      for (const p of options.persisted.checkpoints) this.outbox.set(p.sessionId, p);
      if (this.state.status === 'running') {
        this.state.status = 'interrupted';
        this.state.reason = 'Chủ phòng đã khởi động lại. Vòng chơi bị gián đoạn; thành tích đã ghi được giữ lại.';
        this.state.results = this.state.players.map((p) => {
          const c = options.persisted!.checkpoints.find((c) => c.profileId === p.id);
          const relayLegs =
            this.teams.state?.kind === 'relay'
              ? (this.teams.state.teams.find((t) => t.members.includes(p.id))?.contributions[p.id] ?? 0)
              : undefined;
          return {
            id: p.id,
            username: p.username,
            score:
              relayLegs === undefined ? (this.retained.get(p.id)?.score ?? c?.stats.score ?? 0) : relayLegs * 10000,
            deliveries: relayLegs ?? this.retained.get(p.id)?.deliveries ?? c?.stats.deliveriesCount ?? 0,
          };
        });
      }
    }
  }
  private member(id: string, username: string, team = 0): Member {
    return {
      id,
      playerId: `room-${id}`,
      username,
      team,
      socket: null,
      disconnectedAt: this.now(),
      joined: false,
      last: null,
      lastFull: 0,
      commandIds: new Set(),
      window: this.now(),
      messages: 0,
      commands: 0,
      expired: false,
      tripKey: '',
    };
  }
  public get active() {
    return [...this.members.values()].some((p) => !!p.socket);
  }
  public get expired() {
    return !this.active && this.now() >= this.state.emptyExpiresAt;
  }
  public connect(id: string, socket: RoomTransport) {
    if (this.state.status === 'running' && this.now() >= this.endsAt) this.finish();
    this.prune();
    let p = this.members.get(id);
    if (!p && this.state.status === 'running') throw new Error('Vòng chơi đang diễn ra. Chờ vòng sau nhé.');
    if (!p && this.members.size >= 8) throw new Error('Phòng đã đủ tám tài xế.');
    if (!p) {
      p = this.member(id, 'Bạn', (this.members.size % 2) + 1);
      this.members.set(id, p);
      this.world.addPlayer(p.playerId, p.username);
    }
    if (p.socket) p.socket.close(1000, 'Đã kết nối ở cửa sổ khác.');
    if (p?.expired && this.state.status === 'running') throw new Error('Thời gian nối lại đã hết. Chờ vòng sau nhé.');
    p.expired = false;
    p.socket = socket;
    p.joined = false;
    p.last = null;
    p.window = this.now();
    p.messages = 0;
    p.commands = 0;
    const player = this.world.getPlayer(p.playerId);
    if (player) player.connected = true;
    if (!this.members.get(this.state.hostId)?.socket) this.state.hostId = id;
    this.state.emptyExpiresAt = 0;
    this.dirty = true;
    return p.playerId;
  }
  public disconnect(id: string, socket: RoomTransport) {
    const p = this.members.get(id);
    if (!p || p.socket !== socket) return;
    p.socket = null;
    p.disconnectedAt = this.now();
    p.joined = false;
    const player = this.world.getPlayer(p.playerId);
    if (player) player.connected = false;
    if (this.state.hostId === id) this.transferHost();
    if (!this.active) this.state.emptyExpiresAt = this.now() + ROOM_EMPTY_TTL_MS;
    this.dirty = true;
    this.broadcastState();
  }
  public leave(id: string) {
    const p = this.members.get(id);
    if (!p) return;
    this.capture();
    p.socket?.close(1000, 'Đã rời phòng.');
    this.world.removePlayer(p.playerId);
    this.members.delete(id);
    if (this.state.hostId === id) this.transferHost();
    if (!this.active) this.state.emptyExpiresAt = this.now() + ROOM_EMPTY_TTL_MS;
    this.dirty = true;
    this.broadcastState();
  }
  private transferHost() {
    this.state.hostId = [...this.members.values()].find((p) => p.socket)?.id ?? '';
  }
  private prune() {
    for (const p of this.members.values()) {
      if (!p.socket && p.expired && this.state.status !== 'running') {
        this.members.delete(p.id);
        continue;
      }
      if (!p.socket && !p.expired && this.now() - p.disconnectedAt >= ROOM_RECONNECT_MS) {
        this.capture();
        this.world.removePlayer(p.playerId);
        p.expired = true;
        if (this.state.status !== 'running') this.members.delete(p.id);
      }
    }
  }
  public receive(id: string, socket: RoomTransport, data: string | ArrayBuffer) {
    const p = this.members.get(id);
    if (!p || p.socket !== socket) return;
    if (this.now() - p.window >= 1000) {
      p.window = this.now();
      p.messages = 0;
      p.commands = 0;
    }
    if (++p.messages > 150) {
      socket.close(1008, 'Quá nhiều tin nhắn.');
      return;
    }
    try {
      if (typeof data === 'string') {
        if (/^ping:[0-9]{13}$/.test(data)) {
          socket.send(`pong:${data.slice(5)}`);
          return;
        }
        if (!p.joined || !data.startsWith('control:')) return;
        const c = parseGameCommand(data.slice(8));
        if (!c || ++p.commands > 10) throw new Error('Invalid command');
        if (p.commandIds.has(c.id)) return;
        p.commandIds.add(c.id);
        if (p.commandIds.size > 128) p.commandIds.delete(p.commandIds.values().next().value!);
        this.command(p, c);
        return;
      }
      if (data.byteLength > 1024 || data.byteLength < 1) throw new Error('Invalid packet');
      const type = new DataView(data).getUint8(0);
      if (type === EMessageType.JOIN) {
        if (p.joined) throw new Error('Duplicate join');
        p.username = decodeJoin(data).trim();
        if (!p.username) throw new Error('Empty name');
        p.joined = true;
        const player = this.world.getPlayer(p.playerId);
        if (player) player.username = p.username;
        this.configure(p);
        this.broadcastState();
        this.dirty = true;
      } else if (type === EMessageType.INPUT && p.joined && this.state.status === 'running')
        this.world.queueInput(p.playerId, decodeInput(data));
      else if (type === EMessageType.LEAVE) this.leave(id);
    } catch {
      socket.close(1008, 'Tin nhắn không hợp lệ.');
    }
  }
  private configure(p: Member) {
    p.last = null;
    p.socket?.send(encodeConfig(p.playerId, MAP_SIZE, CHUNK_SIZE));
    this.control(p, 'capabilities', {
      version: 1,
      careers: true,
      trips: true,
      rooms: true,
      modes: ['competitive', 'co-op', 'relay'],
    });
    this.snapshot(p, true);
    this.control(p, 'room', this.view());
  }
  private control(p: Member, kind: string, data: unknown) {
    p.socket?.send(`control:${JSON.stringify({ version: 1, kind, data })}`);
  }
  private command(p: Member, c: GameCommand) {
    if (['profile', 'claim', 'equip'].includes(c.action)) this.careerCommand?.(p.id, c);
    if (c.action === 'select-pickup' && this.state.status === 'running') this.world.selectPickup(p.playerId, c.target);
    if (c.action === 'room-leave') {
      this.leave(p.id);
      return;
    }
    if (c.action === 'room-team' && this.state.status !== 'running' && ['1', '2'].includes(c.value ?? '')) {
      const team = Number(c.value);
      if ([...this.members.values()].filter((m) => m.team === team).length < 4 || p.team === team) p.team = team;
      this.dirty = true;
      this.broadcastState();
      return;
    }
    if (this.state.status === 'running') {
      if (c.action === 'emote' && this.teams.emote(p.id, c.target ?? '')) this.broadcastState();
      if (c.action === 'dispatch-job' && this.teams.dispatch(p.id)) {
        this.dirty = true;
        this.broadcastState();
      }
      if (c.action === 'relay-handoff' && this.teams.handoff(p.id, c.target ?? '')) {
        this.dirty = true;
        this.broadcastState();
      }
    }
    if (p.id !== this.state.hostId) return;
    if (
      c.action === 'room-mode' &&
      this.state.status !== 'running' &&
      ['competitive', 'co-op', 'relay'].includes(c.value ?? '')
    ) {
      this.state.mode = c.value as RoomState['mode'];
      this.state.reason = '';
      if (this.state.mode !== 'competitive') this.state.fillBots = false;
    }
    if (c.action === 'room-bots' && this.state.status !== 'running' && this.state.mode === 'competitive')
      this.state.fillBots = c.value === 'true';
    if (
      (c.action === 'room-start' && this.state.status === 'lobby') ||
      (c.action === 'room-rematch' && ['results', 'interrupted'].includes(this.state.status))
    )
      this.start();
    this.dirty = true;
    this.broadcastState();
  }
  public start() {
    if (this.state.status === 'running' || !this.active) return false;
    const starters = this.teamMembers().filter((p) => p.connected);
    if (this.state.mode === 'co-op' && starters.length < 2) {
      this.state.reason = 'Co-op cần ít nhất hai người thật.';
      this.broadcastState();
      return false;
    }
    if (
      this.state.mode === 'relay' &&
      [1, 2].some((team) => {
        const count = starters.filter((p) => p.team === team).length;
        return count < 2 || count > 4;
      })
    ) {
      this.state.reason = 'Tiếp sức cần hai đội, mỗi đội hai đến bốn người thật.';
      this.broadcastState();
      return false;
    }
    this.capture();
    for (const p of this.members.values()) if (!p.socket && p.expired) this.members.delete(p.id);
    this.world = new GameWorld({ enhanced: true, now: this.now });
    this.bots = new BotManager(this.world, this.world.getPhysics());
    for (const p of this.members.values()) {
      this.world.addPlayer(p.playerId, p.username);
      if (this.appearances.has(p.id)) this.world.setAppearance(p.playerId, this.appearances.get(p.id)!);
      this.world.getPlayer(p.playerId)!.connected = !!p.socket;
    }
    this.teams = new TeamPlay(this.world, () => this.teamMembers(), this.now);
    this.teams.start(this.state.mode, starters);
    this.retained.clear();
    this.state.roundId = crypto.randomUUID();
    this.state.status = 'running';
    this.state.results = [];
    this.state.reason = '';
    this.endsAt = this.now() + ROOM_DURATION_MS;
    this.state.remainingTicks = 6000;
    if (this.state.fillBots) this.bots.spawnBots(Math.max(0, 8 - this.members.size));
    for (const p of this.members.values()) if (p.joined) this.configure(p);
    this.dirty = true;
    this.broadcastState();
    return true;
  }
  private finish(reason = 'Hết giờ! Cảm ơn những chuyến xe vui.') {
    this.state.results = [...this.members.values()]
      .map((p) => ({
        id: p.id,
        username: p.username,
        score: this.world.getPlayer(p.playerId)?.score ?? this.retained.get(p.id)?.score ?? 0,
        deliveries:
          this.world.getSessionStatsForPlayer(p.playerId)?.deliveriesCount ?? this.retained.get(p.id)?.deliveries ?? 0,
      }))
      .concat(this.world.getCityRanking(true).filter((p) => p.id.startsWith('bot-')))
      .sort((a, b) => b.score - a.score);
    if (this.teams.state?.kind === 'co-op')
      reason = this.teams.state.completed
        ? 'Đồng đội hoàn thành mục tiêu! Cả phố cùng vui.'
        : 'Hết vòng co-op. Chơi lại để cùng chạm mục tiêu nhé!';
    if (this.teams.state?.kind === 'relay') {
      const teams = this.teams.state.teams;
      this.state.results = [...this.members.values()]
        .map((p) => ({
          id: p.id,
          username: p.username,
          score: (teams.find((t) => t.members.includes(p.id))?.contributions[p.id] ?? 0) * 10000,
          deliveries: teams.find((t) => t.members.includes(p.id))?.contributions[p.id] ?? 0,
        }))
        .sort((a, b) => b.score - a.score);
      reason = 'Hết vòng tiếp sức. Điểm chặng tính riêng với nghề nghiệp.';
    }
    this.capture();
    this.state.status = 'results';
    this.state.reason = reason;
    this.state.remainingTicks = 0;
    this.dirty = true;
    this.broadcastState();
  }
  public tick() {
    this.prune();
    if (this.state.status === 'running' && this.now() >= this.endsAt) {
      this.finish();
      return;
    }
    if (!this.active || this.state.status !== 'running') return;
    this.bots.tick();
    this.world.tick(0.05);
    this.teams.tick();
    this.state.remainingTicks = Math.max(0, Math.ceil((this.endsAt - this.now()) / 50));
    for (const p of this.members.values()) if (p.joined && p.socket) this.snapshot(p);
    if (this.world.getTick() % 20 === 0) this.broadcastState();
    if (this.world.getTick() % 600 === 0) {
      this.capture();
      this.dirty = true;
    }
  }
  private snapshot(p: Member, full = false) {
    if (!p.socket) return;
    if ((p.socket.bufferedAmount ?? 0) > 262144) {
      p.socket.close(1013, 'Kết nối chậm.');
      return;
    }
    const s = this.world.getVisibleSnapshotForPlayer(p.playerId),
      snapshot: WorldSnapshot = { ...s, tick: this.world.getTick() };
    const complete = full || !p.last || snapshot.tick - p.lastFull >= 40;
    p.socket.send(
      complete
        ? encodeSnapshot(
            snapshot.tick,
            snapshot.players,
            snapshot.passengers,
            snapshot.trafficLights,
            snapshot.pedestrians,
            snapshot.rushHour,
            snapshot.streaks,
          )
        : encodeDeltaSnapshot(p.last!, snapshot),
    );
    if (complete) p.lastFull = snapshot.tick;
    p.last = snapshot;
    const rider = this.world.getPlayer(p.playerId),
      trip = rider?.passengerId ? this.world.getPassengerMap().get(rider.passengerId) : null;
    const tripKey = trip ? `${trip.id}:${trip.destX}:${trip.destY}` : '';
    if (complete || snapshot.tick % 20 === 0 || tripKey !== p.tripKey) {
      p.tripKey = tripKey;
      const gameplay = this.world.getGameplayState(p.playerId),
        relay = this.teams.navigation(p.id);
      if (gameplay && relay) {
        gameplay.teamNavigation = relay.label;
        gameplay.navigation = relay.navigation;
        gameplay.trip = null;
        gameplay.offers = [];
      }
      this.control(p, 'gameplay', gameplay);
      this.control(p, 'appearance', this.world.getAppearances());
      p.socket.send(
        `city:${JSON.stringify({ tick: snapshot.tick, rushHourTicksRemaining: this.world.getRushHourTicksRemaining(), deliveries: this.world.getSessionStatsForPlayer(p.playerId)?.deliveriesCount ?? 0 })}`,
      );
    }
  }
  public view(): RoomState {
    return {
      ...this.state,
      teamPlay:
        this.teams.state?.kind === 'relay'
          ? {
              ...this.teams.state,
              teams: this.teams.state.teams.map((t) => ({ ...t, nextRiderId: this.teams.nextRider(t) })),
            }
          : this.teams.state,
      emotes: this.teams.emotes,
      players: [...this.members.values()].map((p) => ({
        id: p.id,
        playerId: p.playerId,
        username: p.username,
        connected: !!p.socket,
        team: p.team,
      })),
    };
  }
  public broadcastState() {
    const view = this.view();
    for (const p of this.members.values()) if (p.joined && p.socket) this.control(p, 'room', view);
  }
  private capture() {
    if (!this.state.roundId || !['running', 'results'].includes(this.state.status)) return;
    for (const p of this.members.values()) {
      const stats = this.world.getSessionStatsForPlayer(p.playerId);
      if (!stats) continue;
      this.retained.set(p.id, {
        id: p.id,
        username: p.username,
        score: stats.score,
        deliveries: stats.deliveriesCount,
      });
      const sessionId = `room:${this.state.invite}:${this.state.roundId}:${p.id}`;
      if ((stats.revision ?? 0) > (this.acknowledged.get(sessionId) ?? -1))
        this.outbox.set(sessionId, { sessionId, profileId: p.id, stats });
    }
  }
  public checkpoints() {
    this.capture();
    return [...this.outbox.values()].map((p) => structuredClone(p));
  }
  public acknowledge(sessionId: string, revision: number) {
    this.acknowledged.set(sessionId, Math.max(this.acknowledged.get(sessionId) ?? -1, revision));
    if ((this.outbox.get(sessionId)?.stats.revision ?? Infinity) <= revision) this.outbox.delete(sessionId);
  }
  public durable(): DurableRoom {
    const checkpoints = this.checkpoints();
    return { state: this.view(), checkpoints, roundResults: [...this.retained.values()] };
  }
}
