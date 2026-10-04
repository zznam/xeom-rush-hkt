/** Control traffic is JSON and deliberately independent of the simulation protocol. */
export type AdminRole = 'owner' | 'gm' | 'moderator';
export type BotLevel = 'easy' | 'normal' | 'hard';
export type PlayMode = 'career' | 'sandbox';
export interface BotSkillProfile {
  decisionMs: number;
  turnRate: number;
  routeNoise: number;
  valueWeight: number;
  lawfulness: number;
  aggression: number;
  riskTolerance: number;
}
export interface BotPopulationConfig {
  mode: 'manual' | 'automatic';
  count: number;
  target: number;
  minimum: number;
  maximum: number;
  mix: Record<BotLevel, number>;
  profiles: Record<BotLevel, BotSkillProfile>;
}
export interface GameRules {
  passengerLimit: number;
  tiers: { regular: number; business: number; vip: number };
  fareMultiplier: number;
  driverFine: number;
  redLightFine: number;
  pedestrianFine: number;
  speed: number;
  driverCollisions: boolean;
  pedestriansPerCrosswalk: number;
  greenSeconds: number;
  yellowSeconds: number;
  rushIntervalSeconds: number;
  rushDurationSeconds: number;
  rushFareMultiplier: number;
  rushSpawnMultiplier: number;
}
export interface CityConfig {
  mode: PlayMode;
  bots: BotPopulationConfig;
  rules: GameRules;
}
export const STANDARD_RULES: GameRules = {
  passengerLimit: 80,
  tiers: { regular: 70, business: 20, vip: 10 },
  fareMultiplier: 1,
  driverFine: 1000,
  redLightFine: 2000,
  pedestrianFine: 5000,
  speed: 200,
  driverCollisions: true,
  pedestriansPerCrosswalk: 2,
  greenSeconds: 8,
  yellowSeconds: 2,
  rushIntervalSeconds: 300,
  rushDurationSeconds: 60,
  rushFareMultiplier: 1.5,
  rushSpawnMultiplier: 2,
};
export const DEFAULT_BOTS: BotPopulationConfig = {
  mode: 'manual',
  count: 8,
  target: 8,
  minimum: 0,
  maximum: 20,
  mix: { easy: 0, normal: 100, hard: 0 },
  profiles: {
    easy: {
      decisionMs: 750,
      turnRate: 0.18,
      routeNoise: 16,
      valueWeight: 0.5,
      lawfulness: 0.85,
      aggression: 0.4,
      riskTolerance: 0.1,
    },
    normal: {
      decisionMs: 50,
      turnRate: 0.35,
      routeNoise: 7,
      valueWeight: 1,
      lawfulness: 0.8,
      aggression: 0.575,
      riskTolerance: 0.175,
    },
    hard: {
      decisionMs: 50,
      turnRate: 0.5,
      routeNoise: 0,
      valueWeight: 1.5,
      lawfulness: 0.8,
      aggression: 0.575,
      riskTolerance: 0.175,
    },
  },
};
export function defaultCityConfig(): CityConfig {
  return structuredClone({ mode: 'career', bots: DEFAULT_BOTS, rules: STANDARD_RULES });
}
export const RULE_LIMITS: Record<Exclude<keyof GameRules, 'tiers' | 'driverCollisions'>, [number, number, number]> = {
  passengerLimit: [0, 200, 1],
  fareMultiplier: [0, 5, 0.1],
  driverFine: [0, 20000, 100],
  redLightFine: [0, 20000, 100],
  pedestrianFine: [0, 20000, 100],
  speed: [100, 400, 10],
  pedestriansPerCrosswalk: [0, 4, 1],
  greenSeconds: [2, 60, 1],
  yellowSeconds: [1, 10, 1],
  rushIntervalSeconds: [60, 3600, 1],
  rushDurationSeconds: [5, 600, 1],
  rushFareMultiplier: [1, 5, 0.1],
  rushSpawnMultiplier: [1, 10, 1],
};
export const SKILL_LIMITS: Record<keyof BotSkillProfile, [number, number, number]> = {
  decisionMs: [50, 2000, 50],
  turnRate: [0.1, 0.7, 0.05],
  routeNoise: [0, 30, 1],
  valueWeight: [0.1, 2, 0.1],
  lawfulness: [0, 1, 0.05],
  aggression: [0, 1, 0.05],
  riskTolerance: [0, 1, 0.05],
};
export class ConfigValidationError extends Error {}

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ConfigValidationError('Expected an object');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => !keys.includes(key)) || keys.some((key) => !(key in result)))
    throw new ConfigValidationError('Unexpected or missing fields');
  return result;
}
function number(value: unknown, min: number, max: number, integer = false): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    throw new ConfigValidationError(`Expected ${integer ? 'integer' : 'number'} from ${min} to ${max}`);
  return value;
}
function weights(value: unknown, keys: string[]): void {
  const input = object(value, keys);
  if (Math.abs(keys.reduce((sum, key) => sum + number(input[key], 0, 100), 0) - 100) > 0.001)
    throw new ConfigValidationError('Percentages must sum to 100');
}
export function validateCityConfig(value: unknown): CityConfig {
  const c = object(value, ['mode', 'bots', 'rules']);
  if (c.mode !== 'career' && c.mode !== 'sandbox') throw new ConfigValidationError('Invalid play mode');
  const b = object(c.bots, ['mode', 'count', 'target', 'minimum', 'maximum', 'mix', 'profiles']);
  if (b.mode !== 'manual' && b.mode !== 'automatic') throw new ConfigValidationError('Invalid bot mode');
  for (const key of ['count', 'minimum', 'maximum']) number(b[key], 0, 50, true);
  number(b.target, 0, 250, true);
  if ((b.minimum as number) > (b.maximum as number)) throw new ConfigValidationError('Bot minimum exceeds maximum');
  weights(b.mix, ['easy', 'normal', 'hard']);
  const profiles = object(b.profiles, ['easy', 'normal', 'hard']);
  for (const profile of Object.values(profiles)) {
    const p = object(profile, Object.keys(SKILL_LIMITS));
    for (const [key, [min, max]] of Object.entries(SKILL_LIMITS)) number(p[key], min, max);
  }
  const r = object(c.rules, Object.keys(STANDARD_RULES));
  for (const [key, [min, max, step]] of Object.entries(RULE_LIMITS)) number(r[key], min, max, step >= 1);
  if (typeof r.driverCollisions !== 'boolean') throw new ConfigValidationError('Invalid collision setting');
  weights(r.tiers, ['regular', 'business', 'vip']);
  if ((r.rushDurationSeconds as number) > (r.rushIntervalSeconds as number))
    throw new ConfigValidationError('Rush duration exceeds interval');
  if (c.mode === 'career' && !isStandardRules(r as unknown as GameRules))
    throw new ConfigValidationError('Custom rules require sandbox mode');
  return structuredClone(value as CityConfig);
}
export function isStandardRules(rules: GameRules): boolean {
  return Object.keys(STANDARD_RULES).every((key) => {
    const k = key as keyof GameRules;
    return k === 'tiers'
      ? Object.keys(STANDARD_RULES.tiers).every(
          (t) => rules.tiers[t as keyof GameRules['tiers']] === STANDARD_RULES.tiers[t as keyof GameRules['tiers']],
        )
      : rules[k] === STANDARD_RULES[k];
  });
}
export interface CityRef {
  deployment: string;
  region: string;
  room: string;
  runtimeId: string;
  persistent: boolean;
}
export function cityKey(ref: CityRef): string {
  return [ref.deployment, ref.region, ref.room, ...(ref.persistent ? [] : [ref.runtimeId])].join(':');
}
export interface AdminPlayer {
  id: string;
  guestId?: string;
  username: string;
  x: number;
  y: number;
  score: number;
  deliveries: number;
  connected: boolean;
  bot: boolean;
}
export interface CityReport {
  ref: CityRef;
  revision: number;
  config: CityConfig;
  tick: number;
  tickMs: number;
  humans: number;
  bots: { current: number; requested: number; retiring: number };
  paused: boolean;
  admissionsOpen: boolean;
  lastSeen: number;
  observedUntil?: number;
  players?: AdminPlayer[];
  map?: { passengers: { x: number; y: number; tier: number }[] };
}
export type CommandAction =
  | { type: 'configure'; config: CityConfig }
  | { type: 'pause' | 'resume' | 'close' | 'open' | 'reset' | 'rush-start' | 'rush-stop' | 'clear-bots' }
  | { type: 'announce'; message: string }
  | { type: 'kick'; playerId: string; reason: string };
export interface AdminCommand {
  id: string;
  city: string;
  runtimeId: string;
  expectedRevision: number;
  action: CommandAction;
  actor: string;
  createdAt: number;
  expiresAt: number;
  status: 'pending' | 'applied' | 'rejected' | 'expired' | 'unknown';
  result?: string;
  completedAt?: number;
  deliveredAt?: number;
}
export interface BanRecord {
  deployment: string;
  guestId: string;
  reason: string;
  expiresAt: number | null;
  actor: string;
  createdAt: number;
  revokedAt?: number;
}
export interface AdminStaff {
  id: string;
  login: string;
  role: AdminRole;
  disabled?: boolean;
}
export function mayCommand(role: AdminRole, action: CommandAction): boolean {
  return role !== 'moderator' || action.type === 'announce' || action.type === 'kick';
}
