import express from 'express';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import dotenv from 'dotenv';
import {
  EMessageType,
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
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://xeom-rush.vercel.app').split(',').map((s) => s.trim());
app.use(cors({ origin: (origin, cb) => cb(null, !origin || !production || allowedOrigins.includes(origin)) }));
app.use(express.json({ limit: '1kb' }));
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
const world = new GameWorld();
const botManager = new BotManager(world, world.getPhysics());

// HTTP JSON Endpoints for Judges/Dashboard
app.get('/api/health', async (_req, res) => {
  let database = 'connected';
  try {
    await storageHealth();
  } catch {
    database = 'unavailable';
  }
  const healthy = !production || database === 'connected';
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    players: world.getPlayerCount(),
    bots: botManager.getBotCount(),
    database,
    version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || 'local',
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
}

const activeSockets = new Map<string, PlayerSocket>();
interface ResumableSession {
  playerId: string;
  saveId: string;
  username: string;
  expires: number;
}
const sessions = new Map<string, ResumableSession>();
async function finalizeSession(token: string): Promise<void> {
  const session = sessions.get(token);
  if (!session) return;
  sessions.delete(token);
  const stats = world.getSessionStatsForPlayer(session.playerId);
  world.removePlayer(session.playerId);
  activeSockets.delete(session.playerId);
  if (stats) {
    try {
      await saveSession(session.saveId, stats);
    } catch (error) {
      console.error('[Storage] Session save failed', error);
    }
  }
}
const FULL_SNAPSHOT_INTERVAL_TICKS = 40;

server.on('upgrade', (request, socket, head) => {
  if (
    wss.clients.size >= 200 ||
    (production && request.headers.origin && !allowedOrigins.includes(request.headers.origin))
  ) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws: WebSocket, request) => {
  const requestedToken = new URL(request.url || '/', 'http://localhost').searchParams.get('session');
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
          if (sessions.size >= 300) {
            ws.close(1013, 'City is full');
            return;
          }
          world.addPlayer(playerId, username);
          sessions.set(token, { playerId, saveId: randomUUID(), username, expires: Infinity });
        }
        clearTimeout(joinTimeout);

        // Register socket
        activeSockets.set(playerId, { ws, playerId, username, lastSnapshot: null, lastFullSnapshotTick: 0 });
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

const gameLoop = setInterval(() => {
  const now = Date.now();
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
      playerSocket.lastSnapshot = snapshot;
      if (shouldSendFull) {
        playerSocket.lastFullSnapshotTick = world.getTick();
      }
    }
  }
}, TICK_INTERVAL_MS);

// Start only after the selected persistence service is ready.
const PORT = process.env.PORT || 3002;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27018/xeom_rush';

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
  .then(() => {
    startServer();
  })
  .catch((err) => {
    console.warn('⚠️ [Startup] Storage connection failed.', err);
    if (production) {
      clearInterval(gameLoop);
      process.exitCode = 1;
      return;
    }
    console.warn('⚠️ [Startup] Server starting in MEMORY-ONLY mode. Career stats will not be persistent.');
    startServer();
  });

// Low-frequency checkpoints protect career progress during serverless eviction.
// KV records each session's previous contribution, so retries never double-count.
let checkpointPending: Promise<void> | null = null;
const checkpointLoop = setInterval(() => {
  if (!isKvStorage() || checkpointPending) return;
  checkpointPending = Promise.all(
    [...sessions.values()].map(async (session) => {
      const stats = world.getSessionStatsForPlayer(session.playerId);
      if (stats) await saveSession(session.saveId, stats);
    }),
  )
    .then(() => {})
    .catch((error) => console.error('[Storage] Checkpoint failed', error))
    .finally(() => {
      checkpointPending = null;
    });
}, 30000);
checkpointLoop.unref();

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearInterval(gameLoop);
  clearInterval(checkpointLoop);
  const deadline = setTimeout(() => process.exit(1), 4000);
  deadline.unref();
  if (checkpointPending) await checkpointPending;
  for (const client of wss.clients) client.close(1001, 'Server restarting');
  await Promise.all([...sessions.keys()].map(finalizeSession));
  await closeStorage();
  server.close(() => process.exit(0));
}
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
