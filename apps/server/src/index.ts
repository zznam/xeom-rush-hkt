import express from 'express';
import { CityRuntime } from './admin/runtime';
import { ControlTransport, ControlWorker, workerOptions } from './admin/worker';
import { createHubFromEnv } from './admin/router';
import { issueIdentity, verifyIdentity } from './identity';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import dotenv from 'dotenv';
import { Admission, isSessionId, verifyGuest, validRoomKey } from './admission';
import {
  EMessageType,
  resolveDeploymentTarget,
  TICK_INTERVAL_MS,
  MAP_SIZE,
  CHUNK_SIZE,
  decodeInput,
  decodeJoin,
  encodeDeltaSnapshot,
  encodeConfig,
  encodeSnapshot,
  type WorldSnapshot,
} from '@xeom-rush/shared';
import { GameWorld } from './world';
import { BotManager } from './bot-ai';
import { connectStorage, storageHealth, saveSession, getLeaderboard, closeStorage, isKvStorage } from './storage';

dotenv.config();

// --- Express App Setup ---
const app = express();
const production = process.env.NODE_ENV === 'production' || !!process.env.DENO_DEPLOY;
const deploymentTarget = resolveDeploymentTarget(process.env.DEPLOY_TARGET);
const regional = deploymentTarget === 'regional-production';
const region = regional ? process.env.GAME_REGION || '' : 'local';
const roomId = regional ? process.env.ROOM_ID || '' : 'local';
if (regional && !/^[a-z0-9-]{1,32}$/.test(region)) throw new Error('Regional rooms require GAME_REGION');
const guestSecret = process.env.GUEST_SECRET || '';
if (production && regional && !process.env.DYNAMODB_TABLE)
  throw new Error('Production regional rooms require DYNAMODB_TABLE');
const capacity = Number(process.env.ROOM_CAPACITY || 64);
if (!Number.isInteger(capacity) || capacity < 2 || capacity > 200) throw new Error('ROOM_CAPACITY must be 2-200');
if (regional && (guestSecret.length < 32 || !/^[a-z0-9-]{1,24}$/.test(roomId)))
  throw new Error('Regional rooms need a valid ROOM_ID and GUEST_SECRET');
let stopping = false;
let storageReady = false;
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://xeom-rush.vercel.app').split(',').map((s) => s.trim());
app.use(cors({ origin: (origin, cb) => cb(null, !origin || !production || allowedOrigins.includes(origin)) }));
app.disable('x-powered-by');
const smallJson = express.json({ limit: '1kb' });
app.use((req, res, next) =>
  req.path.startsWith('/api/admin') || req.path.startsWith('/api/internal') ? next() : smallJson(req, res, next),
);
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  const prefix = `/rooms/${roomId}`;
  if (req.url.startsWith(`${prefix}/`)) req.url = req.url.slice(prefix.length);
  next();
});
// Demo controls are local-only; no administrator secret is shipped to browsers.
app.use(['/api/spawn-bots', '/api/rush-hour', '/api/bot-logs'], (_req, res, next) => {
  if (production) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  next();
});

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });

// Instantiate authoritative world state
let world = new GameWorld();
let botManager = new BotManager(world, world.getPhysics());

// HTTP JSON Endpoints for Judges/Dashboard
app.get('/api/health', (_req, res) => {
  const database = storageReady ? 'connected' : 'unavailable';
  const healthy = !production || database === 'connected';
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    tickDurationMs: maxTickMs,
    averageTickMs: tickSamples ? totalTickMs / tickSamples : 0,
    tickLagMs: maxTickLagMs,
    deploymentTarget,
    timestamp: new Date().toISOString(),
    players: world.getPlayerCount(),
    bots: botManager.getBotCount(),
    database,
    version: process.env.RELEASE_SHA || process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || 'local',
    region,
    room: roomId,
  });
});

app.get('/api/chunks', (req, res) => {
  res.json({
    occupancy: world.getSpatialGrid().getChunkOccupancy(),
  });
});

app.get('/api/obstacles', (req, res) => {
  res.json({
    buildings: world.getPhysics().getBuildings(),
  });
});

app.get('/api/city-features', (req, res) => {
  const city = world.getCityFeatures();
  res.json({
    roundabouts: city.roundabouts,
    crosswalks: city.crosswalks,
    trafficLights: city.getTrafficLights(),
    pedestrians: city.getPedestrians(),
  });
});

app.post('/api/rush-hour', (_req, res) => {
  world.triggerRushHour();
  console.log(`[Rush Hour] Manually triggered. Active for next 60s.`);
  res.json({
    rushHour: true,
    endsInTicks: world.getRushHourTicksRemaining(),
  });
});

app.post('/api/spawn-bots', (req, res) => {
  const count = Number(req.body?.count ?? 25);
  if (!Number.isInteger(count) || count < 1 || count > 25 || botManager.getBotCount() + count > 50) {
    res.status(400).json({ error: 'Choose 1-25 bots; city maximum is 50.' });
    return;
  }
  const spawnedIds = botManager.spawnBots(count);
  console.log(`[Bot Spawn] Spawned ${spawnedIds.length} AI bots (total: ${botManager.getBotCount()})`);
  res.json({
    spawned: spawnedIds.length,
    totalBots: botManager.getBotCount(),
  });
});

app.get('/api/bot-logs', (_req, res) => {
  res.json({
    logs: botManager.getLogs(),
    stats: botManager.getStats(),
  });
});

app.get('/api/leaderboard', async (_req, res) => {
  try {
    res.json(await getLeaderboard());
  } catch {
    res.status(503).json({ error: 'Saved scores are temporarily unavailable' });
  }
});

// --- WebSocket Connection Management ---
interface PlayerSocket {
  ws: WebSocket;
  playerId: string;
  username: string;
  lastSnapshot: WorldSnapshot | null;
  lastFullSnapshotTick: number;
  lastDeliveries: number;
  lastCityReport: number;
  lastCityRevision: number;
}

const activeSockets = new Map<string, PlayerSocket>();
interface ResumableSession {
  guestId?: string;
  sandbox?: boolean;
  profileId?: string;
  playerId: string;
  saveId: string;
  username: string;
  expires: number;
}
const sessions = new Map<string, ResumableSession>();
const invalidatedSessions = new Map<string, number>();
const management = workerOptions();
const transport = management ? new ControlTransport(management) : null;
let hub: Awaited<ReturnType<typeof createHubFromEnv>> = null;
async function kickPlayer(playerId: string, reason: string): Promise<void> {
  const entry = [...sessions.entries()].find(([, session]) => session.playerId === playerId);
  if (!entry) throw new Error('Player has already left');
  invalidatedSessions.set(entry[0], Date.now() + 120000);
  const socket = activeSockets.get(playerId)?.ws;
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(`notice:${JSON.stringify({ message: reason })}`);
    socket.close(1008, 'Removed by moderator');
  }
  await finalizeSession(entry[0]);
}
const runtime = new CityRuntime({
  world: () => world,
  bots: () => botManager,
  reset(config) {
    world = new GameWorld(config.rules);
    botManager = new BotManager(world, world.getPhysics());
    botManager.configure(config.bots);
  },
  async endRides() {
    if (checkpointPending) await checkpointPending;
    const entries = [...sessions.entries()];
    const writes = await Promise.allSettled(
      entries.map(async ([, session]) => {
        const stats = world.getSessionStatsForPlayer(session.playerId);
        if (stats && !session.sandbox) await saveSession(session.saveId, { ...stats, profileId: session.profileId });
      }),
    );
    if (writes.some((write) => write.status === 'rejected'))
      throw new Error('Không lưu được tiến trình; giữ nguyên lượt chơi hiện tại.');
    for (const [token, session] of entries) {
      const socket = activeSockets.get(session.playerId)?.ws;
      const stats = world.getSessionStatsForPlayer(session.playerId);
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(`result:${JSON.stringify({ ...stats, mode: session.sandbox ? 'sandbox' : 'career' })}`);
        socket.close(1000, 'City starting a new ride');
      }
      sessions.delete(token);
      activeSockets.delete(session.playerId);
      world.removePlayer(session.playerId);
    }
  },
  kick: kickPlayer,
});
const worker = transport
  ? new ControlWorker(
      transport,
      runtime,
      (observe) => ({
        revision: runtime.revision,
        config: runtime.config,
        tick: world.getTick(),
        tickMs: maxTickMs,
        humans: sessions.size,
        bots: botManager.populationStatus(),
        paused: runtime.frozen,
        admissionsOpen: runtime.admissionsOpen,
        lastSeen: Date.now(),
        players: world.getPlayers().map((p) => {
          const session = [...sessions.values()].find((entry) => entry.playerId === p.id);
          return {
            id: p.id,
            guestId: session?.guestId,
            username: p.username,
            x: Math.round(p.x),
            y: Math.round(p.y),
            score: p.score,
            deliveries: world.getSessionStatsForPlayer(p.id)?.deliveriesCount ?? 0,
            connected: p.connected,
            bot: p.id.startsWith('bot-'),
          };
        }),
        ...(observe
          ? {
              map: {
                passengers: [...world.getPassengerMap().values()]
                  .filter((p) => !p.isCarried)
                  .map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), tier: p.tier })),
              },
            }
          : {}),
      }),
      async (bans) => {
        const blocked = new Map(bans.map((ban) => [ban.guestId, ban.reason]));
        for (const session of sessions.values())
          if (session.guestId && blocked.has(session.guestId))
            await kickPlayer(session.playerId, blocked.get(session.guestId)!);
      },
    )
  : null;
app.get('/api/capabilities', (_req, res) => res.json({ managed: !!management, deployment: management?.deployment }));
app.post('/api/guest', (_req, res) => {
  if (!management) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json({
    guest: issueIdentity(management.deployment, process.env.GUEST_IDENTITY_SECRET!),
    deployment: management.deployment,
  });
});

const admission = new Admission(capacity, () => sessions.size);
const ready = () =>
  !stopping && (!production || storageReady) && (!worker || worker.initialized) && Date.now() - lastTickTime < 1000;
const admitting = () => ready() && (!worker || (worker.healthy && runtime.admissionsOpen));
const canReconnect = (session?: ResumableSession) =>
  ready() && !!session && session.expires > Date.now() && !runtime.countdownEndsAt && !!worker?.healthy;
app.get('/api/live', (_req, res) => {
  res.json({ status: 'ok' });
});
app.get('/api/ready', (_req, res) => {
  res.status(ready() ? 200 : 503).json({ ready: ready(), region, room: roomId });
});
app.get('/api/room', (_req, res) => {
  res.status(ready() ? 200 : 503).json({
    region,
    room: roomId,
    players: world.getPlayerCount(),
    available: admitting() ? admission.available : 0,
    capacity,
  });
});
app.post('/api/reservations', (req, res) => {
  if (!validRoomKey(req.headers['x-matchmaker-key'], guestSecret)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  if (!regional || !admitting()) {
    res.status(503).json({ error: 'Room unavailable' });
    return;
  }
  const profileId = management
    ? verifyIdentity(req.body?.guest, management.deployment, process.env.GUEST_IDENTITY_SECRET!)
    : verifyGuest(req.body?.guest, guestSecret);
  if (!profileId || !isSessionId(req.body?.session)) {
    res.status(400).json({ error: 'Invalid guest or session' });
    return;
  }
  if (sessions.has(req.body.session)) {
    res.status(409).json({ error: 'Session already joined' });
    return;
  }
  const reservation = admission.reserve(req.body.session, profileId);
  res
    .status(reservation ? 200 : 409)
    .json(reservation ? { ticket: reservation.ticket, expires: reservation.expires } : { error: 'Room full' });
});
const finalWrites = new Set<Promise<void>>();
function finalizeSession(token: string): Promise<void> {
  const write = finishSession(token);
  finalWrites.add(write);
  void write.finally(() => finalWrites.delete(write));
  return write;
}
async function finishSession(token: string): Promise<void> {
  const session = sessions.get(token);
  if (!session) return;
  sessions.delete(token);
  const stats = world.getSessionStatsForPlayer(session.playerId);
  world.removePlayer(session.playerId);
  activeSockets.delete(session.playerId);
  if (stats && !session.sandbox) {
    try {
      await saveSession(session.saveId, { ...stats, ...(session.profileId ? { profileId: session.profileId } : {}) });
    } catch (error) {
      console.error('[Storage] Session save failed', error);
    }
  }
}
const FULL_SNAPSHOT_INTERVAL_TICKS = 40;

server.on('upgrade', async (request, socket, head) => {
  if (
    !ready() ||
    wss.clients.size >= capacity + 16 ||
    (production && request.headers.origin && !allowedOrigins.includes(request.headers.origin))
  ) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  const requestedSession = new URL(request.url || '/', 'http://localhost').searchParams.get('session') || '';
  for (const [token, expires] of invalidatedSessions) if (expires <= Date.now()) invalidatedSessions.delete(token);
  if (invalidatedSessions.has(requestedSession)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  let managedGuest: { guestId: string; profileId: string } | undefined;
  if (management && transport) {
    const url = new URL(request.url || '/', 'http://localhost');
    const guestId = verifyIdentity(
      url.searchParams.get('guest'),
      management.deployment,
      process.env.GUEST_IDENTITY_SECRET!,
    );
    const previous = sessions.get(url.searchParams.get('session') || '');
    if (
      !guestId ||
      url.searchParams.get('managed') !== '1' ||
      (previous && previous.guestId !== guestId) ||
      (!admitting() && !canReconnect(previous))
    ) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    try {
      const admission = await transport.admit(guestId);
      if (admission.banned || (!admitting() && !canReconnect(previous))) throw new Error('Admission unavailable');
      managedGuest = { guestId, profileId: admission.profileId };
    } catch {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
  }
  if (regional) {
    const url = new URL(request.url || '/', 'http://localhost');
    const token = url.searchParams.get('session') || '';
    const previous = sessions.get(token);
    const resume = previous && previous.expires > Date.now();
    if (
      url.pathname !== `/rooms/${roomId}` ||
      !isSessionId(token) ||
      (!resume && !admission.claim(token, url.searchParams.get('ticket') || ''))
    ) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request, managedGuest);
  });
});

wss.on('connection', (ws: WebSocket, request, managedGuest?: { guestId: string; profileId: string }) => {
  const connectionUrl = new URL(request.url || '/', 'http://localhost');
  const requestedToken = connectionUrl.searchParams.get('session');
  const requestedTicket = connectionUrl.searchParams.get('ticket') || '';
  const token = requestedToken && /^[a-f0-9-]{36}$/.test(requestedToken) ? requestedToken : randomUUID();
  let playerId = `player-${randomUUID()}`;
  let joined = false;
  let received = 0;
  let windowStarted = Date.now();
  let lastPong = Date.now();
  ws.on('pong', () => {
    lastPong = Date.now();
  });
  const heartbeat = setInterval(() => {
    if (Date.now() - lastPong > 10000) ws.terminate();
    else if (ws.readyState === WebSocket.OPEN) ws.ping();
  }, 5000);
  const joinTimeout = setTimeout(() => {
    if (!joined) ws.close(1008, 'Join timeout');
  }, 8000);

  ws.binaryType = 'arraybuffer';

  ws.on('message', (message: ArrayBuffer, isBinary: boolean) => {
    if (Date.now() - windowStarted >= 1000) {
      received = 0;
      windowStarted = Date.now();
    }
    if (++received > 150) {
      ws.close(1008, 'Too many messages');
      return;
    }
    if (!isBinary) {
      const text = message.toString();
      if (joined && /^ping:[0-9]{13}$/.test(text)) ws.send(`pong:${text.slice(5)}`);
      return;
    }
    try {
      const view = new DataView(message);
      const msgType = view.getUint8(0);

      if (msgType === EMessageType.JOIN) {
        if (joined) return;
        const username = decodeJoin(message).trim();
        if (
          !username ||
          [...username].length > 15 ||
          [...username].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
        ) {
          ws.close(1008, 'Invalid name');
          return;
        }
        const previous = sessions.get(token);
        if (invalidatedSessions.has(token) || (management && !admitting() && !canReconnect(previous))) {
          ws.close(1008, 'City is unavailable');
          return;
        }
        if (previous && activeSockets.has(previous.playerId)) {
          ws.close(1013, 'Previous connection is closing');
          return;
        }
        if (previous && previous.expires <= Date.now()) void finalizeSession(token);
        const resumable = sessions.get(token);
        if (resumable) {
          if (resumable.username !== username) {
            ws.close(1008, 'Session name mismatch');
            return;
          }
          playerId = resumable.playerId;
          resumable.expires = Infinity;
          world.setConnected(playerId, true);
        } else {
          if (sessions.size >= capacity) {
            ws.close(1013, 'City is full');
            return;
          }
          const admittedId = regional ? admission.consume(token, requestedTicket) : undefined;
          const profileId = managedGuest?.profileId ?? admittedId;
          if ((regional && !admittedId) || (managedGuest && regional && admittedId !== managedGuest.guestId)) {
            ws.close(1008, 'Reservation expired; find a new city');
            return;
          }
          world.addPlayer(playerId, username);
          sessions.set(token, {
            playerId,
            saveId: randomUUID(),
            username,
            expires: Infinity,
            ...(profileId ? { profileId } : {}),
            ...(managedGuest ? { guestId: managedGuest.guestId, sandbox: runtime.config.mode === 'sandbox' } : {}),
          });
        }
        clearTimeout(joinTimeout);

        // Register socket
        activeSockets.set(playerId, {
          ws,
          playerId,
          username,
          lastSnapshot: null,
          lastFullSnapshotTick: 0,
          lastDeliveries: -1,
          lastCityReport: 0,
          lastCityRevision: -1,
        });
        joined = true;

        console.log(`[Player Join] ${username} (${playerId}) connected.`);

        // Send configuration back to player
        const configBuffer = encodeConfig(playerId, MAP_SIZE, CHUNK_SIZE);
        ws.send(configBuffer);
      } else if (msgType === EMessageType.LEAVE) {
        if (joined) {
          joined = false;
          void finalizeSession(token);
          ws.close(1000, 'Ride ended');
        }
      } else if (msgType === EMessageType.INPUT) {
        if (!joined) return;
        if (management && runtime.frozen) return;
        if (message.byteLength !== 17) {
          ws.close(1008, 'Invalid input');
          return;
        }
        const input = decodeInput(message);
        if (![input.dx, input.dy, input.angle].every(Number.isFinite)) {
          ws.close(1008, 'Invalid input');
          return;
        }
        world.queueInput(playerId, input);
      }
    } catch (err) {
      ws.close(1008, 'Invalid packet');
    }
  });

  ws.on('close', () => {
    clearTimeout(joinTimeout);
    clearInterval(heartbeat);
    if (!joined && !sessions.has(token)) admission.release(token, requestedTicket);
    if (joined && activeSockets.get(playerId)?.ws === ws) {
      activeSockets.delete(playerId);
      world.setConnected(playerId, false);
      const session = sessions.get(token);
      if (session) session.expires = Date.now() + 30000;
    }
  });

  ws.on('error', (err) => {
    console.error(`[WS Error] for ${playerId}:`, err);
  });
});

// --- Authoritative Game Tick Loop (20 Hz) ---
const dt = TICK_INTERVAL_MS / 1000; // 0.05 seconds
let lastTickTime = Date.now();
let maxTickMs = 0;
let totalTickMs = 0;
let tickSamples = 0;
let maxTickLagMs = 0;

const gameLoop = setInterval(() => {
  const workStarted = performance.now();
  const now = Date.now();
  maxTickLagMs = Math.max(maxTickLagMs, now - lastTickTime - TICK_INTERVAL_MS);
  const actualDt = (now - lastTickTime) / 1000;
  lastTickTime = now;
  if (management) runtime.beforeTick();
  if (!runtime.frozen) for (const [token, session] of sessions) if (session.expires <= now) void finalizeSession(token);

  // 1. Run bot AI (generates inputs for bot players)
  if (!management || !runtime.frozen) {
    if (management) botManager.reconcilePopulation(sessions.size);
    botManager.tick();
  }

  // 2. Tick the world simulation
  if (!management || !runtime.frozen) world.tick(Math.min(Math.max(actualDt, 0), 0.1));

  // 3. Broadcast filtered snapshots to each player based on their chunk position
  for (const [playerId, playerSocket] of activeSockets.entries()) {
    if (playerSocket.ws.readyState === WebSocket.OPEN) {
      if (playerSocket.ws.bufferedAmount > 262144) {
        playerSocket.ws.close(1013, 'Slow connection');
        continue;
      }
      // Retrieve entities in player's 3x3 surrounding chunks
      const { players, passengers, trafficLights, pedestrians, rushHour, streaks } =
        world.getVisibleSnapshotForPlayer(playerId);
      const snapshot: WorldSnapshot = {
        tick: world.getTick(),
        players,
        passengers,
        trafficLights,
        pedestrians,
        rushHour,
        streaks,
      };

      const shouldSendFull =
        !playerSocket.lastSnapshot ||
        world.getTick() - playerSocket.lastFullSnapshotTick >= FULL_SNAPSHOT_INTERVAL_TICKS;

      const snapshotBuffer =
        shouldSendFull || !playerSocket.lastSnapshot
          ? encodeSnapshot(
              snapshot.tick,
              snapshot.players,
              snapshot.passengers,
              snapshot.trafficLights,
              snapshot.pedestrians,
              snapshot.rushHour,
              snapshot.streaks,
            )
          : encodeDeltaSnapshot(playerSocket.lastSnapshot, snapshot);

      const deliveries = world.getSessionStatsForPlayer(playerId)?.deliveriesCount ?? 0;
      if (
        shouldSendFull ||
        Date.now() - playerSocket.lastCityReport >= 1000 ||
        playerSocket.lastCityRevision !== runtime.revision ||
        deliveries !== playerSocket.lastDeliveries
      ) {
        playerSocket.ws.send(
          `city:${JSON.stringify({ tick: world.getTick(), rushHourTicksRemaining: world.getRushHourTicksRemaining(), deliveries, ...(management ? { revision: runtime.revision, effectiveTick: runtime.effectiveTick, speed: runtime.config.rules.speed, mode: runtime.config.mode, paused: runtime.frozen, announcement: runtime.announcement && runtime.announcement.expiresAt > Date.now() ? runtime.announcement.message : null, countdownSeconds: runtime.countdownEndsAt ? Math.max(0, Math.ceil((runtime.countdownEndsAt - Date.now()) / 1000)) : null } : {}) })}`,
        );
        playerSocket.lastCityReport = Date.now();
      }
      playerSocket.ws.send(snapshotBuffer);
      playerSocket.lastDeliveries = deliveries;
      playerSocket.lastCityRevision = runtime.revision;
      playerSocket.lastSnapshot = snapshot;
      if (shouldSendFull) {
        playerSocket.lastFullSnapshotTick = world.getTick();
      }
    }
  }
  const tickWorkMs = performance.now() - workStarted;
  maxTickMs = Math.max(maxTickMs, tickWorkMs);
  totalTickMs += tickWorkMs;
  tickSamples++;
  if (production && regional && world.getTick() % 100 === 0) {
    console.log(
      JSON.stringify({
        _aws: {
          Timestamp: Date.now(),
          CloudWatchMetrics: [
            {
              Namespace: 'XeomRush',
              Dimensions: [['Region', 'Room', 'Environment']],
              Metrics: [
                { Name: 'TickDurationMs', Unit: 'Milliseconds' },
                { Name: 'TickLagMs', Unit: 'Milliseconds' },
                { Name: 'OccupiedSeats', Unit: 'Count' },
              ],
            },
          ],
        },
        Region: region,
        Room: roomId,
        Environment: process.env.DEPLOY_ENVIRONMENT || 'production',
        TickDurationMs: maxTickMs,
        TickLagMs: maxTickLagMs,
        OccupiedSeats: capacity - admission.available,
      }),
    );
    maxTickMs = 0;
    maxTickLagMs = 0;
  }
}, TICK_INTERVAL_MS);

// Start only after the selected persistence service is ready.
const PORT = process.env.PORT || 3002;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27018/xeom_rush';

const startServer = async () => {
  hub = await createHubFromEnv();
  if (hub) app.use(hub.router);
  const bots = Number(process.env.BOT_COUNT ?? 8);
  if (!management) botManager.spawnBots(Number.isFinite(bots) ? Math.max(0, Math.min(20, Math.floor(bots))) : 8);
  server.listen(PORT, () => {
    console.log(`🚀 Authoritative Server running on port ${PORT}`);
    console.log(`Tick rate: 20Hz (Interval: ${TICK_INTERVAL_MS}ms)`);
    console.log(`Map Dimensions: ${MAP_SIZE}x${MAP_SIZE} units`);
    worker?.start();
  });
};

async function bootstrapServer() {
  try {
    await connectStorage(MONGODB_URI);
  } catch (error) {
    if (production) throw error;
    console.warn('⚠️ [Startup] Storage unavailable; local career stats will not persist.', error);
  }
  storageReady = true;
  await startServer();
}
void bootstrapServer().catch((error) => {
  console.error('[Startup] Server configuration or storage failed', error);
  void shutdown(1);
});

// Low-frequency checkpoints protect career progress during serverless eviction.
// KV records each session's previous contribution, so retries never double-count.
let checkpointPending: Promise<void> | null = null;
const checkpointLoop = setInterval(() => {
  if ((!isKvStorage() && !management) || checkpointPending || runtime.frozen) return;
  checkpointPending = Promise.all(
    [...sessions.values()].map(async (session) => {
      const stats = world.getSessionStatsForPlayer(session.playerId);
      if (stats && !session.sandbox)
        await saveSession(session.saveId, { ...stats, ...(session.profileId ? { profileId: session.profileId } : {}) });
    }),
  )
    .then(() => {})
    .catch((error) => console.error('[Storage] Checkpoint failed', error))
    .finally(() => {
      checkpointPending = null;
    });
}, 30000);
checkpointLoop.unref();

let checkingHealth = false;
const healthLoop = setInterval(async () => {
  if (checkingHealth || stopping) return;
  checkingHealth = true;
  try {
    await storageHealth();
    storageReady = true;
  } catch {
    storageReady = false;
  } finally {
    checkingHealth = false;
  }
}, 5000);
healthLoop.unref();

async function shutdown(exitCode = 0): Promise<void> {
  if (stopping) return;
  stopping = true;
  worker?.stop();
  hub?.close();
  clearInterval(gameLoop);
  clearInterval(checkpointLoop);
  clearInterval(healthLoop);
  const deadline = setTimeout(() => process.exit(1), 25000);
  deadline.unref();
  if (checkpointPending) await checkpointPending;
  for (const client of wss.clients) client.close(1001, 'Server restarting');
  await Promise.all([...sessions.keys()].map(finalizeSession));
  await Promise.all([...finalWrites]);
  for (const client of wss.clients) client.terminate();
  await closeStorage();
  server.close(() => process.exit(exitCode));
}
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
