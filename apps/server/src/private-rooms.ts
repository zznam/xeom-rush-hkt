import type { Express } from 'express';
import type { Server, IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { randomBytes, timingSafeEqual } from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomOwner, type RoomTransport } from '@xeom-rush/game-core';
import { parseRoomCheckpoint, publicCareer } from '@xeom-rush/shared';
import { careerRepository } from './career-store';
import { verifyGuest, issueGuest } from './admission';

export function installPrivateRooms(
  app: Express,
  options: {
    secret: () => string;
    ready: () => boolean;
    production: boolean;
    regional: boolean;
    ownerId: string;
    allowedOrigins: string[];
  },
) {
  const local =
    process.env.ROOM_ADAPTER === 'local' || (options.regional && process.env.PRIVATE_ROOMS_ENABLED === 'true');
  const remote = (process.env.ROOM_SERVICE_URL ?? '').replace(/\/$/, '');
  const prefix = options.regional ? `/rooms/${options.ownerId}` : '';
  const maximum = Number(process.env.MAX_PRIVATE_ROOMS ?? 4);
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 100) throw new Error('MAX_PRIVATE_ROOMS must be 1-100');
  const owners = new Map<string, RoomOwner>(),
    loads = new Map<string, Promise<RoomOwner | null>>(),
    saving = new Map<string, Promise<void>>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  let cachedCapabilities: { expires: number; value: any } | null = null;
  const apiOrigin = (req: IncomingMessage) =>
    process.env.PUBLIC_ROOM_URL || `${options.production ? 'https' : 'http'}://${req.headers.host}${prefix}`;
  const capabilities = async (base: string) => {
    if (local && options.ready())
      return {
        available: true,
        apiUrl: base,
        identityUrl: base,
        modes: ['competitive'],
        adapter: options.regional ? 'ecs' : 'local',
      };
    if (!remote || !options.ready()) return { available: false, modes: [] };
    if (cachedCapabilities && cachedCapabilities.expires > Date.now()) return cachedCapabilities.value;
    try {
      const r = await fetch(`${remote}/api/rooms/capabilities`, {
        headers: { Authorization: `Bearer ${issueGuest(options.secret())}` },
        signal: AbortSignal.timeout(2500),
      });
      const value = r.ok ? await r.json() : { available: false, modes: [] };
      cachedCapabilities = { expires: Date.now() + 15000, value };
      return value;
    } catch {
      return { available: false, modes: [] };
    }
  };
  async function persist(invite: string, owner: RoomOwner) {
    const previous = saving.get(invite) ?? Promise.resolve();
    const task = previous
      .catch(() => {})
      .then(async () => {
        if (owner.dirty && owners.get(invite) === owner) {
          owner.dirty = false;
          try {
            await careerRepository.writeRoom(invite, owner.durable());
          } catch (e) {
            owner.dirty = true;
            throw e;
          }
        }
        for (const c of owner.checkpoints()) {
          await careerRepository.save(c.profileId, c.sessionId, c.stats);
          owner.acknowledge(c.sessionId, c.stats.revision ?? 0);
        }
      });
    saving.set(invite, task);
    try {
      await task;
    } finally {
      if (saving.get(invite) === task) saving.delete(invite);
    }
  }
  function configure(owner: RoomOwner) {
    owner.careerCommand = (id, c) => {
      void (async () => {
        await persist(owner.state.invite, owner);
        const profile =
          c.action === 'claim'
            ? await careerRepository.claim(id, c.target ?? '')
            : c.action === 'equip'
              ? await careerRepository.equip(id, c.target ?? '')
              : await careerRepository.profile(id);
        owner.sendCareer(id, profile);
      })().catch(() => {});
    };
    return owner;
  }
  async function load(invite: string): Promise<RoomOwner | null> {
    const existing = owners.get(invite);
    if (existing) return existing.expired ? null : existing;
    if (loads.has(invite)) return loads.get(invite)!;
    const task = (async () => {
      const durable = await careerRepository.readRoom(invite);
      if (!durable) return null;
      if (durable.state.emptyExpiresAt && durable.state.emptyExpiresAt <= Date.now() && !durable.checkpoints.length)
        return null;
      const owner = configure(new RoomOwner(invite, { persisted: durable }));
      owners.set(invite, owner);
      return owner;
    })();
    loads.set(invite, task);
    try {
      return await task;
    } finally {
      loads.delete(invite);
    }
  }
  app.get('/api/rooms/capabilities', (req, res) => {
    void capabilities(apiOrigin(req))
      .then((c) => res.json(c))
      .catch(() => res.json({ available: false, modes: [] }));
  });
  app.post('/api/room-checkpoint', (req, res) => {
    const secret = process.env.ROOM_CHECKPOINT_SECRET ?? '',
      provided = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (
      secret.length < 32 ||
      provided.length !== secret.length ||
      !timingSafeEqual(Buffer.from(provided), Buffer.from(secret))
    ) {
      res.status(401).json({ error: 'Unauthorized owner' });
      return;
    }
    if (!options.ready()) {
      res.status(503).json({ error: 'Career storage unavailable' });
      return;
    }
    const c = parseRoomCheckpoint(req.body);
    if (!c) {
      res.status(400).json({ error: 'Invalid career contribution' });
      return;
    }
    void careerRepository
      .save(c.profileId, c.sessionId, c.stats)
      .then((p) => res.json(publicCareer(p)))
      .catch(() => res.status(503).json({ error: 'Checkpoint retry required' }));
  });
  app.post('/api/room-career', async (req, res) => {
    const secret = process.env.ROOM_CHECKPOINT_SECRET ?? '',
      provided = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (
      secret.length < 32 ||
      provided.length !== secret.length ||
      !timingSafeEqual(Buffer.from(provided), Buffer.from(secret))
    ) {
      res.status(401).end();
      return;
    }
    if (
      !/^[a-f0-9-]{36}$/.test(req.body.profileId) ||
      !['profile', 'claim', 'equip'].includes(req.body.action) ||
      (req.body.target !== undefined && typeof req.body.target !== 'string')
    ) {
      res.status(400).end();
      return;
    }
    try {
      const p =
        req.body.action === 'claim'
          ? await careerRepository.claim(req.body.profileId, req.body.target ?? '')
          : req.body.action === 'equip'
            ? await careerRepository.equip(req.body.profileId, req.body.target ?? '')
            : await careerRepository.profile(req.body.profileId);
      res.json(publicCareer(p));
    } catch {
      res.status(400).json({ error: 'Action unavailable' });
    }
  });
  app.get('/api/room-checkpoint', (req, res) => {
    const secret = process.env.ROOM_CHECKPOINT_SECRET ?? '',
      provided = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const valid =
      secret.length >= 32 &&
      provided.length === secret.length &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
    res.status(valid && options.ready() ? 200 : 503).json({ healthy: valid && options.ready() });
  });
  app.post('/api/rooms', async (req, res) => {
    if (!local || !options.ready()) {
      res.status(503).json({ error: 'Room service unavailable' });
      return;
    }
    const id = verifyGuest(req.body.guest, options.secret());
    if (!id) {
      res.status(401).json({ error: 'Invalid guest' });
      return;
    }
    for (const [key, owner] of owners) if (owner.expired) owners.delete(key);
    if (owners.size >= maximum) {
      res.status(503).json({ error: 'Room owner capacity reached' });
      return;
    }
    const invite = randomBytes(24).toString('hex'),
      owner = configure(new RoomOwner(invite));
    owners.set(invite, owner);
    try {
      await careerRepository.writeRoom(invite, owner.durable());
      res.json({ invite, apiUrl: apiOrigin(req), identityUrl: apiOrigin(req) });
    } catch {
      owners.delete(invite);
      res.status(503).json({ error: 'Room creation failed' });
    }
  });
  app.post('/api/rooms/:invite/join', async (req, res) => {
    if (!local || !options.ready() || !/^[a-f0-9]{48}$/.test(req.params.invite)) {
      res.status(404).json({ error: 'Room unavailable' });
      return;
    }
    const id = verifyGuest(req.body.guest, options.secret());
    if (!id) {
      res.status(401).json({ error: 'Invalid guest' });
      return;
    }
    const owner = await load(req.params.invite);
    if (!owner) {
      res.status(404).json({ error: 'Room expired' });
      return;
    }
    const target = new URL(`${apiOrigin(req)}/private/${req.params.invite}/ws`);
    target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
    target.searchParams.set('guest', req.body.guest);
    res.json({ serverUrl: target.toString(), invite: req.params.invite, state: owner.view() });
  });
  app.get('/api/rooms/:invite', async (req, res) => {
    if (!local || !/^[a-f0-9]{48}$/.test(req.params.invite)) {
      res.status(404).json({ error: 'Room unavailable' });
      return;
    }
    const owner = await load(req.params.invite);
    if (!owner) {
      res.status(404).json({ error: 'Room expired' });
      return;
    }
    res.json({ state: owner.view(), apiUrl: apiOrigin(req), identityUrl: apiOrigin(req) });
  });
  // These fixtures never run in production; they exercise adapter recovery and round timing locally.
  app.post('/api/rooms/:invite/test', async (req, res) => {
    if (options.production || process.env.ALLOW_ROOM_TESTS !== 'true' || !local) {
      res.status(404).end();
      return;
    }
    const owner = await load(req.params.invite);
    if (!owner) {
      res.status(404).end();
      return;
    }
    if (req.body.action === 'restart') {
      owner.dirty = true;
      await persist(req.params.invite, owner);
      const durable = await careerRepository.readRoom(req.params.invite);
      for (const socket of wss.clients)
        if ((socket as any).roomInvite === req.params.invite) socket.close(1012, 'Owner restarted');
      owners.set(req.params.invite, configure(new RoomOwner(req.params.invite, { persisted: durable! })));
    } else if (req.body.action === 'finish') {
      (owner as any).endsAt = 0;
      owner.tick();
      await persist(req.params.invite, owner);
    } else if (req.body.action === 'checkpoint') {
      owner.dirty = true;
      await persist(req.params.invite, owner);
    } else if (req.body.action === 'job') {
      const id = `pass-${[0, 6, 9].includes(Number(req.body.kind)) ? Number(req.body.kind) : 0}`;
      const passenger = {
        id,
        x: 2050,
        y: 2280,
        destX: 2050,
        destY: 2380,
        reward: 10000,
        tier: 0,
        deadline: 0,
        spawnedAt: owner.world.getTick(),
        isCarried: false,
      };
      owner.world.getPassengerMap().set(id, passenger);
      owner.world.getSpatialGrid().insert(id, passenger.x, passenger.y);
      const playerId = `room-${req.body.profileId}`,
        player = owner.world.getPlayer(playerId);
      if (player) {
        const name = player.username;
        owner.world.removePlayer(playerId);
        owner.world.addPlayer(playerId, name);
        const fresh = owner.world.getPlayer(playerId)!;
        fresh.x = 2050;
        fresh.y = 2200;
        owner.world.selectPickup(playerId, id);
      }
    } else if (req.body.action === 'position') {
      const p = owner.world.getPlayer(`room-${req.body.profileId}`);
      if (p && Number.isFinite(req.body.x) && Number.isFinite(req.body.y)) {
        p.x = req.body.x;
        p.y = req.body.y;
      }
    }
    res.json({ ok: true, state: owners.get(req.params.invite)!.view() });
  });
  const loop = setInterval(() => {
    for (const [invite, owner] of owners) {
      owner.tick();
      if (owner.expired) {
        if (owner.checkpoints().length) {
          if (!saving.has(invite)) void persist(invite, owner).catch(() => {});
        } else owners.delete(invite);
        continue;
      }
      if (owner.dirty && !saving.has(invite))
        void persist(invite, owner).catch((e) => console.error('[Private room] checkpoint retry pending', e));
    }
  }, 50);
  const flush = setInterval(() => {
    for (const [invite, owner] of owners) if (!saving.has(invite)) void persist(invite, owner).catch(() => {});
  }, 30000);
  async function upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    const url = new URL(request.url ?? '/', 'http://localhost'),
      match = url.pathname.match(new RegExp(`^${prefix}/private/([a-f0-9]{48})/ws$`));
    if (
      !match ||
      !local ||
      !options.ready() ||
      (options.production && request.headers.origin && !options.allowedOrigins.includes(request.headers.origin))
    ) {
      socket.destroy();
      return;
    }
    const id = verifyGuest(url.searchParams.get('guest'), options.secret());
    if (!id) {
      socket.destroy();
      return;
    }
    const owner = await load(match[1]);
    if (!owner) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const transport: RoomTransport = {
        send: (data) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(data);
        },
        close: (code, reason) => ws.close(code, reason),
        get bufferedAmount() {
          return ws.bufferedAmount;
        },
      };
      try {
        owner.connect(id, transport);
      } catch (e) {
        ws.close(1008, (e as Error).message);
        return;
      }
      (ws as any).roomInvite = match[1];
      const timer = setTimeout(() => {
        if (!(ws as any).roomJoined) owner.leave(id);
      }, 10000);
      ws.on('message', (data, isBinary) => {
        const payload = isBinary ? new Uint8Array(data as Buffer).slice().buffer : data.toString();
        owner.receive(id, transport, payload);
        if (isBinary && new Uint8Array(payload as ArrayBuffer)[0] === 1) {
          (ws as any).roomJoined = true;
          clearTimeout(timer);
        }
        if (owner.dirty) void persist(match[1], owner).catch(() => {});
      });
      ws.on('close', () => {
        clearTimeout(timer);
        owner.disconnect(id, transport);
        void persist(match[1], owner).catch(() => {});
      });
      ws.on('error', () => {});
      void careerRepository
        .profile(id)
        .then((p) => owner.sendCareer(id, p))
        .catch(() => {});
    });
  }
  return {
    upgrade,
    close: async () => {
      clearInterval(loop);
      clearInterval(flush);
      for (const [invite, owner] of owners) {
        owner.dirty = true;
        await persist(invite, owner);
      }
      for (const socket of wss.clients) socket.close(1001, 'Owner shutting down');
    },
  };
}
