import { RoomOwner, type RoomTransport } from '@xeom-rush/game-core';
import { encodeJoin, type DurableRoom } from '@xeom-rush/shared';
import { guestId } from './auth';
interface Env {
  ROOMS: DurableObjectNamespace;
  GUEST_SECRET: string;
  ROOM_CHECKPOINT_SECRET: string;
  CAREER_API_URL: string;
  ALLOWED_ORIGINS: string;
  TEST_MODE?: string;
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url),
      origin = request.headers.get('Origin');
    if (origin && env.TEST_MODE !== 'true' && !env.ALLOWED_ORIGINS.split(',').includes(origin))
      return json({ error: 'Origin denied' }, 403);
    if (request.method === 'OPTIONS')
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin ?? '',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        },
      });
    let response: Response;
    if (url.pathname === '/api/careers' && request.method === 'GET') {
      response = await fetch(`${env.CAREER_API_URL}/api/careers`);
    } else if (url.pathname === '/api/rooms/capabilities') {
      const id = await guestId(request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? null, env.GUEST_SECRET);
      let healthy = false;
      if (id && env.ROOM_CHECKPOINT_SECRET?.length >= 32)
        try {
          const r = await fetch(`${env.CAREER_API_URL}/api/room-checkpoint`, {
            headers: { Authorization: `Bearer ${env.ROOM_CHECKPOINT_SECRET}` },
            signal: AbortSignal.timeout(2500),
          });
          healthy = r.ok;
        } catch {
          /* Advertise no modes when careers are unavailable. */
        }
      response = json(
        {
          available: healthy,
          apiUrl: url.origin,
          identityUrl: env.CAREER_API_URL,
          modes: healthy ? ['competitive'] : [],
          adapter: 'cloudflare',
        },
        id ? 200 : 401,
      );
    } else if (request.method === 'POST' && url.pathname === '/api/rooms') {
      if (request.headers.get('Content-Length') && Number(request.headers.get('Content-Length')) > 2048)
        return json({ error: 'Payload too large' }, 413);
      const body = await request.text();
      if (body.length > 2048) return json({ error: 'Payload too large' }, 413);
      let guest: string;
      try {
        guest = JSON.parse(body).guest;
      } catch {
        return json({ error: 'Invalid body' }, 400);
      }
      if (!(await guestId(guest, env.GUEST_SECRET))) return json({ error: 'Invalid guest' }, 401);
      const invite = [...crypto.getRandomValues(new Uint8Array(24))]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('');
      const stub = env.ROOMS.get(env.ROOMS.idFromName(invite));
      await stub.fetch(`https://room/create?invite=${invite}`, { method: 'POST' });
      response = json({ invite, apiUrl: url.origin, identityUrl: env.CAREER_API_URL });
    } else {
      const api = url.pathname.match(/^\/api\/rooms\/([a-f0-9]{48})(?:\/(join|test))?$/),
        ws = url.pathname.match(/^\/private\/([a-f0-9]{48})\/ws$/);
      if (!api && !ws) return json({ error: 'Not found' }, 404);
      const invite = api?.[1] ?? ws![1],
        stub = env.ROOMS.get(env.ROOMS.idFromName(invite));
      if (ws) {
        const guest = url.searchParams.get('guest'),
          id = await guestId(guest, env.GUEST_SECRET);
        if (!id) return json({ error: 'Invalid guest' }, 401);
        const forwarded = new Request(request);
        forwarded.headers.set('X-Profile-ID', id);
        response = await stub.fetch(forwarded);
      } else if (api![2] === 'join' && request.method === 'POST') {
        const text = await request.text();
        if (text.length > 2048) return json({ error: 'Payload too large' }, 413);
        let guest: string;
        try {
          guest = JSON.parse(text).guest;
        } catch {
          return json({ error: 'Invalid body' }, 400);
        }
        const id = await guestId(guest, env.GUEST_SECRET);
        if (!id) return json({ error: 'Invalid guest' }, 401);
        const state = await stub.fetch(`https://room/state?invite=${invite}`);
        if (!state.ok) return state;
        const view = (await state.json()) as { state: any };
        const target = new URL(`/private/${invite}/ws`, url);
        target.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        target.searchParams.set('guest', guest);
        response = json({ serverUrl: target.toString(), invite, state: view.state });
      } else if (api![2] === 'test' && env.TEST_MODE === 'true')
        response = await stub.fetch(new Request(`https://room/test?invite=${invite}`, request));
      else if (request.method === 'GET' && !api![2]) {
        const state = await stub.fetch(`https://room/state?invite=${invite}`);
        response = state.ok
          ? json({ ...((await state.json()) as object), apiUrl: url.origin, identityUrl: env.CAREER_API_URL })
          : state;
      } else return json({ error: 'Not found' }, 404);
    }
    if (response.status === 101) return response;
    response = new Response(response.body, response);
    if (origin) response.headers.set('Access-Control-Allow-Origin', origin);
    return response;
  },
};
export class PrivateRoom {
  private owner: RoomOwner | null = null;
  private closed = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private transports = new Map<WebSocket, RoomTransport>();
  private saving: Promise<void> = Promise.resolve();
  constructor(
    private ctx: DurableObjectState,
    private env: Env,
  ) {
    ctx.blockConcurrencyWhile(async () => {
      this.closed = !!(await ctx.storage.get('closed'));
      const stored = await ctx.storage.get<DurableRoom>('durable');
      if (stored && !this.closed) {
        this.owner = this.configure(new RoomOwner(stored.state.invite, { persisted: stored }));
        for (const ws of ctx.getWebSockets()) {
          const a = ws.deserializeAttachment() as { profileId: string; username: string };
          if (!a) continue;
          const t = this.transport(ws);
          try {
            this.owner.connect(a.profileId, t);
            this.owner.receive(a.profileId, t, encodeJoin(a.username || 'Bạn'));
          } catch {
            ws.close(1012, 'Room interrupted');
          }
        }
        this.owner.dirty = true;
        await this.persist();
      }
    });
  }
  private configure(owner: RoomOwner) {
    owner.careerCommand = (id, c) =>
      this.ctx.waitUntil(
        (async () => {
          await this.persist();
          const r = await fetch(`${this.env.CAREER_API_URL}/api/room-career`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.env.ROOM_CHECKPOINT_SECRET}` },
            body: JSON.stringify({ profileId: id, action: c.action, target: c.target }),
            signal: AbortSignal.timeout(5000),
          });
          if (r.ok) owner.sendCareer(id, (await r.json()) as any);
        })().catch(() => {}),
      );
    return owner;
  }
  private transport(ws: WebSocket): RoomTransport {
    const t: RoomTransport = {
      send: (data) => {
        if (ws.readyState === 1) ws.send(data);
      },
      close: (code, reason) => ws.close(code, reason),
    };
    this.transports.set(ws, t);
    return t;
  }
  private run() {
    if (this.timer || !this.owner?.active || this.owner.state.status !== 'running') return;
    this.timer = setInterval(() => {
      this.owner!.tick();
      if (this.owner!.dirty) {
        this.owner!.dirty = false;
        this.ctx.waitUntil(this.persist());
      }
      if (!this.owner!.active || this.owner!.state.status !== 'running') {
        clearInterval(this.timer!);
        this.timer = null;
        this.ctx.waitUntil(this.ctx.storage.setAlarm(Date.now() + 30000));
      }
    }, 50);
  }
  private persist(): Promise<void> {
    this.saving = this.saving
      .catch(() => {})
      .then(async () => {
        if (!this.owner) return;
        await this.ctx.storage.put('durable', this.owner.durable());
        await Promise.all(
          this.owner.checkpoints().map(async (c) => {
            try {
              const r = await fetch(`${this.env.CAREER_API_URL}/api/room-checkpoint`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${this.env.ROOM_CHECKPOINT_SECRET}`,
                },
                body: JSON.stringify(c),
                signal: AbortSignal.timeout(5000),
              });
              if (r.ok) {
                this.owner!.acknowledge(c.sessionId, c.stats.revision ?? 0);
                const profile = await r.json();
                this.owner!.sendCareer(c.profileId, profile as any);
              }
            } catch {
              /* The durable outbox retries after an alarm or the next checkpoint. */
            }
          }),
        );
        await this.ctx.storage.put('durable', this.owner.durable());
        if (!this.owner.active || this.owner.checkpoints().length) await this.ctx.storage.setAlarm(Date.now() + 30000);
      });
    return this.saving;
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (this.closed) return json({ error: 'Room expired' }, 410);
    if (url.pathname === '/create') {
      if (!this.owner) {
        this.owner = this.configure(new RoomOwner(url.searchParams.get('invite')!));
        await this.persist();
        await this.ctx.storage.setAlarm(Date.now() + 600000);
      }
      return json({ ok: true });
    }
    if (!this.owner) return json({ error: 'Room not found' }, 404);
    if (this.owner.expired) {
      await this.expire();
      return json({ error: 'Room expired' }, 410);
    }
    if (url.pathname === '/state') return json({ state: this.owner.view() });
    if (url.pathname === '/test' && this.env.TEST_MODE === 'true') {
      const body = (await request.json()) as any;
      if (body.action === 'restart') {
        await this.persist();
        const data = await this.ctx.storage.get<DurableRoom>('durable');
        this.owner = this.configure(new RoomOwner(data!.state.invite, { persisted: data! }));
        for (const ws of this.ctx.getWebSockets()) ws.close(1012, 'Owner restarted');
      } else if (body.action === 'finish') {
        (this.owner as any).endsAt = 0;
        this.owner.tick();
        await this.persist();
      } else if (body.action === 'checkpoint') {
        this.owner.dirty = true;
        await this.persist();
      } else if (body.action === 'job') {
        const id = `pass-${[0, 6, 9].includes(Number(body.kind)) ? Number(body.kind) : 0}`;
        const passenger = {
          id,
          x: 2050,
          y: 2280,
          destX: 2050,
          destY: 2380,
          reward: 10000,
          tier: 0,
          deadline: 0,
          spawnedAt: this.owner.world.getTick(),
          isCarried: false,
        };
        this.owner.world.getPassengerMap().set(id, passenger);
        this.owner.world.getSpatialGrid().insert(id, passenger.x, passenger.y);
        const playerId = `room-${body.profileId}`,
          player = this.owner.world.getPlayer(playerId);
        if (player) {
          const name = player.username;
          this.owner.world.removePlayer(playerId);
          this.owner.world.addPlayer(playerId, name);
          const fresh = this.owner.world.getPlayer(playerId)!;
          fresh.x = 2050;
          fresh.y = 2200;
          this.owner.world.selectPickup(playerId, id);
        }
      } else if (body.action === 'position') {
        const p = this.owner.world.getPlayer(`room-${body.profileId}`);
        if (p && Number.isFinite(body.x) && Number.isFinite(body.y)) {
          p.x = body.x;
          p.y = body.y;
        }
      }
      return json({ ok: true, state: this.owner.view() });
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
      return json({ error: 'WebSocket required' }, 426);
    const id = request.headers.get('X-Profile-ID');
    if (!id) return json({ error: 'Invalid admission' }, 401);
    const pair = new WebSocketPair(),
      [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ profileId: id, username: 'Bạn' });
    const transport = this.transport(server);
    try {
      this.owner.connect(id, transport);
    } catch (e) {
      server.close(1008, (e as Error).message);
    }
    await this.persist();
    this.ctx.waitUntil(
      (async () => {
        const r = await fetch(`${this.env.CAREER_API_URL}/api/profile`, {
          headers: { Authorization: `Bearer ${url.searchParams.get('guest')}` },
          signal: AbortSignal.timeout(5000),
        });
        if (r.ok) this.owner?.sendCareer(id, (await r.json()) as any);
      })().catch(() => {}),
    );
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (!this.owner) return;
    const a = ws.deserializeAttachment() as { profileId: string; username: string };
    const t = this.transports.get(ws) ?? this.transport(ws);
    this.owner.receive(a.profileId, t, message);
    const p = this.owner.view().players.find((p) => p.id === a.profileId);
    if (p) ws.serializeAttachment({ ...a, username: p.username });
    if (this.owner.dirty) {
      this.owner.dirty = false;
      await this.persist();
    }
    this.run();
  }
  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    const a = ws.deserializeAttachment() as { profileId: string };
    const t = this.transports.get(ws);
    if (t && a) this.owner?.disconnect(a.profileId, t);
    this.transports.delete(ws);
    ws.close(code, reason);
    await this.persist();
  }
  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws, 1011, 'Connection interrupted');
  }
  async alarm() {
    if (!this.owner) return;
    if (this.owner.expired) {
      await this.expire();
      return;
    }
    await this.persist();
    if (!this.owner.active) await this.ctx.storage.setAlarm(Date.now() + 30000);
  }
  private async expire() {
    if (this.timer) clearInterval(this.timer);
    await this.persist();
    if (this.owner?.checkpoints().length) {
      await this.ctx.storage.setAlarm(Date.now() + 30000);
      return;
    }
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.put('closed', true);
    this.closed = true;
    this.owner = null;
  }
}
