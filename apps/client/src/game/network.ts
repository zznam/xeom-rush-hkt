import { managedGuest } from './guest';
import { readStored, writeStored } from './preferences';
import {
  encodeJoin,
  encodeInput,
  decodeConfig,
  decodeSnapshot,
  decodeDeltaSnapshot,
  EMessageType,
  type WorldSnapshot,
  type CityStatus,
  type ConfigPayload,
  type SnapshotPacketMeta,
} from '@xeom-rush/shared';

export interface ServerEnd {
  message?: string;
  result?: { score: number; deliveriesCount: number; mode: 'career' | 'sandbox' };
}

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting';

export class GameNetwork {
  private ws: WebSocket | null = null;
  private controls = new Set<(message: { version: 1; kind: string; data: any }) => void>();
  private onSnapshotCallbacks = new Set<(snapshot: WorldSnapshot, meta: SnapshotPacketMeta) => void>();
  private onConfigCallbacks = new Set<(config: ConfigPayload) => void>();
  private onCityCallbacks = new Set<(status: CityStatus) => void>();
  private lastSnapshot: WorldSnapshot | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private generation = 0;
  private ready = false;
  public rtt = 0;
  public get connected(): boolean {
    return this.ready;
  }

  public connect(
    url: string,
    username: string,
    onConnect: () => void,
    onDisconnect: (end?: ServerEnd) => void,
    onStatus?: (state: ConnectionState) => void,
  ): void {
    this.disconnect();
    const generation = this.generation;
    const token = new URL(url).searchParams.get('session') || crypto.randomUUID();
    let failuresStarted = 0;
    let attempts = 0;
    let preparedUrl = url;
    let serverEnd: ServerEnd | undefined;
    const open = () => {
      if (generation !== this.generation) return;
      this.ready = false;
      this.lastSnapshot = null;
      onStatus?.(attempts ? 'reconnecting' : 'connecting');
      let socket: WebSocket;
      try {
        const target = new URL(preparedUrl);
        target.searchParams.set('session', token);
        if (!target.pathname.includes('/private/') && readStored('tutorial') !== 'done')
          target.searchParams.set('practice', '1');
        socket = new WebSocket(target);
      } catch {
        onDisconnect();
        return;
      }
      this.ws = socket;
      socket.binaryType = 'arraybuffer';
      let lastReceived = Date.now();
      socket.onopen = () => {
        if (this.ws !== socket) return;
        socket.send(encodeJoin(username));
      };
      this.heartbeat = setInterval(() => {
        if (this.ws !== socket) return;
        if (Date.now() - lastReceived > 8000) {
          socket.close();
          return;
        }
        if (socket.readyState === WebSocket.OPEN) socket.send(`ping:${Date.now()}`);
      }, 2000);
      socket.onmessage = (event: MessageEvent) => {
        if (this.ws !== socket) return;
        lastReceived = Date.now();
        if (typeof event.data === 'string') {
          if (event.data.startsWith('notice:') || event.data.startsWith('result:')) {
            try {
              const body = JSON.parse(event.data.slice(event.data.indexOf(':') + 1));
              if (event.data.startsWith('notice:') && typeof body.message === 'string')
                serverEnd = { message: body.message };
              if (
                event.data.startsWith('result:') &&
                Number.isFinite(body.score) &&
                Number.isFinite(body.deliveriesCount) &&
                ['career', 'sandbox'].includes(body.mode)
              )
                serverEnd = { result: body };
            } catch {
              /* Invalid optional metadata is ignored. */
            }
          }

          if (event.data.startsWith('pong:')) this.rtt = Math.max(0, Date.now() - Number(event.data.slice(5)));
          if (event.data.startsWith('city:')) {
            try {
              const status = JSON.parse(event.data.slice(5)) as CityStatus;
              if (
                [status.tick, status.rushHourTicksRemaining, status.deliveries].every(
                  (n) => Number.isInteger(n) && n >= 0,
                )
              )
                this.onCityCallbacks.forEach((cb) => cb(status));
            } catch {
              /* Ignore malformed optional metadata; snapshots remain authoritative. */
            }
          }
          if (event.data.startsWith('control:')) {
            try {
              const message = JSON.parse(event.data.slice(8));
              if (message.version === 1 && typeof message.kind === 'string') this.controls.forEach((cb) => cb(message));
            } catch {
              /* optional control metadata */
            }
          }
          return;
        }
        try {
          const buffer = event.data as ArrayBuffer;
          const msgType = new DataView(buffer).getUint8(0);
          if (msgType === EMessageType.CONFIG) {
            const config = decodeConfig(buffer);
            this.onConfigCallbacks.forEach((cb) => cb(config));
            this.ready = true;
            failuresStarted = 0;
            attempts = 0;
            onStatus?.('connected');
            onConnect();
          } else if (
            msgType === EMessageType.SNAPSHOT ||
            (msgType === EMessageType.DELTA_SNAPSHOT && this.lastSnapshot)
          ) {
            const snapshot =
              msgType === EMessageType.SNAPSHOT
                ? decodeSnapshot(buffer)
                : decodeDeltaSnapshot(buffer, this.lastSnapshot!);
            this.lastSnapshot = snapshot;
            this.onSnapshotCallbacks.forEach((cb) =>
              cb(snapshot, { bytes: buffer.byteLength, kind: msgType === EMessageType.SNAPSHOT ? 'full' : 'delta' }),
            );
          }
        } catch {
          socket.close(1002, 'Invalid game packet');
        }
      };
      socket.onclose = (event) => {
        if (this.ws !== socket || generation !== this.generation) return;
        this.ready = false;
        this.ws = null;
        if (this.heartbeat) clearInterval(this.heartbeat);
        this.heartbeat = null;
        if (!failuresStarted) failuresStarted = Date.now();
        if (event.code === 1000 || event.code === 1008 || Date.now() - failuresStarted >= 25000) {
          onDisconnect(serverEnd);
          return;
        }
        attempts++;
        onStatus?.('reconnecting');
        const timer = setTimeout(
          () => {
            this.timers.delete(timer);
            open();
          },
          Math.min(500 * 2 ** attempts, 3000) + Math.random() * 400,
        );
        this.timers.add(timer);
      };
      socket.onerror = () => {
        /* onclose owns retries and user feedback. */
      };
    };
    const prepare = async () => {
      try {
        const target = new URL(url);
        if (target.searchParams.get('managed') === '1' && target.searchParams.has('guest')) {
          preparedUrl = target.toString();
          open();
          return;
        }
        const apiUrl = `${target.protocol === 'wss:' ? 'https:' : 'http:'}//${target.host}${target.pathname.replace(/\/$/, '')}`;
        const guest = target.pathname.includes('/private/') ? null : await managedGuest(apiUrl);
        if (generation !== this.generation) return;
        if (guest) {
          target.searchParams.set('guest', guest);
          target.searchParams.set('managed', '1');
        }
        if (!guest && !target.searchParams.has('ticket') && !target.searchParams.has('guest')) {
          const key = `guest:${target.host}`;
          let credential = readStored(key);
          if (!credential) {
            try {
              const response = await fetch(`${apiUrl}/api/guest`, {
                method: 'POST',
                signal: AbortSignal.timeout(5000),
              });
              if (response.ok) {
                credential = (await response.json()).guest;
                if (typeof credential === 'string') writeStored(key, credential);
              }
            } catch {
              /* Older backends accept the binary handshake. */
            }
          }
          if (credential) target.searchParams.set('guest', credential);
        }
        if (generation !== this.generation) return;
        preparedUrl = target.toString();
        open();
      } catch (error) {
        if (generation === this.generation)
          onDisconnect({ message: error instanceof Error ? error.message : 'Chưa kết nối được thành phố.' });
      }
    };
    void prepare();
  }
  public registerControlCallback(cb: (message: { version: 1; kind: string; data: any }) => void) {
    this.controls.add(cb);
    return () => {
      this.controls.delete(cb);
    };
  }
  public command(action: string, target?: string, value?: string) {
    if (this.ready && this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(`control:${JSON.stringify({ version: 1, id: crypto.randomUUID(), action, target, value })}`);
  }

  public sendInput(seq: number, dx: number, dy: number, angle: number): void {
    if (this.ready && this.ws?.readyState === WebSocket.OPEN && this.ws.bufferedAmount < 16384)
      this.ws.send(encodeInput(seq, dx, dy, angle));
  }
  public registerSnapshotCallback(cb: (snapshot: WorldSnapshot, meta: SnapshotPacketMeta) => void): () => void {
    this.onSnapshotCallbacks.add(cb);
    return () => {
      this.onSnapshotCallbacks.delete(cb);
    };
  }
  public registerConfigCallback(cb: (config: ConfigPayload) => void): () => void {
    this.onConfigCallbacks.add(cb);
    return () => {
      this.onConfigCallbacks.delete(cb);
    };
  }
  public registerCityCallback(cb: (status: CityStatus) => void): () => void {
    this.onCityCallbacks.add(cb);
    return () => {
      this.onCityCallbacks.delete(cb);
    };
  }
  public disconnect(): void {
    this.generation++;
    this.ready = false;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    const socket = this.ws;
    this.ws = null;
    if (socket?.readyState === WebSocket.OPEN) socket.send(new Uint8Array([EMessageType.LEAVE]));
    socket?.close();
    this.lastSnapshot = null;
  }
}
export const network = new GameNetwork();
