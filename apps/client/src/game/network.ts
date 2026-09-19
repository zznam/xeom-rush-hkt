import {
  encodeJoin,
  encodeInput,
  decodeConfig,
  decodeSnapshot,
  decodeDeltaSnapshot,
  EMessageType,
  type WorldSnapshot,
  type ConfigPayload,
  type SnapshotPacketMeta,
} from '@xeom-rush/shared';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting';

export class GameNetwork {
  private ws: WebSocket | null = null;
  private onSnapshotCallbacks = new Set<(snapshot: WorldSnapshot, meta: SnapshotPacketMeta) => void>();
  private onConfigCallbacks = new Set<(config: ConfigPayload) => void>();
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
    onDisconnect: () => void,
    onStatus?: (state: ConnectionState) => void,
  ): void {
    this.disconnect();
    const generation = this.generation;
    const token = crypto.randomUUID();
    let failuresStarted = 0;
    let attempts = 0;
    const open = () => {
      if (generation !== this.generation) return;
      this.ready = false;
      this.lastSnapshot = null;
      onStatus?.(attempts ? 'reconnecting' : 'connecting');
      let socket: WebSocket;
      try {
        const target = new URL(url);
        target.searchParams.set('session', token);
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
          if (event.data.startsWith('pong:')) this.rtt = Math.max(0, Date.now() - Number(event.data.slice(5)));
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
        if (event.code === 1008 || Date.now() - failuresStarted >= 25000) {
          onDisconnect();
          return;
        }
        attempts++;
        onStatus?.('reconnecting');
        const timer = setTimeout(
          () => {
            this.timers.delete(timer);
            open();
          },
          Math.min(500 * 2 ** attempts, 3000),
        );
        this.timers.add(timer);
      };
      socket.onerror = () => {
        /* onclose owns retries and user feedback. */
      };
    };
    open();
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
