import {
  encodeJoin,
  encodeInput,
  decodeConfig,
  decodeSnapshot,
  type WorldSnapshot,
  type ConfigPayload,
} from '@xeom-rush/shared';

export class GameNetwork {
  private ws: WebSocket | null = null;
  private onSnapshotCallbacks: ((snapshot: WorldSnapshot) => void)[] = [];
  private onConfigCallbacks: ((config: ConfigPayload) => void)[] = [];
  private onConnectCallback: (() => void) | null = null;
  private onDisconnectCallback: (() => void) | null = null;

  public rtt: number = 0;
  private pingSentTime: number = 0;

  constructor() {}

  public connect(url: string, username: string, onConnect: () => void, onDisconnect: () => void): void {
    this.onConnectCallback = onConnect;
    this.onDisconnectCallback = onDisconnect;
    
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (err) {
      console.error('Failed to create WebSocket:', err);
      this.onDisconnectCallback?.();
      return;
    }
    
    this.ws = socket;
    socket.binaryType = 'arraybuffer';

    socket.onopen = () => {
      if (this.ws !== socket) return;
      const joinBuffer = encodeJoin(username);
      socket.send(joinBuffer);
      this.onConnectCallback?.();

      this.startPingLoop();
    };

    socket.onmessage = (event: MessageEvent) => {
      if (this.ws !== socket) return;
      const buffer = event.data as ArrayBuffer;
      const view = new DataView(buffer);
      const msgType = view.getUint8(0);

      if (msgType === 5) { // EMessageType.CONFIG
        const config = decodeConfig(buffer);
        this.onConfigCallbacks.forEach((cb) => cb(config));
      } else if (msgType === 4) { // EMessageType.SNAPSHOT
        const snapshot = decodeSnapshot(buffer);
        this.onSnapshotCallbacks.forEach((cb) => cb(snapshot));

        if (this.pingSentTime > 0) {
          this.rtt = Date.now() - this.pingSentTime;
          this.pingSentTime = 0;
        }
      }
    };

    socket.onclose = () => {
      if (this.ws === socket) {
        this.onDisconnectCallback?.();
        this.ws = null;
      }
    };

    socket.onerror = (err) => {
      if (this.ws !== socket) return;
      console.error('WebSocket Error:', err);
    };
  }

  private startPingLoop(): void {
    setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.pingSentTime = Date.now();
      }
    }, 2000);
  }

  public sendInput(seq: number, dx: number, dy: number, angle: number): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const inputBuffer = encodeInput(seq, dx, dy, angle);
      this.ws.send(inputBuffer);
    }
  }

  public registerSnapshotCallback(cb: (snapshot: WorldSnapshot) => void): void {
    this.onSnapshotCallbacks.push(cb);
  }

  public registerConfigCallback(cb: (config: ConfigPayload) => void): void {
    this.onConfigCallbacks.push(cb);
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export const network = new GameNetwork();
