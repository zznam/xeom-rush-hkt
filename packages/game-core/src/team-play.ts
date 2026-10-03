import {
  EMOTES,
  LANDMARKS,
  ROOM_RECONNECT_MS,
  type TeamPlayState,
  type RelayTeam,
  type RoomEmote,
  type Vector2D,
} from '@xeom-rush/shared';
import type { GameWorld } from './world';
export interface TeamMember {
  id: string;
  playerId: string;
  team: number;
  connected: boolean;
  disconnectedAt: number;
}
export class TeamPlay {
  public state: TeamPlayState | null = null;
  public emotes: RoomEmote[] = [];
  private cooldowns = new Map<string, number>();
  private absent = new Map<string, number>();
  private earnings = new Map<string, number>();
  private startingIds: string[] = [];
  private routes = new Map<string, { key: string; from: Vector2D; route: Vector2D[] }>();
  constructor(
    private world: GameWorld,
    private members: () => TeamMember[],
    private now: () => number,
  ) {}
  public start(mode: 'competitive' | 'co-op' | 'relay', members: TeamMember[]) {
    this.startingIds = members.map((m) => m.id);
    this.state =
      mode === 'co-op'
        ? { kind: 'co-op', target: members.length * 20000, earned: 0, completed: false, assignments: {} }
        : mode === 'relay'
          ? {
              kind: 'relay',
              teams: [1, 2].map((id) => {
                const people = members.filter((m) => m.team === id).map((m) => m.id);
                return {
                  id,
                  members: people,
                  legs: [LANDMARKS[0].id, LANDMARKS[4].id, LANDMARKS[8].id, LANDMARKS[11].id],
                  leg: 0,
                  carrierId: people[0],
                  handoffPending: false,
                  completed: false,
                  failed: '',
                  score: 0,
                  finishedAt: 0,
                  contributions: {},
                };
              }),
            }
          : null;
    if (mode === 'relay') for (const m of members) this.world.setJobParticipation(m.playerId, false);
  }
  public emote(id: string, target: string) {
    if (!EMOTES.some((e) => e.id === target) || this.now() - (this.cooldowns.get(id) ?? -Infinity) < 3000) return false;
    this.cooldowns.set(id, this.now());
    this.emotes = [
      ...this.emotes.filter((e) => e.expiresAt > this.now()),
      { profileId: id, id: target, expiresAt: this.now() + 3000 },
    ].slice(-8);
    return true;
  }
  public dispatch(id: string) {
    if (this.state?.kind !== 'co-op') return false;
    const m = this.members().find((m) => m.id === id),
      rider = m && this.world.getPlayer(m.playerId);
    if (!rider) return false;
    if (rider.passengerId) {
      this.state.assignments[id] = rider.passengerId;
      return true;
    }
    const current = this.state.assignments[id];
    if (current && this.world.getPassengerMap().has(current)) return true;
    const offer = this.world
      .getGameplayState(m!.playerId)
      ?.offers.find((o) => this.world.reservePickup(m!.playerId, o.id));
    if (!offer) return false;
    this.state.assignments[id] = offer.id;
    return true;
  }
  private next(team: RelayTeam, after: string) {
    const start = team.members.indexOf(after);
    for (let offset = 1; offset < team.members.length; offset++) {
      const id = team.members[(start + offset) % team.members.length];
      const member = this.members().find((m) => m.id === id && m.connected);
      if (member && this.world.getPlayer(member.playerId)) return member;
    }
    return null;
  }
  public handoff(id: string, target: string) {
    if (this.state?.kind !== 'relay') return false;
    const team = this.state.teams.find((t) => t.carrierId === id && t.handoffPending && !t.failed && !t.completed);
    if (!team) return false;
    const next = this.next(team, id),
      from = this.members().find((m) => m.id === id && m.connected);
    const rider = from && this.world.getPlayer(from.playerId),
      recipient = next && this.world.getPlayer(next.playerId);
    const landmark = LANDMARKS.find((l) => l.id === team.legs[team.leg])!;
    if (
      !rider ||
      !recipient ||
      next!.id !== target ||
      Math.hypot(rider.x - recipient.x, rider.y - recipient.y) > 70 ||
      Math.hypot(rider.x - landmark.x, rider.y - landmark.y) > 90 ||
      Math.hypot(recipient.x - landmark.x, recipient.y - landmark.y) > 90
    )
      return false;
    team.leg++;
    team.carrierId = next!.id;
    team.handoffPending = false;
    return true;
  }
  public nextRider(team: RelayTeam) {
    return this.next(team, team.carrierId)?.id ?? '';
  }
  public tick() {
    this.emotes = this.emotes.filter((e) => e.expiresAt > this.now());
    if (this.state?.kind === 'co-op') {
      for (const id of this.startingIds) {
        const p = this.world.getPlayer(`room-${id}`);
        if (p) this.earnings.set(id, p.score);
      }
      this.state.earned = [...this.earnings.values()].reduce((sum, n) => sum + n, 0);
      this.state.completed = this.state.earned >= this.state.target;
      for (const [id, passenger] of Object.entries(this.state.assignments))
        if (!this.world.getPassengerMap().has(passenger) || !this.members().some((m) => m.id === id && m.connected)) {
          this.world.releasePickup(`room-${id}`, passenger);
          delete this.state.assignments[id];
        }
    }
    if (this.state?.kind !== 'relay') return;
    for (const team of this.state.teams) {
      if (team.failed || team.completed) continue;
      const m = this.members().find((m) => m.id === team.carrierId),
        rider = m && this.world.getPlayer(m.playerId);
      if (!m?.connected || !rider) {
        if (!this.absent.has(team.carrierId)) this.absent.set(team.carrierId, m?.disconnectedAt ?? this.now());
        if (this.now() - this.absent.get(team.carrierId)! < ROOM_RECONNECT_MS) continue;
        const next = this.next(team, team.carrierId);
        if (!next) {
          team.failed = 'Không còn đồng đội để nhận chặng.';
          continue;
        }
        if (team.handoffPending) team.leg++;
        team.carrierId = next.id;
        team.handoffPending = false;
        continue;
      }
      this.absent.delete(team.carrierId);
      if (team.handoffPending && !this.next(team, team.carrierId)) {
        const waiting = team.members
          .filter((id) => id !== team.carrierId)
          .some((id) => {
            const other = this.members().find((m) => m.id === id);
            if (!this.absent.has(id)) this.absent.set(id, other?.disconnectedAt ?? this.now());
            return this.now() - this.absent.get(id)! < ROOM_RECONNECT_MS;
          });
        if (!waiting) {
          team.failed = 'Không còn đồng đội để nhận chặng.';
          continue;
        }
      }
      const target = LANDMARKS.find((l) => l.id === team.legs[team.leg])!;
      if (!team.handoffPending && Math.hypot(rider.x - target.x, rider.y - target.y) <= 65) {
        team.score += 10000;
        team.contributions[m.id] = (team.contributions[m.id] ?? 0) + 1;
        if (team.leg === team.legs.length - 1) {
          team.completed = true;
          team.finishedAt = this.world.getTick();
        } else team.handoffPending = true;
      }
    }
  }
  public navigation(id: string) {
    if (this.state?.kind !== 'relay') return null;
    const team = this.state.teams.find((t) => t.members.includes(id)),
      m = this.members().find((m) => m.id === id);
    if (!team || !m || team.failed || team.completed)
      return { label: team?.failed || 'Đội đã hoàn thành! Đợi kết quả vòng.', navigation: null };
    const landmark = LANDMARKS.find((l) => l.id === team.legs[team.leg])!,
      rider = this.world.getPlayer(m.playerId);
    if (!rider) return null;
    const key = `${landmark.id}:${this.world.getCityLife().roadRevision}`,
      cached = this.routes.get(id);
    const route =
      cached?.key === key && Math.hypot(cached.from.x - rider.x, cached.from.y - rider.y) < 200
        ? cached.route
        : this.world.getNavigationRoute(rider, landmark);
    this.routes.set(id, {
      key,
      from: cached?.key === key && route === cached.route ? cached.from : { x: rider.x, y: rider.y },
      route,
    });
    return {
      label: `${team.carrierId === id ? (team.handoffPending ? 'Trao gói cho đồng đội' : 'Mang gói tiếp sức') : 'Điểm gặp đồng đội'} · ${landmark.name} · ${team.leg + 1}/${team.legs.length}`,
      navigation: {
        targetId: `relay-${landmark.id}`,
        target: { x: landmark.x, y: landmark.y },
        route,
        distance: route.reduce(
          (sum, p, i) => sum + (i ? Math.hypot(p.x - route[i - 1].x, p.y - route[i - 1].y) : 0),
          0,
        ),
        pickupExpiryTick: 0,
        tier: 0,
        fare: { base: 0, combo: 0, environment: 0, clean: 0, tip: 0, total: 0 },
      },
    };
  }
}
