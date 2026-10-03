import express from 'express';
import cors from 'cors';
import { issueGuest, isSessionId, verifyGuest, roomKey } from './admission';
import { regionsFromEnv } from './regions';
import { resolveDeploymentTarget } from '@xeom-rush/shared';

export interface Room {
  id: string;
  url: string;
}

// Prefer occupied cities to bring players together; stable ordering avoids
// spreading an empty region across every room. Reservations decide capacity.
export async function findMatch(rooms: Room[], session: string, guest: string, key: string, request = fetch) {
  const deadline = Date.now() + 9000;
  const candidates = await Promise.all(
    rooms.map(async (room) => {
      try {
        const response = await request(`${room.url}/api/room`, { signal: AbortSignal.timeout(2000) });
        if (!response.ok) return null;
        const status = (await response.json()) as { available: number; players: number };
        return status.available > 0 ? { ...room, players: status.players } : null;
      } catch {
        return null;
      }
    }),
  );
  for (const room of candidates
    .filter((r) => r !== null)
    .sort((a, b) => b.players - a.players || a.id.localeCompare(b.id))) {
    if (Date.now() >= deadline) break;
    try {
      const response = await request(`${room.url}/api/reservations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-matchmaker-key': key },
        body: JSON.stringify({ session, guest }),
        signal: AbortSignal.timeout(Math.min(2500, Math.max(1, deadline - Date.now()))),
      });
      if (!response.ok) continue;
      const reservation = (await response.json()) as { ticket: string; expires: number };
      const target = new URL(room.url);
      target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
      target.searchParams.set('session', session);
      target.searchParams.set('ticket', reservation.ticket);
      return { room: room.id, wsUrl: target.toString(), expires: reservation.expires };
    } catch {
      // An ambiguous reservation expires in 15s; never exceed room capacity.
    }
  }
  return null;
}

export function startMatchmaker(): void {
  if (resolveDeploymentTarget(process.env.DEPLOY_TARGET) !== 'regional-production')
    throw new Error('Matchmaking requires DEPLOY_TARGET=regional-production');
  const regions = regionsFromEnv();
  const region = regions.find((r) => r.id === process.env.GAME_REGION);
  const secret = process.env.GUEST_SECRET || '';
  if (!region || secret.length < 32)
    throw new Error('Matchmaker needs GAME_REGION, REGIONS_JSON and GUEST_SECRET (32+ chars)');
  const roomIds = (process.env.ROOM_IDS || '').split(',');
  if (!roomIds.length || roomIds.length > 40 || roomIds.some((id) => !/^[a-z0-9-]{1,24}$/.test(id)))
    throw new Error('Invalid ROOM_IDS');
  const rooms = roomIds.map((id) => ({ id, url: `${region.apiUrl}/rooms/${id}` }));
  const app = express();
  const origins = (process.env.ALLOWED_ORIGINS || '').split(',');
  app.disable('x-powered-by');
  app.use(cors({ origin: (origin, cb) => cb(null, !origin || origins.includes(origin)) }));
  app.use(express.json({ limit: '1kb' }));
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.get('/api/live', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/api/ready', (_req, res) => {
    res.json({ status: 'ok', region: region.id });
  });
  app.get('/api/latency', (_req, res) => {
    res.json({ region: region.id });
  });
  app.get('/api/rooms/capabilities', async (_req, res) => {
    const candidates = await Promise.all(
      rooms.map(async (room) => {
        try {
          const r = await fetch(`${room.url}/api/rooms/capabilities`, { signal: AbortSignal.timeout(2000) });
          const c = await r.json();
          return c.available ? c : null;
        } catch {
          return null;
        }
      }),
    );
    res.json(candidates.find(Boolean) ?? { available: false, modes: [] });
  });
  app.get('/api/rooms', (_req, res) => {
    res.json(roomIds);
  });
  app.get('/api/regions', (_req, res) => {
    res.json(regions);
  });
  app.post('/api/guest', (_req, res) => {
    res.json({ guest: issueGuest(secret) });
  });
  let pending = 0;
  app.post('/api/match', async (req, res) => {
    if (req.body?.region !== region.id || !isSessionId(req.body?.session) || !verifyGuest(req.body?.guest, secret)) {
      res.status(400).json({ error: 'Invalid region, session or guest' });
      return;
    }
    if (pending >= 100) {
      res.status(429).json({ error: 'Please retry shortly' });
      return;
    }
    pending++;
    try {
      const match = await findMatch(rooms, req.body.session, req.body.guest, roomKey(secret));
      res
        .status(match ? 200 : 503)
        .json(match ? { ...match, region: region.id } : { error: 'Region full or unavailable' });
    } finally {
      pending--;
    }
  });
  const server = app.listen(Number(process.env.PORT || 3002), () => console.log(`[Matchmaker] Ready in ${region.id}`));
  process.once('SIGTERM', () => {
    server.close();
    server.closeIdleConnections();
  });
}

if (require.main === module) startMatchmaker();
