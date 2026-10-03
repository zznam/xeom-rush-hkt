import { careerRepository } from './career-store';
import { publicCareer } from '@xeom-rush/shared';
import express from 'express';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import dotenv from 'dotenv';
import { Admission, isSessionId, issueGuest, verifyGuest, validRoomKey } from './admission';
import {
  parseGameCommand,
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
let identitySecret = guestSecret;
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
app.use(express.json({ limit: '1kb' }));
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
const world = new GameWorld({ enhanced: process.env.CONTENT_RELEASE !== 'false' });
const botManager = new BotManager(world, world.getPhysics());

// HTTP JSON Endpoints for Judges/Dashboard
app.get('/api/health', (_req, res) => {
  const database = storageReady ? 'connected' : 'unavailable';
  const healthy = !production || database === 'connected';
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
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

app.post('/api/guest', (_req, res) => {
  res.json({ guest: issueGuest(identitySecret) });
});
app.get('/api/profile', async (req, res) => {
  const id = verifyGuest(req.headers.authorization?.replace(/^Bearer /, ''), identitySecret);
  if (!id) {
    res.status(401).json({ error: 'Invalid guest' });
    return;
  }
  try {
    res.json(publicCareer(await careerRepository.profile(id)));
  } catch {
    res.status(503).json({ error: 'Profile unavailable' });
  }
});
app.get('/api/careers', async (_req, res) => {
  try {
    res.json((await careerRepository.leaders()).map(publicCareer));
  } catch {
    res.status(503).json({ error: 'Ranking unavailable' });
  }
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
  metadataPhase: number;
  lastTripKey: string;
  lastLifeKey: string;
}

const activeSockets = new Map<string, PlayerSocket>();
interface ResumableSession {
  profileId?: string;
  playerId: string;
  saveId: string;
  username: string;
  expires: number;
}
const sessions = new Map<string, ResumableSession>();
const admission = new Admission(capacity, () => sessions.size);
const ready = () => !stopping && (!production || storageReady) && Date.now() - lastTickTime < 1000;
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
    available: ready() ? admission.available : 0,
    capacity,
  });
});
app.post('/api/reservations', (req, res) => {
  if (!validRoomKey(req.headers['x-matchmaker-key'], guestSecret)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  if (!regional || !ready()) {
    res.status(503).json({ error: 'Room unavailable' });
    return;
  }
  const profileId = verifyGuest(req.body?.guest, guestSecret);
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
  if (stats) {
    try {
      await saveSession(session.saveId, { ...stats, ...(session.profileId ? { profileId: session.profileId } : {}) });
    } catch (error) {
      console.error('[Storage] Session save failed', error);
    }
  }
}
const FULL_SNAPSHOT_INTERVAL_TICKS = 40;

server.on('upgrade', (request, socket, head) => {
  if (
    !ready() ||
    wss.clients.size >= capacity + 16 ||
    (production && request.headers.origin && !allowedOrigins.includes(request.headers.origin))
  ) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
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
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws: WebSocket, request) => {
  const connectionUrl = new URL(request.url || '/', 'http://localhost');
  const requestedToken = connectionUrl.searchParams.get('session');
  const requestedTicket = connectionUrl.searchParams.get('ticket') || '';
  const token = requestedToken && /^[a-f0-9-]{36}$/.test(requestedToken) ? requestedToken : randomUUID();
  let playerId = `player-${randomUUID()}`;
  let joined = false;
  const commandIds = new Set<string>();
  let commandCount = 0;
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
      commandCount = 0;
      windowStarted = Date.now();
    }
    if (++received > 150) {
      ws.close(1008, 'Too many messages');
      return;
    }
    if (!isBinary) {
      const text = message.toString();
      if (joined && text.startsWith('control:')) {
        const command = parseGameCommand(text.slice(8));
        if (!command || ++commandCount > 10) {
          ws.close(1008, 'Invalid game command');
          return;
        }
        if (commandIds.has(command.id)) return;
        commandIds.add(command.id);
        if (commandIds.size > 128) commandIds.delete(commandIds.values().next().value!);
        if (command.action === 'select-pickup') world.selectPickup(playerId, command.target);
        if (['profile', 'claim', 'equip'].includes(command.action)) {
          const session = sessions.get(token);
          if (session?.profileId)
            void (async () => {
              const stats = world.getSessionStatsForPlayer(playerId);
              if (stats) await saveSession(session.saveId, { ...stats, profileId: session.profileId });
              const p =
                command.action === 'claim'
                  ? await careerRepository.claim(session.profileId!, command.target ?? '')
                  : command.action === 'equip'
                    ? await careerRepository.equip(session.profileId!, command.target ?? '')
                    : await careerRepository.profile(session.profileId!);
              world.setAppearance(playerId, p.equipped);
              if (ws.readyState === WebSocket.OPEN)
                ws.send(`control:${JSON.stringify({ version: 1, kind: 'career', data: publicCareer(p) })}`);
            })().catch(() => {
              if (ws.readyState === WebSocket.OPEN)
                ws.send(
                  `control:${JSON.stringify({ version: 1, kind: 'notice', data: 'Chưa thể nhận quà. Kiểm tra tiến độ và thử lại nhé.' })}`,
                );
            });
        }
        return;
      }
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
          const requestedGuest = connectionUrl.searchParams.get('guest');
          const profileId = regional
            ? admission.consume(token, requestedTicket)
            : requestedGuest
              ? verifyGuest(requestedGuest, identitySecret)
              : undefined;
          if (requestedGuest && !profileId) {
            ws.close(1008, 'Invalid guest credential');
            return;
          }
          if (regional && !profileId) {
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
          metadataPhase: activeSockets.size % 20,
          lastTripKey: '',
          lastLifeKey: '',
        });
        joined = true;

        console.log(`[Player Join] ${username} (${playerId}) connected.`);

        // Send configuration back to player
        const configBuffer = encodeConfig(playerId, MAP_SIZE, CHUNK_SIZE);
        ws.send(configBuffer);
        ws.send(
          `control:${JSON.stringify({ version: 1, kind: 'capabilities', data: { careers: true, cityRanking: true, trips: true, progression: true } })}`,
        );
        const profileId = sessions.get(token)?.profileId;
        if (profileId)
          void careerRepository
            .profile(profileId)
            .then((p) => {
              world.setAppearance(playerId, p.equipped);
              if (ws.readyState === WebSocket.OPEN)
                ws.send(`control:${JSON.stringify({ version: 1, kind: 'career', data: publicCareer(p) })}`);
            })
            .catch(() => {});
      } else if (msgType === EMessageType.LEAVE) {
        if (joined) {
          joined = false;
          void finalizeSession(token);
          ws.close(1000, 'Ride ended');
        }
      } else if (msgType === EMessageType.INPUT) {
        if (!joined) return;
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
let maxTickLagMs = 0;

const gameLoop = setInterval(() => {
  const workStarted = performance.now();
  const now = Date.now();
  maxTickLagMs = Math.max(maxTickLagMs, now - lastTickTime - TICK_INTERVAL_MS);
  const actualDt = (now - lastTickTime) / 1000;
  lastTickTime = now;
  for (const [token, session] of sessions) if (session.expires <= now) void finalizeSession(token);

  // 1. Run bot AI (generates inputs for bot players)
  botManager.tick();

  // 2. Tick the world simulation
  world.tick(Math.min(Math.max(actualDt, 0), 0.1));

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

      playerSocket.ws.send(snapshotBuffer);
      const deliveries = world.getSessionStatsForPlayer(playerId)?.deliveriesCount ?? 0;
      if (shouldSendFull || world.getTick() % 20 === 0 || deliveries !== playerSocket.lastDeliveries) {
        playerSocket.ws.send(
          `city:${JSON.stringify({ tick: world.getTick(), rushHourTicksRemaining: world.getRushHourTicksRemaining(), deliveries })}`,
        );
      }
      const rider = world.getPlayer(playerId);
      const trip = rider?.passengerId ? world.getPassengerMap().get(rider.passengerId) : undefined;
      const tripKey = trip ? `${trip.id}:${trip.destX}:${trip.destY}` : '';
      const life = world.getCityLife();
      const lifeKey = `${life.phase}:${life.rain}:${life.event?.id}:${life.closure?.id}:${life.closure?.active}:${life.roadRevision}`;
      if (
        world.getTick() % 20 === playerSocket.metadataPhase ||
        shouldSendFull ||
        tripKey !== playerSocket.lastTripKey ||
        lifeKey !== playerSocket.lastLifeKey
      ) {
        playerSocket.ws.send(
          `control:${JSON.stringify({ version: 1, kind: 'gameplay', data: world.getGameplayState(playerId) })}`,
        );
        playerSocket.ws.send(
          `control:${JSON.stringify({ version: 1, kind: 'appearance', data: world.getAppearances() })}`,
        );
        playerSocket.lastTripKey = tripKey;
        playerSocket.lastLifeKey = lifeKey;
      }
      playerSocket.lastDeliveries = deliveries;
      playerSocket.lastSnapshot = snapshot;
      if (shouldSendFull) {
        playerSocket.lastFullSnapshotTick = world.getTick();
      }
    }
  }
  maxTickMs = Math.max(maxTickMs, performance.now() - workStarted);
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
const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://localhost:27018/xeom_rush?directConnection=true&replicaSet=rs0';

const startServer = () => {
  const bots = Number(process.env.BOT_COUNT ?? 8);
  botManager.spawnBots(Number.isFinite(bots) ? Math.max(0, Math.min(20, Math.floor(bots))) : 8);
  server.listen(PORT, () => {
    console.log(`🚀 Authoritative Server running on port ${PORT}`);
    console.log(`Tick rate: 20Hz (Interval: ${TICK_INTERVAL_MS}ms)`);
    console.log(`Map Dimensions: ${MAP_SIZE}x${MAP_SIZE} units`);
  });
};

connectStorage(MONGODB_URI)
  .then(async () => {
    identitySecret = regional ? guestSecret : await careerRepository.secret();
    storageReady = true;
    startServer();
  })
  .catch((err) => {
    console.warn('⚠️ [Startup] Storage connection failed.', err);
    if (production) {
      clearInterval(gameLoop);
      clearInterval(healthLoop);
      process.exitCode = 1;
      return;
    }
    identitySecret ||= randomUUID() + randomUUID();
    console.warn('⚠️ [Startup] Server starting in MEMORY-ONLY mode. Career stats will not be persistent.');
    storageReady = true;
    startServer();
  });

// Low-frequency checkpoints protect career progress during serverless eviction.
// KV records each session's previous contribution, so retries never double-count.
let checkpointPending: Promise<void> | null = null;
const checkpointLoop = setInterval(() => {
  if (checkpointPending) return;
  checkpointPending = Promise.all(
    [...sessions.values()].map(async (session) => {
      const stats = world.getSessionStatsForPlayer(session.playerId);
      if (stats && (session.profileId || isKvStorage()))
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

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
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
  server.close(() => process.exit(0));
}
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
