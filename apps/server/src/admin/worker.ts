import { randomUUID } from 'crypto';
import { cityKey, type AdminCommand, type BanRecord, type CityRef, type CityReport } from '@xeom-rush/shared';
import type { CityRuntime } from './runtime';
import type { ConfigRecord } from './service';

export interface WorkerOptions {
  url: string;
  deployment: string;
  token: string;
  region: string;
  room: string;
  persistent: boolean;
}
export function workerOptions(): WorkerOptions | null {
  if (process.env.GAME_MASTER_ENABLED !== '1') return null;
  const url = process.env.ADMIN_CONTROL_URL || '';
  const parsed = new URL(url);
  if (parsed.origin !== url || (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:'))
    throw new Error('ADMIN_CONTROL_URL must be an exact HTTPS origin');
  const deployment = process.env.GAME_DEPLOYMENT_ID || '';
  const token = process.env.ADMIN_WORKER_TOKEN || '';
  const identitySecret = process.env.GUEST_IDENTITY_SECRET || '';
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(deployment) || token.length < 32 || identitySecret.length < 32)
    throw new Error('Managed games require GAME_DEPLOYMENT_ID, ADMIN_WORKER_TOKEN and GUEST_IDENTITY_SECRET');
  const regional = process.env.DEPLOY_TARGET === 'regional-production';
  return {
    url,
    deployment,
    token,
    region: regional ? process.env.GAME_REGION || '' : 'local',
    room: regional ? process.env.ROOM_ID || 'gateway' : 'local',
    persistent: regional,
  };
}
export class ControlTransport {
  constructor(
    public options: WorkerOptions,
    private request = fetch,
  ) {}
  async call<T>(path: string, body: unknown): Promise<T> {
    const response = await this.request(`${this.options.url}/api/internal/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.options.token}`,
        'x-deployment-id': this.options.deployment,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Controller request failed (${response.status})`);
    return response.json() as Promise<T>;
  }
  admit(guestId: string) {
    return this.call<{ banned: boolean; profileId: string }>('admit', { guestId, region: this.options.region });
  }
  link(guestId: string, legacyProfileId: string) {
    return this.call('link', { guestId, legacyProfileId, region: this.options.region });
  }
}
export class ControlWorker {
  ref: CityRef;
  initialized = false;
  lastContact = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private stopped = false;
  private observedUntil = 0;
  private lastReport = 0;
  private lastPoll = 0;
  private executing = new Set<string>();
  private results = new Map<string, { status: 'applied' | 'rejected'; result: string }>();
  constructor(
    public transport: ControlTransport,
    private runtime: CityRuntime,
    private report: (observe: boolean) => Omit<CityReport, 'ref'>,
    private enforceBans: (bans: BanRecord[]) => Promise<void>,
  ) {
    const options = transport.options;
    this.ref = {
      deployment: options.deployment,
      region: options.region,
      room: options.room,
      persistent: options.persistent,
      runtimeId: randomUUID(),
    };
  }
  start() {
    this.timer = setInterval(() => {
      void this.step();
    }, 1000);
    this.timer.unref();
    void this.step();
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }
  get healthy() {
    return this.initialized && Date.now() - this.lastContact < 10000;
  }
  async step() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      const now = Date.now();
      const observed = now < this.observedUntil;
      if (now - this.lastReport >= (observed ? 1000 : 5000)) {
        await this.transport.call('report', { ...this.report(observed), ref: this.ref });
        this.lastReport = now;
      }
      // Retry acknowledgement independently of command execution; never execute a retry twice.
      for (const [id, result] of this.results) {
        await this.transport.call('ack', { ref: this.ref, id, ...result });
        this.results.delete(id);
        this.executing.delete(id);
      }
      if (now - this.lastPoll >= 2000) {
        const state = await this.transport.call<{
          config: ConfigRecord;
          command: AdminCommand | null;
          bans: BanRecord[];
          observedUntil: number;
        }>('poll', this.ref);
        this.lastContact = Date.now();
        this.lastPoll = now;
        this.observedUntil = state.observedUntil;
        if (!this.initialized) {
          this.runtime.load(state.config.config, state.config.revision);
          this.initialized = true;
        }
        await this.enforceBans(state.bans);
        const command = state.command;
        if (
          command &&
          command.runtimeId === this.ref.runtimeId &&
          command.city === cityKey(this.ref) &&
          !this.executing.has(command.id)
        ) {
          this.executing.add(command.id);
          void this.runtime
            .enqueue(command)
            .then((result) => {
              this.results.set(command.id, { status: 'applied', result });
            })
            .catch((error) => {
              this.results.set(command.id, { status: 'rejected', result: String(error.message).slice(0, 500) });
            });
        }
      }
    } catch {
      // Existing rides continue with the last applied state; admission checks fail closed.
    } finally {
      this.busy = false;
    }
  }
}
