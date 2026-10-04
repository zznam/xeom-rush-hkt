import { defaultCityConfig, validateCityConfig, type AdminCommand, type CityConfig } from '@xeom-rush/shared';
import type { GameWorld } from '../world';
import type { BotManager } from '../bot-ai';

export interface RuntimeHooks {
  world(): GameWorld;
  bots(): BotManager;
  reset(config: CityConfig): void;
  endRides(): Promise<void>;
  kick(playerId: string, reason: string): Promise<void>;
}
interface Pending {
  command: AdminCommand;
  resolve(value: string): void;
  reject(error: Error): void;
}
export class CityRuntime {
  config = defaultCityConfig();
  revision = 0;
  effectiveTick = 0;
  paused = false;
  admissionsOpen = true;
  announcement: { message: string; expiresAt: number } | null = null;
  countdownEndsAt: number | null = null;
  private pending: Pending | null = null;
  private transition: { pending: Pending; config: CityConfig; wasOpen: boolean; wasPaused: boolean } | null = null;
  private saving = false;
  constructor(
    private hooks: RuntimeHooks,
    private now = Date.now,
    private countdownMs = 30000,
  ) {}
  load(config: CityConfig, revision: number) {
    this.config = validateCityConfig(config);
    this.revision = revision;
    this.hooks.reset(this.config);
  }
  enqueue(command: AdminCommand): Promise<string> {
    if (this.pending || this.transition) return Promise.reject(new Error('A city operation is already running'));
    return new Promise((resolve, reject) => {
      this.pending = { command, resolve, reject };
    });
  }
  get frozen() {
    return this.paused || this.saving;
  }
  beforeTick(): void {
    if (this.transition && !this.saving && this.now() >= this.countdownEndsAt!) {
      this.saving = true;
      this.hooks.world().clearInputs();
      const transition = this.transition;
      void this.hooks
        .endRides()
        .then(() => {
          this.config = transition.config;
          this.hooks.reset(this.config);
          this.paused = false;
          this.finish(transition.pending, 'Rides ended and city reset');
        })
        .catch((error) => {
          this.paused = transition.wasPaused;
          transition.pending.reject(
            new Error(`City change aborted: ${error instanceof Error ? error.message : 'career save failed'}`),
          );
        })
        .finally(() => {
          this.admissionsOpen = transition.wasOpen;
          this.transition = null;
          this.countdownEndsAt = null;
          this.saving = false;
        });
    }
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    try {
      const { command } = pending;
      if (command.expiresAt <= this.now()) throw new Error('Command expired');
      if (command.expectedRevision !== this.revision) throw new Error('Configuration revision changed');
      const action = command.action;
      if (action.type === 'reset' || (action.type === 'configure' && action.config.mode !== this.config.mode)) {
        this.transition = {
          pending,
          config: action.type === 'configure' ? validateCityConfig(action.config) : structuredClone(this.config),
          wasOpen: this.admissionsOpen,
          wasPaused: this.paused,
        };
        this.admissionsOpen = false;
        this.countdownEndsAt = this.now() + this.countdownMs;
        this.announcement = {
          message: 'Thành phố sẽ bắt đầu lượt mới sau 30 giây. Tiến trình hợp lệ sẽ được lưu.',
          expiresAt: this.countdownEndsAt,
        };
        return;
      }
      switch (action.type) {
        case 'configure':
          this.config = validateCityConfig(action.config);
          this.hooks.world().setRules(this.config.rules);
          this.hooks.bots().configure(this.config.bots);
          break;
        case 'pause':
          this.paused = true;
          this.hooks.world().clearInputs();
          break;
        case 'resume':
          this.hooks.world().clearInputs();
          this.paused = false;
          break;
        case 'close':
          this.admissionsOpen = false;
          break;
        case 'open':
          this.admissionsOpen = true;
          break;
        case 'rush-start':
          this.hooks.world().triggerRushHour();
          break;
        case 'rush-stop':
          this.hooks.world().stopRushHour();
          break;
        case 'clear-bots':
          this.hooks.bots().clearBots();
          this.config.bots.mode = 'manual';
          this.config.bots.count = 0;
          break;
        case 'announce':
          this.announcement = { message: action.message, expiresAt: this.now() + 60000 };
          break;
        case 'kick':
          void this.hooks
            .kick(action.playerId, action.reason)
            .then(() => this.finish(pending, 'Player removed'))
            .catch((e) => pending.reject(e));
          return;
      }
      this.finish(pending, 'Applied');
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error('Command failed'));
    }
  }
  private finish(pending: Pending, message: string) {
    this.revision++;
    this.effectiveTick = this.hooks.world().getTick();
    pending.resolve(message);
  }
}
