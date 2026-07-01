import express from 'express';
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
import { dbManager } from './db';
import { savePlayerSession } from './persist';

dotenv.config();

// --- Express App Setup ---
const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Instantiate authoritative world state
const world = new GameWorld();
const botManager = new BotManager(world, world.getPhysics());

// HTTP JSON Endpoints for Judges/Dashboard
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    players: world.getSpatialGrid().getNearbyEntities(MAP_SIZE / 2, MAP_SIZE / 2).length,
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
  const count = Math.min(req.body?.count ?? 25, 100); // Cap at 100 bots per request
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

app.get('/api/leaderboard', async (req, res) => {
  try {
    const db = dbManager.getDb();
    const playersCol = db.collection('players');
    const topPlayers = await playersCol
      .find()
      .sort({ careerScore: -1 })
      .limit(10)
      .toArray();

    res.json(topPlayers.map(p => ({
      username: p.username,
      careerScore: p.careerScore,
      peakScore: p.peakScore,
      peakStreak: p.peakStreak,
      totalDeliveries: p.totalDeliveries
    })));
  } catch (err) {
    console.warn('[API Leaderboard] Returning empty leaderboard (DB not connected or queried error).');
    res.json([]);
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
let connectionIdCounter = 1;
const FULL_SNAPSHOT_INTERVAL_TICKS = 40;

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws: WebSocket) => {
  const playerId = `player-${connectionIdCounter++}`;
  let joined = false;

  ws.binaryType = 'arraybuffer';

  ws.on('message', (message: ArrayBuffer) => {
    try {
      const view = new DataView(message);
      const msgType = view.getUint8(0);

      if (msgType === EMessageType.JOIN) {
        if (joined) return;
        const username = decodeJoin(message);

        // Add to game world
        world.addPlayer(playerId, username);

        // Register socket
        activeSockets.set(playerId, { ws, playerId, username, lastSnapshot: null, lastFullSnapshotTick: 0 });
        joined = true;

        console.log(`[Player Join] ${username} (${playerId}) connected.`);

        // Send configuration back to player
        const configBuffer = encodeConfig(playerId, MAP_SIZE, CHUNK_SIZE);
        ws.send(configBuffer);

      } else if (msgType === EMessageType.INPUT) {
        if (!joined) return;
        const input = decodeInput(message);
        world.queueInput(playerId, input);
      }
    } catch (err) {
      console.error(`[WS Message Error] from ${playerId}:`, err);
    }
  });

  ws.on('close', () => {
    if (joined) {
      console.log(`[Player Leave] Player ${playerId} disconnected.`);
      const stats = world.getSessionStatsForPlayer(playerId);
      if (stats) {
        // Fire-and-forget async save to MongoDB
        savePlayerSession(stats.username, stats).catch((err) => {
          console.error(`[DB save error] Failed to save stats for ${stats.username}:`, err);
        });
      }
      world.removePlayer(playerId);
      activeSockets.delete(playerId);
    }
  });

  ws.on('error', (err) => {
    console.error(`[WS Error] for ${playerId}:`, err);
  });
});

// --- Authoritative Game Tick Loop (20 Hz) ---
const dt = TICK_INTERVAL_MS / 1000; // 0.05 seconds
let lastTickTime = Date.now();

setInterval(() => {
  const now = Date.now();
  const actualDt = (now - lastTickTime) / 1000;
  lastTickTime = now;

  // 1. Run bot AI (generates inputs for bot players)
  botManager.tick();

  // 2. Tick the world simulation
  world.tick(actualDt);

  // 3. Broadcast filtered snapshots to each player based on their chunk position
  for (const [playerId, playerSocket] of activeSockets.entries()) {
    if (playerSocket.ws.readyState === WebSocket.OPEN) {
      // Retrieve entities in player's 3x3 surrounding chunks
      const { players, passengers, trafficLights, pedestrians, rushHour, streaks } = world.getVisibleSnapshotForPlayer(playerId);
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

      const snapshotBuffer = shouldSendFull || !playerSocket.lastSnapshot
        ? encodeSnapshot(snapshot.tick, snapshot.players, snapshot.passengers, snapshot.trafficLights, snapshot.pedestrians, snapshot.rushHour, snapshot.streaks)
        : encodeDeltaSnapshot(playerSocket.lastSnapshot, snapshot);

      playerSocket.ws.send(snapshotBuffer);
      playerSocket.lastSnapshot = snapshot;
      if (shouldSendFull) {
        playerSocket.lastFullSnapshotTick = world.getTick();
      }
    }
  }
}, TICK_INTERVAL_MS);

// Start server after connecting to MongoDB
const PORT = process.env.PORT || 3002;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27018/xeom_rush';

const startServer = () => {
  server.listen(PORT, () => {
    console.log(`🚀 Authoritative Server running on port ${PORT}`);
    console.log(`Tick rate: 20Hz (Interval: ${TICK_INTERVAL_MS}ms)`);
    console.log(`Map Dimensions: ${MAP_SIZE}x${MAP_SIZE} units`);
  });
};

dbManager.connect(MONGODB_URI)
  .then(() => {
    startServer();
  })
  .catch((err) => {
    console.warn(`⚠️ [Startup] Failed to connect to MongoDB at ${MONGODB_URI}: ${err.message}`);
    console.warn('⚠️ [Startup] Server starting in MEMORY-ONLY mode. Career stats will not be persistent.');
    startServer();
  });
