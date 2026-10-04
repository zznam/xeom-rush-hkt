import { createHash, randomUUID } from 'crypto';
import {
  cityKey,
  defaultCityConfig,
  validateCityConfig,
  mayCommand,
  type AdminCommand,
  type AdminStaff,
  type BanRecord,
  type CityConfig,
  type CityRef,
  type CityReport,
  type CommandAction,
} from '@xeom-rush/shared';
import type { ControlStore, Stored } from './store';

export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
export const validUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export class ControlError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export interface DeploymentRecord {
  id: string;
  label: string;
  regions: string[];
  tokenHash: string;
  defaults: CityConfig;
}
export interface AuditRecord {
  id: string;
  actor: string;
  action: string;
  target: string;
  at: number;
  detail?: unknown;
}
export interface ConfigRecord {
  revision: number;
  config: CityConfig;
  pending?: string;
}
export interface Preset {
  id: string;
  name: string;
  config: CityConfig;
}
export class ControlService {
  constructor(
    public store: ControlStore,
    public now = Date.now,
  ) {}
  async put(key: string, value: unknown): Promise<void> {
    for (let i = 0; i < 8; i++) {
      const old = await this.store.get(key);
      if (await this.store.commit([old], [{ key, value }])) return;
    }
    throw new ControlError(409, 'Concurrent update; refresh and try again');
  }
  audit(actor: string, action: string, target: string, detail?: unknown) {
    const id = `${String(9999999999999 - this.now()).padStart(13, '0')}-${randomUUID()}`;
    return { key: `audit/${id}`, value: { id, actor, action, target, at: this.now(), detail } satisfies AuditRecord };
  }
  async change(actor: string, action: string, key: string, value: unknown, expected: string | null) {
    const old = await this.store.get(key);
    if (old.version !== expected) throw new ControlError(409, 'This record changed. Reload it before saving');
    const detail =
      value && typeof value === 'object' && 'tokenHash' in value
        ? Object.fromEntries(Object.entries(value).filter(([field]) => field !== 'tokenHash'))
        : value;
    if (!(await this.store.commit([old], [{ key, value }, this.audit(actor, action, key, detail)])))
      throw new ControlError(409, 'Concurrent update; refresh and try again');
  }
  async bootstrap(owner: string, deployments: DeploymentRecord[]) {
    if (!/^\d+$/.test(owner)) throw new Error('ADMIN_OWNER_GITHUB_ID must be a numeric GitHub account ID');
    await this.put(`staff/${owner}`, { id: owner, login: 'Owner', role: 'owner' } satisfies AdminStaff);
    for (const deployment of deployments) {
      const row = await this.store.get(`deployments/${deployment.id}`);
      if (!row.value) await this.store.commit([row], [{ key: row.key, value: deployment }]);
    }
  }
  async deployment(id: string): Promise<DeploymentRecord> {
    if (!validId(id)) throw new ControlError(400, 'Invalid deployment');
    const row = await this.store.get<DeploymentRecord>(`deployments/${id}`);
    if (!row.value) throw new ControlError(404, 'Unknown deployment');
    return row.value;
  }
  async authenticateWorker(id: string, token: string) {
    const deployment = await this.deployment(id);
    if (token.length < 32 || hash(token) !== deployment.tokenHash)
      throw new ControlError(403, 'Invalid deployment credential');
    return deployment;
  }
  validateRef(ref: CityRef, deployment: DeploymentRecord) {
    if (
      !ref ||
      ref.deployment !== deployment.id ||
      !deployment.regions.includes(ref.region) ||
      !validId(ref.room) ||
      !validUuid(ref.runtimeId) ||
      typeof ref.persistent !== 'boolean'
    )
      throw new ControlError(400, 'Invalid city identity');
  }
  async report(report: CityReport, deployment: DeploymentRecord) {
    this.validateRef(report.ref, deployment);
    const key = cityKey(report.ref);
    if (
      !Number.isInteger(report.revision) ||
      report.revision < 0 ||
      !Number.isFinite(report.tickMs) ||
      !Number.isInteger(report.humans) ||
      report.humans < 0 ||
      report.humans > 200
    )
      throw new ControlError(400, 'Invalid report');
    validateCityConfig(report.config);
    const old = await this.store.get<CityReport>(`cities/${key}`);
    if (old.value && old.value.ref.runtimeId !== report.ref.runtimeId && this.now() - old.value.lastSeen < 15000)
      throw new ControlError(409, 'A live owner already holds this city');
    const { players, map, ...summary } = report;
    const writes: { key: string; value: unknown }[] = [
      { key: old.key, value: { ...summary, lastSeen: this.now(), observedUntil: old.value?.observedUntil ?? 0 } },
    ];
    if (players) {
      if (!Array.isArray(players) || players.length > 250) throw new ControlError(400, 'Player report too large');
      writes.push({ key: `players/${key}`, value: { runtimeId: report.ref.runtimeId, players, at: this.now() } });
    }
    if (map) writes.push({ key: `maps/${key}`, value: { runtimeId: report.ref.runtimeId, map, at: this.now() } });
    if (!(await this.store.commit([old], writes))) throw new ControlError(409, 'Report raced another update');
    const config = await this.store.get<ConfigRecord>(`config/${key}`);
    if (!config.value)
      await this.store.commit([config], [{ key: config.key, value: { revision: 0, config: deployment.defaults } }]);
  }
  async observe(key: string) {
    for (let i = 0; i < 4; i++) {
      const city = await this.store.get<CityReport>(`cities/${key}`);
      if (!city.value) throw new ControlError(404, 'City not found');
      if (
        await this.store.commit(
          [city],
          [{ key: city.key, value: { ...city.value, observedUntil: this.now() + 15000 } }],
        )
      )
        return;
    }
  }
  async submit(
    actor: AdminStaff,
    key: string,
    input: { id: string; runtimeId: string; expectedRevision: number; action: CommandAction },
  ) {
    if (!validUuid(input.id) || !validUuid(input.runtimeId) || !Number.isInteger(input.expectedRevision))
      throw new ControlError(400, 'Invalid command identity');
    const action = this.validateAction(input.action);
    if (!mayCommand(actor.role, action)) throw new ControlError(403, 'Your role cannot change city settings');
    const previous = await this.store.get<AdminCommand>(`commands/${key}/${input.id}`);
    if (previous.value) {
      if (
        previous.value.actor !== actor.id ||
        previous.value.runtimeId !== input.runtimeId ||
        previous.value.expectedRevision !== input.expectedRevision ||
        JSON.stringify(previous.value.action) !== JSON.stringify(action)
      )
        throw new ControlError(409, 'Request ID was already used');
      return previous.value;
    }
    const city = await this.store.get<CityReport>(`cities/${key}`);
    if (!city.value || city.value.ref.runtimeId !== input.runtimeId || this.now() - city.value.lastSeen > 15000)
      throw new ControlError(409, 'City owner is offline or changed');
    const config = await this.store.get<ConfigRecord>(`config/${key}`);
    if (city.value.revision !== config.value?.revision)
      throw new ControlError(409, 'Waiting for the city to reconcile its applied revision');
    if (!config.value || config.value.revision !== input.expectedRevision)
      throw new ControlError(409, 'Configuration changed. Reload before applying');
    if (config.value.pending) {
      await this.expireCommand(key, config.value.pending);
      throw new ControlError(409, 'Another command is pending. Refresh its result first');
    }
    const recent = await this.store.get<string[]>(`recent/${key}`);
    const command: AdminCommand = {
      ...input,
      action,
      city: key,
      actor: actor.id,
      createdAt: this.now(),
      expiresAt: this.now() + 90000,
      status: 'pending',
    };
    if (
      !(await this.store.commit(
        [previous, city, config, recent],
        [
          { key: previous.key, value: command },
          { key: recent.key, value: [input.id, ...(recent.value ?? [])].slice(0, 30) },
          { key: config.key, value: { ...config.value, pending: input.id } },
          this.audit(actor.id, action.type, key, { commandId: input.id, action }),
        ],
      ))
    )
      throw new ControlError(409, 'Concurrent update; refresh and try again');
    return command;
  }
  validateAction(input: CommandAction): CommandAction {
    if (!input || typeof input !== 'object') throw new ControlError(400, 'Invalid command');
    if (input.type === 'configure') return { type: 'configure', config: validateCityConfig(input.config) };
    if (input.type === 'announce') {
      if (typeof input.message !== 'string' || !input.message.trim() || [...input.message].length > 240)
        throw new ControlError(400, 'Announcement must contain 1–240 characters');
      return { type: 'announce', message: input.message.trim() };
    }
    if (input.type === 'kick') {
      if (
        !validId(input.playerId) ||
        typeof input.reason !== 'string' ||
        !input.reason.trim() ||
        input.reason.length > 240
      )
        throw new ControlError(400, 'Player ID and reason are required');
      return { type: 'kick', playerId: input.playerId, reason: input.reason.trim() };
    }
    if (!['pause', 'resume', 'close', 'open', 'reset', 'rush-start', 'rush-stop', 'clear-bots'].includes(input.type))
      throw new ControlError(400, 'Unknown action');
    return { type: input.type } as CommandAction;
  }
  async expireCommand(key: string, id: string) {
    const row = await this.store.get<AdminCommand>(`commands/${key}/${id}`);
    if (!row.value || row.value.status !== 'pending' || row.value.expiresAt > this.now()) return;
    const config = await this.store.get<ConfigRecord>(`config/${key}`);
    const status = row.value.deliveredAt ? 'unknown' : 'expired';
    await this.store.commit(
      [row, config],
      [
        {
          key: row.key,
          value: {
            ...row.value,
            status,
            completedAt: this.now(),
            result: 'No application acknowledgement received before expiry',
          },
        },
        ...(config.value?.pending === id
          ? [{ key: config.key, value: { revision: config.value.revision, config: config.value.config } }]
          : []),
      ],
    );
  }
  async poll(ref: CityRef) {
    const key = cityKey(ref);
    const city = await this.store.get<CityReport>(`cities/${key}`);
    if (!city.value || city.value.ref.runtimeId !== ref.runtimeId)
      throw new ControlError(409, 'Runtime no longer owns this city');
    let config = await this.store.get<ConfigRecord>(`config/${key}`);
    if (config.value?.pending) {
      await this.expireCommand(key, config.value.pending);
      config = await this.store.get<ConfigRecord>(config.key);
    }
    const commandRow = config.value?.pending
      ? await this.store.get<AdminCommand>(`commands/${key}/${config.value.pending}`)
      : null;
    let command = commandRow?.value ?? null;
    if (
      commandRow &&
      command &&
      command.status === 'pending' &&
      command.runtimeId === ref.runtimeId &&
      !command.deliveredAt
    ) {
      const delivered = { ...command, deliveredAt: this.now() };
      if (!(await this.store.commit([commandRow], [{ key: commandRow.key, value: delivered }])))
        throw new ControlError(409, 'Command delivery changed');
      command = delivered;
    }
    const roster = await this.store.get<{ players: { guestId?: string }[] }>(`players/${key}`);
    const guestIds = [
      ...new Set(roster.value?.players.flatMap((p) => (p.guestId && validUuid(p.guestId) ? [p.guestId] : [])) ?? []),
    ];
    const bans = (
      await Promise.all(guestIds.map((guestId) => this.store.get<BanRecord>(`bans/${ref.deployment}/${guestId}`)))
    ).flatMap((r) =>
      r.value && !r.value.revokedAt && (r.value.expiresAt === null || r.value.expiresAt > this.now()) ? [r.value] : [],
    );
    return {
      config: config.value,
      command: command?.runtimeId === ref.runtimeId && command.status === 'pending' ? command : null,
      bans,
      observedUntil: city.value.observedUntil ?? 0,
    };
  }
  async acknowledge(ref: CityRef, id: string, status: 'applied' | 'rejected', result: string) {
    if (
      !validUuid(id) ||
      !['applied', 'rejected'].includes(status) ||
      typeof result !== 'string' ||
      result.length > 500
    )
      throw new ControlError(400, 'Invalid acknowledgement');
    const key = cityKey(ref);
    const row = await this.store.get<AdminCommand>(`commands/${key}/${id}`);
    const config = await this.store.get<ConfigRecord>(`config/${key}`);
    if (!row.value || !config.value || row.value.runtimeId !== ref.runtimeId)
      throw new ControlError(409, 'Command target mismatch');
    if (row.value.status === 'applied' || row.value.status === 'rejected') return row.value;
    const city = await this.store.get<CityReport>(`cities/${key}`);
    if (
      city.value?.ref.runtimeId !== ref.runtimeId ||
      config.value.revision !== row.value.expectedRevision ||
      (config.value.pending && config.value.pending !== id)
    )
      throw new ControlError(409, 'City ownership or revision changed before acknowledgement');
    const next = {
      revision: config.value.revision + (status === 'applied' ? 1 : 0),
      config:
        status === 'applied' && row.value.action.type === 'configure'
          ? row.value.action.config
          : status === 'applied' && row.value.action.type === 'clear-bots'
            ? { ...config.value.config, bots: { ...config.value.config.bots, mode: 'manual', count: 0 } }
            : config.value.config,
    };
    const completed = { ...row.value, status, completedAt: this.now(), result };
    if (
      !(await this.store.commit(
        [row, config, city],
        [
          { key: row.key, value: completed },
          { key: config.key, value: next },
          this.audit(row.value.actor, `command-${status}`, key, { id, result }),
        ],
      ))
    )
      throw new ControlError(409, 'Acknowledgement raced another update');
    return completed;
  }
  async isBanned(deployment: string, guestId: string) {
    if (!validUuid(guestId)) throw new ControlError(400, 'Invalid guest identity');
    const row = await this.store.get<BanRecord>(`bans/${deployment}/${guestId}`);
    return !!row.value && !row.value.revokedAt && (row.value.expiresAt === null || row.value.expiresAt > this.now());
  }
}
export function deploymentRecord(id: string, label: string, regions: string[], token: string): DeploymentRecord {
  if (
    !validId(id) ||
    typeof label !== 'string' ||
    label.length > 80 ||
    !Array.isArray(regions) ||
    !regions.length ||
    regions.length > 40 ||
    !regions.every(validId) ||
    typeof token !== 'string' ||
    token.length < 32
  )
    throw new ControlError(400, 'Invalid deployment registration');
  return { id, label, regions, tokenHash: hash(token), defaults: defaultCityConfig() };
}
