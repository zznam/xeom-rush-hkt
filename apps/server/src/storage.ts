import { dbManager } from './db';
import { savePlayerSession, type ISessionStats } from './persist';
import { resolveDeploymentTarget } from '@xeom-rush/shared';

type Key = (string | number)[];
interface Entry<T> {
  key: Key;
  value: T | null;
  versionstamp: string | null;
}
interface Atomic {
  check(...entries: { key: Key; versionstamp: string | null }[]): Atomic;
  set(key: Key, value: unknown, options?: { expireIn: number }): Atomic;
  delete(key: Key): Atomic;
  commit(): Promise<{ ok: boolean }>;
}
export interface KvStore {
  get<T>(key: Key): Promise<Entry<T>>;
  list<T>(selector: { prefix: Key }, options?: { limit?: number }): AsyncIterable<Entry<T>>;
  atomic(): Atomic;
  close(): void;
}
interface Profile {
  username: string;
  careerScore: number;
  peakScore: number;
  peakStreak: number;
  totalDeliveries: number;
}

// The adapter keeps simulation and the wire protocol identical on Node and Deno.
export class KvPersistence {
  constructor(private kv: KvStore) {}

  async save(sessionId: string, stats: ISessionStats): Promise<void> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const profileKey = stats.profileId ? ['players-v2', stats.profileId] : ['players', stats.username];
      const boardKey = stats.profileId ? 'leaderboard-v2' : 'leaderboard';
      const identity = stats.profileId ?? stats.username;
      const profile = await this.kv.get<Profile>(profileKey);
      const previous = await this.kv.get<ISessionStats>(['sessions', sessionId]);
      if (previous.value && previous.value.profileId !== stats.profileId) throw new Error('Session owner mismatch');
      if (previous.value && JSON.stringify(previous.value) === JSON.stringify(stats)) return;
      const old = profile.value;
      const next: Profile = {
        username: stats.username,
        careerScore: (old?.careerScore ?? 0) + stats.score - (previous.value?.score ?? 0),
        totalDeliveries: (old?.totalDeliveries ?? 0) + stats.deliveriesCount - (previous.value?.deliveriesCount ?? 0),
        peakScore: Math.max(old?.peakScore ?? 0, stats.score),
        peakStreak: Math.max(old?.peakStreak ?? 0, stats.peakStreak),
      };
      const transaction = this.kv.atomic().check(profile, previous);
      if (old) transaction.delete([boardKey, -old.careerScore, identity]);
      const result = await transaction
        .set(profileKey, next)
        .set([boardKey, -next.careerScore, identity], next)
        .set(['sessions', sessionId], stats)
        .commit();
      if (result.ok) return;
    }
    throw new Error('Could not save score after concurrent updates');
  }

  async leaderboard(idBased = false): Promise<Profile[]> {
    const profiles: Profile[] = [];
    for await (const entry of this.kv.list<Profile>(
      { prefix: [idBased ? 'leaderboard-v2' : 'leaderboard'] },
      { limit: 10 },
    )) {
      if (entry.value) profiles.push(entry.value);
    }
    return profiles;
  }
  async health(): Promise<void> {
    await this.kv.get(['health']);
  }
  close(): void {
    this.kv.close();
  }
}

let kvPersistence: KvPersistence | null = null;
let dynamoPersistence: import('./dynamo-storage').DynamoPersistence | null = null;
export async function connectStorage(mongoUri: string): Promise<void> {
  if (resolveDeploymentTarget(process.env.DEPLOY_TARGET) === 'regional-production' && process.env.DYNAMODB_TABLE) {
    const { DynamoPersistence } = await import('./dynamo-storage.js');
    dynamoPersistence = new DynamoPersistence(process.env.DYNAMODB_TABLE);
    await dynamoPersistence.health();
    console.log('[Storage] Connected to regional DynamoDB');
    return;
  }
  const deno = (globalThis as unknown as { Deno?: { openKv(path?: string): Promise<KvStore> } }).Deno;
  if (deno) {
    kvPersistence = new KvPersistence(await deno.openKv(process.env.DENO_KV_PATH || undefined));
    console.log('[Storage] Connected to Deno KV');
  } else {
    await dbManager.connect(mongoUri);
  }
}
export async function storageHealth(): Promise<void> {
  if (dynamoPersistence) return dynamoPersistence.health();
  if (kvPersistence) return kvPersistence.health();
  await dbManager.getDb().command({ ping: 1 });
}
const writes = new Map<string, Promise<void>>();
export async function saveSession(id: string, stats: ISessionStats): Promise<void> {
  const previous = writes.get(id) ?? Promise.resolve();
  const write = previous
    .catch(() => {})
    .then(() =>
      dynamoPersistence
        ? dynamoPersistence.save(id, stats)
        : kvPersistence
          ? kvPersistence.save(id, stats)
          : stats.profileId
            ? saveIdSession(id, stats)
            : savePlayerSession(stats.username, stats),
    );
  writes.set(id, write);
  try {
    await write;
  } finally {
    if (writes.get(id) === write) writes.delete(id);
  }
}
export async function getLeaderboard(): Promise<Profile[]> {
  if (dynamoPersistence) return dynamoPersistence.leaderboard();
  if (kvPersistence) return kvPersistence.leaderboard(process.env.GAME_MASTER_ENABLED === '1');
  if (process.env.GAME_MASTER_ENABLED === '1') return idLeaderboard();
  const rows = await dbManager.getDb().collection('players').find().sort({ careerScore: -1 }).limit(10).toArray();
  return rows.map((p) => ({
    username: p.username,
    careerScore: p.careerScore,
    peakScore: p.peakScore,
    peakStreak: p.peakStreak,
    totalDeliveries: p.totalDeliveries,
  }));
}
export function isKvStorage(): boolean {
  return kvPersistence !== null || dynamoPersistence !== null;
}
export async function closeStorage(): Promise<void> {
  if (dynamoPersistence) dynamoPersistence.close();
  else if (kvPersistence) kvPersistence.close();
  else await dbManager.close();
}

// ID-based Mongo careers derive totals from unique session contributions. This also
// works on standalone development Mongo without requiring replica-set transactions.
async function saveIdSession(id: string, stats: ISessionStats): Promise<void> {
  await dbManager
    .getDb()
    .collection('career_sessions_v2')
    .updateOne(
      { _id: id as never, profileId: stats.profileId },
      { $set: { ...stats, updatedAt: new Date() } },
      { upsert: true },
    );
}
async function idLeaderboard(): Promise<Profile[]> {
  const rows = await dbManager
    .getDb()
    .collection('career_sessions_v2')
    .aggregate<Profile>([
      { $sort: { updatedAt: 1 } },
      {
        $group: {
          _id: '$profileId',
          username: { $last: '$username' },
          careerScore: { $sum: '$score' },
          totalDeliveries: { $sum: '$deliveriesCount' },
          peakScore: { $max: '$score' },
          peakStreak: { $max: '$peakStreak' },
        },
      },
      { $sort: { careerScore: -1 } },
      { $limit: 10 },
      { $project: { _id: 0 } },
    ])
    .toArray();
  return rows;
}
