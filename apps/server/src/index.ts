import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import {
  EMessageType,
  TICK_INTERVAL_MS,
  MAP_SIZE,
  CHUNK_SIZE,
  decodeInput,
  decodeJoin,
  encodeConfig,
  encodeSnapshot,
} from '@xeom-rush/shared';
import { GameWorld } from './world';

// --- Express App Setup ---
const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Instantiate authoritative world state
const world = new GameWorld();

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

// --- WebSocket Connection Management ---
interface PlayerSocket {
  ws: WebSocket;
  playerId: string;
  username: string;
}

const activeSockets = new Map<string, PlayerSocket>();
let connectionIdCounter = 1;

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
        activeSockets.set(playerId, { ws, playerId, username });
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

  // 1. Tick the world simulation
  world.tick(actualDt);

  // 2. Broadcast filtered snapshots to each player based on their chunk position
  for (const [playerId, playerSocket] of activeSockets.entries()) {
    if (playerSocket.ws.readyState === WebSocket.OPEN) {
      // Retrieve entities in player's 3x3 surrounding chunks
      const { players, passengers } = world.getVisibleSnapshotForPlayer(playerId);

      // Encode snapshot in custom binary format
      const snapshotBuffer = encodeSnapshot(world.getTick(), players, passengers);
      playerSocket.ws.send(snapshotBuffer);
    }
  }
}, TICK_INTERVAL_MS);

// Start server
const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log(`🚀 Authoritative Server running on port ${PORT}`);
  console.log(`Tick rate: 20Hz (Interval: ${TICK_INTERVAL_MS}ms)`);
  console.log(`Map Dimensions: ${MAP_SIZE}x${MAP_SIZE} units`);
});
